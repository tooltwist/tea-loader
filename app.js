#!/usr/bin/env node

var fs = require("fs");


// Check the command line prameters
if (process.argv.length === 6 && process.argv[2] === 'categoryMap' && endsWith(process.argv[5], '.csv')){
	
	// Load category map from CSV file
	var accessToken = process.argv[3];
	var sourceId = process.argv[4];
	var csvFile = process.argv[5];
	require('./code/categoryMap_csv').load(accessToken, sourceId, csvFile); // async
} else {
	
	// Unrecognised command
	var cmd = process.argv[1];
	console.log("usage: [node] " + cmd + " categoryMap <accessToken> <sourceId> <csvFile>");
	process.exit(1);
}




//process.exit(0);
// Finished

/**
 *	Return true if name ends with a specific suffix
 *  @example
 *  endsWith("image.png", ".png"))
 *	// true
 */
function endsWith(name, suffix) {
	//console.log("endsWith(" + name + ", " + suffix + ")")
	var nameLen = name.length;
	var suffixLen = suffix.length;
	if (nameLen < suffixLen)
		return false;
	var ending = name.substring(nameLen - suffixLen);
	return (ending === suffix);
}