const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require('electron');
const path = require('path');

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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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
