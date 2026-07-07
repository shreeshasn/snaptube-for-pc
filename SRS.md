# Software Requirements Specification (SRS) v3.0
# SnapTube PC — Native Desktop Application (Windows / macOS / Linux)

---

## 0. Revision Notes (v2 → v3)

This version converts SnapTube from a hosted web app into **installable desktop software**. The core UI/UX vision from v2 (shader background, motion system) carries over unchanged — it now runs inside a native window instead of a browser tab.

| Area | v2 (Web App) | v3 (Desktop Software) |
|---|---|---|
| Distribution | URL, hosted on Vercel | **Installer files** (.exe / .dmg / .AppImage) or auto-updating app |
| Frontend shell | Browser tab | **Tauri** native window wrapping the same React UI |
| Backend | Always-on Express server on Render | **Thin cloud relay** (still needed — see §2.2) + no local server required |
| CORS | Required (browser-enforced) | **Removed** — desktop app isn't subject to browser CORS |
| Local storage | `localStorage` (session history) | **SQLite** (via Tauri's SQL plugin) or flat JSON in app data dir |
| Updates | Instant (redeploy) | **Explicit update mechanism** required (§6) |
| Install footprint | None | New requirement: installer size, code signing, OS permissions (§5, §7) |

---

## 1. Project Overview

**1.1 Purpose**
To ship SnapTube as a downloadable, installable desktop application for Windows, macOS, and Linux — not a website. Users download an installer once, and the app runs as a standalone program with its own icon, dock/taskbar presence, and native window chrome.

**1.2 Why Tauri over Electron**
Recommended: **Tauri**, not Electron.

| | Electron | Tauri |
|---|---|---|
| Bundle size | ~150–200MB (ships full Chromium) | ~10–20MB (uses OS's native webview) |
| Backend language | Node.js | Rust (with Node still usable via sidecar if needed) |
| Memory footprint | Higher | Lower |
| Shader/WebGL support | Full (Chromium) | Full on Windows (WebView2/Chromium-based) and Linux (WebKitGTK); on macOS uses WKWebView — test the R3F shader on this target specifically, WKWebView WebGL performance has historically lagged Chromium |

Given the app's identity is the shader/motion UI, the one thing to validate early is R3F/WebGL2 performance inside each OS's native webview — this is the single biggest technical risk in the conversion and should be a Day 1 spike, not discovered at the end.

**1.3 Scope**
Same functional scope as v2 (single YouTube URL → metadata → format selection → direct download), now running as a native process. No playlist/channel support in this version.

---

## 2. Architecture & Tech Stack

### 2.1 Application Shell
| Layer | Technology | Notes |
|---|---|---|
| Shell | **Tauri 2.0** | Rust core process, native webview for UI |
| UI | Same React 18 + Vite + Tailwind + R3F + GSAP/Framer Motion stack from v2 | Runs inside Tauri's webview, effectively unchanged |
| Local persistence | Tauri SQL plugin (SQLite) | Replaces `localStorage` for download history |
| Native OS integration | Tauri APIs: file-save dialogs, system tray icon, native notifications | See §4 |
| Downloads | Tauri's `fs`/`http` APIs or a Rust command | Browser's native download flow no longer applies — the app itself must write the file to disk (see REQ-5 rewrite below) |

### 2.2 Why a Backend Still Exists
Even as desktop software, **the RapidAPI key cannot ship inside the installed app** — anyone can unpack a Tauri/Electron bundle and extract embedded secrets. The architecture therefore keeps a minimal cloud relay:

```
Desktop App (Tauri)  --HTTPS-->  Thin Relay API (Render)  --HTTPS-->  RapidAPI
```

- The relay's only job: hold the API key, apply rate limiting, and forward the resolve request. It is a smaller, dumber version of the v2 Express server — no CORS logic needed (no browser origin to police), but should validate a lightweight app-signature/header so it isn't trivially callable by anyone who reverse-engineers the relay's URL.
- This is the correct trade-off vs. embedding the key: slightly more infrastructure, but doesn't leak the API key to every installer.

### 2.3 Build & Packaging
| Platform | Output | Tooling |
|---|---|---|
| Windows | `.msi` / `.exe` (NSIS) | `tauri build` |
| macOS | `.dmg` / `.app` | `tauri build`, requires Apple Developer ID for notarization (see §7) |
| Linux | `.AppImage` / `.deb` | `tauri build` |

---

## 3. Team Workload Distribution (Updated)

* **Frontend / UI-UX Lead** — Unchanged scope from v2, plus: validating shader/WebGL performance inside each OS's native webview (§1.2), adapting the download-trigger flow from "browser download" to native file-save dialog (REQ-5).
* **Backend Lead** — Now owns the **thin relay**, not a full app server: RapidAPI integration, key protection, rate limiting, lightweight request-signing so the relay isn't openly callable.
* **Integration & Deployment Lead** — Expanded scope: Tauri build pipeline for three OS targets, code signing (Windows Authenticode + Apple notarization), auto-update channel setup, installer testing on real (not just VM) hardware per OS.

---

## 4. Functional Requirements (Deltas from v2)

Requirements REQ-1 through REQ-4 and REQ-7 through REQ-12 from v2 are unchanged. The following are rewritten or new for the desktop context:

* **REQ-5 (rewritten): Native Download Trigger** — Clicking a format opens a native "Save As" dialog (Tauri `dialog` API) defaulting to the OS Downloads folder; the app streams the resolved CDN URL to disk itself via a Rust command, since there is no browser to hand the download off to.
* **REQ-8 (rewritten): Persistent Local History** — Download history now persists across app restarts via SQLite (not session-only `localStorage`), since this is a real installed app users expect to retain state.
* **REQ-13 (new): System Tray Presence** — App minimizes to a system tray icon rather than fully closing, with a right-click menu for "Open," "Check for Updates," and "Quit."
* **REQ-14 (new): Native Notifications** — OS-level notification on download completion (Tauri `notification` API), so users can alt-tab away during larger downloads.
* **REQ-15 (new): Auto-Update Check** — On launch, app silently checks a version endpoint; if a newer build exists, shows a non-blocking in-app banner (not a forced update) with a "Restart to Update" action.

---

## 5. UI/UX Specification (Carried Over + Desktop Adjustments)

All of v2 §5 (shader background system, motion system, visual language, accessibility) applies unchanged — the design system doesn't know or care that it's in a native window vs. a tab.

**Desktop-specific additions:**
- **Custom title bar**: Tauri supports frameless windows — recommend a custom-drawn title bar consistent with the glass/shader aesthetic rather than the OS's default chrome, for a more "native premium app" feel (see e.g. Arc, Linear's desktop app).
- **Window states**: design explicit visual treatment for minimized-to-tray, and for the window regaining focus (subtle shader "wake" pulse, consistent with the fetching/success pulses already defined in v2).
- **DPI/multi-monitor**: verify shader canvas resolution scales correctly across mixed-DPI multi-monitor setups (a common Tauri/webview gotcha) — test explicitly, don't assume it "just works" like it does in a browser tab.

---

## 6. Non-Functional Requirements (Deltas from v2)

SEC-1, SEC-3, PER-2, PER-3, PERF-1, PERF-2, ACC-1 from v2 carry over. Changes:

* **SEC-2 (rewritten): API Key Protection** — Key lives only on the relay server, never in the Tauri bundle, never in any compiled binary or config file shipped to users.
* **PER-1 (removed)**: CORS lockdown no longer applies — replaced by relay request-signing (§2.2).
* **DESK-1 (new): Installer Size Budget** — Target under 25MB for the Tauri bundle (vs. Electron's 150MB+) as a hard constraint validating the Tauri choice.
* **DESK-2 (new): Update Cadence** — Auto-update check must not block app launch; failure to reach the version endpoint must fail silently (offline-first assumption — users may launch the app with no network and should still be able to use previously-cached history).
* **DESK-3 (new): Code Signing** — Unsigned builds trigger OS security warnings (Windows SmartScreen, macOS Gatekeeper) that will tank install completion rates; signing is treated as a release blocker, not a post-launch nice-to-have.

---

## 7. Platform-Specific Release Requirements

* **Windows**: Authenticode code-signing certificate required before public distribution; without it, SmartScreen will show an "Unknown Publisher" warning on every install.
* **macOS**: Requires an active Apple Developer Program membership for notarization; unsigned/unnotarized `.app` bundles are blocked by Gatekeeper by default on modern macOS, and users would need to manually bypass this — a significant conversion-killer for a public release.
* **Linux**: `.AppImage` needs no special signing to run, but consider also publishing to Flathub or an AUR package for discoverability if this moves past a portfolio project.

---

## 8. Directory Structure

```text
snaptube-desktop/
├── src/                        # React UI (shared with v2's client/src)
│   ├── App.jsx
│   ├── main.jsx
│   ├── shaders/
│   ├── components/
│   ├── store/
│   └── lib/
│       ├── validateUrl.js
│       └── api.js              # now calls Tauri commands, not fetch()
├── src-tauri/                   # Tauri/Rust core
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── icons/                  # per-OS app icons
│   └── src/
│       ├── main.rs
│       ├── commands/
│       │   ├── download.rs     # streams file to disk
│       │   └── history.rs      # SQLite read/write
│       └── tray.rs             # system tray menu logic
├── relay-server/                # thin cloud relay (was server/ in v2)
│   ├── package.json
│   ├── .env
│   ├── index.js
│   └── middleware/
│       ├── rateLimiter.js
│       └── requestSigning.js   # replaces CORS check
└── package.json                 # Tauri build orchestration
```

---

## 9. Suggested Build Order (Desktop-Specific)

1. **Day 1 spike**: bare Tauri app with the R3F shader canvas running, tested on all three target OS webviews — de-risk this before anything else.
2. Port the v2 React UI into the Tauri shell as-is (should be near drop-in, given the shell doesn't touch component logic).
3. Replace `fetch()`-to-Express calls with Tauri `invoke()` calls to Rust commands.
4. Implement native download-to-disk (REQ-5) and SQLite history (REQ-8) — these replace browser-native behaviors that no longer exist outside a browser.
5. Stand up the thin relay server and swap the API key over to it.
6. System tray + notifications (REQ-13/14).
7. Code signing + auto-update (§6 DESK-3, REQ-15) — last, but not skippable before any public release.

---

## 10. Legal & Compliance Notes (Carried Over from v2, Unchanged)

- YouTube's ToS concerns from v2 §9 apply identically here — packaging the tool as installable software doesn't change the underlying ToS/copyright posture, and arguably raises the stakes slightly since a distributed installer is a more visible artifact than a web app URL.
- The RapidAPI provider fragility risk from v2 also carries over unchanged — still worth keeping the extraction call abstracted behind one module (now `relay-server/index.js`) so a provider swap doesn't require an app update, only a relay redeploy.

---

*End of SRS v3.0*
