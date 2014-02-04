var csv = require("csv"),
	fs = require("fs"),
	request = require('request'),
	strip = require('strip'),
	log4js = require('log4js');


var configPath = "config/";

log4js.configure(configPath + "log4js-config.json",{level: "INFO"});

var logger = log4js.getLogger('tea-loader');
var reportLogger = log4js.getLogger('report');


/**
 * Log to the log files
 */
function log(message){
	logger.info(message);
}

function report(message){
	logger.info(message);
	reportLogger.info(message);
}

/**
 *	Write out a message, and exit with error status
 */
function bomb(message) {
	logger.error(message);
	reportLogger.error(message);
	process.exit(1);
} 

exports.load = function(host, accessToken, sourceId, csvfile) {
	
	var credentials = {
		host : host,
		accessToken : accessToken,
		sourceId : sourceId
	}
	report("Loading " + csvfile + " with the following parameters: " + JSON.stringify(credentials));
	ProductLoader.execute(credentials, csvfile);
}

var ProductLoader = {
	
	headers : [ 'Name', 'Price', 'Weight', 'Manufacturer', 'Sku',
  				'Summary', 'Description', 'Categories', 'ImageUrl',
  				'Sub_ImageUrl', 'option' ],
	categoryMap : [],
	categoryIdMap : [],
	varianceMap :[],
	products : [],
	
	/**
	*	Entry point for the product loader
	*/
  	execute : function(credentials, csvfile){

  		functions = [
  		/* Step 1 */	function(next){ProductLoader.validate(csvfile, next)},
  		/* Step 2 */	function(next){ProductLoader.initializeCategoryMapping(next)},
  		/* Step 3 */	function(next){ProductLoader.initializeVarianceMapping(next)},
  		/* Step 4 */	function(next){ProductLoader.initializeCategoryIdMapping(credentials, next)},
  		/* Step 5 */	function(next){ProductLoader.parseDetails(credentials, csvfile, next)},
  		/* Step 6 */	function(next){ProductLoader.persist(credentials, next)}
  					];
  		/**
  		*	Facilitates running the functions synchronously.
  		*/
  		function next() {
		    var fn = functions.shift();
		    if(fn) {
			    fn(function() {
					next();
				});
		    } else {
		    	report("Processing completed.");
			}
		}
		next();
  	}, // end execute method


  	/**
  	*	Checks that the csv file is in the correct format.
  	*/
	validate : function(csvfile, next){

		report("Pass 1: Validation")
		var stream = fs.createReadStream(csvfile);
		stream.on('error', function (error) {bomb('CSV file error.')});

		// Verify each line of the CSV file
		var count = 0;
		var lineErrors = "";
		
		csv()
		.from.stream(stream, { delimiter: ',', escape: '"' })
		.on('record', function(row){
			if(count++ === 0){
				for (var i = 0; i < row.length; i++) {
					if( ProductLoader.headers[i] == undefined || ProductLoader.headers[i] != row[i] ) {
						lineErrors += "File headers should be: " + headers + "\n";
					} 
				};
			} else {
				if(row.length != ProductLoader.headers.length){
					lineErrors += "Line " + count + " currently has " + row.length + 
								  " columns. Proper format requires " + ProductLoader.headers.length + " columns.\n";
					lineErrors += "Row content: " + row;
				}
			}
		})
		.on('end', function(count){
			report("Done reading csv file containing " + count + " records.");
			if( lineErrors != ""){
				bomb(lineErrors.substr(0, lineErrors.length - 1)); //remove trailing newline character.
			}
			next();
		})
		.on('error', function(err){
			bomb("Pass 1: Error encountered: " + err);
		});

	}, // end validate method

	/**
	*	Loads the csv file that contains the mapping of Dropshipper categories
	*	to Metrosix categories and places it in a property map.
	*/
	initializeCategoryMapping : function (next){

		report("Retrieving Dropshipper -> Metrosix category mapping contained in: " + configPath + "category-mapping.csv");
		var stream = fs.createReadStream(configPath + "category-mapping.csv");
		stream.on('error', function (error) {bomb('CSV file error.')});

		var categoryMap = [];

		csv()
		.from.stream(stream, {columns: true})
		.on('record', function(category){
			categoryMap[category.from] = category.to;	
		})
		.on('end', function(count){
			report("Done reading csv file with " + count + " categories.");
			ProductLoader.categoryMap = categoryMap;
			next();
		})
		.on('error', function(err){
			bomb("Dropshipper -> Metrosix Category Mapping: Error encountered: " + err);
		});

	},// end initializeCategoryMapping

	/**
	*	Loads the csv file that contains the mapping of variance types
	*	and places it in a property map.
	*/
	initializeVarianceMapping : function (next){

		report("Retrieving variance mapping contained in: " + configPath + "variance-mapping.csv");
		var stream = fs.createReadStream(configPath + "variance-mapping.csv");
		stream.on('error', function (error) {bomb('CSV file error.')});

		var varianceMap = [];

		csv()
		.from.stream(stream, {columns: true})
		.on('record', function(variantInfo){
			varianceMap[(variantInfo.Variance + "").toLowerCase()] = variantInfo.Type;	
		})
		.on('end', function(count){
			report("Done reading csv file containing " + count + " variant types.");
			ProductLoader.varianceMap = varianceMap;
			next();
		})
		.on('error', function(err){
			bomb("Variance Mapping: Error encountered: " + err);
		});

	},// end initializeVarianceMapping


	/**
	*	Loads the category IDs from Tea /getParentCategories
	*	and places it in a property map.
	*/
	initializeCategoryIdMapping : function (credentials, next){

		report("Retrieving Metrosix Category ID mapping.");
		
		var categoryIds = [];

		var url = 'http://' + credentials.host + '/getParentCategories';
		var json = {
			accessToken : credentials.accessToken
		}

		request.apply(this, [{
			method: 'POST',
			url: url,
			json: json },
			function (error, response, body) {
				if (error) {
					bomb("Unexpected error: ", error);
				} else if (response.statusCode != 200) {
					bomb("Unexpected status code " + response.statusCode);
				} else {
					if(body === undefined || body.response === "Error"){
						bomb("Failed to retrieve category IDs.")
					}
					for (var i = body.categories.length - 1; i >= 0; i--) {
						categoryIds[body.categories[i].name.trim()] = body.categories[i].category_id;
					};
					ProductLoader.categoryIdMap = categoryIds;
					report("Successfully retrieved " + body.categories.length + " Category IDs.")
					next();
				}
			}
		]);

	},

	/**
	*	Loads the products from the dropshipper's csv file onto a
	*	property array.
	*/
	parseDetails : function(credentials, csvfile, next){
		report("Pass 2: Load Details")
		var stream = fs.createReadStream(csvfile);
		stream.on('error', function (error) {bomb('CSV file error.')});

		// Load csv file rows into a map
		var count = 0;
		var item = {};
		var products = [];
		var lineErrors = "";

		csv()
		.from.stream(stream, { columns : true })
		.on('record', function(item){
			item.lineNumber = ++count;
			ProductLoader.insertVariant(products, ProductLoader.createVariant(item));
		})
		.on('end', function(count){
			report("Done reading csv file containing " + count + " records with " + products.length + " products.");
			ProductLoader.products = products;
			next();
		})
		.on('error', function(err){
			bomb("Pass 2: Error encountered: " + err);
		});

	},// end load method

	/**
	*	Saves the products into the database using webservices.
	*/
	persist : function(credentials, next){

		report("Pass 3: Upload to TEA");
		log("Uploading products, please wait...");
	
		var url = 'http://' + credentials.host + '/loadProducts';
		var json = {
			accessToken : credentials.accessToken,
			products: ProductLoader.products 
		};

		request({
			method: 'POST',
			url: url,
			json: json
		}, function (error, response, body) {

			if (error) {
				bomb("Unexpected error: ", error);
			} else if (response.statusCode != 200) {
				bomb("Unexpected status code " + response.statusCode);
			} else {
				if (body === undefined || body.response !== 'Success') {
					bomb('ERROR: response="' + body.response + '", message="' + body.message + '"');
				} else {
					report("Successfully saved products.");
				}
				next();
			}
		});

	},// end persist method


	/**
	*	Creates a variant JSON object using details from the items
	*	retrieved from the csv file.
	*/
	createVariant: function(item){
		var variant = {
			lineNumber : item.lineNumber,
			categoryId : ProductLoader.categoryIdMap[ProductLoader.categoryMap[item.Categories]],
			productName : item.Name,
			manufacturer : item.Manufacturer,
			shortDescription : strip(item.Summary),
			longDescription : strip(item.Description),
			sku : item.Sku,
			costPrice : item.Price,
			weight : item.Weight,
			varianceValue : ProductLoader.varianceMap[(item.option + "").toLowerCase()] ? item.option : null,
			variance : ProductLoader.varianceMap[(item.option + "").toLowerCase()],
			imageType : ProductLoader.getImageExtension(item.ImageUrl),
			imagePath : item.ImageUrl,
			imageName : ProductLoader.getImageName(item.ImageUrl),
			//properties below are hard coded since they are not provided in the dropshipper's file
			quantity : 0,
			barcode : null,
			format : "",
			isDisplayed : true,
			teaIdAtSource : 0,
			metaTitle : null,
			metaDescription : null,
			metaKeyword : null,
			serialNo : null,
			statusOnly : "0"
		}
		return variant;
	}, // end createVariant method


	/**
	*	Places items under categories for more efficient storage during
	*	persist stage.
	*/
	insertVariant : function(products, itemVariant){
		var productIndex = ProductLoader.findInList(products, itemVariant.productName);
		if( productIndex != -1 ){ // item product was found
			products[productIndex].variants.push(itemVariant);
		} else { // add a new product under this category
			if(itemVariant.categoryId == undefined){
				report("Item : " + itemVariant.productName + " will not be uploaded since it does not have a category.");
			} else {
				products.push({
					name : itemVariant.productName,
					variants : [itemVariant]
				});
			}
		}
	}, // end insertVariant method

	/**
	*	Parses the imageUrl provided for the file extension
	*/
	getImageExtension : function(imageUrl){
		if(imageUrl != undefined && imageUrl.length > 0 && imageUrl.lastIndexOf(".") != -1){
			return imageUrl.substr(imageUrl.lastIndexOf(".") + 1);
		}
	},

	/**
	*	Parses the imageUrl provided for the file name
	*/
	getImageName : function(imageUrl){
		if(imageUrl != undefined && imageUrl.length > 0 && imageUrl.lastIndexOf("/") != -1){
			return imageUrl.substring(imageUrl.lastIndexOf("/") + 1, imageUrl.lastIndexOf("."));
		}
	},

	/**
	*	Convenience method for locating an object in a list using
	*	its id property.
	*/
	findInList : function(list, name){
		for (var i = list.length - 1; i >= 0; i--) {
			if(list[i].name === name) return i;
		}
		return -1;
	}
	
}


