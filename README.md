# Remote Desktop App — Build From Scratch, Step by Step

This is a **real, working MVP**: two Electron apps that can pair by device ID, stream one machine's screen to the other over WebRTC, and let the viewer control the mouse/keyboard on the host. It's the same architecture family as AnyDesk/TeamViewer, simplified to something one person can build and run.

What it does: screen share + remote input, P2P over WebRTC, device-ID pairing.
What it doesn't do (yet): TURN relay for strict NATs, file transfer, clipboard sync, multi-monitor, audio, auto-reconnect, installers. Those are Phase 4 items from the architecture doc — extensions to this same codebase.

---

## 0. Prerequisites

Install on your dev machine:
- **Node.js** 18+ (https://nodejs.org)
- A C++ build toolchain, needed to compile `robotjs`'s native module:
  - Windows: `npm install --global windows-build-tools` (or Visual Studio Build Tools)
  - macOS: `xcode-select --install`
  - Linux: `sudo apt install build-essential`

`robotjs` is the trickiest install in this stack because it compiles native code. If it fails on your Node version, see the troubleshooting note at the bottom — the rest of the app runs fine without it, just without host-side input injection.

---

## Step 1 — Project layout

```
remote-desktop-app/
├── signaling-server/
│   ├── package.json
│   └── server.js
└── app/
    ├── package.json
    ├── main.js
    ├── preload.js
    └── renderer/
        ├── index.html
        ├── styles.css
        └── renderer.js
```

All these files are included in this project folder already — this guide explains what each does and how to run it.

---

## Step 2 — Run the signaling server

This is the small always-on server that lets two copies of the app find each other and exchange connection info before the P2P link is up. It never sees your screen — only device IDs and connection handshake data.

```bash
cd signaling-server
npm install
npm start
```

You should see:
```
Signaling server running on ws://localhost:8080
```

Leave this running. For real internet use later (not just same-machine testing), you'd deploy this to a small VPS and point both app instances at its public address by editing `SIGNALING_URL` in `renderer.js`.

**What's in `server.js`:** a WebSocket server that assigns each connecting app an 8-character device ID, and relays four message types between paired peers: `connect-request`, `connect-accept`/`reject`, and `signal` (which carries the WebRTC SDP offer/answer and ICE candidates). This is the entire signaling protocol.

---

## Step 3 — Install and run the Electron app

Open a **second terminal** (keep the signaling server running in the first):

```bash
cd app
npm install
npm start
```

An Electron window opens showing your device's ID at the top. **Run this same command in two separate terminals/machines** to simulate a host and a client — each launch gets its own device ID.

---

## Step 4 — Connect the two instances

1. In App Window #1, note the ID shown at the top (e.g. `A1B2C3D4`).
2. In App Window #2, type that ID into the "Enter the other device's ID" box and click **Connect**.
3. Window #1 gets a confirm dialog — accept it. Your OS may then prompt for screen recording permission (macOS/Windows do this the first time).
4. Window #1 becomes the **host** (starts sharing its screen). Window #2 becomes the **client** (displays the video and can move the mouse over it).

That confirm-and-share flow is the whole pairing UX — swap which window initiates the request and roles swap accordingly.

---

## Step 5 — How the pieces fit together (so you can extend it)

**`main.js` (Electron main process)** — has OS-level access. Handles the screen-picker permission and receives input-injection commands over IPC, then calls `robotjs` to actually move the mouse / press keys on this machine.

**`preload.js`** — the security boundary. Exposes exactly four functions (`injectMouseMove`, `injectMouseClick`, `injectMouseScroll`, `injectKey`) to the renderer's browser context, nothing else. The renderer never gets raw Node/OS access.

**`renderer.js`** — runs in the Chromium window. Handles:
- WebSocket connection to the signaling server (`connectSignaling`)
- WebRTC peer connection setup, offer/answer/ICE exchange (`createPeerConnection`, `handleSignal`)
- Host role: `getDisplayMedia()` to capture the screen, creates a `DataChannel` named `"input"` to receive remote input commands
- Client role: renders the incoming video track into `<video>`, captures local mouse/keyboard events and sends them as JSON over the data channel

This is the WebRTC dance happening under the hood:
```
Host                                    Client
 |--- register (get device ID) --------- (signaling server) --------- register ---|
 |<----------------- connect-request / accept ------------------------------------|
 |--- createOffer() → send SDP offer -------------------------------------------->|
 |<-- createAnswer() ← SDP answer -------------------------------------------------|
 |<-------- exchange ICE candidates as they're discovered ------------------------>|
 |======================= P2P connection established =============================|
 |======= video track flows Host→Client, input commands flow Client→Host =========|
```

---

## Step 6 — Extending toward a real product

Pick these up roughly in this order:

1. **TURN server for reliable connections.** Not everyone can connect P2P (symmetric NATs, corporate firewalls). Run `coturn` on a cheap VPS and add it to `rtcConfig.iceServers` in `renderer.js`:
   ```js
   { urls: 'turn:your-server-ip:3478', username: 'user', credential: 'pass' }
   ```
2. **Persistent device identity + access codes**, so a device ID survives app restarts and unattended access needs a saved password, not just a live confirm dialog.
3. **File transfer** — a second `DataChannel` carrying chunked file data.
4. **Clipboard sync** — poll `navigator.clipboard` and push changes over a data channel.
5. **Multi-monitor** — `desktopCapturer.getSources()` returns one entry per display; let the host pick, or the client switch between them.
6. **Adaptive quality** — inspect `RTCPeerConnection.getStats()` for packet loss/bandwidth and adjust the requested capture resolution/frame rate accordingly.
7. **Packaging** — `electron-builder` to produce signed installers for Windows/macOS/Linux, plus auto-update.
8. **The animated UI** you originally asked about — swap out `index.html`/`styles.css` for the polished interface; none of the WebRTC/IPC logic above needs to change to support that.

---

## Troubleshooting

- **`robotjs` fails to install:** it needs to compile against your exact Node/Electron ABI. If `npm install` errors out, try `npm install --build-from-source` or pin Node to an LTS version. As a fallback, comment out the `robot.*` calls in `main.js` — everything else (screen viewing) still works, you just lose remote input control until it's sorted.
- **Screen share prompt never appears / stream is black:** on macOS, grant your terminal or the packaged app **Screen Recording** permission in System Settings → Privacy & Security, then relaunch.
- **Connection request times out:** confirm both windows connected to the *same* signaling server address, and that `ws start` is still running in its terminal.
- **Video connects but input does nothing:** check that `robotjs` loaded successfully — `main.js` logs a warning to the terminal if it didn't.
