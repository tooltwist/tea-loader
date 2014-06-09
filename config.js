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
                        "base",
                        "lineNumber",
                        "product parent",
                        "category 1",
                        "category 2",
                        "name",
                        "barcode",
                        "cost_price",
                        "sale_price",
                        "manufacturer_srp",
                        "weight",
                        "manufacturer",
                        "supplier",
                        "store_sku",
                        "manufacturer_sku",
                        "supplier_sku",
                        "short_description",
                        "long_description",
                        "categories",
                        "image_url",
                        "sub_image_url",
                        "meta_title",
                        "meta_desc",
                        "quantity"
                      ]
  }
];