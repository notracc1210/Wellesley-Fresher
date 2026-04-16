const path = require('path');
require("dotenv").config({ path: path.join(process.env.HOME, '.cs304env')});
const express = require('express');
const morgan = require('morgan');
const serveStatic = require('serve-static');
const bodyParser = require('body-parser');
const cookieSession = require('cookie-session');
const flash = require('express-flash');
const bcrypt = require('bcrypt');

// our modules loaded from cwd

const { Connection } = require('./connection');
const cs304 = require('./cs304');

// Create and configure the app

const app = express();

// Morgan reports the final status code of a request's response
app.use(morgan('tiny'));

app.use(cs304.logStartRequest);

// This handles POST data
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(cs304.logRequestData); // tell the user about any request data

app.use(serveStatic('public'));
app.set('view engine', 'ejs');

app.use(cookieSession({
    name: 'session',
    keys: [cs304.randomString(20)],

    // Cookie Options
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));
app.use(flash());

const mongoUri = cs304.getMongoUri();

// ================================================================
// custom routes here

// Use these constants and mispellings become errors
const DB = "fresher";
const STUDENTS = "students";
const REVIEWS = "reviews";

const ROUNDS = 10;

// main page
app.get('/', async(req, res) => {
    const db = await Connection.open(mongoUri, DB);
    display_reviews = await db.collection(REVIEWS).find({canDisplay: true},{projection: {reviewText: 1, diningHallName: 1, dateUploaded: 1}}).toArray();
    return res.render('homepage.ejs', {logged_in: req.session.logged_in, email: req.session.email, display_reviews});
});

app.get('/login', (req, res) => {
    return res.render('login.ejs');
})

app.post("/login", async (req, res) => {
  try {
    const email = req.body.email;
    const password = req.body.password;
    console.log("Hello: " + req.body);
    const db = await Connection.open(mongoUri, DB);
    var existingUser = await db.collection(STUDENTS).findOne({email: email});
    console.log('user', existingUser);
    if (!existingUser) {
        console.log("Username does not exist - try again.");
      req.flash('error', "Username does not exist - try again.");
     return res.redirect('/')
    }
    const match = await bcrypt.compare(password, existingUser.password); 
    console.log('match', match);
    if (!match) {
        console.log("Username or password incorrect - try again.");
        req.flash('error', "Username or password incorrect - try again.");
        return res.redirect('/')
    }
    req.flash('info', 'successfully logged in as ' + email);
    req.session.email = email;
    req.session.logged_in = true;
    console.log('login as', email);
    return res.redirect('/');
  } 
  catch (error) {
    console.log(error);
    req.flash('error', `Form submission error: ${error}`);
    return res.redirect('/')
  }
});


app.get('/signup', (req, res) => {
    return res.render('signup.ejs');
})

/**
async function getNextUid(counterName) {
    const db = await Connection.open(mongoUri, DB);
    const doc = await db.collection("counters").findOneAndUpdate(
        {_id: counterName},
        {$inc:{seq: 1}},
        {returnDocument: "after"}
    );

    return doc.seq;
}
    */

app.post("/signup", async (req, res) => {
  try {
    const email = req.body.email;
    const password = req.body.password;
    const db = await Connection.open(mongoUri, DB);
    var existingUser = await db.collection(STUDENTS).findOne({email: email});
    if (existingUser) {
      req.flash('error', "Login already exists - please try logging in instead.");
      return res.redirect('/')
    }
    const hash = await bcrypt.hash(password, ROUNDS);
    await db.collection(STUDENTS).insertOne({
        email: email,
        password: hash,
        revieweCount: 0
    });
    

    console.log('successfully joined', email, password, hash);
    req.flash('info', 'successfully joined and logged in as ' + email);
    req.session.email = email;
    req.session.logged_in = true;
    return res.redirect('/');
  } catch (error) {
    console.log("signup error:", error);
    req.flash('error', `Form submission error: ${error}`);
    return res.redirect('/')
  }
});

app.post('/logout', (req,res) => {
  if (req.session.email) {
    req.session.username = null;
    req.session.logged_in = false;
    req.flash('info', 'You are logged out');
    return res.redirect('/');
  } else {
    req.flash('error', 'You are not logged in - please do so.');
    return res.redirect('/');
  }
});

// ================================================================
// postlude

const serverPort = cs304.getPort(8080);


app.listen(serverPort, function() {
    console.log(`listening on ${serverPort}`);
    console.log(`visit http://cs.wellesley.edu:${serverPort}/`);
    console.log(`or http://localhost:${serverPort}/`);
    console.log('^C to exit');
});
