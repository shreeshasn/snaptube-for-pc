import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, Play, AlertCircle, RefreshCw, Download, 
  History, FolderOpen, Trash2, X, Bell, 
  ExternalLink, Sparkles, CheckCircle2, AlertTriangle, ArrowRight,
  Settings
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { openPath as openFile } from "@tauri-apps/plugin-opener";
import { 
  isPermissionGranted as checkNotificationPermission, 
  requestPermission as requestNotificationPermission, 
  sendNotification 
} from "@tauri-apps/plugin-notification";

import ShaderBackground from "./components/ShaderBackground";
import TitleBar from "./components/TitleBar";
import { validateUrl } from "./lib/validateUrl";
import { api } from "./lib/api";

const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;

function App() {
  const [url, setUrl] = useState("");
  const [isValid, setIsValid] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [metadata, setMetadata] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  
  const [downloadState, setDownloadState] = useState(null); // 'dialog', 'downloading', 'completed', 'failed'
  const [progress, setProgress] = useState({
    percentage: 0,
    speed_kbps: 0,
    downloaded_bytes: 0,
    total_bytes: 0
  });

  const [history, setHistory] = useState([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem("novatube_settings");
    const defaults = {
      provider: "relay", // "relay" | "direct"
      apiKey: "",
      relayUrl: "http://localhost:3000/resolve",
      mockMode: false,
      theme: "rose",
      rapidHost: "youtube-video-fast-downloader-24-7.p.rapidapi.com",
    };
    if (saved) {
      try {
        return { ...defaults, ...JSON.parse(saved) };
      } catch (e) {
        console.error("Failed to parse settings:", e);
      }
    }
    return defaults;
  });

  useEffect(() => {
    localStorage.setItem("novatube_settings", JSON.stringify(settings));
    document.body.setAttribute("data-theme", settings.theme);
  }, [settings]);

  // Validate URL input changes
  useEffect(() => {
    setIsValid(validateUrl(url));
  }, [url]);

  // Load history from SQLite on mount
  useEffect(() => {
    loadHistory();
  }, []);

  // Listen to manual update check from tray
  useEffect(() => {
    if (!isTauri) return;
    let unlistenFn;
    listen("check-for-updates-manual", () => {
      setUpdateAvailable(true);
      setUpdateVersion("v1.1.0-beta");
    }).then(unlisten => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Silent update check on startup
  useEffect(() => {
    const silentCheck = async () => {
      try {
        const baseRelay = settings.relayUrl ? settings.relayUrl.replace(/\/resolve\/?$/, "") : "http://localhost:3000";
        const response = await fetch(`${baseRelay}/version`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.version !== "1.0.0") {
            setUpdateAvailable(true);
            setUpdateVersion(data.version);
          }
        }
      } catch (e) {
        console.warn("Silent version check failed:", e);
      }
    };
    // Give it a tiny delay on startup
    const timer = setTimeout(silentCheck, 3000);
    return () => clearTimeout(timer);
  }, [settings.relayUrl]);

  const loadHistory = async () => {
    try {
      const items = await api.getHistory();
      setHistory(items || []);
    } catch (e) {
      console.error("Failed to load SQLite history:", e);
    }
  };

  const handleResolve = async (e) => {
    if (e) e.preventDefault();
    if (!isValid) return;

    setIsLoading(true);
    setErrorMsg("");
    setMetadata(null);

    try {
      const data = await api.resolveVideo(url, settings);
      setMetadata(data);
    } catch (e) {
      setErrorMsg(e.toString());
    } finally {
      setIsLoading(false);
    }
  };

  const triggerDownload = async (format) => {
    if (!metadata) return;
    setErrorMsg("");

    if (!isTauri) {
      setDownloadState("downloading");
      setProgress({
        percentage: 10,
        speed_kbps: 1540,
        downloaded_bytes: 1000000,
        total_bytes: 10000000
      });
      
      setTimeout(() => {
        setProgress(prev => ({
          ...prev,
          percentage: 60,
          downloaded_bytes: 6000000,
        }));
      }, 1000);

      setTimeout(async () => {
        setProgress(prev => ({
          ...prev,
          percentage: 100,
          downloaded_bytes: 10000000,
        }));
        setDownloadState("completed");

        const filename = `${metadata.title.replace(/[/\\?%*:|"<>.#]/g, "")}.${format.extension || "mp4"}`;
        const mockPath = `Downloads/${filename}`;
        await api.addHistoryItem(
          metadata.title,
          format.quality,
          format.size || "Unknown Size",
          mockPath
        );
        loadHistory();
      }, 2000);

      return;
    }

    setDownloadState("dialog");
    try {
      // Suggest filename based on title and extension
      const extension = format.extension || "mp4";
      const filename = `${metadata.title.replace(/[/\\?%*:|"<>.#]/g, "")}.${extension}`;
      
      // Native Save As dialog
      const selectedPath = await save({
        defaultPath: filename,
        filters: [{
          name: extension.toUpperCase(),
          extensions: [extension]
        }]
      });

      if (!selectedPath) {
        setDownloadState(null);
        return; // User canceled
      }

      setDownloadState("downloading");
      setProgress({
        percentage: 0,
        speed_kbps: 0,
        downloaded_bytes: 0,
        total_bytes: 0
      });

      // Listen to progress events from the Rust backend
      let unlistenProgress;
      const progressPromise = listen("download-progress", (event) => {
        const p = event.payload;
        setProgress({
          percentage: p.percentage,
          speed_kbps: p.speed_kbps,
          downloaded_bytes: p.downloaded_bytes,
          total_bytes: p.total_bytes
        });
      });

      progressPromise.then(unlisten => {
        unlistenProgress = unlisten;
      });

      // Invoke the Rust download_file command
      const result = await api.downloadFile(format.url, selectedPath);

      if (unlistenProgress) unlistenProgress();

      if (result === "success") {
        setDownloadState("completed");
        
        // Add to SQLite history
        await api.addHistoryItem(
          metadata.title,
          format.quality,
          format.size || "Unknown Size",
          selectedPath
        );
        loadHistory();

        // Native Notification
        let hasPermission = await checkNotificationPermission();
        if (!hasPermission) {
          const status = await requestNotificationPermission();
          hasPermission = status === "granted";
        }
        if (hasPermission) {
          sendNotification({
            title: "Download Finished!",
            body: `"${metadata.title}" has been saved successfully.`
          });
        }
      } else {
        setDownloadState("failed");
      }
    } catch (e) {
      console.error(e);
      setDownloadState("failed");
      setErrorMsg(`Download error: ${e.toString()}`);
    }
  };

  const handleOpenFolder = async (path) => {
    try {
      await openFile(path);
    } catch (e) {
      alert(`Could not open file: ${e.toString()}`);
    }
  };

  const handleDeleteHistory = async (id) => {
    try {
      await api.deleteHistoryItem(id);
      loadHistory();
    } catch (e) {
      console.error(e);
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatSpeed = (speedKbps) => {
    if (speedKbps > 1024) {
      return `${(speedKbps / 1024).toFixed(2)} MB/s`;
    }
    return `${speedKbps.toFixed(2)} KB/s`;
  };

  return (
    <div className="relative min-h-screen flex flex-col pt-11 text-slate-100 font-sans">
      <ShaderBackground theme={settings.theme} />
      <TitleBar />

      {/* Auto update banner */}
      <AnimatePresence>
        {updateAvailable && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-12 left-4 right-4 z-40 bg-primary-500/20 border border-primary-500/30 backdrop-blur-lg rounded-xl p-3 px-4 flex items-center justify-between shadow-2xl"
          >
            <div className="flex items-center space-x-2.5">
              <Sparkles className="w-5 h-5 text-primary-400 animate-pulse" />
              <p className="text-sm font-medium text-slate-200">
                A new version of NovaTube <span className="text-white font-bold">{updateVersion}</span> is available!
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => setUpdateAvailable(false)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition-all shadow-md focus:outline-none"
              >
                Restart to Update
              </button>
              <button 
                onClick={() => setUpdateAvailable(false)}
                className="text-slate-400 hover:text-slate-200 focus:outline-none"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main app grid */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 z-10 max-w-4xl w-full mx-auto pb-12">
        
        {/* Toggle history button */}
        <button
          onClick={() => setIsHistoryOpen(true)}
          className="fixed bottom-6 right-6 flex items-center space-x-2 bg-slate-900/60 border border-white/10 hover:bg-slate-800/80 hover:border-white/20 transition-all rounded-full p-3 px-5 shadow-xl backdrop-blur-md z-30 focus:outline-none group"
        >
          <History className="w-4 h-4 text-primary-400 group-hover:rotate-12 transition-transform" />
          <span className="text-xs font-semibold tracking-wider uppercase text-slate-300">History</span>
          {history.length > 0 && (
            <span className="w-4 h-4 rounded-full bg-primary-500 text-[10px] font-bold text-white flex items-center justify-center">
              {history.length}
            </span>
          )}
        </button>

        {/* Toggle settings button */}
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="fixed bottom-6 left-6 flex items-center space-x-2 bg-slate-900/60 border border-white/10 hover:bg-slate-800/80 hover:border-white/20 transition-all rounded-full p-3 px-5 shadow-xl backdrop-blur-md z-30 focus:outline-none group"
        >
          <Settings className="w-4 h-4 text-primary-400 group-hover:rotate-45 transition-transform duration-300" />
          <span className="text-xs font-semibold tracking-wider uppercase text-slate-300">Settings</span>
        </button>

        <AnimatePresence mode="wait">
          {!metadata ? (
            /* STATE 1: SEARCH STATE */
            <motion.div
              key="search-state"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="w-full max-w-2xl text-center space-y-8"
            >
              <div className="space-y-3">
                <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-primary-400 bg-clip-text text-transparent">
                  Download Anything. Instantly.
                </h2>
                <p className="text-slate-400 text-sm sm:text-base font-light tracking-wide max-w-md mx-auto">
                  Paste a YouTube video URL below to stream and save media files directly to your local drive.
                </p>
              </div>

              <form onSubmit={handleResolve} className="relative w-full max-w-xl mx-auto group">
                <div className="relative flex items-center">
                  <div className="absolute left-4 text-slate-400 pointer-events-none group-focus-within:text-primary-400 transition-colors">
                    <Search className="w-5 h-5" />
                  </div>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Paste YouTube Link here..."
                    className="w-full h-14 pl-12 pr-32 rounded-2xl glass-input text-slate-100 placeholder-slate-500 font-medium text-base shadow-2xl"
                    disabled={isLoading}
                  />
                  <div className="absolute right-2">
                    <button
                      type="submit"
                      disabled={!isValid || isLoading}
                      className={`h-10 px-5 rounded-xl font-bold text-xs tracking-wider uppercase flex items-center space-x-1.5 shadow-lg transition-all ${
                        isValid && !isLoading
                          ? "bg-gradient-to-r from-primary-500 to-primary-600 text-white hover:from-primary-400 hover:to-primary-500 hover:shadow-primary-500/20 active:scale-95"
                          : "bg-slate-800/40 text-slate-500 cursor-not-allowed border border-white/5"
                      }`}
                    >
                      {isLoading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <span>Resolve</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>

              {errorMsg && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-center space-x-2 text-primary-400 text-xs font-semibold max-w-md mx-auto bg-primary-950/20 border border-primary-500/10 p-2.5 rounded-lg backdrop-blur-md select-text"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </motion.div>
              )}
            </motion.div>
          ) : (
            /* STATE 2: METADATA & SELECT STATE */
            <motion.div
              key="metadata-state"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
              className="w-full max-w-3xl glass-panel rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row gap-8 shadow-2xl relative overflow-hidden"
            >
              {/* Reset button inside metadata state */}
              <button
                onClick={() => {
                  setMetadata(null);
                  setUrl("");
                  setErrorMsg("");
                }}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors focus:outline-none"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Video preview / thumbnail */}
              <div className="w-full md:w-2/5 flex flex-col space-y-4">
                <div className="relative rounded-2xl overflow-hidden aspect-video border border-white/10 shadow-xl group">
                  <img
                    src={metadata.thumbnail}
                    alt={metadata.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-slate-950/20 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30 shadow-2xl">
                      <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="font-extrabold text-lg leading-snug line-clamp-2 text-white">
                    {metadata.title}
                  </h3>
                  <div className="flex items-center space-x-2 mt-2">
                    <span className="text-xs font-semibold text-primary-400 bg-primary-500/10 px-2.5 py-0.5 rounded-full border border-primary-500/10">
                      {metadata.author || "YouTube Creator"}
                    </span>
                    <span className="text-xs font-medium text-slate-400">
                      {metadata.duration || "0:00"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Format selection */}
              <div className="flex-1 flex flex-col justify-between space-y-6">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3.5">
                    Available Downloads
                  </h4>
                  <div className="space-y-2.5">
                    {metadata.formats && metadata.formats.map((format, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all group"
                      >
                        <div className="flex flex-col">
                          <span className="font-bold text-sm text-slate-200">
                            {format.quality} ({format.extension.toUpperCase()})
                          </span>
                          <span className="text-xs text-slate-400">
                            Size: {format.size || "Unknown"}
                          </span>
                        </div>
                        <button
                          onClick={() => triggerDownload(format)}
                          disabled={downloadState !== null}
                          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-200 font-bold text-xs uppercase tracking-wide hover:bg-primary-600 hover:border-primary-600 hover:text-white transition-all shadow-md focus:outline-none"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Get</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* STATE 3: DOWNLOADING OVERLAY */}
        <AnimatePresence>
          {downloadState && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md"
            >
              <motion.div
                initial={{ scale: 0.95, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 10 }}
                className="w-full max-w-md glass-panel rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl text-center border border-white/10"
              >
                {downloadState === "dialog" && (
                  <div className="space-y-4">
                    <div className="mx-auto w-12 h-12 rounded-full bg-primary-500/10 border border-primary-500/20 flex items-center justify-center animate-pulse">
                      <FolderOpen className="w-5 h-5 text-primary-400" />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg text-white">Opening Save Dialog...</h4>
                      <p className="text-xs text-slate-400 mt-1">Please select where you want to save the file.</p>
                    </div>
                  </div>
                )}

                {downloadState === "downloading" && (
                  <div className="space-y-5">
                    <div className="space-y-1">
                      <h4 className="font-bold text-lg text-white">Downloading File</h4>
                      <p className="text-xs text-primary-400 font-medium">Please do not close NovaTube</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                        <span>{progress.percentage.toFixed(1)}%</span>
                        <span>{formatSpeed(progress.speed_kbps)}</span>
                      </div>
                      <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-white/5 p-0.5">
                        <div
                          className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full transition-all duration-300 shadow-md"
                          style={{ width: `${progress.percentage}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                        <span>{formatBytes(progress.downloaded_bytes)}</span>
                        <span>{formatBytes(progress.total_bytes)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {downloadState === "completed" && (
                  <div className="space-y-4">
                    <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400 animate-bounce" />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg text-white">Download Complete!</h4>
                      <p className="text-xs text-slate-400 mt-1">Your file has been saved to disk.</p>
                    </div>
                    <div className="flex space-x-3 pt-2">
                      <button
                        onClick={() => setDownloadState(null)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-900 border border-white/10 hover:bg-slate-800 text-slate-200 font-bold text-xs uppercase transition-all focus:outline-none"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}

                {downloadState === "failed" && (
                  <div className="space-y-4">
                    <div className="mx-auto w-12 h-12 rounded-full bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
                      <AlertTriangle className="w-6 h-6 text-primary-400" />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg text-white">Download Failed</h4>
                      <p className="text-xs text-slate-400 mt-1">Something went wrong during the transfer.</p>
                      {errorMsg && (
                        <div className="mt-2.5 p-2 bg-primary-950/20 border border-primary-500/15 rounded-xl text-[10px] text-primary-400/90 font-mono text-left break-all select-text max-h-24 overflow-y-auto">
                          {errorMsg}
                        </div>
                      )}
                    </div>
                    <div className="flex space-x-3 pt-2">
                      <button
                        onClick={() => {
                          setDownloadState(null);
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-400 text-white font-bold text-xs uppercase transition-all shadow-md focus:outline-none"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* STATE 4: HISTORY DRAWER */}
        <AnimatePresence>
          {isHistoryOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHistoryOpen(false)}
              className="fixed inset-0 z-[90] bg-slate-950/60 backdrop-blur-sm flex justify-end"
            >
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "tween", duration: 0.3 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md h-full bg-slate-900/90 border-l border-white/10 backdrop-blur-xl p-6 pt-16 shadow-2xl flex flex-col justify-between"
              >
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
                    <div className="flex items-center space-x-2">
                      <History className="w-5 h-5 text-primary-400" />
                      <h3 className="font-bold text-lg text-white">Download History</h3>
                    </div>
                    <button
                      onClick={() => setIsHistoryOpen(false)}
                      className="p-1.5 rounded-full hover:bg-white/5 text-slate-400 hover:text-white transition-colors focus:outline-none"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Scrollable list */}
                  <div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
                    {history.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500 space-y-2">
                        <History className="w-8 h-8 opacity-20" />
                        <p className="text-sm font-medium">No downloads yet.</p>
                      </div>
                    ) : (
                      history.map((item) => (
                        <div
                          key={item.id}
                          className="p-3.5 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-all flex items-start justify-between gap-3 group"
                        >
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <h4 className="font-bold text-sm text-slate-200 line-clamp-2 leading-tight">
                              {item.title}
                            </h4>
                            <div className="flex items-center space-x-2 text-xs text-slate-400">
                              <span className="bg-primary-500/10 px-2 py-0.5 rounded text-[10px] font-bold text-primary-400">
                                {item.resolution}
                              </span>
                              <span>•</span>
                              <span>{item.size}</span>
                            </div>
                            <p className="text-[10px] text-slate-500 truncate select-text">
                              {item.file_path}
                            </p>
                          </div>
                          
                          <div className="flex flex-col space-y-2 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleOpenFolder(item.file_path)}
                              className="p-1.5 rounded-lg bg-slate-900 border border-white/10 hover:bg-primary-600 hover:border-primary-600 hover:text-white transition-all focus:outline-none"
                              title="Open File Location"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteHistory(item.id)}
                              className="p-1.5 rounded-lg bg-slate-900 border border-white/10 hover:bg-primary-600 hover:border-primary-600 hover:text-white transition-all focus:outline-none"
                              title="Delete Item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="border-t border-white/10 pt-4 mt-4 flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>NovaTube PC v1.0.0</span>
                  <span className="flex items-center space-x-1 text-primary-400/80">
                    <Bell className="w-3 h-3" />
                    <span>SQLite Database</span>
                  </span>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* STATE 5: SETTINGS MODAL */}
        <AnimatePresence>
          {isSettingsOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6"
            >
              <motion.div
                initial={{ scale: 0.95, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 10 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg glass-panel rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl border border-white/10 relative overflow-hidden"
              >
                {/* Close button */}
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="absolute top-4 right-4 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors focus:outline-none"
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="flex items-center space-x-2 border-b border-white/10 pb-4">
                  <Settings className="w-5 h-5 text-primary-400" />
                  <h3 className="font-bold text-lg text-white">NovaTube Settings</h3>
                </div>

                <div className="space-y-5 text-left">
                  {/* Mock Mode Toggle */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/5">
                    <div>
                      <label className="block text-sm font-bold text-slate-200">Local Mock Mode</label>
                      <span className="text-xs text-slate-400">Offline demo resolution (uses open-source movie)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSettings(prev => ({ ...prev, mockMode: !prev.mockMode }))}
                      className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 focus:outline-none ${
                        settings.mockMode ? "bg-primary-500" : "bg-slate-800"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-white transition-transform duration-300 ${
                          settings.mockMode ? "translate-x-6" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Theme Selector */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">Background Theme</label>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { id: "rose", name: "Rose", color: "from-rose-500 to-rose-600 border-rose-500" },
                        { id: "emerald", name: "Emerald", color: "from-emerald-500 to-emerald-600 border-emerald-500" },
                        { id: "aurora", name: "Aurora", color: "from-cyan-500 to-blue-600 border-cyan-500" },
                        { id: "solar", name: "Solar", color: "from-orange-500 to-yellow-600 border-orange-500" }
                      ].map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setSettings(prev => ({ ...prev, theme: t.id }))}
                          className={`p-2 rounded-xl border flex flex-col items-center justify-center space-y-1.5 focus:outline-none transition-all ${
                            settings.theme === t.id
                              ? "bg-white/10 border-white/40 shadow-lg"
                              : "bg-white/5 border-white/5 hover:bg-white/10"
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-gradient-to-tr ${t.color}`} />
                          <span className="text-[10px] font-bold text-slate-300">{t.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Provider Mode Selection */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">Resolution Provider</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setSettings(prev => ({ ...prev, provider: "relay" }))}
                        className={`p-3 rounded-xl border text-center font-bold text-xs uppercase tracking-wide transition-all focus:outline-none ${
                          settings.provider === "relay"
                            ? "bg-primary-500/20 border-primary-500 text-primary-400 shadow-lg shadow-primary-500/5"
                            : "bg-white/5 border-white/5 text-slate-400 hover:bg-white/10"
                        }`}
                      >
                        Relay Mode
                      </button>
                      <button
                        onClick={() => setSettings(prev => ({ ...prev, provider: "direct" }))}
                        className={`p-3 rounded-xl border text-center font-bold text-xs uppercase tracking-wide transition-all focus:outline-none ${
                          settings.provider === "direct"
                            ? "bg-primary-500/20 border-primary-500 text-primary-400 shadow-lg shadow-primary-500/5"
                            : "bg-white/5 border-white/5 text-slate-400 hover:bg-white/10"
                        }`}
                      >
                        Direct API (BYOK)
                      </button>
                    </div>
                  </div>

                  {/* API Key (only shown in Direct Mode) */}
                  {settings.provider === "direct" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2 overflow-hidden"
                    >
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">RapidAPI Key</label>
                      <input
                        type="password"
                        value={settings.apiKey}
                        onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                        placeholder="Enter your youtube-video-fast-downloader key..."
                        className="w-full h-11 px-4 rounded-xl bg-slate-950/60 border border-white/10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-primary-500/50 shadow-inner"
                      />
                      <span className="text-[10px] text-slate-500 block leading-tight">
                        Your key is stored only on this machine in your local webview storage.
                      </span>
                    </motion.div>
                  )}

                  {/* RapidAPI Host (only shown in Direct Mode) */}
                  {settings.provider === "direct" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2 overflow-hidden"
                    >
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">RapidAPI Host</label>
                      <input
                        type="text"
                        value={settings.rapidHost}
                        onChange={(e) => setSettings(prev => ({ ...prev, rapidHost: e.target.value }))}
                        placeholder="youtube-video-fast-downloader-24-7.p.rapidapi.com"
                        className="w-full h-11 px-4 rounded-xl bg-slate-950/60 border border-white/10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-primary-500/50 shadow-inner"
                      />
                    </motion.div>
                  )}

                  {/* Relay URL (only shown in Relay Mode) */}
                  {settings.provider === "relay" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2 overflow-hidden"
                    >
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">Relay Server URL</label>
                      <input
                        type="text"
                        value={settings.relayUrl}
                        onChange={(e) => setSettings(prev => ({ ...prev, relayUrl: e.target.value }))}
                        placeholder="http://localhost:3000/resolve"
                        className="w-full h-11 px-4 rounded-xl bg-slate-950/60 border border-white/10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-primary-500/50 shadow-inner"
                      />
                      <span className="text-[10px] text-slate-500 block leading-tight">
                        The thin server that holds the default API key and updates config.
                      </span>
                    </motion.div>
                  )}
                </div>

                <div className="flex space-x-3 pt-4 border-t border-white/10">
                  <button
                    onClick={() => {
                      setSettings({
                        provider: "relay",
                        apiKey: "",
                        relayUrl: "http://localhost:3000/resolve",
                        mockMode: false,
                        theme: "rose",
                        rapidHost: "youtube-video-fast-downloader-24-7.p.rapidapi.com"
                      });
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-slate-950/60 border border-white/5 hover:bg-slate-900 text-slate-400 hover:text-slate-200 font-bold text-xs uppercase transition-all focus:outline-none"
                  >
                    Reset Defaults
                  </button>
                  <button
                    onClick={() => setIsSettingsOpen(false)}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-400 hover:to-primary-500 text-white font-bold text-xs uppercase transition-all shadow-md focus:outline-none"
                  >
                    Save & Close
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default App;
