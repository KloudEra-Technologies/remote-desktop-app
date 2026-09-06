# Deploying the Signaling Server to Oracle Cloud (Free Forever)

This gets your `signaling-server` running permanently, 24/7, on a real Linux server, for $0. It's more setup than Render but nothing sleeps and nothing times out.

You'll end up with: a Linux VM → Node.js running your server on it → nginx in front of it handling HTTPS/WSS → a domain name pointing at it → `renderer.js` updated to use it.

---

## Part 1 — Create the free server

1. Go to **oracle.com/cloud/free** and sign up. It asks for a credit card for identity verification — you are not charged for Always Free resources, ever.
2. Once in the Oracle Cloud Console, go to **Compute → Instances → Create Instance**.
3. Name it (e.g. `signaling-server`).
4. Under **Image and shape**, click **Edit** on the shape:
   - Choose **Ampere (ARM)** → `VM.Standard.A1.Flex` → set 1 OCPU / 6GB RAM (well within the Always Free limits), **or**
   - Choose an AMD shape (`VM.Standard.E2.1.Micro`) if ARM isn't available in your region — smaller (1GB RAM) but also free and plenty for this.
5. Leave the image as **Ubuntu** (latest LTS, e.g. 22.04).
6. Under **Add SSH keys**, select "Generate a key pair for me" and **download both the private and public key** — you need the private key to log in later. Save it somewhere safe, e.g. `oracle_key.pem`.
7. Click **Create**. Wait 1-2 minutes for it to provision. Once running, copy its **Public IP address** from the instance details page.

---

## Part 2 — Open the firewall for your app's ports

Oracle blocks everything by default at the network level (separate from the OS firewall). You need to open ports 80, 443, and 8080.

1. On the instance details page, click the **subnet** link (under Primary VNIC).
2. Click the **Security List** attached to it (usually named "Default Security List for...").
3. Click **Add Ingress Rules**. Add three rules, one at a time, all with:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: TCP
   - Destination Port Range: `80` (then repeat for `443`, then `8080`)
4. Save each.

---

## Part 3 — Connect and set up the server

Open a terminal on your PC (PowerShell works fine) in the folder where you saved the private key:

```powershell
ssh -i oracle_key.pem ubuntu@<YOUR_PUBLIC_IP>
```

(If you get a permissions error on the key file, run: `icacls oracle_key.pem /inheritance:r` first.)

Once connected, set up the OS firewall and install Node:

```bash
# Open the same ports at the OS level (Ubuntu's own firewall, separate from Oracle's)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8080 -j ACCEPT
sudo netfilter-persistent save

# Install Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

---

## Part 4 — Deploy your signaling server code

Easiest path: push `signaling-server` to GitHub (you may have already done this for the Render attempt), then pull it onto the VM:

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git app
cd app/signaling-server   # adjust path to wherever server.js actually lives in your repo
npm install
```

Test it runs:
```bash
node server.js
```
You should see `Signaling server running on ws://localhost:8080`. Press `Ctrl+C` to stop — next we make it run permanently in the background.

---

## Part 5 — Keep it running forever with systemd

This makes the server auto-start on boot and auto-restart if it ever crashes.

```bash
sudo nano /etc/systemd/system/signaling.service
```

Paste this in (edit the `WorkingDirectory` path to match where you cloned it):

```ini
[Unit]
Description=Remote Desktop Signaling Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/app/signaling-server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
User=ubuntu

[Install]
WantedBy=multi-user.target
```

Save (`Ctrl+O`, Enter, `Ctrl+X`), then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable signaling
sudo systemctl start signaling
sudo systemctl status signaling
```

You should see "active (running)". It'll now survive reboots and crashes automatically.

---

## Part 6 — Put nginx + a real domain in front of it (for wss://)

Browsers and packaged Electron apps increasingly refuse plain `ws://` — you want `wss://` (secure), which needs a domain and a TLS certificate. This also lets you use the standard port 443 instead of exposing 8080 directly.

**Get a free domain/subdomain** — options: buy a cheap domain (~$10/yr from Namecheap/Porkbun), or use a free subdomain service like **DuckDNS** (duckdns.org) pointed at your Public IP.

Install nginx and Certbot (for free TLS certs):
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Configure nginx to forward WebSocket traffic:
```bash
sudo nano /etc/nginx/sites-available/signaling
```
Paste (replace `your-domain.com` with your actual domain/subdomain):
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
Enable it and get a free cert:
```bash
sudo ln -s /etc/nginx/sites-available/signaling /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d your-domain.com
```
Certbot edits the config automatically to add HTTPS/WSS and sets up auto-renewal. Your signaling server is now reachable at:
```
wss://your-domain.com
```

---

## Part 7 — Point your app at it and rebuild

On your dev PC, edit `app/renderer/renderer.js`:
```js
const SIGNALING_URL = 'wss://your-domain.com';
```

Then rebuild the installer:
```powershell
cd app
npm run dist
```

Share the new `.exe` — it now talks to a server that's up permanently, for free, with no sleep delay.

---

## Keeping it maintained

- **Updating the server code later:** SSH in, `cd app/signaling-server`, `git pull`, `sudo systemctl restart signaling`.
- **Checking it's alive:** `sudo systemctl status signaling` or `sudo journalctl -u signaling -f` to tail live logs.
- **Renewing TLS:** Certbot sets up auto-renewal via a cron job/systemd timer automatically — nothing for you to do.
- **Next step from here:** this same VM can also run a **coturn** TURN server (mentioned in the earlier architecture doc) so users behind strict firewalls can connect too — say the word when you're ready for that and I'll guide it the same way.
