require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const multer = require("multer");
const cors = require("cors");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const app = express();
app.use(cors());
app.use(express.json());

/* ------------------- PostgreSQL ------------------- */
const pool = new Pool({
  connectionString: process.env.POSTGRES_URI,
  ssl: { rejectUnauthorized: false }
});

/* ------------------- Create Table ------------------- */
const createTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      path TEXT NOT NULL,
      caption TEXT,
      username VARCHAR(100),
      email VARCHAR(100),
      avatar TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    );
  `);
};
createTable();

/* ------------------- Cloudinary Config ------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/* ------------------- Multer Storage ------------------- */
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "asirnet_stories",
    resource_type: "video",
    transformation: [{ height: 720, crop: "scale" }]
  }
});
const upload = multer({ storage });

/* ------------------- Upload Story ------------------- */
app.post("/upload-story", upload.single("storyVideo"), async (req, res) => {
  try {
    const { caption, username, email, avatar } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "No video uploaded" });
    }

    const videoUrl = req.file.path;
    const publicId = req.file.filename;

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await pool.query(
      `INSERT INTO videos (name, path, caption, username, email, avatar, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [publicId, videoUrl, caption, username, email, avatar, expiresAt]
    );

    res.json({ success: true, message: "Story uploaded (24h active) ✅" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

/* ------------------- Get Active Stories Only ------------------- */
app.get("/stories", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM videos 
       WHERE expires_at > NOW()
       ORDER BY created_at DESC`
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

/* ------------------- Delete All Stories By Email ------------------- */
app.delete("/delete-my-stories/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const result = await pool.query(
      "SELECT * FROM videos WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({ message: "No stories found" });
    }

    // Delete from Cloudinary
    for (let story of result.rows) {
      await cloudinary.uploader.destroy(story.name, {
        resource_type: "video"
      });
    }

    // Delete from DB
    await pool.query("DELETE FROM videos WHERE email = $1", [email]);

    res.json({ success: true, message: "All your stories deleted ✅" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Delete failed" });
  }
});

/* ------------------- Auto Cleanup Expired Stories ------------------- */
setInterval(async () => {
  try {
    const expired = await pool.query(
      "SELECT * FROM videos WHERE expires_at <= NOW()"
    );

    for (let story of expired.rows) {
      await cloudinary.uploader.destroy(story.name, {
        resource_type: "video"
      });
    }

    await pool.query("DELETE FROM videos WHERE expires_at <= NOW()");
  } catch (err) {
    console.error("Cleanup error:", err);
  }
}, 60 * 60 * 1000); // every 1 hour

/* ------------------- Server Start ------------------- */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`Story server running on port ${PORT}`)
);