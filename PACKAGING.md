# From Dev Project → Installable App

Right now, running this requires Node.js + a terminal + `npm install`. To get to "download, double-click, use it" you need four things: (1) a packaged installer, (2) a signing certificate so Windows/macOS don't block it, (3) a signaling server that's actually online (not `localhost`), and (4) auto-updates. Here's each, in order.

---

## 1. Package it into a real installer

I've swapped `robotjs` for `@nut-tree-fork/nut-js` in `main.js` and `app/package.json` — it's actively maintained and installs far more reliably (fewer "install Visual Studio" moments for you or your users). Re-run `npm install` in the `app` folder to pick it up.

I also added an `electron-builder` config to `app/package.json`. This is the tool that bundles your app + all its dependencies + a copy of the Chromium/Node runtime into one file the user just runs.

```bash
cd app
npm install
npm run dist
```

This produces, depending on what OS you build on:
- **Windows:** `dist/RemoteDesk Setup 1.0.0.exe` — a real installer with Next/Next/Finish, desktop shortcut, Start Menu entry
- **macOS:** `dist/RemoteDesk-1.0.0.dmg` — drag-to-Applications installer
- **Linux:** `dist/RemoteDesk-1.0.0.AppImage` — single executable file

**Important limitation:** electron-builder mostly builds for the OS you're running it on. To ship for all three platforms you either need three machines (or VMs), or use a CI service (GitHub Actions is free for public repos and can build all three in parallel — search "electron-builder GitHub Actions" for ready-made workflow files).

You'll also want a real app icon — drop `icon.ico` (Windows), `icon.icns` (Mac), and `icon.png` (Linux, 512×512) into a `build/` folder; the config already points to them.

---

## 2. Code signing (skip this and Windows/macOS actively warn people off your app)

Without signing:
- Windows SmartScreen shows "Windows protected your PC" with a scary blue screen
- macOS Gatekeeper refuses to open it at all ("app is damaged" / unidentified developer)

**Windows:** buy a code signing certificate (~$70–400/year from DigiCert, SSL.com, or similar — cheaper "OV" certs still trigger some warnings initially until you build reputation; "EV" certs avoid this immediately but cost more and require hardware key storage). Add it to the build config:
```json
"win": { "certificateFile": "cert.pfx", "certificatePassword": "..." }
```

**macOS:** you need an Apple Developer account ($99/year), then sign + **notarize** (Apple scans it and approves). `electron-builder` can automate this if you set:
```json
"mac": { "hardenedRuntime": true, "notarize": { "teamId": "YOUR_TEAM_ID" } }
```
with your Apple ID credentials in environment variables at build time.

This is the single biggest thing separating "a tool you built" from "a product people trust enough to install."

---

## 3. Put the signaling server somewhere real

`SIGNALING_URL` in `renderer.js` currently points at `ws://localhost:8080` — that only works when both users are on your dev machine. For real use:

1. Deploy `signaling-server/` to a cheap always-on host: a $5/mo VPS (DigitalOcean, Hetzner), or a platform like Railway/Render/Fly.io that runs Node apps directly from a git push.
2. Put it behind HTTPS/WSS (a reverse proxy like Caddy or nginx gets you a free TLS cert in a couple lines) — browsers/Electron increasingly block insecure `ws://` from packaged apps.
3. Update `SIGNALING_URL` to `wss://your-domain.com` and rebuild.

You'll also want a **TURN server** at this point (mentioned in the original architecture doc) — without it, users on strict corporate/hotel/mobile networks simply can't connect. `coturn` self-hosted, or a hosted TURN provider (Metered, Twilio) if you don't want to run infrastructure yourself.

---

## 4. Auto-update

Nobody wants to manually redownload installers. `electron-updater` (already added as a dependency) checks a server for new versions and updates silently in the background.

Simplest setup — publish releases to GitHub:
```js
// add near the top of main.js
const { autoUpdater } = require('electron-updater');
app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
  // ...existing createWindow() etc.
});
```
Then `npm run dist -- --publish always` (with a `GH_TOKEN` env var set) uploads the installer straight to a GitHub Release, and every installed copy checks that release feed on launch.

---

## Realistic order of operations

1. Get `npm run dist` producing a working local installer, install it on your own machine, confirm the packaged app runs correctly (packaged apps sometimes behave differently than `npm start` — test this before anything else).
2. Deploy the signaling server + TURN server so two *different* real machines can connect, not just two windows on your dev box.
3. Buy/set up code signing for whichever OS you're launching on first.
4. Wire up auto-update.
5. Only then worry about polish — icon, animated UI, landing page, download page.

Each of these is independently a few hours to a day of work; none of them is optional if the goal is something a stranger can download and trust.
