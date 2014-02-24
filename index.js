// index.js
var path = require("path");
var architect = require('architect');
var configPath = path.join(__dirname, 'config.js');
var config = architect.loadConfig(configPath);
architect.createApp(config, function(err, app) {
    if(err){
        console.log(err);
        process.exit(1);
    } else {
        console.log("Successfully loaded the following services: ");
        console.log(JSON.stringify(app.services));
    }
    
    var productLoader = app.services["productLoader"];
    var utils = app.services["utils"];
    var params = {};
    // Check the command line parameters
    if (process.argv.length === 7 && process.argv[2] === 'categoryMap' && utils.endsWith(process.argv[6], '.csv')) {
        // Load category map from CSV file
        params.host = process.argv[3];
        params.accessToken = process.argv[4];
        params.sourceId = process.argv[5];
        params.csvFile = process.argv[6];
        require('./code/categoryMap_csv').load(params); // async
    } else if (process.argv.length === 7 && process.argv[2] === 'product' && utils.endsWith(process.argv[6], '.csv')) {
        // Load products from CSV file
        params.host = process.argv[3];
        params.accessToken = process.argv[4];
        params.sourceId = process.argv[5];
        params.csvFile = process.argv[6];
        productLoader.load(params); // async
    } else {
        // Unrecognised command
        var cmd = process.argv[1];
        console.log("usage:\n");
        console.log("  [node] " + cmd + " categoryMap <url> <accessToken> <sourceId> <csvFile>");
        console.log("  [node] " + cmd + " product <url> <accessToken> <sourceId> <csvFile>");
        process.exit(1);
    }
});