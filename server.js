require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");

const app = express();
app.use(cors());
app.use(express.json());

// ------------------- Postgres -------------------
const pool = new Pool({ connectionString: process.env.POSTGRES_URI });

// Create videos table
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

// ------------------- Multer -------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "videos/";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ------------------- Upload Story -------------------
app.post("/upload-story", upload.single("storyVideo"), async (req, res) => {
  if (!req.file) return res.status(400).send("No video uploaded");

  const { caption, username, email, avatar } = req.body;
  const { filename, path: filepath } = req.file;

  try {
    // 1️⃣ Check video duration
    ffmpeg.ffprobe(filepath, (err, metadata) => {
      if(err) return res.status(500).send("Metadata error");

      const duration = metadata.format.duration; // seconds
      if(duration > 60) { // >1 minute
        fs.unlinkSync(filepath);
        return res.status(400).send("Video duration cannot exceed 1 minute");
      }

      // 2️⃣ Check resolution
      const videoStream = metadata.streams.find(s => s.codec_type === "video");
      const height = videoStream.height;

      if(height > 720){
        // downscale to 720p
        const outputPath = `videos/resized-${filename}`;
        ffmpeg(filepath)
          .outputOptions(["-vf scale=-2:720","-c:v libx264","-crf 28","-preset fast"])
          .on("end", async ()=>{
            fs.unlinkSync(filepath); // remove original
            await pool.query(
              `INSERT INTO videos (name,path,caption,username,email,avatar) VALUES($1,$2,$3,$4,$5,$6)`,
              [`resized-${filename}`, outputPath, caption, username, email, avatar]
            );
            res.json({ success:true, message:"Story uploaded & resized ✅" });
          })
          .on("error", err => {
            console.error(err);
            res.status(500).send("Video processing failed");
          })
          .save(outputPath);
      } else {
        // already <=720
        pool.query(
          `INSERT INTO videos (name,path,caption,username,email,avatar) VALUES($1,$2,$3,$4,$5,$6)`,
          [filename, filepath, caption, username, email, avatar]
        ).then(()=>res.json({ success:true, message:"Story uploaded ✅" }))
         .catch(err=>{ console.error(err); res.status(500).send("DB error"); });
      }
    });
  } catch(err){
    console.error(err);
    res.status(500).send("Server error");
  }
});

// ------------------- Get All Stories -------------------
app.get("/stories", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM videos ORDER BY created_at DESC");
    const host = req.headers.host;
    const protocol = req.protocol;

    const stories = result.rows.map(row => ({
      id: row.id,
      username: row.username,
      email: row.email,
      avatar: row.avatar,
      caption: row.caption,
      created_at: row.created_at,
      videoURL: `${protocol}://${host}/videos/${path.basename(row.path)}`
    }));

    res.json(stories);
  } catch(err){
    console.error(err);
    res.status(500).send("DB error");
  }
});

// ------------------- Serve static videos -------------------
app.use("/videos", express.static(path.join(__dirname, "videos")));

// ------------------- Start Server -------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Story server running on port ${PORT}`));