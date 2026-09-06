// Signaling server: matches two peers by device ID and relays
// WebRTC offer/answer/ICE messages between them. It never sees
// screen content — only connection metadata.

const WebSocket = require('ws');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// deviceId -> ws connection
const peers = new Map();

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function newDeviceId() {
  // 8-character human-friendly ID, e.g. "A1B2C3D4"
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

      // Relays WebRTC SDP offers/answers and ICE candidates between
      // two already-paired peers.
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

console.log(`Signaling server running on ws://localhost:${PORT}`);
