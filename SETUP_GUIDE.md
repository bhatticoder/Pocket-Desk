# 🖥️📱 Mobile-Laptop Bridge — Setup & Usage Guide

> A remote desktop web app (like AnyDesk) that lets you control your laptop from your mobile browser over the internet.

---

## 📋 Architecture Overview

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   YOUR LAPTOP   │◄═══════►│   RELAY SERVER   │◄═══════►│   YOUR PHONE    │
│   (Desktop      │  WebSocket│  (Cloud/Local)   │  WebSocket│  (Web Browser)  │
│    Agent)       │         │                  │         │                 │
│ • Screen capture│         │ • Session codes  │         │ • Touch controls│
│ • Mouse control │         │ • Data routing   │         │ • Virtual KB    │
│ • Keyboard ctrl │         │ • QR codes       │         │ • File transfer │
│ • File transfer │         │ • Auth           │         │ • Settings      │
└─────────────────┘         └──────────────────┘         └─────────────────┘
```

### Three Components:

| Component | What it does | Where it runs |
|-----------|-------------|---------------|
| **Relay Server** | Routes data between laptop & phone, serves web UI | Cloud (or locally for testing) |
| **Desktop Agent** | Captures screen, controls mouse/keyboard | Your laptop |
| **Mobile Web Client** | Displays screen, sends touch/keyboard input | Your phone's browser |

---

## 🚀 Prerequisites

### Install Node.js

You need Node.js (v18+) installed. Install via one of these methods:

**Option A — Scoop (you already have it!):**
```powershell
scoop install nodejs
```

**Option B — Direct download:**
Go to [https://nodejs.org](https://nodejs.org) and download the LTS version.

**Option C — winget:**
```powershell
winget install OpenJS.NodeJS.LTS
```

> [!IMPORTANT]
> After installing Node.js, **close and reopen your terminal** so `node` and `npm` are available in PATH.

Verify installation:
```powershell
node --version   # Should show v18+ 
npm --version    # Should show 9+
```

---

## 📦 Installation

### 1. Install Relay Server dependencies
```powershell
cd "d:\Projects\Mobile-Laptop Bridge\relay-server"
npm install
```

### 2. Install Desktop Agent dependencies
```powershell
cd "d:\Projects\Mobile-Laptop Bridge\desktop-agent"
npm install
```

> [!NOTE]  
> The `@nut-tree-fork/nut-js` package (for mouse/keyboard control) may require additional setup on some systems. If it fails, the agent will still work for **screen viewing** — just without input control.

---

## 🖥️ Running Locally (for testing)

### Step 1: Start the Relay Server
```powershell
cd "d:\Projects\Mobile-Laptop Bridge\relay-server"
node index.js
```
You'll see:
```
╔══════════════════════════════════════════════════════════╗
║         Mobile-Laptop Bridge  •  Relay Server           ║
║  🌐  Server running on port 3000                        ║
╚══════════════════════════════════════════════════════════╝
```

### Step 2: Start the Desktop Agent
Open a **new terminal** and run:
```powershell
cd "d:\Projects\Mobile-Laptop Bridge\desktop-agent"
node index.js
```
You'll see a **6-digit connection code** like:
```
╔══════════════════════════════════════════════╗
║   🖥️  Desktop Agent Ready                   ║
║   Connection Code:  482 159                  ║
║   Enter this code on your mobile device      ║
╚══════════════════════════════════════════════╝
```

### Step 3: Connect from Mobile
On your phone, open `http://<your-laptop-IP>:3000` in the browser.  
To find your IP:
```powershell
ipconfig
```
Look for your Wi-Fi adapter's IPv4 address (e.g., `192.168.1.x`).

Enter the **6-digit code** and tap **Connect**!

---

## 🌐 Running Over the Internet

To access your laptop from anywhere (not just local WiFi), you need the relay server to be publicly accessible. Here are your options:

### Option A: Free Cloud Deployment (Recommended)

#### Deploy to Render.com (Free):
1. Push the `relay-server` folder to a GitHub repo
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your repo, set:
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Environment:** Node
4. Deploy! You'll get a URL like `https://your-app.onrender.com`

