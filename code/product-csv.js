var csv = require("csv"),
    fs = require("fs"),
    strip = require('strip'),
    log4js = require('log4js'),
    request = require('request'),
    config = require("../config/config");
log4js.configure(config.settings.logger_config_file_path, {
    level: "INFO"
});
var logger = log4js.getLogger('tea-loader');
var reportLogger = log4js.getLogger('report');
/**
 * Log to the log files
 */
function log(message) {
    logger.info(message);
}

function report(message) {
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
exports.load = function(host, accessToken, sourceId, csvFile) {
    var settings = config.settings;
    settings.host = host;
    settings.accessToken = accessToken;
    settings.sourceId = sourceId;
    settings.csvFile = csvFile;
    report("Loading " + csvFile + " with the following parameters: " + JSON.stringify(settings));
    new ProductLoader().execute(settings);
};
var ProductLoader = (function() {
    var categoryMap = [];
    var categoryIdMap = [];
    var varianceMap = [];
    var products = [];
    /**
     *	Entry point for the product loader
     */
    function execute(settings) {
        functions = [
            /* Step 1 */
            function(next) {
                validate(settings, next);
            },
            /* Step 2 */
            function(next) {
                initializeCategoryMapping(settings, next);
            },
            /* Step 3 */
            function(next) {
                initializeVarianceMapping(settings, next);
            },
            /* Step 4 */
            function(next) {
                initializeCategoryIdMapping(settings, next);
            },
            /* Step 5 */
            function(next) {
                parseDetails(settings, next);
            },
            /* Step 6 */
            function(next) {
                persist(settings, next);
            }
        ];
        /**
         *	Facilitates running the functions synchronously.
         */
        function next() {
            var fn = functions.shift();
            if (fn) {
                fn(function() {
                    next();
                });
            } else {
                report("Processing completed.");
            }
        }
        next();
    } // end execute method
    /**
     *	Checks that the csv file is in the correct format.
     */
    function validate(settings, next) {
        report("Pass 1: Validation");
        var stream = fs.createReadStream(settings.csvFile);
        stream.on('error', function(error) {
            bomb('CSV file error.');
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
                    if (settings.product_headers[i] === undefined || settings.product_headers[i] !== row[i]) {
                        lineErrors += "File settings.product_headers should be: " + settings.product_headers + "\n";
                    }
                }
            } else {
                if (row.length != settings.product_headers.length) {
                    lineErrors += "Line " + count + " currently has " + row.length + " columns. Proper format requires " + settings.product_headers.length + " columns.\n";
                    lineErrors += "Row content: " + row;
                }
            }
        }).on('end', function(count) {
            report("Done reading csv file containing " + count + " records.");
            if (lineErrors !== "") {
                bomb(lineErrors.substr(0, lineErrors.length - 1)); //remove trailing newline character.
            }
            next();
        }).on('error', function(err) {
            bomb("Pass 1: Error encountered: " + err);
        });
    } // end validate method
    /**
     *	Loads the csv file that contains the mapping of Dropshipper categories
     *	to Metrosix categories and places it in a property map.
     */
    function initializeCategoryMapping(settings, next) {
        report("Retrieving Dropshipper -> Metrosix category mapping contained in: " + settings.category_mapping_path);
        var stream = fs.createReadStream(settings.category_mapping_path);
        stream.on('error', function(error) {
            bomb('CSV file error.');
        });
        var categoryMap = [];
        csv().from.stream(stream, {
            columns: true
        }).on('record', function(category) {
            categoryMap[category.from] = category.to;
        }).on('end', function(count) {
            report("Done reading csv file with " + count + " categories.");
            categoryMap = categoryMap;
            next();
        }).on('error', function(err) {
            bomb("Dropshipper -> Metrosix Category Mapping: Error encountered: " + err);
        });
    } // end initializeCategoryMapping
    /**
     *	Loads the csv file that contains the mapping of variance types
     *	and places it in a property map.
     */
    function initializeVarianceMapping(settings, next) {
        report("Retrieving variance mapping contained in: " + settings.variance_mapping_path);
        var stream = fs.createReadStream(settings.variance_mapping_path);
        stream.on('error', function(error) {
            bomb('CSV file error.');
        });
        var varianceMap = [];
        csv().from.stream(stream, {
            columns: true
        }).on('record', function(variantInfo) {
            varianceMap[(variantInfo.Variance + "").toLowerCase()] = variantInfo.Type;
        }).on('end', function(count) {
            report("Done reading csv file containing " + count + " variant types.");
            varianceMap = varianceMap;
            next();
        }).on('error', function(err) {
            bomb("Variance Mapping: Error encountered: " + err);
        });
    } // end initializeVarianceMapping
    /**
     *	Loads the category IDs from Tea /getParentCategories
     *	and places it in a property map.
     */
    function initializeCategoryIdMapping(settings, next) {
        report("Retrieving Metrosix Category ID mapping.");
        var categoryIds = [];
        var url = 'http://' + settings.host + '/getParentCategories';
        var json = {
            accessToken: settings.accessToken
        };
        request({
            method: 'POST',
            url: url,
            json: json
        }, function(error, response, body) {
            if (error) {
                bomb("Unexpected error: ", error);
            } else if (response.statusCode != 200) {
                bomb("Unexpected status code " + response.statusCode);
            } else {
                if (body === undefined || body.response === "Error") {
                    bomb("Failed to retrieve category IDs.");
                }
                for (var i = body.categories.length - 1; i >= 0; i--) {
                    categoryIds[body.categories[i].name.trim()] = body.categories[i].category_id;
                }
                categoryIdMap = categoryIds;
                report("Successfully retrieved " + body.categories.length + " Category IDs.");
                next();
            }
        });
    } // end initializeCategoryIdMapping
    /**
     *	Loads the products from the dropshipper's csv file onto a
     *	property array.
     */
    function parseDetails(settings, next) {
        report("Pass 2: Load Details");
        var stream = fs.createReadStream(settings.csvFile);
        stream.on('error', function(error) {
            bomb('CSV file error.');
        });
        // Load csv file rows into a map
        var count = 0;
        var item = {};
        var products = [];
        var lineErrors = "";
        csv().from.stream(stream, {
            columns: true
        }).on('record', function(item) {
            item.lineNumber = ++count;
            insertVariant(products, createVariant(item));
        }).on('end', function(count) {
            report("Done reading csv file containing " + count + " records with " + products.length + " products.");
            products = products;
            next();
        }).on('error', function(err) {
            bomb("Pass 2: Error encountered: " + err);
        });
    } // end parseDetails method
    /**
     *	Saves the products into the database using webservices.
     */
    function persist(settings, next) {
        if (products && products.length > 0) {
            report("Pass 3: Upload to TEA");
            log("Uploading products, please wait...");
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
        } else {
            report("No products to upload.");
        }
    } // end persist method
    /**
     *	Creates a variant JSON object using details from the items
     *	retrieved from the csv file.
     */
    function createVariant(item) {
        var variant = {
            lineNumber: item.lineNumber,
            categoryId: categoryIdMap[categoryMap[item.Categories]],
            productName: item.Name,
            manufacturer: item.Manufacturer,
            shortDescription: strip(item.Summary),
            longDescription: strip(item.Description),
            sku: item.Sku,
            costPrice: item.Price,
            weight: item.Weight,
            varianceValue: varianceMap[(item.option + "").toLowerCase()] ? item.option : null,
            variance: varianceMap[(item.option + "").toLowerCase()],
            imageType: getImageExtension(item.ImageUrl),
            imagePath: item.ImageUrl,
            imageName: getImageName(item.ImageUrl),
            //properties below are hard coded since they are not provided in the dropshipper's file
            imageSize: 0,
            quantity: 0,
            barcode: null,
            format: "",
            isDisplayed: true,
            teaIdAtSource: 0,
            metaTitle: null,
            metaDescription: null,
            metaKeyword: null,
            serialNo: null,
            statusOnly: "0"
        };
        return variant;
    } // end createVariant method
    /**
     *	Places items under categories for more efficient storage during
     *	persist stage.
     */
    function insertVariant(products, itemVariant) {
        var productIndex = findInList(products, itemVariant.productName);
        if (productIndex != -1) { // item product was found
            products[productIndex].variants.push(itemVariant);
        } else { // add a new product under this category
            if (itemVariant.categoryId === undefined) {
                report("Item : " + itemVariant.productName + " will not be uploaded since it does not have a category.");
            } else {
                products.push({
                    name: itemVariant.productName,
                    variants: [itemVariant]
                });
            }
        }
    } // end insertVariant method
    /**
     *	Parses the imageUrl provided for the file extension
     */
    function getImageExtension(imageUrl) {
        if (imageUrl !== undefined && imageUrl.length > 0 && imageUrl.lastIndexOf(".") != -1) {
            return imageUrl.substr(imageUrl.lastIndexOf(".") + 1);
        }
    }
    /**
     *	Parses the imageUrl provided for the file name
     */
    function getImageName(imageUrl) {
        if (imageUrl !== undefined && imageUrl.length > 0 && imageUrl.lastIndexOf("/") !== -1) {
            return imageUrl.substring(imageUrl.lastIndexOf("/") + 1, imageUrl.lastIndexOf("."));
        }
    }
    /**
     *	Convenience method for locating an object in a list using
     *	its id property.
     */
    function findInList(list, name) {
        for (var i = list.length - 1; i >= 0; i--) {
            if (list[i].name === name) return i;
        }
        return -1;
    }
    return {
        execute: execute
    };
})();