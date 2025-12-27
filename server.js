require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Postgres connection
const pool = new Pool({
    connectionString: process.env.POSTGRES_URI,
});

// সার্ভার চালু হলে টেবিল বানানো
const createTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS videos (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                path VARCHAR(500) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("Table 'videos' is ready");
    } catch (err) {
        console.error("Error creating table:", err);
    }
};
createTable();

// ভিডিও আপলোডের জন্য multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = "videos/";
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// ভিডিও আপলোড
app.post("/upload", upload.single("video"), async (req, res) => {
    if (!req.file) return res.status(400).send("No video uploaded");

    const { filename, path: filepath } = req.file;

    try {
        await pool.query(
            "INSERT INTO videos (name, path) VALUES ($1, $2)",
            [filename, filepath]
        );
        res.json({ message: "Video uploaded successfully", filename });
    } catch (err) {
        console.error(err);
        res.status(500).send("DB error");
    }
});

// ভিডিও লিস্ট
app.get("/videos", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM videos ORDER BY created_at DESC");
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("DB error");
    }
});

// ভিডিও স্ট্রিমিং
app.get("/video/:id", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM videos WHERE id=$1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send("Video not found");

        const video = result.rows[0];
        const stat = fs.statSync(video.path);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            const file = fs.createReadStream(video.path, { start, end });
            const head = {
                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                "Accept-Ranges": "bytes",
                "Content-Length": chunkSize,
                "Content-Type": "video/mp4",
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                "Content-Length": fileSize,
                "Content-Type": "video/mp4",
            };
            res.writeHead(200, head);
            fs.createReadStream(video.path).pipe(res);
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
});
