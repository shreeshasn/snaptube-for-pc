import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { apiLimiter } from "./middleware/rateLimiter.js";
import { validateSignature } from "./middleware/requestSigning.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for testing (though desktop app bypasses CORS, development servers might need it)
app.use(cors());
app.use(express.json());

// Version endpoint for silent auto-update check
app.get("/version", (req, res) => {
  res.json({
    version: "1.0.0", // Local version of the app. Set to e.g. "1.1.0" to test update banner.
    changelog: "Stability improvements and faster download streaming."
  });
});

// Resolve endpoint - requires signature validation and applies rate limiting
app.post("/resolve", apiLimiter, validateSignature, async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing YouTube URL parameter." });
  }

  const apiKey = process.env.RAPIDAPI_KEY;

  if (!apiKey) {
    // ==========================================
    // MOCK MODE (Fallback if no RapidAPI key)
    // ==========================================
    console.log(`[Relay Mock] Resolving URL: ${url}`);
    
    // Simulate minor delay (1 second) to demonstrate frontend skeleton/loading state
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Return beautiful Blender open source demo content with real high-speed download links
    return res.json({
      title: "Big Buck Bunny - 1080p Open Source Movie",
      thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_Buck_Bunny_Narrated_Thumbnail.jpg/640px-Big_Buck_Bunny_Narrated_Thumbnail.jpg",
      duration: "9:56",
      author: "Blender Foundation",
      formats: [
        {
          quality: "1080p Full HD",
          extension: "mp4",
          size: "138.0 MB",
          url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        },
        {
          quality: "720p HD",
          extension: "mp4",
          size: "78.4 MB",
          url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        },
        {
          quality: "480p SD",
          extension: "mp4",
          size: "45.1 MB",
          url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
        },
        {
          quality: "Audio MP3",
          extension: "mp3",
          size: "9.1 MB",
          url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
        }
      ]
    });
  }

  // ==========================================
  // PRODUCTION MODE (Calls RapidAPI YouTube Resolver)
  // ==========================================
  console.log(`[Relay Production] Resolving URL: ${url}`);

  try {
    const rapidHost = process.env.RAPIDAPI_HOST || "youtube-video-fast-downloader-24-7.p.rapidapi.com";
    const apiResponse = await fetch(`https://${rapidHost}/info?url=${encodeURIComponent(url)}`, {
      method: "GET",
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": rapidHost
      }
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text();
      return res.status(apiResponse.status).json({ 
        error: `RapidAPI error: ${apiResponse.statusText}. Details: ${errBody}` 
      });
    }

    const rawData = await apiResponse.json();

    // Map the RapidAPI response into our clean, standard Snaptube contract
    // We assume the typical RapidAPI downloader response structure
    const mappedData = {
      title: rawData.title || "YouTube Video",
      thumbnail: rawData.thumbnail || rawData.thumb || "https://placehold.co/640x360",
      duration: rawData.duration || "0:00",
      author: rawData.author || rawData.channelName || "YouTube Creator",
      formats: []
    };

    if (rawData.formats && Array.isArray(rawData.formats)) {
      mappedData.formats = rawData.formats.map(f => ({
        quality: f.quality || f.resolution || "720p",
        extension: f.extension || f.ext || "mp4",
        size: f.size || f.fileSize || "Unknown Size",
        url: f.url || f.downloadUrl
      })).filter(f => f.url);
    } else if (rawData.url) {
      // Fallback simple payload if API returns a single format
      mappedData.formats.push({
        quality: rawData.quality || "720p",
        extension: "mp4",
        size: rawData.size || "Unknown Size",
        url: rawData.url
      });
    }

    if (mappedData.formats.length === 0) {
      return res.status(422).json({ error: "Could not find any download formats for this video." });
    }

    res.json(mappedData);

  } catch (error) {
    console.error("Relay processing exception:", error);
    res.status(500).json({ error: `Internal relay error: ${error.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`SnapTube Thin Relay running on http://localhost:${PORT}`);
  if (!process.env.RAPIDAPI_KEY) {
    console.log(`[!] RAPIDAPI_KEY is not defined. Running in MOCK MODE.`);
  } else {
    console.log(`[+] RAPIDAPI_KEY detected. Running in PRODUCTION MODE.`);
  }
});
