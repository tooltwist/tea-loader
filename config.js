/**
 * Configuration settings for each imported plugin.
 * packagePath is required while all other properties are arbitrary.
 */

module.exports = [
  {
    packagePath: "./plugins/logger",
    loggerConfig: "config/log4js-config.json",
    loggerLevel: { level: "INFO" }
  },
  { packagePath: "./plugins/utils" },
  {
    packagePath: "./plugins/product-loader",
    varianceMapping: "config/variance-mapping.csv",
    categoryMapping: "config/category-mapping.csv",
    product_headers:  [
                        "Name", "Price", "Weight", "Manufacturer",
                        "Sku", "Summary", "Description", "Categories",
                        "ImageUrl", "Sub_ImageUrl", "option"
                      ]
  }
];