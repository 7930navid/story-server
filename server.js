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

// Table creation with all needed fields
const createTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS videos (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                path VARCHAR(500) NOT NULL,
                caption TEXT,
                username VARCHAR(100),
                email VARCHAR(100),
                avatar VARCHAR(500),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("Table 'videos' is ready");
    } catch (err) {
        console.error("Error creating table:", err);
    }
};
createTable();

// Multer storage
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

// Upload route
app.post("/upload-story", upload.single("storyVideo"), async (req, res) => {
    if (!req.file) return res.status(400).send("No video uploaded");

    const { caption, username, email, avatar } = req.body;
    const { filename, path: filepath } = req.file;

    try {
        await pool.query(
            `INSERT INTO videos (name, path, caption, username, email, avatar) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [filename, filepath, caption, username, email, avatar]
        );

        res.json({ 
            success: true, 
            message: "Story uploaded successfully", 
            data: { filename, caption, username, email, avatar }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("DB error");
    }
});

// Fetch all stories
app.get("/stories", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM videos ORDER BY created_at DESC");
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("DB error");
    }
});

// Stream video by ID
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

// Serve uploaded videos statically
app.use("/videos", express.static(path.join(__dirname, "videos")));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Story server running on port ${PORT}`);
});