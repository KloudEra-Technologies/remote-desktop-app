// Signaling server: matches two peers by device ID and relays WebRTC
// offer/answer/ICE messages between them (never sees screen content).
// Also exposes HTTP licensing endpoints on the same port, since Render's
// free tier only exposes one port per service.

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { randomUUID } = require('crypto');
const licensing = require('./licensing');

const PORT = process.env.PORT || 8080;

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// Render (and most hosts) sit behind a proxy, so the real client IP is in
// x-forwarded-for, not the raw socket address.
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress;
}

function isAdmin(req) {
  return req.headers['x-admin-key'] === licensing.ADMIN_SECRET;
}

// ---------- HTTP server: health check + licensing API + admin panel ----------
const httpServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    sendJson(res, 200, { status: 'ok', message: 'Signaling server is running' });
    return;
  }

  // Admin panel UI — a single static HTML file, gated by the secret you
  // enter inside the page itself (sent as a header on every API call).
  if (req.method === 'GET' && req.url === '/admin') {
    const filePath = path.join(__dirname, 'admin-panel.html');
    fs.readFile(filePath, 'utf8', (err, content) => {
      if (err) return sendJson(res, 500, { error: 'admin-panel.html not found' });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/activate') {
    const { key, deviceId } = await readBody(req);
    if (!key || !deviceId) return sendJson(res, 400, { valid: false, reason: 'Missing key or deviceId' });
    return sendJson(res, 200, licensing.activate(key, deviceId, getClientIp(req)));
  }

  if (req.method === 'POST' && req.url === '/api/verify') {
    const { key, deviceId } = await readBody(req);
    if (!key || !deviceId) return sendJson(res, 400, { valid: false, reason: 'Missing key or deviceId' });
    return sendJson(res, 200, licensing.verify(key, deviceId, getClientIp(req)));
  }

  // Everything below here is admin-only, protected by the x-admin-key header.
  if (req.url.startsWith('/api/generate-key') || req.url.startsWith('/api/keys') ||
      req.url.startsWith('/api/revoke-device') || req.url.startsWith('/api/edit-key') ||
      req.url.startsWith('/api/delete-key')) {
    if (!isAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
  }

  if (req.method === 'POST' && req.url === '/api/generate-key') {
    const { maxActivations, expiresAt, label } = await readBody(req);
    const key = licensing.createKey(maxActivations || 2, expiresAt || null, label || '');
    return sendJson(res, 200, { key });
  }

  if (req.method === 'GET' && req.url === '/api/keys') {
    return sendJson(res, 200, { keys: licensing.listKeys() });
  }

  if (req.method === 'POST' && req.url === '/api/revoke-device') {
    const { key, deviceId } = await readBody(req);
    return sendJson(res, 200, licensing.revokeDevice(key, deviceId));
  }

  if (req.method === 'POST' && req.url === '/api/edit-key') {
    const { key, maxActivations, expiresAt, label } = await readBody(req);
    return sendJson(res, 200, licensing.editKey(key, { maxActivations, expiresAt, label }));
  }

  if (req.method === 'POST' && req.url === '/api/delete-key') {
    const { key } = await readBody(req);
    return sendJson(res, 200, licensing.deleteKey(key));
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
