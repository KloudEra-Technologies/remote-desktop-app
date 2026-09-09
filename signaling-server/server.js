// Signaling server: matches two peers by device ID and relays WebRTC
// offer/answer/ICE messages between them (never sees screen content).
// Also exposes HTTP licensing endpoints on the same port, since Render's
// free tier only exposes one port per service.

const http = require('http');
const WebSocket = require('ws');
const { randomUUID } = require('crypto');
const licensing = require('./licensing');

const PORT = process.env.PORT || 8080;

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

// ---------- HTTP server: health check + licensing API ----------
const httpServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    sendJson(res, 200, { status: 'ok', message: 'Signaling server is running' });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/activate') {
    const { key, deviceId } = await readBody(req);
    if (!key || !deviceId) return sendJson(res, 400, { valid: false, reason: 'Missing key or deviceId' });
    return sendJson(res, 200, licensing.activate(key, deviceId));
  }

  if (req.method === 'POST' && req.url === '/api/verify') {
    const { key, deviceId } = await readBody(req);
    if (!key || !deviceId) return sendJson(res, 400, { valid: false, reason: 'Missing key or deviceId' });
    return sendJson(res, 200, licensing.verify(key, deviceId));
  }

  // Admin-only: generate a new key after a sale. Protected by a secret
  // header so random visitors can't mint their own keys.
  if (req.method === 'POST' && req.url === '/api/generate-key') {
    if (req.headers['x-admin-key'] !== licensing.ADMIN_SECRET) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }
    const { maxActivations, expiresAt } = await readBody(req);
    const key = licensing.createKey(maxActivations || 2, expiresAt || null);
    return sendJson(res, 200, { key });
  }

  sendJson(res, 404, { error: 'Not found' });
});

// ---------- WebSocket server: signaling (attached to the same HTTP server) ----------
const wss = new WebSocket.Server({ server: httpServer });

const peers = new Map(); // deviceId -> ws connection

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function newDeviceId() {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

wss.on('connection', (ws) => {
  let myId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'register': {
        myId = newDeviceId();
        peers.set(myId, ws);
        send(ws, { type: 'registered', deviceId: myId });
        console.log(`[+] Device registered: ${myId}`);
        break;
      }

      case 'connect-request': {
        const target = peers.get(msg.targetId);
        if (!target) {
          send(ws, { type: 'error', message: 'Device not found or offline' });
          return;
        }
        send(target, { type: 'incoming-request', fromId: myId });
        break;
      }

      case 'connect-accept': {
        const target = peers.get(msg.targetId);
        send(target, { type: 'request-accepted', fromId: myId });
        break;
      }

      case 'connect-reject': {
        const target = peers.get(msg.targetId);
        send(target, { type: 'request-rejected', fromId: myId });
        break;
      }

      case 'signal': {
        const target = peers.get(msg.targetId);
        send(target, { type: 'signal', fromId: myId, payload: msg.payload });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (myId) {
      peers.delete(myId);
      console.log(`[-] Device disconnected: ${myId}`);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Signaling + licensing server running on port ${PORT}`);
});
