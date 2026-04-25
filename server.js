const path = require("path");
require("dotenv").config({ path: path.join(process.env.HOME, ".cs304env") });
const express = require("express");
const morgan = require("morgan");
const serveStatic = require("serve-static");
const bodyParser = require("body-parser");
const cookieSession = require("cookie-session");
const flash = require("express-flash");
const bcrypt = require("bcrypt");

// our modules loaded from cwd

const { Connection } = require("./connection");
const cs304 = require("./cs304");

// Create and configure the app

const app = express();

// Morgan reports the final status code of a request's response
app.use(morgan("tiny"));

app.use(cs304.logStartRequest);

// This handles POST data
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(cs304.logRequestData); // tell the user about any request data

app.use(serveStatic("public"));
app.set("view engine", "ejs");

app.use(
	cookieSession({
		name: "session",
		keys: [cs304.randomString(20)],

		// Cookie Options
		maxAge: 24 * 60 * 60 * 1000, // 24 hours
	}),
);
app.use(flash());

const mongoUri = cs304.getMongoUri();

// ================================================================
// custom routes here

// Use these constants and mispellings become errors
const DB = "fresher";
const STUDENTS = "students";
const REVIEWS = "reviews";
const STAFF = "staff";
const IMAGES = "images";
const COUNTERS = "counters";

const ROUNDS = 10;

// main page
app.get("/home", async (req, res) => {
	const db = await Connection.open(mongoUri, DB);
	display_reviews = await db
		.collection(REVIEWS)
		.find(
			{ canDisplay: true },
			{ projection: { reviewText: 1, diningHall: 1, dateUploaded: 1 } },
		)
		.sort({dateUploaded: -1})
		.toArray();

	// if not enough reviews, add placeholders
	while (display_reviews.length < 3) {
		display_reviews.push({
			reviewText: "No reviews yet",
			diningHallName: "Coming soon",
			dateUploaded: new Date(),
		});
	}

	return res.render("homepage.ejs", {
		logged_in: req.session.logged_in,
		email: req.session.email,
		display_reviews,
	});
});

// redirect to main page
app.get("/", (req, res) => {
	return res.redirect("/home");
});

// login routes AKA student login routes
app.get("/login", (req, res) => {
	return res.render("login.ejs");
});

app.post("/login", async (req, res) => {
	try {
		const email = req.body.email;
		const password = req.body.password;
		console.log("Hello: " + req.body);
		const db = await Connection.open(mongoUri, DB);
		var existingUser = await db.collection(STUDENTS).findOne({ email: email });
		var existingStaff = await db.collection(STAFF).findOne({ email: email });
		if(existingStaff){
			req.session.email = email;
			req.session.logged_in = true;
			return res.redirect("/staff");
		}
		if (!existingUser) {
			console.log("Username does not exist - try again.");
			req.flash("error", "Username does not exist - try again.");
			return res.redirect("/");
		}
		const match = await bcrypt.compare(password, existingUser.password);
		console.log("match", match);
		if (!match) {
			console.log("Username or password incorrect - try again.");
			req.flash("error", "Username or password incorrect - try again.");
			return res.redirect("/");
		}
		req.flash("info", "successfully logged in as " + email);
		req.session.email = email;
		req.session.logged_in = true;
		console.log("login as", email);
		return res.redirect("/");
	} catch (error) {
		console.log(error);
		req.flash("error", `Form submission error: ${error}`);
		return res.redirect("/");
	}
});


// staff page/dashboard
app.get("/staff", async (req, res) => {
	const db = await Connection.open(mongoUri, DB);

	const email = req.session.email;
	var existingStaff = await db.collection(STAFF).findOne({ email: email });
	if(!existingStaff){
		return res.redirect("/home");
	}

	const filter = {};

	if(req.query.diningHall){
		const selectedDiningHalls = Array.isArray(req.query.diningHall) ? req.query.diningHall : [req.query.diningHall];
		filter.diningHall = {$in: selectedDiningHalls};
	}

	const reviews = await db.collection(REVIEWS)
		.find(filter)
		.sort({reviewID: -1})
		.toArray();


	return res.render("staff-dashboard.ejs", {
		logged_in: req.session.logged_in,
		email: req.session.email,
		reviews,
		selectedDiningHalls: req.query.diningHall
			? Array.isArray(req.query.diningHall)
				? req.query.diningHall
				: [req.query.diningHall]
			: []
	});
});

