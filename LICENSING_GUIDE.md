# License Key System — Setup & Usage

This adds paid-activation to the app: it now shows an Activation screen before the normal UI until a valid license key is entered, verified against your signaling server.

---

## 1. Deploy the updated server

Your `signaling-server` now also serves a small licensing API on the same port. Push these changes to your GitHub repo (the one connected to Render) the same way as before:

```bash
cd signaling-server
git add .
git commit -m "add licensing"
git push
```

Render auto-redeploys on push — watch the dashboard for "Live".

### Set your admin secret (important)

On Render, go to your service → **Environment** → add a variable:
```
ADMIN_SECRET = <pick something long and random>
```
This protects the key-generation endpoint so only you can mint new license keys. Without setting this, it falls back to a default value that's in the code you're about to publish — **do not skip this step**.

---

## 2. Generate a license key after a sale

From your own machine, with the same `ADMIN_SECRET` you set on Render:

```bash
cd signaling-server
ADMIN_SECRET=your-secret-here node generate-key.js --remote https://signaling-server-rzbl.onrender.com
```

This prints something like:
```
New license key: F8F6-4531-A535-6F58
```

That's what you send the customer. By default each key allows **2 activations** (e.g. a desktop + laptop) — edit `maxActivations` in `generate-key.js` if you want a different limit.

---

## 3. What the customer experiences

1. They install and open the app — instead of the normal home screen, they see an **Activate Remote Desk** card.
2. They type in the key you gave them (auto-formats as `XXXX-XXXX-XXXX-XXXX` as they type).
3. On success, the app remembers it (stored locally) and loads the normal app from then on.
4. Every launch, it quietly re-checks with your server in the background. If you later revoke that device or the key, it'll drop back to the Activation screen next launch. If they're just offline, it doesn't lock them out — it only reacts to an explicit "invalid" response from the server.

---

## 4. Managing keys

- **Revoke one device from a key** (e.g. customer got a new PC): there's a `revokeDevice(key, deviceId)` function in `licensing.js`, but no HTTP endpoint wired up yet for it — say the word and I'll add an admin endpoint for this so you can do it remotely instead of editing the server's `keys.json` by hand.
- **See all issued keys:** SSH/access isn't set up for Render's free tier by default; for now, the simplest way to inspect `keys.json` is via a temporary admin endpoint (ask me to add a `/api/list-keys` route if you want this) or an Oracle/VPS setup where you have direct file access.
- **Expiring keys:** `createKey(maxActivations, expiresAt)` already supports an expiry timestamp — `generate-key.js` currently always passes `null` (never expires). Ask me to add a `--days 30` style flag if you want time-limited keys (e.g. trials).

---

## Known limitation (same caveat as before)

This is real protection against casual key-sharing and gives you real revoke/limit control — but it is not tamper-proof against a determined reverse-engineer opening up the packaged app. That level of protection (code obfuscation, native binary signing checks, etc.) is a much bigger undertaking and generally only worth it if piracy becomes an actual measured problem for you.
