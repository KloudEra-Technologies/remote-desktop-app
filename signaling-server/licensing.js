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

// Creates a new license key with a custom device-activation limit
// (e.g. 1 for a solo user, up to 500 for a large org).
function createKey(maxActivations = 2, expiresAt = null, label = '') {
  const keys = readKeys();
  const key = generateKey();
  keys[key] = {
    label,
    maxActivations,
    activations: [], // [{ deviceId, ip, activatedAt }]
    createdAt: Date.now(),
    expiresAt, // null = never expires
  };
  writeKeys(keys);
  return key;
}

// First-time activation on a device. Binds the device (by its locally
// generated persistent ID) to the key, up to maxActivations devices.
// Records the IP address it was activated from for the admin panel.
function activate(key, deviceId, ip) {
  const keys = readKeys();
  const entry = keys[key];
  if (!entry) return { valid: false, reason: 'Key not found' };
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    return { valid: false, reason: 'Key has expired' };
  }
  const existing = entry.activations.find((a) => a.deviceId === deviceId);
  if (existing) {
    existing.ip = ip;
    existing.lastSeenAt = Date.now();
    writeKeys(keys);
    return { valid: true, reason: 'Already activated on this device' };
  }
  if (entry.activations.length >= entry.maxActivations) {
    return { valid: false, reason: 'Activation limit reached for this key' };
  }
  entry.activations.push({ deviceId, ip, activatedAt: Date.now(), lastSeenAt: Date.now() });
  writeKeys(keys);
  return { valid: true };
}

// Periodic re-check from an already-activated device.
function verify(key, deviceId, ip) {
  const keys = readKeys();
  const entry = keys[key];
  if (!entry) return { valid: false, reason: 'Key not found' };
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    return { valid: false, reason: 'Key has expired' };
  }
  const existing = entry.activations.find((a) => a.deviceId === deviceId);
  if (!existing) return { valid: false, reason: 'Device not activated for this key' };
  existing.ip = ip || existing.ip;
  existing.lastSeenAt = Date.now();
  writeKeys(keys);
  return { valid: true };
}

// Revokes a single device's activation (e.g. employee left, PC lost),
// freeing up a slot without invalidating the whole key.
function revokeDevice(key, deviceId) {
  const keys = readKeys();
  const entry = keys[key];
  if (!entry) return { ok: false, reason: 'Key not found' };
  entry.activations = entry.activations.filter((a) => a.deviceId !== deviceId);
  writeKeys(keys);
  return { ok: true };
}

// Changes the device limit for an existing key (e.g. org bought more seats).
function editKey(key, { maxActivations, expiresAt, label } = {}) {
  const keys = readKeys();
  const entry = keys[key];
  if (!entry) return { ok: false, reason: 'Key not found' };
  if (typeof maxActivations === 'number') entry.maxActivations = maxActivations;
  if (expiresAt !== undefined) entry.expiresAt = expiresAt;
  if (typeof label === 'string') entry.label = label;
  writeKeys(keys);
  return { ok: true };
}

// Deletes a key entirely (e.g. refunded order, fraudulent key).
function deleteKey(key) {
  const keys = readKeys();
  if (!keys[key]) return { ok: false, reason: 'Key not found' };
  delete keys[key];
  writeKeys(keys);
  return { ok: true };
}

// Returns every key with its full activation list, for the admin panel.
function listKeys() {
  const keys = readKeys();
  return Object.entries(keys).map(([key, data]) => ({ key, ...data }));
}

module.exports = {
  createKey,
  activate,
  verify,
  revokeDevice,
  editKey,
  deleteKey,
  listKeys,
  ADMIN_SECRET,
};
