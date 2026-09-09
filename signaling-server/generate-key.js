// Run this ON THE SERVER (or against it via HTTP) to generate a new license
// key after a sale. Two ways to use it:
//
// 1. Locally against the keys.json file directly (if you have server access):
//    node generate-key.js
//
// 2. Remotely against your deployed server (recommended — works from anywhere):
//    node generate-key.js --remote https://signaling-server-rzbl.onrender.com

const args = process.argv.slice(2);
const remoteIndex = args.indexOf('--remote');

async function main() {
  if (remoteIndex !== -1) {
    const baseUrl = args[remoteIndex + 1];
    if (!baseUrl) {
      console.error('Usage: node generate-key.js --remote <server-url>');
      process.exit(1);
    }
    const adminKey = process.env.ADMIN_SECRET;
    if (!adminKey) {
      console.error('Set ADMIN_SECRET env var to match the one on your server.');
      process.exit(1);
    }
    const res = await fetch(`${baseUrl}/api/generate-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ maxActivations: 2 }),
    });
    const data = await res.json();
    if (data.key) {
      console.log('New license key:', data.key);
    } else {
      console.error('Failed:', data);
    }
  } else {
    const licensing = require('./licensing');
    const key = licensing.createKey(2, null);
    console.log('New license key:', key);
  }
}

main();
