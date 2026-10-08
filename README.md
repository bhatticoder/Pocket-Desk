# 📱 Pocket-Desk (Mobile-Laptop Bridge)

> **Turn any mobile browser into a real-time remote desktop monitor and touch trackpad for your PC over the internet.**

Pocket-Desk is a lightweight, zero-install remote desktop solution. Control your laptop or PC directly from your smartphone's web browser (Chrome, Safari, Firefox) across Wi-Fi or cellular data (4G/5G) without installing any client app on the phone.

---

## ✨ Features

- 🌐 **Zero Mobile Installation**: Runs 100% in any modern mobile browser via WebSockets and HTML5 Canvas.
- ⚡ **Ultra-Low Latency Streaming**: Optimized ACK-driven backpressure streaming delivers smooth real-time performance (~130ms) even over slow cellular connections.
- 🎯 **Full High-DPI Desktop Capture**: Native C# GDI+ capture with true hardware display scaling awareness (`1920x1080` full screen, no cropping).
- 👆 **Touch & Trackpad Controls**:
  - Direct Touch & Trackpad modes
  - Left click, right click, double click, drag-and-drop
  - Multi-touch pinch-to-zoom and pan
  - Screen fit modes: **Fit Screen**, **Fit Width**, and **Stretch Full**
- ⌨️ **Virtual Keyboard & Desktop Shortcuts**:
  - Quick typing bar with mobile soft keyboard integration
  - Windows Start, Task View, Copy/Paste, and Function keys (`F1`-`F12`, `Esc`, `Tab`)
- 📁 **File Transfer**: Browse and transfer files between your mobile device and desktop.
- 🔒 **Secure Connection**: 6-digit session pairing with Cloudflare tunneling support for instant remote internet access anywhere.

---

## 🏗️ Architecture

```
┌─────────────────────────┐         ┌─────────────────────────┐         ┌─────────────────────────┐
│       DESKTOP PC        │         │      RELAY SERVER       │         │      MOBILE PHONE       │
│     (Desktop Agent)     │◄───────►│    (Node.js / Cloud)    │◄───────►│      (Web Browser)      │
│                         │Socket.IO│                         │Socket.IO│                         │
│ • FastCaptureServer.exe │         │ • Session routing       │         │ • HTML5 Canvas Stream   │
│ • NativeInputServer.exe │         │ • Cloudflare Tunnel     │         │ • Touch Gestures Engine │
│ • Win32 Input Injection │         │ • Static Web UI Host    │         │ • Virtual Keyboard      │
└─────────────────────────┘         └─────────────────────────┘         └─────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** (v18+)
- **Windows 10 / 11** (for Desktop Agent)

### 2. Clone the Repository
```bash
git clone https://github.com/bhatticoder/Pocket-Desk.git
cd Pocket-Desk
```

### 3. Install Dependencies
```powershell
# Install root & component packages
npm install
cd relay-server && npm install && cd ..
cd desktop-agent && npm install && cd ..
```

### 4. Start the Application
You can run both locally or expose it to the internet:

#### Option A: One-Command Internet Start (Recommended)
```powershell
node start-internet.js
```
This automatically starts:
1. The **Relay Server** (port 3000)
2. A secure **Cloudflare Tunnel** (for global internet access)
3. The **Desktop Agent** (displays your direct mobile connection link and 6-digit pairing code)

#### Option B: Manual Start
**Terminal 1 — Relay Server:**
```powershell
cd relay-server
node index.js
```

**Terminal 2 — Desktop Agent:**
```powershell
cd desktop-agent
node index.js
```

Open the printed URL on your phone's browser, enter the 6-digit code, and start controlling your computer!

---

## 🛠️ Tech Stack

- **Desktop Agent**: C# (.NET, Win32 API, GDI+), Node.js, `sharp`, `screenshot-desktop`, `socket.io-client`
- **Relay Server**: Node.js, Express, Socket.IO
- **Mobile Frontend**: HTML5 Canvas, Vanilla CSS3 (Glassmorphism), JavaScript (ES6+), Touch Events API
- **Tunneling**: Cloudflare Quick Tunnels

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
