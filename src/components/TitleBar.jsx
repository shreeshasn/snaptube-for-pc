import React, { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X, Download } from "lucide-react";

const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = isTauri ? getCurrentWindow() : null;

  useEffect(() => {
    if (!isTauri) return;

    const updateMaximized = async () => {
      try {
        setIsMaximized(await appWindow.isMaximized());
      } catch (e) {
        console.error("Failed to check maximized state:", e);
      }
    };

    updateMaximized();
    
    let unlistenFn;
    appWindow.onResized(() => {
      updateMaximized();
    }).then(unlisten => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [appWindow]);

  const handleMinimize = () => {
    if (isTauri) appWindow.minimize();
  };

  const handleMaximize = () => {
    if (isTauri) appWindow.toggleMaximize();
  };

  const handleClose = () => {
    if (isTauri) appWindow.close();
  };

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-11 bg-slate-950/60 border-b border-white/5 backdrop-blur-md text-slate-300 select-none fixed top-0 left-0 right-0 z-[100] px-4"
    >
      <div className="flex items-center space-x-2 pointer-events-none">
        <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-gradient-to-tr from-rose-500 via-pink-500 to-orange-500 text-white shadow-md">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 5.14v14l11-7-11-7z"/>
          </svg>
        </div>
        <span className="font-sans font-bold tracking-wide text-sm bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
          NovaTube PC
        </span>
      </div>
      
      <div className="flex items-center -mr-4 h-full">
        <button
          onClick={handleMinimize}
          className="flex items-center justify-center w-12 h-11 hover:bg-white/5 transition-colors focus:outline-none"
          title="Minimize"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex items-center justify-center w-12 h-11 hover:bg-white/5 transition-colors focus:outline-none"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Copy className="w-3.5 h-3.5 rotate-180" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="flex items-center justify-center w-12 h-11 hover:bg-rose-600 hover:text-white transition-colors focus:outline-none"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
