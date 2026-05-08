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

app.set("view engine", "ejs"); // use EJS to render pages

// set up cookie sessions
app.use( 
	cookieSession({
		name: "session",
		keys: [cs304.randomString(20)],

		// Cookie Options
		maxAge: 24 * 60 * 60 * 1000, // 24 hours
	}),
);
app.use(flash()); // use flash for temporary (debug/error) messages

app.use(express.static("public"));

const mongoUri = cs304.getMongoUri(); // use cs304 helper to get the Mongo URI from env

// ================================================================
// custom routes here

// Use these constants and mispellings become errors
const DB = "fresher";
const STUDENTS = "students";
const REVIEWS = "reviews";
const STAFF = "staff";
const COUNTERS = "counters";
const ADMIN = "admin";

const ROUNDS = 10;

// route for liking reviews
const { ObjectId } = require('mongodb');
const { link } = require("fs");

// route for uploading images in reviews, with validation for file type and size
const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, "public/images");
	},
	filename: function (req, file, cb) {
		const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9.\-_]/g, "_");
		const ext = path.extname(safeName).toLowerCase();
		const allowed = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
		if (!allowed.includes(ext)) {
			return cb(new Error("Invalid file extension"), null);
		}
		cb(null, Date.now() + "-" + safeName);
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


