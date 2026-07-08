import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;

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

export const api = {
  async resolveVideo(url, settings = {}) {
    // 1. Mock Mode Check (instant local mock resolution)
    if (settings.mockMode) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return {
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
      };
    }

    if (!isTauri) {
      // Browser fallback: direct API or custom relay URL
      if (settings.provider === "direct") {
        if (!settings.apiKey) {
          throw new Error("API Key is required for Direct API Mode.");
        }
        const videoId = extractVideoId(url);
        if (!videoId) {
          throw new Error("Invalid YouTube URL format.");
        }

        const host = settings.rapidHost || "youtube-video-fast-downloader-24-7.p.rapidapi.com";
        const [infoRes, qualityRes] = await Promise.all([
          fetch(`https://${host}/get-video-info/${videoId}`, {
            method: "GET",
            headers: {
              "x-rapidapi-key": settings.apiKey,
              "x-rapidapi-host": host
            }
          }),
          fetch(`https://${host}/get_available_quality/${videoId}`, {
            method: "GET",
            headers: {
              "x-rapidapi-key": settings.apiKey,
              "x-rapidapi-host": host
            }
          })
        ]);

        if (!infoRes.ok) {
          throw new Error(`Direct API Video Info error: ${infoRes.statusText}`);
        }
        if (!qualityRes.ok) {
          throw new Error(`Direct API Quality Options error: ${qualityRes.statusText}`);
        }

        const infoData = await infoRes.json();
        const qualityData = await qualityRes.json();

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
              url: `https://${host}/download_${f.type}/${videoId}?quality=${f.id}&apiKey=${settings.apiKey}`
            };
          });
        }

        return mappedData;
      } else {
        const endpoint = settings.relayUrl || "http://localhost:3000/resolve";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-snaptube-signature": "SnapTube-Desktop-Client-Token-2026"
          },
          body: JSON.stringify({ url })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server error: ${res.statusText}`);
        }
        return await res.json();
      }
    }

    return await invoke("resolve_video", { 
      url,
      provider: settings.provider || "relay",
      apiKey: settings.apiKey || "",
      relayUrl: settings.relayUrl || "",
      rapidHost: settings.rapidHost || "youtube-video-fast-downloader-24-7.p.rapidapi.com"
    });
  },

  async downloadFile(url, path) {
    if (!isTauri) {
      throw new Error("Native downloading requires the desktop app shell.");
    }
    return await invoke("download_file", { url, path });
  },

  async getHistory() {
    if (!isTauri) {
      const stored = localStorage.getItem("snaptube_mock_history");
      return stored ? JSON.parse(stored) : [];
    }
    return await invoke("get_history_items");
  },

  async addHistoryItem(title, resolution, size, filePath) {
    if (!isTauri) {
      const stored = localStorage.getItem("snaptube_mock_history");
      const items = stored ? JSON.parse(stored) : [];
      const newItem = {
        id: Date.now(),
        title,
        resolution,
        size,
        file_path: filePath,
        timestamp: Math.floor(Date.now() / 1000)
      };
      items.unshift(newItem);
      localStorage.setItem("snaptube_mock_history", JSON.stringify(items));
      return newItem;
    }
    return await invoke("add_history_item", { title, resolution, size, filePath });
  },

  async deleteHistoryItem(id) {
    if (!isTauri) {
      const stored = localStorage.getItem("snaptube_mock_history");
      if (stored) {
        const items = JSON.parse(stored).filter(item => item.id !== id);
        localStorage.setItem("snaptube_mock_history", JSON.stringify(items));
      }
      return "deleted";
    }
    return await invoke("delete_history_item", { id });
  }
};
