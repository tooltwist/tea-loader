var csv = require("fast-csv"),
	fs = require("fs");



exports.load = function(accessToken, sourceId, csvfile) {
	
	console.log("categoryMap_csv.load(" + accessToken + ", " + sourceId + ", " + csvfile + ")");
	
	var stream = fs.createReadStream(csvfile);
console.log('here we go...')

	// Step 1 - and verify the CSV file
	var count = 0;
	var map = { };
	csv(stream)
		.on("data", function(data){
console.log('have data row', data)
			if (count++ === 0) {

				// Header row
				if (data[0] != "source_category" || data[1] != "tea_category") {
					throw new Error('First line must contain "source_category,tea_category"');
				}
				return;
			} else {

				// Non-header row
				if (data.length != 2) {
					throw new Error('Line ' + count + ' should contain 2 fields');
				}
				var source_category = data[0];
				var tea_category = data[1];
				map[source_category] = tea_category;
			}
		})
		.on("end", function(){

			// Finished loading the mapping. Send it to TEA.
			console.log("map=>\n", map)
		})
		.on("error", function(){
			console.log("Got an error loading CSV file.")
		})
		.parse();

}