// render the main page
app.get("/home", async (req, res) => {
	const db = await Connection.open(mongoUri, DB);
	const display_reviews = await db
		.collection(REVIEWS)
		.find(
			{ canDisplay: true },
			{ projection: { reviewText: 1, diningHall: 1, dateUploaded: 1, likes: 1, likedBy: 1, imagePath:1 } },
		)
		.sort({dateUploaded: -1})
		.limit(6)
		.toArray();

	// if not enough reviews, add placeholders
	while (display_reviews.length < 6) {
		display_reviews.push({
			_id: new ObjectId(),
			reviewText: "No reviews yet",
			diningHall: "Coming soon",
			dateUploaded: new Date(),
			likes: 0,
			likedBy: [],
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

// login routes
app.get("/login", (req, res) => {
	return res.render("login.ejs");
});

app.post("/login", async (req, res) => {
	try {
		const email = String(req.body.email || "");
		const password = String(req.body.password || "");
		const db = await Connection.open(mongoUri, DB);
		// distinguish between students, staff, and admin for login
		let existingUser = await db.collection(STUDENTS).findOne({ email: email });
		let existingStaff = await db.collection(STAFF).findOne({ email: email });
		let existingAdmin = await db.collection(ADMIN).findOne({ email: email });
		if(existingAdmin){
			const match = await bcrypt.compare(password, existingAdmin.password);
			if (!match) {
				console.log("Username or password incorrect - try again.");
				req.flash("error", "Username or password incorrect - try again.");
				return res.redirect("/login");
			}
			req.session.email = email;
			req.session.logged_in = true;
			console.log("match", match);
			return res.redirect("/admin");
		}
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
	} catch (error) { // send an error message if something goes wrong with login process
		console.log(error);
		req.flash("error", `Form submission error: ${error}`);
		return res.redirect("/");
	}
});

// Helper function to check if user is logged in and belongs to the specified collection
async function requireUserInCollection(req, res, collectionName) {
	const db = await Connection.open(mongoUri, DB);

	if (!req.session.logged_in || !req.session.email) {
		req.flash("error", "You must be logged in.");
		res.redirect("/login");
		return null;
	}

	const user = await db.collection(collectionName).findOne({
		email: req.session.email
	});

	if (!user) {
		req.flash("error", "You are not authorized to access this page.");
		res.redirect("/login");
		return null;
	}

	return db;
}

// Helper function to get review data for dashboard with filtering, pagination, and search
async function getReviewDashboardData(req, db, baseUrl) {
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

	if (selectedDiningHalls.length > 0) {
		filter.diningHall = { $in: selectedDiningHalls };
	}

	if (selectedMealTime.length > 0) {
		filter.mealTime = { $in: selectedMealTime };
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

	let page = parseInt(req.query.page) || 1;
	const perPage = 5;

	const totalReviews = await db.collection(REVIEWS).countDocuments(filter);
	const totalPages = Math.ceil(totalReviews / perPage);

	const reviews = await db.collection(REVIEWS)
		.find(filter)
		.sort({ dateUploaded: -1 })
		.skip((page - 1) * perPage)
		.limit(perPage)
		.toArray();

	function pageUrl(pageNum) {
		const params = new URLSearchParams(req.query);
		params.set("page", pageNum);
		return baseUrl + "?" + params.toString();
	}

	return {
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
	};
}

// route for staff dashboard and admin dashboard, with filtering, pagination, and search
app.get("/staff", async (req, res) => {
	const db = await requireUserInCollection(req, res, STAFF);
	if (!db) return;

	const data = await getReviewDashboardData(req, db, "/staff");

	return res.render("dashboard.ejs", {
		...data,
		isAdmin: false,
		dashboardPath: "/staff",
		analyticsPath: "/staff/analytics"
	});
});
// admin dashboard with same functionality as staff but with edit/delete options
app.get("/admin", async (req, res) => {
	const db = await requireUserInCollection(req, res, ADMIN);
	if (!db) return;

	const data = await getReviewDashboardData(req, db, "/admin");

	return res.render("dashboard.ejs", {
		...data,
		isAdmin: true,
		dashboardPath: "/admin",
		analyticsPath: "/admin/analytics"
	});
});

// route for review detail page for admin
async function renderReviewDetail(req, res, collectionName, backUrl, isAdmin) {
	const db = await requireUserInCollection(req, res, collectionName);
	if (!db) return;

	const reviewID = parseInt(req.params.reviewID);

	if (isNaN(reviewID)) {
		return res.redirect(backUrl);
	}

	const review = await db.collection(REVIEWS).findOne({
		reviewID: reviewID
	});

	if (!review) {
		return res.redirect(backUrl);
	}

	return res.render("review-detail.ejs", {
		logged_in: req.session.logged_in,
		email: req.session.email,
		review,
		reviewID,
		isAdmin,
		backUrl
	});
}

app.get("/staff/review-detail/:reviewID", async (req, res) => {
	return renderReviewDetail(req, res, STAFF, "/staff", false);
});

app.get("/admin/review-detail/:reviewID", async (req, res) => {
	return renderReviewDetail(req, res, ADMIN, "/admin", true);
});

// delete review route for admin
app.post("/admin/review/:reviewID/delete", async (req, res) => {
	const db = await requireUserInCollection(req, res, ADMIN);
	if (!db) return;

	const reviewID = parseInt(req.params.reviewID);

	if (isNaN(reviewID)) {
		req.flash("error", "Invalid review ID.");
		return res.redirect("/admin");
	}

	const result = await db.collection(REVIEWS).deleteOne({ reviewID });

	if (result.deletedCount === 0) {
		req.flash("error", "Review not found.");
	} else {
		req.flash("info", "Review deleted.");
	}
	return res.redirect("/admin");
});

// edit review route for admin
app.get("/admin/review/:reviewID/edit", async (req, res) => {
	const db = await requireUserInCollection(req, res, ADMIN);
	if (!db) return;

	const reviewID = parseInt(req.params.reviewID);

	if (isNaN(reviewID)) {
		return res.redirect("/admin");
	}

	const review = await db.collection(REVIEWS).findOne({
		reviewID: reviewID
	});

	if (!review) {
		return res.redirect("/admin");
	}

	return res.render("admin-edit-review.ejs", {
		logged_in: req.session.logged_in,
		email: req.session.email,
		isAdmin:true,
		review
	});
});

// handle edit review form submission for admin, with image upload/validation/ability to remove exisiting image
app.post("/admin/review/:reviewID/edit", upload.single("reviewImage"), async (req, res) => {
	const db = await requireUserInCollection(req, res, ADMIN);
	if (!db) return;

	const reviewID = parseInt(req.params.reviewID);

	const {
		diningHall,
		mealTime,
		rating,
		reviewText,
		category,
		display,
		removeImage
	} = req.body;

	const updateFields = {
		diningHall: diningHall,
		mealTime: mealTime,
		rating: parseInt(rating),
		reviewText: reviewText,
		category: category,
		canDisplay: display === "on",
		lastEditedAt: new Date(),
		lastEditedBy: req.session.email
	};

	// If admin uploads a new image, replace the old imagePath
	if (req.file) {
		updateFields.imagePath = "/images/" + req.file.filename;
	}

	// If admin checks "Remove current image" and did not upload a new one
	if (removeImage === "on" && !req.file) {
		updateFields.imagePath = null;
	}

	await db.collection(REVIEWS).updateOne(
		{ reviewID: reviewID },
		{ $set: updateFields }
	);

	return res.redirect("/admin");
});

// function to get analytics data for reviews based on filters
async function getReviewAnalyticsData(req, db) {
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

	const startDate = req.query.startDate || "";
	const endDate = req.query.endDate || "";

	const filter = {};

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

	if (selectedDiningHalls.length > 0) {
		filter.diningHall = { $in: selectedDiningHalls };
	}

	if (selectedMealTime.length > 0) {
		filter.mealTime = { $in: selectedMealTime };
	}

	const result = await db.collection(REVIEWS).aggregate([
		{ $match: filter },
		{
			$group: {
				_id: null,
				avgRating: { $avg: "$rating" },
				reviewCount: { $sum: 1 }
			}
		}
	]).toArray();

	const analytics = result[0] || {
		avgRating: 0,
		reviewCount: 0
	};

	return {
		startDate,
		endDate,
		selectedDiningHalls,
		selectedMealTime,
		avgRating: analytics.avgRating,
		reviewCount: analytics.reviewCount
	};
}

// route for analytics pages for staff and admin
app.get("/staff/analytics", async (req, res) => {
	const db = await requireUserInCollection(req, res, STAFF);
	if (!db) return;

	const data = await getReviewAnalyticsData(req, db);

	return res.render("review-analytics.ejs", {
		...data,
		logged_in: req.session.logged_in,
		email: req.session.email,
		isAdmin: false,
		dashboardPath: "/staff",
		analyticsPath: "/staff/analytics"
	});
});

app.get("/admin/analytics", async (req, res) => {
	const db = await requireUserInCollection(req, res, ADMIN);
	if (!db) return;

	const data = await getReviewAnalyticsData(req, db);

	return res.render("review-analytics.ejs", {
		...data,
		logged_in: req.session.logged_in,
		email: req.session.email,
		isAdmin: true,
		dashboardPath: "/admin",
		analyticsPath: "/admin/analytics"
	});
});


// Increments the counter for the given collection key and returns the new value.
// Used to generate unique sequential IDs for new reviews.
async function incrCounter(counters, key){
	let result = await counters.findOneAndUpdate(
		{collection: key},
		{$inc: {counter: 1}},
		{returnDocument: "after"}
	);

	return result.counter;
}

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

// posting to database/submission route
app.post("/submit-review", upload.single("reviewImage"), async (req, res) => {
	try {
		// Check if user is logged in
		if (!req.session.logged_in) {
			req.flash("error", "You must be logged in to submit a review.");
			return res.redirect("/login");
		}

		// Get form data
		const { diningHall, mealTime, rating, reviewText, category, display} = req.body;

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

		// document structure for document in reviews collection
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
			likes: 0,
			likedBy: []
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

// signup routes
app.get("/signup", (req, res) => {
	return res.render("signup.ejs");
});

app.post("/signup", async (req, res) => {
	try {
		const email = String(req.body.email || "");
		const password = String(req.body.password || "");
		const db = await Connection.open(mongoUri, DB);
		let existingStudent = await db.collection(STUDENTS).findOne({ email: email });
		let existingStaff = await db.collection(STAFF).findOne({ email: email });
		let existingAdmin = await db.collection(ADMIN).findOne({ email: email });
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
		if (existingAdmin) {
			req.flash(
				"error",
				'Please try again',
			);
			return res.redirect("/signup");
		}
		const hash = await bcrypt.hash(password, ROUNDS);
		await db.collection(STUDENTS).insertOne({
			email: email,
			password: hash,
			reviewCount: 0,
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

// AJAX to handle liking a review
app.post('/like-review', async (req, res) => {
    try {
        // Check if user is logged in
        if (!req.session.logged_in) {
            return res.status(401).json({ error: 'You must be logged in to like a review' });
        }

        const reviewId = req.body.reviewId;
        const userEmail = req.session.email;

        if (!reviewId || !ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const db = await Connection.open(mongoUri, DB);
        const reviewsCollection = db.collection(REVIEWS);

        // Get current review
        const review = await reviewsCollection.findOne({ _id: new ObjectId(reviewId) });

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        // Initialize arrays if array doesn't exist
        if (!review.likedBy) review.likedBy = [];
        if (review.likes === undefined) review.likes = 0;

        // Check if user already liked review
        const alreadyLiked = review.likedBy.includes(userEmail);

        let updatedLikes;
        let updatedLikedBy;

        if (alreadyLiked) {
            // Unlike
            updatedLikedBy = review.likedBy.filter(email => email !== userEmail);
            updatedLikes = Math.max(0, review.likes - 1);
        } else {
            // Like
            updatedLikedBy = [...review.likedBy, userEmail];
            updatedLikes = review.likes + 1;
        }

        // Update database
        const result = await reviewsCollection.updateOne(
            { _id: new ObjectId(reviewId) },
            {
                $set: {
                    likes: updatedLikes,
                    likedBy: updatedLikedBy
                }
            }
        );

        // Return updated like data
        return res.json({
            success: true,
            likes: updatedLikes,
            isLiked: !alreadyLiked, // true if now liked, false if now unliked
            message: alreadyLiked ? 'Removed like' : 'Added like'
        });

    } catch (error) {
        console.error('Error liking review:', error);
        return res.status(500).json({ error: 'Error processing like: ' + error.message });
    }
});
// end  of like-review route

// logout route
app.post("/logout", (req, res) => {
	if (req.session.email) {
		req.session.logged_in = false;
		req.session.email = null;
		return res.redirect("/");
	} else {
		return res.redirect("/");
	}
});

// ================================================================
// postlude

const serverPort = cs304.getPort(8080);

// start the server, run it with "node server.js" and visit http://localhost:8080/ (or the printed URL) in your browser!
app.listen(serverPort, function () {
	console.log(`listening on ${serverPort}`);
	console.log(`visit http://cs.wellesley.edu:${serverPort}/`);
	console.log(`or http://localhost:${serverPort}/`);
	console.log("^C to exit");
});
