const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Use https:// here (not wss://) — this is a plain HTTP API on the same server.
const LICENSE_API_URL = 'https://signaling-server-rzbl.onrender.com';

const LICENSE_FILE = path.join(app.getPath('userData'), 'license.json');
const MACHINE_ID_FILE = path.join(app.getPath('userData'), 'machine-id.txt');

// A persistent per-install identifier, separate from the random per-session
// device ID used for pairing. This is what a license key gets bound to.
function getMachineId() {
  try {
    return fs.readFileSync(MACHINE_ID_FILE, 'utf8').trim();
  } catch {
    const id = crypto.randomUUID();
    fs.mkdirSync(path.dirname(MACHINE_ID_FILE), { recursive: true });
    fs.writeFileSync(MACHINE_ID_FILE, id);
    return id;
  }
}

function readStoredLicense() {
  try {
    return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeStoredLicense(data) {
  fs.mkdirSync(path.dirname(LICENSE_FILE), { recursive: true });
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(data));
}

async function callLicenseApi(endpoint, body) {
  const res = await fetch(`${LICENSE_API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// nut-js does native input injection (mouse/keyboard). It's actively
// maintained and ships prebuilt binaries for common platforms, so it
// installs far more reliably than robotjs.
let mouse, keyboard, Button, Key, Point;
try {
  const nut = require('@nut-tree-fork/nut-js');
  ({ mouse, keyboard, Button, Key, Point } = nut);
} catch (e) {
  console.warn('nut-js not available — input injection will be disabled.');
}

const KEY_MAP = {
  enter: 'Enter', tab: 'Tab', escape: 'Escape', backspace: 'Backspace',
  delete: 'Delete', ' ': 'Space', arrowup: 'Up', arrowdown: 'Down',
  arrowleft: 'Left', arrowright: 'Right', shift: 'LeftShift',
  control: 'LeftControl', alt: 'LeftAlt', meta: 'LeftSuper',
};

function resolveKey(k) {
  if (!Key) return null;
  const mapped = KEY_MAP[k] || (k.length === 1 ? k.toUpperCase() : null);
  return mapped ? Key[mapped] : null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const stored = readStoredLicense();
  if (stored && stored.key) {
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    // Re-verify quietly in the background; only matters if the server
    // explicitly says the key is no longer valid (revoked/expired).
    callLicenseApi('/api/verify', { key: stored.key, deviceId: getMachineId() })
      .then((result) => {
        if (!result.valid) {
          writeStoredLicense(null);
          win.loadFile(path.join(__dirname, 'renderer', 'activation.html'));
        }
      })
      .catch(() => {
        // Offline or server unreachable — don't lock the user out just
        // for that; they already activated successfully once before.
      });
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'activation.html'));
  }

  return win;
}

app.whenReady().then(() => {
  // Auto-approve the screen picker with the primary display so
  // getDisplayMedia() works without a manual OS prompt in this demo.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: input injection (host side only) ----
ipcMain.on('inject-mouse-move', (e, { x, y }) => {
  if (mouse) mouse.setPosition(new Point(x, y));
});

ipcMain.on('inject-mouse-click', (e, { button }) => {
  if (mouse) mouse.click(button === 'right' ? Button.RIGHT : Button.LEFT);
});

ipcMain.on('inject-mouse-scroll', (e, { dx, dy }) => {
  if (!mouse) return;
  if (dy > 0) mouse.scrollDown(Math.abs(Math.round(dy)));
  if (dy < 0) mouse.scrollUp(Math.abs(Math.round(dy)));
});

ipcMain.on('inject-key', async (e, { key, modifiers }) => {
  if (!keyboard) return;
  const target = resolveKey(key);
  if (!target) return;
  try {
    const modKeys = (modifiers || []).map(resolveKey).filter(Boolean);
    for (const m of modKeys) await keyboard.pressKey(m);
    await keyboard.pressKey(target);
    await keyboard.releaseKey(target);
    for (const m of modKeys) await keyboard.releaseKey(m);
  } catch (err) {
    // Unsupported key — ignore rather than crash the session.
  }
});

// ---- IPC: license activation ----
ipcMain.handle('activate-license', async (e, { licenseKey }) => {
  try {
    const deviceId = getMachineId();
    const result = await callLicenseApi('/api/activate', { key: licenseKey, deviceId });
    if (result.valid) {
      writeStoredLicense({ key: licenseKey });
      const win = BrowserWindow.fromWebContents(e.sender);
      win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    }
    return result;
  } catch (err) {
    return { valid: false, reason: 'Could not reach the license server. Check your internet connection.' };
  }
});
