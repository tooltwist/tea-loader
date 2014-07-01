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
    var uuid = require('node-uuid');
    // retrieve plugin options
    var batchCount = options.batchCount;
    var variance_mapping_path = options.varianceMapping;
    var category_mapping_path = options.categoryMapping;
    var productHeaders = options.productHeaders;
    // collections
    var categoryMap = {};
    var categoryIdMap = [];
    var varianceMap = [];
    var products = [];
    /**
     *  Entry point for the product loader
     */
    function load(settings) {
        // the following functions will be executed synchronously
        functions = [
            // validate,
            initializeCategoryMapping,
            //initializeVarianceMapping,
            //initializeCategoryIdMapping,
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
                    if (productHeaders[i] === undefined || productHeaders[i] !== row[i]) {
                        lineErrors += "File headers should be: " + productHeaders + "\n";
                    }
                }
            } else {
                if (row.length != productHeaders.length) {
                    lineErrors += "Line " + count + " currently has " + row.length + " columns. Proper format requires " + productHeaders.length + " columns.\n";
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
        var categories = {};
        csv().from.stream(stream, {
            columns: true
        }).on('record', function(category) {
            var key = category.parent_category.split(' ').join('_') + category.category1.split(' ').join('_') + category.category2.split(' ').join('_');
            categories[key] = category.category_id;
        }).on('end', function(count) {
            logger.report("Done reading csv file with " + count + " categories.");
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
            var batches = Math.floor(products.length / batchCount);
            var remaining = products.length % batchCount;
            logger.report("Pass 3: Upload to TEA");
            logger.log("Uploading products, please wait...");
            if(products.length > batchCount) {
                logger.log("Will be uploading " + batches + " batches of " + batchCount + " and a remainder of " + remaining + " for a total of " + products.length + ".");
            } else {
                logger.log("Will be uploading a total of " + products.length + " products.");
            }

            function callNextBatch(i) {
                logger.report("Loading batch: " + i);
                persistBatch(settings, products.slice((i - 1) * batchCount, i * batchCount), function(result) {
                    if (result === undefined || result.response !== 'Success') {
                        logger.error("Transaction completed with the following errors:\n" + result.message);
                    } else {
                        logger.report("Successfully saved products.");
                    }
                    if (i < batches) {
                        callNextBatch(i + 1);
                    } else {
                        if(products.length > batchCount && remaining > 0){
                            logger.report("Loading last batch.");
                            persistBatch(settings, products.slice((-1) * remaining), function(result) {
                                if (result === undefined || result.response !== 'Success') {
                                    logger.error("Transaction completed with the following errors:\n" + result.message);
                                } else {
                                    logger.report("Successfully saved products.");
                                }
                                callback();
                            });
                        } else {
                            callback();
                        }
                    }
                });
            }
            callNextBatch(1);
        } else {
            logger.report("No products to upload.");
        }
    } // end persist method
    function persistBatch(settings, products, callback) {
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
                callback(body);
            }
        });
    }
    /**
     *  Creates a variant JSON object using details from the items
     *  retrieved from the csv file.
     */
    function createVariant(item) {

        var variant = {};

        for(var key in item){
            if(productHeaders.indexOf(key) === -1){
                if(!variant.variance){
                    variant.variance = {};
                }
                if(item[key]){
                    variant.variance[key] = item[key];
                }
            }
        }
        
        variant.lineNumber = item.lineNumber + 1;
        variant.base = item.base;
        variant.categoryId = categoryMap[item["product parent"].split(' ').join('_') + item["category 1"].split(' ').join('_') + item["category 2"].split(' ').join('_')];
        variant.productName = item.name;
        variant.manufacturer = item.manufacturer;
        variant.shortDescription = item.short_description;
        variant.longDescription = encodeURIComponent(item.long_description);
        variant.sku = item.store_sku;
        variant.manufacturerSku = item.manufacturer_sku;
        variant.supplierSku = item.supplier_sku;
        variant.serialNo = item.serial_number;
        variant.costPrice = item.cost_price;
        variant.salePrice = item.sale_price;
        variant.manufacturerPrice = item.manufacturer_srp ? item.manufacturer_srp : 0;
        variant.weight = item.weight;
        //variant.varianceValue = "";//varianceMap[(item.option + "").toLowerCase()] ? item.option : null;
        //variant.variance = "";//varianceMap[(item.option + "").toLowerCase()];
        variant.images = [];
        if (item.image_url) {
            variant.images.push({
                imageType: utils.getResourceExtension(item.image_url),
                imagePath: item.image_url,
                imageName: utils.getResourceName(item.image_url),
                imageSize: 0
            });
        }
        if (item.sub_image_url) {
            variant.images.push({
                imageType: utils.getResourceExtension(item.sub_image_url),
                imagePath: item.sub_image_url,
                imageName: utils.getResourceName(item.sub_image_url),
                imageSize: 0
            });
        }
        variant.quantity = item.quantity;
        variant.barcode = item.barcode;
        variant.metaTitle = item.meta_title;
        variant.metaDescription = item.meta_desc;
        //properties below are hard coded since they are not provided in the dropshipper's file
        variant.format = "";
        variant.isDisplayed = true;
        variant.teaIdAtSource = 0;
        variant.metaKeyword = null;
        variant.statusOnly = "0";
        return variant;
    } // end createVariant method
    /**
     *  Places items under categories for more efficient storage during
     *  persist stage.
     */
    function insertVariant(productList, itemVariant) {
        utils.findInList(productList, "name", itemVariant.base, function(productIndex) {
            validateVariant(itemVariant, function(err) {
                if (!err) {
                    if (productIndex != -1) { // item product was found
                        productList[productIndex].variants.push(itemVariant);
                    } else { // add a new product under this category
                        productList.push({
                            name: itemVariant.base,
                            variants: [itemVariant]
                        });
                    }
                }
            });
        });
    } // end insertVariant method
    function validateVariant(itemVariant, callback){
        var errorFound = false;
        if(!itemVariant.categoryId){
            logger.error("Line No. " + itemVariant.lineNumber + " Item : " + itemVariant.productName + " will not be uploaded since it does not have a category.");
            errorFound = true;
        }
        if(!itemVariant.sku){
            logger.error("Line No. " + itemVariant.lineNumber + " Item : " + itemVariant.productName + " will not be uploaded since it does not have an SKU.");
            errorFound = true;
        }
        if(!itemVariant.shortDescription){
            logger.warn("Line No." + itemVariant.lineNumber + " Item : " + itemVariant.productName + " does not have a short description.");
        }
        if(!itemVariant.longDescription){
            logger.warn("Line No." + itemVariant.lineNumber + " Item : " + itemVariant.productName + " does not have a long description.");
        }
        if(!itemVariant.sku){
            logger.warn("Line No." + itemVariant.lineNumber + " Item : " + itemVariant.productName + " does not have a SKU.");
        }
        if(!itemVariant.images || itemVariant.images.length < 1){
            logger.warn("Line No." + itemVariant.lineNumber + " Item : " + itemVariant.productName + " does not have any images.");
        }
        if(!itemVariant.serialNo){
            logger.warn("Line No." + itemVariant.lineNumber + " Item : " + itemVariant.productName + " does not have a serial number.  Generating serial...");
            itemVariant.serialNo = '1111';
            logger.warn("Generated serial: " + itemVariant.serialNo);
        }
        if(!itemVariant.quantity){
            logger.warn("Line No." + itemVariant.lineNumber + " Item : " + itemVariant.productName + " has no quantity.  Setting quantity to 10...");
            itemVariant.quantity = 10;
        }
        if(!itemVariant.salePrice){
            logger.warn("Line No." + itemVariant.lineNumber + " Item : " + itemVariant.productName + " has no sale price.  Item will be saved but not displayed.");
            itemVariant.isDisplayed = false;
        }

        callback(errorFound);
    }
    register(null, {
        productLoader: {
            load: load
        }
    });
};