var log4js = require('log4js');
//log the cheese logger messages to a file, and the console ones as well.
log4js.configure("config/log4js-config.json",{level: "INFO"});


var logger = log4js.getLogger('tea-loader');
logger.setLevel('INFO');
var report = log4js.getLogger('report');
report.setLevel('INFO')

console.error("AAArgh! Something went wrong", { some: "otherObject", useful_for: "debug purposes" });

//these will not appear (logging level beneath error)
logger.trace('Entering cheese testing');
logger.debug('Got cheese.');
logger.info('Cheese is Gouda.');
logger.warn('Cheese is quite smelly.');
//these end up on the console and in cheese.log
logger.error('Cheese %s is too ripe!', "gouda");
logger.fatal('Cheese was breeding ground for listeria.');

report.info("Something for the report");