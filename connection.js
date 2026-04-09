/* Singleton pattern. Connects to database on first use of .open() and
 * subsequent calls return the same connection object.

The .open() method returns the db object.

Using this API means that if connections time out, we can replace this
code with something that connects every time.

Use this class like this:

const Connection = require('./connection.js');
...
const db = Connection.open(mongoUri, 'wmdb');
let scott = await db.collection("staff").findOne({uid: 1});

or 

const db = Connection.open(mongoUri, 'wmdb');
const staff = db.collection("staff");
let scott = await staff.findOne({uid: 1});

or, more generally,

const conn = Connection.open(mongoUri);
const wmdb = conn.db('wmdb');
const staff = wmdb.collection('staff');
let scott = await staff.findOne({uid: 1});

Olivia Giandrea and Scott Anderson
January 2023

Changelog:

1/16/2023 Provide a version w/o a pre-specified db name, so you can
either get a connection object or a database.

1/20/2024 Updated the options for the new driver 6.3.0
See https://cloud.mongodb.com/v2/62d5b81f4ed1da6a1a289ba5#/clusters/connect?clusterId=Cluster0

*/

const singleton = true;

const { MongoClient, ServerApiVersion } = require('mongodb');

class Connection {

    // this method connects every time.
    static async openAlways(uri) {
        const conn = new MongoClient(uri, this.options);
        await conn.connect();
        this.conn = conn;
        return this.conn;
    }

    // this method connects only if the cached value is null
    static async openOnce(uri) {
        if(this.conn) return this.conn;
        // otherwise, use the other method
        return await Connection.openAlways(uri);
    }
        
    // returns either a connection (client) or, if dbName is supplied, a database connection
    static async open(uri, dbName) {
        if(singleton) {
            await Connection.openOnce(uri);
        } else {
            await Connection.openAlways(uri);
        }
        if(dbName) {
            return this.conn.db(dbName);
        } else {
            return this.conn;
        }
    }

    static async close() {
        await this.conn.close();
        this.conn = null;
        return;
    }

    // initialization
    static {
        Connection.conn = null;
        Connection.options = {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: false,  // was true, but causes errors on code that should work
                deprecationErrors: true,
            }
        };
    }
}

module.exports = { Connection };