// review submission form, check login functionality
app.get("/review-form", (req, res) => {
	if (!req.session.logged_in) {
		req.flash("error", "You must be logged in to submit a review.");
		return res.redirect("/login");
	}
	return res.render("review-form.ejs", {
		logged_in: req.session.logged_in,
		email: req.session.email,
	});
});

app.get("/submit-review", async (req,res) => {
	res.render("submit-review.ejs");
})

async function incrCounter(counters, key){
	let result = await counters.findOneAndUpdate(
		{collection: key},
		{$inc: {counter: 1}},
		{returnDocument: "after"}
	);

	return result.counter;
}

// posting to database/submission route
app.post("/submit-review", async (req, res) => {
	try {
		// Check if user is logged in
		if (!req.session.logged_in) {
			req.flash("error", "You must be logged in to submit a review.");
			return res.redirect("/login");
		}

		// Get form data
		const { diningHall, rating, reviewText, category, anonymous, display} = req.body;

		// Validation
		const errors = [];
		if (!diningHall) errors.push("Please select a dining hall");
		if (!rating) errors.push("Please select a rating");
		if (!reviewText) errors.push("Please enter a review");
		if (reviewText.length < 5) errors.push("Review must be at least 5 characters");
		if (reviewText.length > 500) errors.push("Review must not exceed 500 characters");
		if (!category) errors.push("Please select a category");

		// If validation fails, show errors
		if (errors.length > 0) {
			req.flash("error", errors.join(" | "));
			return res.render("review-form.ejs", {
				logged_in: req.session.logged_in,
				email: req.session.email,
				errors: errors
			});
		}

		// Connect to database and insert review
		const db = await Connection.open(mongoUri, DB);
		const counters = db.collection(COUNTERS);
		let reviewID = await incrCounter(counters, "reviews");

		const newReview = {
			reviewID,
			userEmail: req.session.email,
			diningHall: diningHall,
			rating: parseInt(rating),
			reviewText: reviewText,
			category: category,
			canDisplay: display === "on",
			dateUploaded: new Date(),
		};

		// Insert into database
		await db.collection(REVIEWS).insertOne(newReview);

		req.flash("info", "Thank you! Your review has been submitted successfully!");
		
		return res.redirect("/submit-review");

	} catch (error) {
		console.error("Error submitting review:", error);
		req.flash("error", `Form submission error: ${error}`);
		return res.redirect("/review-form");
	}
});

app.get("/signup", (req, res) => {
	return res.render("signup.ejs");
});

app.post("/signup", async (req, res) => {
	try {
		const email = req.body.email;
		const password = req.body.password;
		const db = await Connection.open(mongoUri, DB);
		var existingStudent = await db.collection(STUDENTS).findOne({ email: email });
		var existingStaff = await db.collection(STAFF).findOne({ email: email });
		if (existingStudent) {
			req.flash(
				"error",
				"Login already exists - please try logging in instead.",
			);
			return res.redirect("/signup");
		}
		if (existingStaff) {
			req.flash(
				"error",
				'If you are Wellesley Fresh staff, please <a href="/login">log in</a> directly.',
			);
			return res.redirect("/signup");
		}
		const hash = await bcrypt.hash(password, ROUNDS);
		await db.collection(STUDENTS).insertOne({
			email: email,
			password: hash,
			revieweCount: 0,
		});

		console.log("successfully joined", email, password, hash);
		req.flash("info", "successfully joined and logged in as " + email);
		req.session.email = email;
		req.session.logged_in = true;
		return res.redirect("/");
	} catch (error) {
		console.log("signup error:", error);
		req.flash("error", `Form submission error: ${error}`);
		return res.redirect("/");
	}
});

app.post("/logout", (req, res) => {
	if (req.session.email) {
		req.session.username = null;
		req.session.logged_in = false;
		req.flash("info", "You are logged out");
		return res.redirect("/");
	} else {
		req.flash("error", "You are not logged in - please do so.");
		return res.redirect("/");
	}
});

// ================================================================
// postlude

const serverPort = cs304.getPort(8080);

app.listen(serverPort, function () {
	console.log(`listening on ${serverPort}`);
	console.log(`visit http://cs.wellesley.edu:${serverPort}/`);
	console.log(`or http://localhost:${serverPort}/`);
	console.log("^C to exit");
});
