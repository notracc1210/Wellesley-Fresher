const path = require("path");
require("dotenv").config({ path: path.join(process.env.HOME, ".cs304env") });
const express = require("express");
const morgan = require("morgan");
const serveStatic = require("serve-static");
const bodyParser = require("body-parser");
const cookieSession = require("cookie-session");
const flash = require("express-flash");
const bcrypt = require("bcrypt");
const multer = require("multer");

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

app.use(express.static("public"));


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
	const display_reviews = await db
		.collection(REVIEWS)
		.find(
			{ canDisplay: true },
			{ projection: { reviewText: 1, diningHall: 1, dateUploaded: 1 } },
		)
		.sort({dateUploaded: -1})
		.limit(6)
		.toArray();

	// if not enough reviews, add placeholders
	while (display_reviews.length < 6) {
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
			const match = await bcrypt.compare(password, existingStaff.password);
			if (!match) {
				console.log("Username or password incorrect - try again.");
				req.flash("error", "Username or password incorrect - try again.");
				return res.redirect("/login");
			}
			req.session.email = email;
			req.session.logged_in = true;
			console.log("match", match);
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
			return res.redirect("/login");
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
		return res.redirect("/login");
	}

	const selectedDiningHalls = req.query.diningHall
		? Array.isArray(req.query.diningHall)
		? req.query.diningHall
		: [req.query.diningHall]
		: [];

	const selectedMealTime = req.query.mealTime
		? Array.isArray(req.query.mealTime)
		? req.query.mealTime
		: [req.query.mealTime]
		: [];

	const filter = {};

	if(req.query.diningHall){
		filter.diningHall = {$in: selectedDiningHalls};
	}

	if(req.query.mealTime){
		filter.mealTime = {$in: selectedMealTime};
	}

	const startDate = req.query.startDate || "";
	const endDate = req.query.endDate || "";

	if (startDate || endDate) {
		filter.dateUploaded = {};

	if (startDate) {
		filter.dateUploaded.$gte = new Date(startDate);
	}

	if (endDate) {
		const end = new Date(endDate);
		end.setDate(end.getDate() + 1);
		filter.dateUploaded.$lt = end;
	}
	}

	function pageUrl(pageNum) {
		const params = new URLSearchParams(req.query);

		params.set("page", pageNum);
		return "/staff?" + params.toString();
	}

	let page = parseInt(req.query.page) || 1;
	const perPage = 5;

	const search = req.query.search ? req.query.search.trim() : "";

	if (search) {
		const searchConditions = [
			{ reviewText: { $regex: search, $options: "i" } },
		];

		const searchAsNumber = parseInt(search);

		if (!isNaN(searchAsNumber)) {
			searchConditions.push({ reviewID: searchAsNumber });
		}

		filter.$or = searchConditions;
	}

	let totalReviews = await db.collection(REVIEWS).countDocuments(filter);
	let totalPages = Math.ceil(totalReviews / perPage);

	const reviews = await db.collection(REVIEWS)
		.find(filter)
		.sort({reviewID: -1})
		.sort({dateUploaded: -1})
		.skip((page - 1) * perPage)
  		.limit(perPage)
		.toArray();


	return res.render("staff-dashboard.ejs", {
		logged_in: req.session.logged_in,
		email: req.session.email,
		reviews,
		page,
  		totalPages,
		pageUrl,
		selectedDiningHalls,
		selectedMealTime,
		startDate,
		endDate,
		search
	});
});

app.get("/staff/review-detail/:reviewID", async (req, res) => {
	const db = await Connection.open(mongoUri, DB);

	var existingStaff = await db.collection(STAFF).findOne({ email: req.session.email });
	if(!existingStaff){
		return res.redirect("/login");
	}

	const reviewID = parseInt(req.params.reviewID);

	const review = await db.collection(REVIEWS).findOne({reviewID: reviewID});
	if (!review) {
		req.flash("error", "Review not found.");
		return res.redirect("/staff");
	}

	return res.render("review-detail.ejs", {
		logged_in: req.session.logged_in,
		email: req.session.email,
		review,
		reviewID
	});
})

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "public/images");
    },
    filename: function (req, file, cb) {
        const uniqueName = Date.now() + "-" + file.originalname;
        cb(null, uniqueName);
    }
});

const fileFilter = function (req, file, cb) {
    if (file.mimetype.startsWith("image/")) {
        cb(null, true);
    } else {
        cb(new Error("Only image files are allowed."), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 20 * 1024 * 1024
    }
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
app.post("/submit-review", upload.single("reviewImage"), async (req, res) => {
	try {
		// Check if user is logged in
		if (!req.session.logged_in) {
			req.flash("error", "You must be logged in to submit a review.");
			return res.redirect("/login");
		}

		// Get form data
		const { diningHall, mealTime, rating, reviewText, category, anonymous, display} = req.body;

		let imagePath = null;

		if (req.file) {
			imagePath = "/images/" + req.file.filename;
		}

		// Validation
		const errors = [];
		if (!diningHall) errors.push("Please select a dining hall");
		if (!mealTime) errors.push("Please select your meal time");
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
			mealTime: mealTime,
			rating: parseInt(rating),
			reviewText: reviewText,
			category: category,
			imagePath: imagePath,
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
				'If you are Wellesley Fresh staff, please login directly.',
			);
			return res.redirect("/signup");
		}
		const hash = await bcrypt.hash(password, ROUNDS);
		await db.collection(STUDENTS).insertOne({
			email: email,
			password: hash,
			revieweCount: 0,
		});

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
		req.session.logged_in = false;
		req.session.email = null;
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
