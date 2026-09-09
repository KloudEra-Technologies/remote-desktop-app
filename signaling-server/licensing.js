// Simple file-backed license store. Good enough for a small/medium user
// base on a single server instance. For real production scale, swap
// readKeys/writeKeys for a real database (Postgres, MongoDB, etc.) —
// the function signatures below are the only thing that would need to change.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS_FILE = path.join(__dirname, 'keys.json');
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me-before-deploying';

function readKeys() {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeKeys(keys) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

function generateKey() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}-${part()}`;
}

// Creates a new license key. Call this yourself (via the /api/generate-key
// endpoint, protected by ADMIN_SECRET) after someone pays.
function createKey(maxActivations = 2, expiresAt = null) {
  const keys = readKeys();
  const key = generateKey();
  keys[key] = {
    maxActivations,
    activations: [],
    createdAt: Date.now(),
    expiresAt, // null = never expires
  };
  writeKeys(keys);
  return key;
}

// First-time activation on a device. Binds the device (by its locally
// generated persistent ID) to the key, up to maxActivations devices.
function activate(key, deviceId) {
  const keys = readKeys();
  const entry = keys[key];
  if (!entry) return { valid: false, reason: 'Key not found' };
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    return { valid: false, reason: 'Key has expired' };
  }
  if (entry.activations.includes(deviceId)) {
    return { valid: true, reason: 'Already activated on this device' };
  }
  if (entry.activations.length >= entry.maxActivations) {
    return { valid: false, reason: 'Activation limit reached for this key' };
  }
  entry.activations.push(deviceId);
  writeKeys(keys);
  return { valid: true };
}

// Periodic re-check from an already-activated device.
function verify(key, deviceId) {
  const keys = readKeys();
  const entry = keys[key];
  if (!entry) return { valid: false, reason: 'Key not found' };
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    return { valid: false, reason: 'Key has expired' };
  }
  if (!entry.activations.includes(deviceId)) {
    return { valid: false, reason: 'Device not activated for this key' };
  }
  return { valid: true };
}

// Revokes a single device's activation (e.g. customer lost their PC),
// freeing up a slot without invalidating the whole key.
function revokeDevice(key, deviceId) {
  const keys = readKeys();
  const entry = keys[key];
  if (!entry) return { ok: false, reason: 'Key not found' };
  entry.activations = entry.activations.filter((d) => d !== deviceId);
  writeKeys(keys);
  return { ok: true };
}

module.exports = { createKey, activate, verify, revokeDevice, ADMIN_SECRET };
