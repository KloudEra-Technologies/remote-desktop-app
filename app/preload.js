const { contextBridge, ipcRenderer } = require('electron');

// Exposes a small, safe API to the renderer — the renderer never gets
// direct Node/OS access, only these specific calls.
contextBridge.exposeInMainWorld('hostAPI', {
  injectMouseMove: (x, y) => ipcRenderer.send('inject-mouse-move', { x, y }),
  injectMouseClick: (button) => ipcRenderer.send('inject-mouse-click', { button }),
  injectMouseScroll: (dx, dy) => ipcRenderer.send('inject-mouse-scroll', { dx, dy }),
  injectKey: (key, modifiers) => ipcRenderer.send('inject-key', { key, modifiers }),
  activateLicense: (licenseKey) => ipcRenderer.invoke('activate-license', { licenseKey }),
});
