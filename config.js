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
    batchCount: 5,
    varianceMapping: "config/variance-mapping.csv",
    categoryMapping: "config/category-mapping.csv",
    productHeaders:  [
                        "Name", "Price", "Weight", "Manufacturer",
                        "Sku", "Summary", "Description", "Categories",
                        "ImageUrl", "Sub_ImageUrl", "option"
                      ]
  }
];