# Complete Guide: Code → GitHub → Signaling Server → Compiled App

Everything in one place, in the order you actually do it. The zip attached has all the code files already — this guide is the full path from that zip to a working installed app talking to a live server.

---

## PART A — What's in the project (reference, no action needed)

```
remote-desktop-app/
├── signaling-server/       ← deploy this to Render
│   ├── package.json
│   └── server.js           ← matches two devices by ID, relays WebRTC handshake
└── app/                    ← compile this into your .exe
    ├── package.json        ← has the electron-builder packaging config
    ├── main.js              ← OS-level: screen capture permission, mouse/keyboard injection
    ├── preload.js           ← security bridge between main.js and the UI
    └── renderer/
        ├── index.html       ← the UI structure
        ├── styles.css       ← the UI styling
        └── renderer.js      ← WebRTC + signaling connection logic (has SIGNALING_URL)
```

You don't need to write any of this — it's done. You only ever edit `SIGNALING_URL` in `renderer.js` (once, in Part D) and, later, the UI files if you want to redesign the look.

---

## PART B — Push signaling-server to GitHub

**1. Check Git is installed**
```powershell
git --version
```
If that errors, install from git-scm.com/download/win (default options), then reopen PowerShell.

**2. Create a GitHub account + empty repo**
- Go to github.com → sign up if needed
- Click **+** (top right) → **New repository**
- Name: `remote-desktop-signaling`
- Keep it **Public**
- Do **not** check "Add a README" — must be completely empty
- Click **Create repository**

**3. Push your local folder to it**
```powershell
cd D:\Projects\remote-desktop-app\signaling-server
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/remote-desktop-signaling.git
git push -u origin main
```
Replace `YOUR-USERNAME` with your actual GitHub username (visible in the repo URL GitHub showed you after creating it). A browser window may pop up asking you to authorize — log in and approve it.

**4. Confirm it worked**
Refresh the repo page on github.com — you should see `server.js` and `package.json` listed.

---

## PART C — Deploy it on Render (free, live server)

**1. Sign up:** dashboard.render.com → sign in with GitHub (simplest, grants repo access automatically).

**2. Create the service:**
- Click **New +** (top right) → **Web Service**
- Under "Build and deploy from a Git repository", click **Next**
- Select `remote-desktop-signaling` from your repo list → **Connect**
  (if it's not listed, click "Configure account" to grant Render access to it)

**3. Fill in settings:**
| Field | Value |
|---|---|
| Name | `signaling-server` (or anything) |
| Region | closest to you |
| Branch | `main` |
| Root Directory | leave blank |
| Environment | `Node` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | `Free` |

Click **Create Web Service**.

**4. Wait for deploy** — watch the log stream, takes 2-3 minutes, until it says **Live**. If it fails, copy the error log and send it to me.

**5. Copy the URL** shown at the top of the service page — looks like:
```
https://signaling-server-xxxx.onrender.com
```

**6. Keep it awake (optional but recommended):**
- Sign up free at uptimerobot.com
- **+ Add New Monitor** → HTTP(s) → paste your Render URL (the `https://` one) → 5 minute interval → **Create Monitor**
- This pings it regularly so it doesn't go idle-to-sleep between uses

---

## PART D — Point the app at your live server

Open `app\renderer\renderer.js` in Notepad (or any text editor) and find this near the top:
```js
const SIGNALING_URL = 'ws://localhost:8080';
```
Replace it with your Render URL, changing `https://` to `wss://`:
```js
const SIGNALING_URL = 'wss://signaling-server-xxxx.onrender.com';
```
Save the file.

---

## PART E — Compile it into a real .exe

```powershell
cd D:\Projects\remote-desktop-app\app
npm install
npm run dist
```

- `npm install` pulls in dependencies (Electron, electron-builder, nut-js for input control)
- `npm run dist` packages everything into a standalone installer

Output lands in `app\dist\`:
```
RemoteDesk Setup 1.0.0.exe
```

That single file is now your shareable app — copy it to any Windows PC, double-click, install, and it runs with no Node, no npm, no terminal, and connects through your live Render server automatically.

---

## PART F — Test it for real

1. Install the `.exe` on your PC (or a second machine)
2. Launch it — it should now show a real **Device ID** at the top instead of "disconnected", since `renderer.js` is reaching your live server
3. Install/launch it on a second PC too, note its Device ID
4. On one, enter the other's ID and click **Connect** — accept the prompt on the other side, grant screen recording permission if asked
5. Confirm screen sharing + mouse/keyboard control both work

---

## If something breaks

Send me the exact error text and which Part/step you were on — that's all I need to debug it, same as we've done for every step so far (the robotjs build error, the symlink permission error, etc. were all fixed this way).

**Common ones to expect:**
- `git push` asking for auth → log into the browser popup, don't type a password in the terminal
- Render build fails → check `Root Directory` is blank and `package.json`/`server.js` are actually at the root of the repo (not nested in an extra folder)
- App still shows "disconnected" after rebuild → double check `SIGNALING_URL` uses `wss://` not `ws://`, and matches your Render URL exactly, then confirm you re-ran `npm run dist` after saving the change