#### Deploy to Railway.app (Free tier):
```bash
# Install Railway CLI
npm install -g @railway/cli

# Deploy
cd relay-server
railway login
railway init
railway up
```

#### Deploy to Fly.io (Free tier):
```bash
# Install flyctl
# Then:
cd relay-server
fly launch
fly deploy
```

### Option B: ngrok Tunnel (Quick & Easy)

1. Install ngrok: `scoop install ngrok` or from [ngrok.com](https://ngrok.com)
2. Start your relay server locally: `node relay-server/index.js`
3. In another terminal: `ngrok http 3000`
4. ngrok gives you a public URL like `https://abc123.ngrok.io`

### After Deploying:

Update the desktop agent to point to your deployed relay:
```powershell
# Set the relay URL environment variable
$env:RELAY_URL = "https://your-relay-server.onrender.com"
cd "d:\Projects\Mobile-Laptop Bridge\desktop-agent"
node index.js
```

Then on your phone, open `https://your-relay-server.onrender.com` and enter the code!

---

## 📱 Mobile Controls Guide

| Gesture | Action |
|---------|--------|
| **Single tap** | Left click |
| **Double tap** | Double click |
| **Long press** | Right click |
| **One finger drag** | Move cursor (trackpad mode) |
| **Two finger drag** | Scroll |
| **Pinch** | Zoom in/out |

### Bottom Toolbar:
- **⌨️ Keyboard** — Opens your phone's keyboard for typing
- **🖱️ Mouse** — Toggle between Trackpad and Direct Touch modes
- **📁 Files** — Upload/download files between phone and laptop  
- **⚙️ Settings** — Adjust quality, FPS, touch mode
- **Fn Keys** — Special keys: Ctrl, Alt, F-keys, shortcuts (Ctrl+C, Alt+Tab, etc.)

### Quality Settings:
- **Low** — 480p, uses less data (good for slow connections)
- **Medium** — 720p, balanced (default)
- **High** — 1080p, best quality (needs good connection)

---

## 🔐 Security Notes

> [!WARNING]
> This is a remote desktop tool — treat it with appropriate security:

1. **Connection codes are session-based** — they expire after 30 minutes of inactivity
2. **Only one mobile can connect per session** — no multi-client access
3. For production use, consider adding:
   - Password authentication
   - TLS/HTTPS (use a reverse proxy like nginx)
   - IP whitelisting
   - Session encryption

---

## 🗂️ Project Structure

```
Mobile-Laptop Bridge/
├── package.json                    # Root workspace config
├── relay-server/                   # Cloud relay server
│   ├── package.json
│   ├── index.js                    # Express + Socket.io relay
│   └── public/                     # Mobile web client
│       ├── index.html              # Main HTML (connection + remote screens)
│       ├── css/
│       │   └── styles.css          # Premium dark theme UI
│       └── js/
│           ├── app.js              # Main app orchestrator
│           ├── connection.js       # Socket.io connection manager
│           ├── display.js          # Canvas rendering & coordinate mapping
│           ├── input.js            # Touch → mouse/keyboard mapping
│           └── files.js            # File transfer manager
├── desktop-agent/                  # Laptop agent
│   ├── package.json
│   └── index.js                    # Screen capture + input control
└── SETUP_GUIDE.md                  # This file
```

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm` not recognized | Install Node.js and restart terminal |
| Screen capture fails | Run terminal as Administrator |
| Mouse/keyboard not working | `@nut-tree-fork/nut-js` may need Visual C++ Build Tools: `npm install -g windows-build-tools` |
| Can't connect from phone | Make sure phone and laptop are on same WiFi (for local), or use ngrok/cloud relay |
| Laggy/slow | Reduce quality to "Low" in settings, or lower FPS |
| `sharp` install fails | Run `npm install --build-from-source sharp` |

---

## 🔮 Future Enhancements

- [ ] Audio streaming (hear laptop audio on phone)
- [ ] Multi-monitor support
- [ ] Clipboard sync
- [ ] Session recording/playback
- [ ] Password-protected sessions
- [ ] End-to-end encryption
- [ ] PWA (installable on phone home screen)
- [ ] Wake-on-LAN support
