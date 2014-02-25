// loader.js
/* 
 * @options is the hash of options the user passes in when creating an instance
 * of the plugin.
 * @imports is a hash of all services this plugin consumes.
 * @register is the callback to be called when the plugin is done initializing.
 */
module.exports = function setup(options, imports, register) {
    // imported modules
    var logger = imports.logger;
    var utils = imports.utils;
    var request = require("request");
    var csv = require("csv");
    var fs = require("fs");
    var strip = require('strip');
    // retrieve plugin options
    var variance_mapping_path = options.varianceMapping;
    var category_mapping_path = options.categoryMapping;
    var product_headers = options.product_headers;
    // collections
    var categoryMap = [];
    var categoryIdMap = [];
    var varianceMap = [];
    var products = [];
    /**
     *  Entry point for the product loader
     */
    function load(settings) {
        // the following functions will be executed synchronously
        functions = [
            validate,
            initializeCategoryMapping,
            initializeVarianceMapping,
            initializeCategoryIdMapping,
            parseDetails,
            persist
        ];
        logger.report("Loading " + settings.csvFile + " with the following parameters: " + JSON.stringify(settings));
        utils.synchronize(functions, settings);
    } // end execute method
    /**
     *  Checks that the csv file is in the correct format.
     */
    function validate(settings, callback) {
        logger.log("Received settings: " + JSON.stringify(settings));
        logger.report("Pass 1: Validation");
        var stream = fs.createReadStream(settings.csvFile);
        stream.on('error', function(error) {
            logger.bomb('CSV file error.');
        });
        // Verify each line of the CSV file
        var count = 0;
        var lineErrors = "";
        csv().from.stream(stream, {
            delimiter: ',',
            escape: '"'
        }).on('record', function(row) {
            if (count++ === 0) {
                for (var i = 0; i < row.length; i++) {
                    if (product_headers[i] === undefined || product_headers[i] !== row[i]) {
                        lineErrors += "File product_headers should be: " + product_headers + "\n";
                    }
                }
            } else {
                if (row.length != product_headers.length) {
                    lineErrors += "Line " + count + " currently has " + row.length + " columns. Proper format requires " + product_headers.length + " columns.\n";
                    lineErrors += "Row content: " + row;
                }
            }
        }).on('end', function(count) {
            logger.report("Done reading csv file containing " + count + " records.");
            if (lineErrors !== "") {
                logger.bomb(lineErrors.substr(0, lineErrors.length - 1)); //remove trailing newline character.
            }
            callback();
        }).on('error', function(err) {
            logger.bomb("Pass 1: Error encountered: " + err);
        });
    } // end validate method
    /**
     *  Loads the csv file that contains the mapping of Dropshipper categories
     *  to Metrosix categories and places it in a property map.
     */
    function initializeCategoryMapping(settings, callback) {
        logger.report("Retrieving Dropshipper -> Metrosix category mapping contained in: " + category_mapping_path);
        var stream = fs.createReadStream(category_mapping_path);
        stream.on('error', function(error) {
            logger.bomb('CSV file error.');
        });
        var categories = [];
        csv().from.stream(stream, {
            columns: true
        }).on('record', function(category) {
            categories[category.from] = category.to;
        }).on('end', function(count) {
            logger.report("Done reading csv file with " + categories.length + " categories.");
            categoryMap = categories;
            callback();
        }).on('error', function(err) {
            logger.bomb("Dropshipper -> Metrosix Category Mapping: Error encountered: " + err);
        });
    } // end initializeCategoryMapping
    /**
     *  Loads the csv file that contains the mapping of variance types
     *  and places it in a property map.
     */
    function initializeVarianceMapping(settings, callback) {
        logger.report("Retrieving variance mapping contained in: " + variance_mapping_path);
        var stream = fs.createReadStream(variance_mapping_path);
        stream.on('error', function(error) {
            logger.bomb('CSV file error.');
        });
        var variances = [];
        csv().from.stream(stream, {
            columns: true
        }).on('record', function(variantInfo) {
            variances[(variantInfo.Variance + "").toLowerCase()] = variantInfo.Type;
        }).on('end', function(count) {
            logger.report("Done reading csv file containing " + count + " variant types.");
            varianceMap = variances;
            callback();
        }).on('error', function(err) {
            logger.bomb("Variance Mapping: Error encountered: " + err);
        });
    } // end initializeVarianceMapping
    /**
     *  Loads the category IDs from Tea /getParentCategories
     *  and places it in a property map.
     */
    function initializeCategoryIdMapping(settings, callback) {
        logger.report("Retrieving Metrosix Category ID mapping.");
        var categoryIds = [];
        var url = 'http://' + settings.host + '/getParentCategories';
        var json = {
            accessToken: settings.accessToken
        };
        logger.log("Sending request to: " + url);
        logger.log("Request payload: " + JSON.stringify(json));
        request({
            method: 'POST',
            url: url,
            json: json
        }, function(error, response, body) {
            if (error) {
                logger.bomb("Unexpected error: ", error);
            } else if (response.statusCode != 200) {
                logger.bomb("Unexpected status code " + response.statusCode);
            } else {
                if (body === undefined || body.response === "Error") {
                    logger.bomb("Failed to retrieve category IDs.");
                }
                for (var i = body.categories.length - 1; i >= 0; i--) {
                    categoryIds[body.categories[i].name.trim()] = body.categories[i].category_id;
                }
                categoryIdMap = categoryIds;
                logger.report("Successfully retrieved " + body.categories.length + " Category IDs.");
                callback();
            }
        });
    } // end initializeCategoryIdMapping
    /**
     *  Loads the products from the dropshipper's csv file onto a
     *  property array.
     */
    function parseDetails(settings, callback) {
        logger.report("Pass 2: Load Details");
        var stream = fs.createReadStream(settings.csvFile);
        stream.on('error', function(error) {
            logger.bomb('CSV file error.');
        });
        // Load csv file rows into a map
        var count = 0;
        var item = {};
        var productsList = [];
        var lineErrors = "";
        csv().from.stream(stream, {
            columns: true
        }).on('record', function(item) {
            item.lineNumber = ++count;
            insertVariant(productsList, createVariant(item));
        }).on('end', function(count) {
            logger.report("Done reading csv file containing " + count + " rows with " + productsList.length + " valid products.");
            products = productsList;
            callback();
        }).on('error', function(err) {
            logger.bomb("Pass 2: Error encountered: " + err);
        });
    } // end parseDetails method
    /**
     *  Saves the products into the database using webservices.
     */
    function persist(settings, callback) {
        if (products && products.length > 0) {
            logger.report("Pass 3: Upload to TEA");
            logger.log("Uploading products, please wait...");
            var url = 'http://' + settings.host + '/loadProducts';
            var json = {
                accessToken: settings.accessToken,
                products: products
            };
            request({
                method: 'POST',
                url: url,
                json: json
            }, function(error, response, body) {
                if (error) {
                    logger.bomb("Unexpected error: ", error);
                } else if (response.statusCode != 200) {
                    logger.bomb("Unexpected status code " + response.statusCode);
                } else {
                    if (body === undefined || body.response !== 'Success') {
                        logger.bomb('ERROR: response="' + body.response + '", message="' + body.message + '"');
                    } else {
                        logger.report("Successfully saved products.");
                    }
                    callback();
                }
            });
        } else {
            logger.report("No products to upload.");
        }
    } // end persist method
    /**
     *  Creates a variant JSON object using details from the items
     *  retrieved from the csv file.
     */
    function createVariant(item) {
        var variant = {};
        variant.lineNumber = item.lineNumber;
        variant.categoryId = categoryIdMap[categoryMap[item.Categories]];
        variant.productName = item.Name;
        variant.manufacturer = item.Manufacturer;
        variant.shortDescription = strip(item.Summary);
        variant.longDescription = strip(item.Description);
        variant.sku = item.Sku;
        variant.costPrice = item.Price;
        variant.weight = item.Weight;
        variant.varianceValue = varianceMap[(item.option + "").toLowerCase()] ? item.option : null;
        variant.variance = varianceMap[(item.option + "").toLowerCase()];
        variant.images = [{
            imageType: utils.getResourceExtension(item.ImageUrl),
            imagePath: item.ImageUrl,
            imageName: utils.getResourceName(item.ImageUrl),
            imageSize: 0
        }, {
            imageType: utils.getResourceExtension(item.Sub_ImageUrl),
            imagePath: item.Sub_ImageUrl,
            imageName: utils.getResourceName(item.Sub_ImageUrl),
            imageSize: 0
        }];
        //properties below are hard coded since they are not provided in the dropshipper's file
        variant.quantity = 0;
        variant.barcode = null;
        variant.format = "";
        variant.isDisplayed = true;
        variant.teaIdAtSource = 0;
        variant.metaTitle = null;
        variant.metaDescription = null;
        variant.metaKeyword = null;
        variant.serialNo = null;
        variant.statusOnly = "0";
        return variant;
    } // end createVariant method
    /**
     *  Places items under categories for more efficient storage during
     *  persist stage.
     */
    function insertVariant(productList, itemVariant) {
        utils.findInList(productList, "name", itemVariant.productName, function(productIndex) {
            if (productIndex != -1) { // item product was found
                productList[productIndex].variants.push(itemVariant);
            } else { // add a new product under this category
                if (itemVariant.categoryId === undefined) {
                    logger.report("Item : " + itemVariant.productName + " will not be uploaded since it does not have a category.");
                } else {
                    productList.push({
                        name: itemVariant.productName,
                        variants: [itemVariant]
                    });
                }
            }
        });
    } // end insertVariant method
    register(null, {
        productLoader: {
            load: load
        }
    });
};