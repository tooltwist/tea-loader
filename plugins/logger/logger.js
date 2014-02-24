// index.js
/* 
 * @options is the hash of options the user passes in when creating an instance
 * of the plugin.
 * @imports is a hash of all services this plugin consumes.
 * @register is the callback to be called when the plugin is done initializing.
 */
module.exports = function setup(options, imports, register) {
    var log4js = require('log4js');
    log4js.configure(options.loggerConfig, options.loggerLevel);
    var logger = log4js.getLogger('tea-loader');
    var reportLogger = log4js.getLogger('report');
    /**
     * Log to the log files
     */
    function log(message) {
        logger.info(message);
    }
    /**
    * Log to the report file
    */
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
    register(null, {
        logger: {
            log: log,
            report: report,
            bomb: bomb
        }
    });
};