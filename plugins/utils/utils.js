// index.js
/* 
 * @options is the hash of options the user passes in when creating an instance
 * of the plugin.
 * @imports is a hash of all services this plugin consumes.
 * @register is the callback to be called when the plugin is done initializing.
 */
module.exports = function setup(options, imports, register) {

    var logger = imports.logger;

    /**
     * Run a list of functions synchronously
     * functions should accept an options object and a callback function.
     */
    function synchronize(functions, options) {
        function next() {
            var fn = functions.shift();
            if (fn) {
                fn(options, function(response) {
                    if(response && response.error){
                        logger.bomb(response.error);
                    }
                    logger.log(fn.name + " response: " + JSON.stringify(response));
                    next();
                });
            } else {
                logger.report("Processing completed.");
            }
        }
        next();
    }

    /**
     *  Return true if name ends with a specific suffix
     *  @example
     *  endsWith("image.png", ".png"))
     *  // true
     */
    function endsWith(name, suffix) {
        var nameLen = name.length;
        var suffixLen = suffix.length;
        if (nameLen < suffixLen) return false;
        var ending = name.substring(nameLen - suffixLen);
        return (ending === suffix);
    }

    /**
     *  Retrieves the resource's extension from a given path.
     */
    function getResourceExtension(fromPath) {
        var start = fromPath.lastIndexOf(".");
        if (fromPath && fromPath.length > 0 && start !== -1) {
            return fromPath.substr(start);
        }
    }

    /**
     *  Retrieves the resource's name from a given path.
     */
    function getResourceName(fromPath) {
        var start = fromPath.lastIndexOf("/");
        if (fromPath && fromPath.length > 0 && start !== -1) {
            return fromPath.substring(start + 1);
        }
    }

    /**
     *  Convenience method for locating an object in a list using
     *  its id property.
     */
    function findInList(list, property, value, callback) {
        for (var i = list.length - 1; i >= 0; i--) {
            var hasValue = list[i] && list[i].hasOwnProperty(property) && list[i][property] === value;
            if (hasValue) return callback(i);
        }
        return callback(-1);
    }

    register(null, {
        utils: {
            synchronize: synchronize,
            endsWith: endsWith,
            getResourceExtension: getResourceExtension,
            getResourceName: getResourceName,
            findInList: findInList
        }
    });
};