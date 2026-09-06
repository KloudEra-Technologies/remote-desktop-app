// Change this to your signaling server's address when not testing locally.
const SIGNALING_URL = 'wss://signaling-server-rzbl.onrender.com';

let ws;
let pc;
let dataChannel;
let localStream;
let peerId = null;
let role = null; // 'host' or 'client'

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Add a TURN server for connections across strict NATs/firewalls:
    // { urls: 'turn:your-turn-server:3478', username: 'user', credential: 'pass' },
  ],
};

const HISTORY_KEY = 'remotedesk-history';
const HISTORY_LIMIT = 8;

// ---------- Connection history (localStorage) ----------
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveToHistory(id) {
  const history = loadHistory().filter((entry) => entry.id !== id);
  history.unshift({ id, time: Date.now() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  renderHistory();
}

function relativeTime(ts) {
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

function renderHistory() {
  const history = loadHistory();
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', history.length > 0);
  history.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'history-item';
    row.innerHTML = `<span class="hid">${entry.id}</span><span class="htime">${relativeTime(entry.time)}</span>`;
    row.addEventListener('click', () => {
      document.getElementById('target-id').value = entry.id;
      document.getElementById('history-panel').classList.add('hidden');
      requestConnect(entry.id);
    });
    list.appendChild(row);
  });
}

// ---------- Signaling ----------
function connectSignaling() {
  return new Promise((resolve) => {
    ws = new WebSocket(SIGNALING_URL);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'register' }));
    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      await handleSignalingMessage(msg);
      if (msg.type === 'registered') resolve(msg.deviceId);
    };
    ws.onerror = () => setStatus(false, 'Could not reach signaling server.');
    ws.onclose = () => setStatus(false, 'Signaling disconnected.');
  });
}

function setStatus(online, text) {
  document.getElementById('status-dot').classList.toggle('online', online);
  document.getElementById('status-text').textContent = text;
}

async function handleSignalingMessage(msg) {
  switch (msg.type) {
    case 'registered':
      document.getElementById('my-id').textContent = msg.deviceId;
      setStatus(true, 'Online and ready');
      break;

    case 'incoming-request':
      if (confirm(`Incoming connection request from ${msg.fromId}. Accept?`)) {
        peerId = msg.fromId;
        ws.send(JSON.stringify({ type: 'connect-accept', targetId: peerId }));
        await startHostSession();
        saveToHistory(peerId);
      } else {
        ws.send(JSON.stringify({ type: 'connect-reject', targetId: msg.fromId }));
      }
      break;

    case 'request-accepted':
      peerId = msg.fromId;
      await startClientSession();
      saveToHistory(peerId);
      break;

    case 'request-rejected':
      log('Connection request was rejected.');
      break;

    case 'error':
      log('Error: ' + msg.message);
      break;

    case 'signal':
      if (msg.payload && msg.payload.end) {
        endSession(false);
        log('The other device ended the session.');
      } else {
        await handleSignal(msg.fromId, msg.payload);
      }
      break;

    default:
      break;
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection(rtcConfig);
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({
        type: 'signal',
        targetId: peerId,
        payload: { candidate: e.candidate },
      }));
    }
  };
  return pc;
}

function showSessionView(label) {
  document.getElementById('connect-view').classList.add('hidden');
  document.getElementById('session-view').classList.remove('hidden');
  document.getElementById('session-label').textContent = label;
}

function showConnectView() {
  document.getElementById('session-view').classList.add('hidden');
  document.getElementById('connect-view').classList.remove('hidden');
  document.getElementById('remote-video').style.display = 'none';
  document.getElementById('remote-video').srcObject = null;
  document.getElementById('host-indicator').classList.add('hidden');
}

// ---------- Host side: shares screen, receives + injects input ----------
async function startHostSession() {
  role = 'host';
  createPeerConnection();

  localStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  dataChannel = pc.createDataChannel('input');
  dataChannel.onmessage = (e) => {
    const cmd = JSON.parse(e.data);
    if (cmd.type === 'mousemove') window.hostAPI.injectMouseMove(cmd.x, cmd.y);
    if (cmd.type === 'mouseclick') window.hostAPI.injectMouseClick(cmd.button);
    if (cmd.type === 'scroll') window.hostAPI.injectMouseScroll(cmd.dx, cmd.dy);
    if (cmd.type === 'key') window.hostAPI.injectKey(cmd.key, cmd.modifiers);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'signal', targetId: peerId, payload: { sdp: offer } }));

  showSessionView(`Sharing with ${peerId}`);
  document.getElementById('host-indicator').classList.remove('hidden');
}

