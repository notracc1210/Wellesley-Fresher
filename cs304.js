/* This function returns a port (as an integer) for the node app. It
 uses the command line value if one is provided, like this:

node server.js -port 1234

Otherwise it uses the UID, unless that value is less than 1024 (which
are reserved for system processes on Unix). 

Finally, uses the argument as a final fall-back.
*/

function getPort(defaultPort) {
    const portArg = process.argv.findIndex((p) => p === '-port');
    if(portArg != -1) {
        let portVal = process.argv[portArg+1];
        let port = parseInt(portVal);
        if( typeof port === 'number' ) {
            // trust the user
            console.log('using command-line arg for port: ', port);
            return port;
        } else {
            console.log('error using command-line arg for port; not a number: ', portVal, port);
        }
    }
    // no command-line arg, so use UID, unless < 1024, otherwise defaultPort
    // we could check process.platform == 'linux'
    let uid = process.getuid();
    if( uid > 1024 ) {
        console.log('using UID as port', uid);
        return uid;
    }
    console.log('using default port', defaultPort);
    return defaultPort;
}

/* This function provides something similar to morgan('tiny') but at
 * the beginning of the request rather than at the end. You can add it
 * to the middleware like this:

app.use(cs304.logStartRequest);
*/

function logStartRequest(req, res, next) {
    let now = new Date();
    let now_time = now.toLocaleTimeString();
    console.log(`${req.method} ${req.url} at ${now_time}`);
    next();
}

/* This function logs dynamic data provides in the request, including 
data in parameterized urls, query strings and POSTed forms. You can add it
to the middleware like this:

app.use(cs304.logRequestData);

You can also use it just in relevant routes, like this:

cs304.logRequestData(req, res);
*/

function logRequestData(req, res, next) {
    // parameterized urls
    if( req.params && Object.keys(req.params).length > 0 ) {
        let vals = JSON.stringify(req.params);
        console.log(`parameterized endpoint args: ${vals}`);
    }
    // query string data
    if( req.query && Object.keys(req.query).length > 0 ) {
        let vals = JSON.stringify(req.query);
        console.log(`query args: ${vals}`);
    }
    // data from POST requests. Populated by the body-parser module
    if( req.body && Object.keys(req.body).length > 0 ) {
        let vals = JSON.stringify(req.body);
        console.log(`form data: ${vals}`);
    }
    // only invoke next if there is one
    if(next) next();
}

/* This function reads two environment variables and constructs the URI for Mongo Atlas. It complains if the environment variables don't exist. */

function getMongoUri() {
    const mongoUser = process.env.MONGO_USERNAME;
    const mongoPass = process.env.MONGO_PASSWORD;
    if( mongoUser && mongoPass ) {
        return `mongodb+srv://${mongoUser}:${mongoPass}@cluster0.dn6vs.mongodb.net/?retryWrites=true&w=majority`;
    } else {
        console.error(`missing environment variables MONGO_USERNAME (${mongoUser}) or MONGO_PASSWORD (${mongoPass})`);
        console.error('check that you have a proper .env file in your home directory: ls -l ~/.cs304env');
    }
}

/* This function creates a random string of 20 characters. Not
 * necessarily cryptographically secure, but good for cookie
 * signing. 
 * Thanks to https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
 */

function randomString(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
      counter += 1;
    }
    return result;
}

module.exports = {
    getPort, logStartRequest, logRequestData, getMongoUri, randomString
};
