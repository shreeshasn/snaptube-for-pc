import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;

export const api = {
  async resolveVideo(url) {
    if (!isTauri) {
      // Browser fallback: call the relay directly using fetch
      const res = await fetch("http://localhost:3000/resolve", {
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
    return await invoke("resolve_video", { url });
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