// ---------- Client side: views stream, captures + sends input ----------
async function startClientSession() {
  role = 'client';
  createPeerConnection();

  pc.ontrack = (e) => {
    const video = document.getElementById('remote-video');
    video.srcObject = e.streams[0];
    video.style.display = 'block';
    setupInputCapture(video);
  };

  pc.ondatachannel = (e) => {
    dataChannel = e.channel;
  };

  showSessionView(`Viewing ${peerId}`);
}

async function handleSignal(fromId, payload) {
  if (!pc) return;
  if (payload.sdp) {
    await pc.setRemoteDescription(payload.sdp);
    if (payload.sdp.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'signal', targetId: fromId, payload: { sdp: answer } }));
    }
  }
  if (payload.candidate) {
    await pc.addIceCandidate(payload.candidate);
  }
}

// ---------- End session / disconnect ----------
function endSession(notifyPeer) {
  if (notifyPeer && ws && peerId) {
    ws.send(JSON.stringify({ type: 'signal', targetId: peerId, payload: { end: true } }));
  }
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }
  peerId = null;
  role = null;
  showConnectView();
  log('');
}

function setupInputCapture(video) {
  video.addEventListener('mousemove', (e) => {
    const rect = video.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * video.videoWidth);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * video.videoHeight);
    sendInput({ type: 'mousemove', x, y });
  });
  video.addEventListener('click', () => sendInput({ type: 'mouseclick', button: 'left' }));
  video.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    sendInput({ type: 'mouseclick', button: 'right' });
  });
  video.addEventListener('wheel', (e) => sendInput({ type: 'scroll', dx: e.deltaX, dy: e.deltaY }));
  window.addEventListener('keydown', (e) => {
    sendInput({ type: 'key', key: e.key.toLowerCase(), modifiers: getModifiers(e) });
  });
}

function getModifiers(e) {
  const mods = [];
  if (e.shiftKey) mods.push('shift');
  if (e.ctrlKey) mods.push('control');
  if (e.altKey) mods.push('alt');
  if (e.metaKey) mods.push('command');
  return mods;
}

function sendInput(obj) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(obj));
  }
}

function log(msg) {
  document.getElementById('log').textContent = msg;
}

function requestConnect(targetId) {
  if (!targetId) return;
  peerId = targetId;
  ws.send(JSON.stringify({ type: 'connect-request', targetId }));
  log(`Requesting connection to ${targetId}...`);
}

// ---------- UI wiring ----------
document.addEventListener('DOMContentLoaded', async () => {
  // Initialise Aurora on the splash screen
  const splashAuroraCtn = document.getElementById('splash-aurora');
  let splashAurora = null;
  if (splashAuroraCtn && typeof initAurora === 'function') {
    splashAurora = initAurora(splashAuroraCtn, {
      colorStops: ['#3A29FF', '#7c4fff', '#5227FF'],
      blend: 0.6,
      amplitude: 1.2,
      speed: 0.4,
    });
  }

  // Remove the splash screen from the DOM once its fade-out finishes.
  const splash = document.getElementById('splash');
  if (splash) {
    splash.addEventListener('animationend', (e) => {
      // Prevent bubbling from children's animations (e.g. text/aurora) 
      if (e.target !== splash) return;
      
      if (splashAurora) splashAurora.destroy();
      splash.remove();
    });
  }

  // Initialise Aurora WebGL background (main page)
  const auroraCtn = document.getElementById('aurora-bg');
  if (auroraCtn && typeof initAurora === 'function') {
    initAurora(auroraCtn, {
      colorStops: ['#3A29FF', '#7c4fff', '#5227FF'],
      blend: 0.5,
      amplitude: 1.0,
      speed: 0.5,
    });
  }

  renderHistory();
  await connectSignaling();

  document.getElementById('connect-btn').addEventListener('click', () => {
    const targetId = document.getElementById('target-id').value.trim().toUpperCase();
    requestConnect(targetId);
  });

  document.getElementById('copy-id-btn').addEventListener('click', () => {
    const id = document.getElementById('my-id').textContent;
    navigator.clipboard.writeText(id);
    const btn = document.getElementById('copy-id-btn');
    const original = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = original; }, 1200);
  });

  document.getElementById('history-btn').addEventListener('click', () => {
    document.getElementById('history-panel').classList.toggle('hidden');
  });

  const historyCloseBtn = document.getElementById('history-close-btn');
  if (historyCloseBtn) {
    historyCloseBtn.addEventListener('click', () => {
      document.getElementById('history-panel').classList.add('hidden');
    });
  }

  document.addEventListener('click', (e) => {
    const panel = document.getElementById('history-panel');
    const btn = document.getElementById('history-btn');
    if (!panel.contains(e.target) && e.target !== btn && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
    }
  });

  document.getElementById('end-session-btn').addEventListener('click', () => {
    endSession(true);
  });
});
