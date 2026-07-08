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

// Utility function to extract videoId from YouTube URLs
function extractVideoId(url) {
  if (!url) return null;
  const regex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/(watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[5] : null;
}

// Utility to format bytes to human-readable size
function formatBytes(bytes) {
  if (!bytes) return "Unknown Size";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

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
      thumbnail: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=640",
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
  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: "Invalid YouTube URL format." });
  }

  console.log(`[Relay Production] Resolving URL: ${url} (Video ID: ${videoId})`);

  try {
    const rapidHost = process.env.RAPIDAPI_HOST || "youtube-video-fast-downloader-24-7.p.rapidapi.com";
    
    // Call both info and quality endpoints in parallel
    const [infoResponse, qualityResponse] = await Promise.all([
      fetch(`https://${rapidHost}/get-video-info/${videoId}`, {
        method: "GET",
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": rapidHost
        }
      }),
      fetch(`https://${rapidHost}/get_available_quality/${videoId}`, {
        method: "GET",
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": rapidHost
        }
      })
    ]);

    if (!infoResponse.ok) {
      const errBody = await infoResponse.text();
      return res.status(infoResponse.status).json({ 
        error: `RapidAPI Video Info error: ${infoResponse.statusText}. Details: ${errBody}` 
      });
    }

    if (!qualityResponse.ok) {
      const errBody = await qualityResponse.text();
      return res.status(qualityResponse.status).json({ 
        error: `RapidAPI Quality Options error: ${qualityResponse.statusText}. Details: ${errBody}` 
      });
    }

    const infoData = await infoResponse.json();
    const qualityData = await qualityResponse.json();

    // Map thumbnail
    let thumbnail = "https://placehold.co/640x360";
    if (infoData.thumbnail && Array.isArray(infoData.thumbnail) && infoData.thumbnail.length > 0) {
      thumbnail = infoData.thumbnail[infoData.thumbnail.length - 1].url || thumbnail;
    }

    // Format duration
    let duration = "0:00";
    if (infoData.lengthSeconds) {
      const seconds = parseInt(infoData.lengthSeconds, 10);
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      duration = `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    const mappedData = {
      title: infoData.title || "YouTube Video",
      thumbnail: thumbnail,
      duration: duration,
      author: infoData.ownerChannelName || infoData.author || "YouTube Creator",
      formats: []
    };

    if (Array.isArray(qualityData)) {
      // Group/deduplicate and filter formats (highest bitrate for unique quality levels)
      const filteredFormats = [];
      const seenQualities = new Set();
      const sorted = qualityData.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      for (const f of sorted) {
        if (f.type === "audio") {
          if (!seenQualities.has("audio")) {
            seenQualities.add("audio");
            filteredFormats.push(f);
          }
        } else if (f.type === "video") {
          const key = f.quality;
          if (key && !seenQualities.has(key)) {
            seenQualities.add(key);
            filteredFormats.push(f);
          }
        }
      }

      // Determine client request address to format internal relay download URL
      const protocol = req.protocol;
      const clientHost = req.get("host");
      const baseRelay = `${protocol}://${clientHost}`;

      mappedData.formats = filteredFormats.map(f => {
        let extension = "mp4";
        let label = f.quality;
        if (f.type === "audio") {
          extension = f.mime && f.mime.includes("opus") ? "opus" : "m4a";
          label = `Audio (${extension.toUpperCase()})`;
        } else {
          extension = f.mime && f.mime.includes("webm") ? "webm" : "mp4";
          label = `${f.quality} (${extension.toUpperCase()})`;
        }

        return {
          quality: label,
          extension: extension,
          size: formatBytes(f.size),
          url: `${baseRelay}/download?videoId=${videoId}&type=${f.type}&quality=${f.id}`
        };
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

// Download endpoint to generate download URL and redirect client
app.get("/download", async (req, res) => {
  const { videoId, type, quality } = req.query;

  if (!videoId || !type || !quality) {
    return res.status(400).send("Missing query parameters: videoId, type, and quality are required.");
  }

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    const mockUrl = type === "audio" 
      ? "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
      : "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
    return res.redirect(mockUrl);
  }

  try {
    const rapidHost = process.env.RAPIDAPI_HOST || "youtube-video-fast-downloader-24-7.p.rapidapi.com";
    const endpoint = type === "audio" ? "download_audio" : "download_video";
    
    console.log(`[Relay Download] Fetching link for video: ${videoId}, quality: ${quality}, type: ${type}`);
    
    const apiResponse = await fetch(`https://${rapidHost}/${endpoint}/${videoId}?quality=${quality}`, {
      method: "GET",
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": rapidHost
      }
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      return res.status(apiResponse.status).send(`RapidAPI download error: ${apiResponse.statusText}. Details: ${errText}`);
    }

    const data = await apiResponse.json();
    if (data && data.file) {
      console.log(`[Relay Download] Redirecting to: ${data.file}`);
      return res.redirect(data.file);
    }

    res.status(422).send("No download file URL was returned from RapidAPI.");
  } catch (error) {
    console.error("Download redirection exception:", error);
    res.status(500).send(`Internal relay download error: ${error.message}`);
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
