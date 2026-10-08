/**
 * Mobile-Laptop Bridge - Relay Server
 * 
 * This server acts as the middleman between the desktop agent and mobile web client.
 * It handles:
 * - Session creation and management (connection codes)
 * - Routing screen frames from desktop → mobile
 * - Routing input events from mobile → desktop
 * - File transfer relay
 * - Serving the mobile web client
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { nanoid } = require('nanoid');
const QRCode = require('qrcode');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for file transfers
  pingTimeout: 60000,
  pingInterval: 15000
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

// ─── Session Store ───────────────────────────────────────────────────────────
// Each session represents a desktop agent waiting for a mobile connection
const sessions = new Map();

/**
 * Generate a 6-digit numeric connection code
 */
function generateCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (sessions.has(code)); // ensure uniqueness
  return code;
}

// ─── REST API ────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', activeSessions: sessions.size });
});

// Generate QR code for a session
app.get('/api/qrcode/:code', async (req, res) => {
  const { code } = req.params;
  const session = sessions.get(code);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    // Build the connection URL
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseUrl = process.env.PUBLIC_URL || `${protocol}://${host}`;
    const connectUrl = `${baseUrl}/connect?code=${code}`;
    
    const qrDataUrl = await QRCode.toDataURL(connectUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#ffffff', light: '#00000000' }
    });
    
    res.json({ qr: qrDataUrl, url: connectUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Serve the mobile client for /connect route
app.get('/connect', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Socket.IO Event Handling ────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // ── Desktop Agent Registration ──
  socket.on('desktop:register', (data, callback) => {
    const code = generateCode();
    const sessionId = nanoid(12);

    const session = {
      id: sessionId,
      code: code,
      desktopSocketId: socket.id,
      mobileSocketId: null,
      desktopInfo: data || {},
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    sessions.set(code, session);
    socket.join(`session:${sessionId}`);
    socket.sessionId = sessionId;
    socket.sessionCode = code;
    socket.role = 'desktop';

    console.log(`[Desktop] Registered session ${sessionId} with code ${code}`);
    
    if (callback) {
      callback({ 
        success: true, 
        code, 
        sessionId,
        message: 'Session created. Share the code with mobile device.'
      });
    }
  });

  // ── Mobile Client Connection ──
  socket.on('mobile:connect', (data, callback) => {
    const { code } = data;
    const session = sessions.get(code);

    if (!session) {
      if (callback) callback({ success: false, error: 'Invalid connection code' });
      return;
    }

    if (session.mobileSocketId) {
      if (callback) callback({ success: false, error: 'Session already has a mobile client' });
      return;
    }

    session.mobileSocketId = socket.id;
    session.lastActivity = Date.now();
    socket.join(`session:${session.id}`);
    socket.sessionId = session.id;
    socket.sessionCode = code;
    socket.role = 'mobile';

    // Notify the desktop agent
    io.to(session.desktopSocketId).emit('mobile:connected', {
      mobileId: socket.id,
      timestamp: Date.now()
    });

    console.log(`[Mobile] Connected to session ${session.id}`);
    
    if (callback) {
      callback({ 
        success: true, 
        sessionId: session.id,
        desktopInfo: session.desktopInfo
      });
    }
  });

  // ── Screen Frame Relay (Desktop → Mobile) ──
  socket.on('desktop:frame', (frameData) => {
    const session = findSessionBySocket(socket);
    if (session && session.mobileSocketId) {
      session.lastActivity = Date.now();
      io.to(session.mobileSocketId).emit('screen:frame', frameData);
    }
  });

  // ── Screen Frame ACK (Mobile → Desktop) for Flow Control ──
  socket.on('mobile:frameAck', () => {
    const session = findSessionBySocket(socket);
    if (session && session.desktopSocketId) {
      io.to(session.desktopSocketId).emit('screen:ack');
    }
  });

  // ── Screen Info (Desktop → Mobile) ──
  socket.on('desktop:screenInfo', (info) => {
    const session = findSessionBySocket(socket);
    if (session && session.mobileSocketId) {
      io.to(session.mobileSocketId).emit('screen:info', info);
    }
  });

  // ── Screen State / Lock Detection (Desktop → Mobile) ──
  socket.on('desktop:screenState', (state) => {
    const session = findSessionBySocket(socket);
    if (session && session.mobileSocketId) {
      io.to(session.mobileSocketId).emit('screen:state', state);
    }
  });

  // ── Screen Wake Relay (Mobile → Desktop) ──
  socket.on('mobile:wakeScreen', () => {
    const session = findSessionBySocket(socket);
    if (session && session.desktopSocketId) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('screen:wake');
    }
  });

  // ── Input Events Relay (Mobile → Desktop) ──
  socket.on('mobile:mouseMove', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:mouseMove', data);
    }
  });

  socket.on('mobile:mouseClick', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:mouseClick', data);
    }
  });

  socket.on('mobile:mouseDoubleClick', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:mouseDoubleClick', data);
    }
  });

  socket.on('mobile:mouseDown', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:mouseDown', data);
    }
  });

  socket.on('mobile:mouseUp', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:mouseUp', data);
    }
  });

  socket.on('mobile:scroll', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:scroll', data);
    }
  });

  socket.on('mobile:keyPress', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:keyPress', data);
    }
  });

  socket.on('mobile:text', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:text', data);
    }
  });

  socket.on('mobile:keyDown', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:keyDown', data);
    }
  });

  socket.on('mobile:keyUp', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:keyUp', data);
    }
  });

  socket.on('mobile:keyCombo', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      session.lastActivity = Date.now();
      io.to(session.desktopSocketId).emit('input:keyCombo', data);
    }
  });

  // ── File Transfer Relay ──
  socket.on('file:request', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      // Forward to the other party
      const targetId = socket.role === 'mobile' ? session.desktopSocketId : session.mobileSocketId;
      if (targetId) io.to(targetId).emit('file:request', data);
    }
  });

  socket.on('file:list', (data) => {
    const session = findSessionBySocket(socket);
    if (session && session.mobileSocketId) {
      io.to(session.mobileSocketId).emit('file:list', data);
    }
  });

  socket.on('file:chunk', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      const targetId = socket.role === 'mobile' ? session.desktopSocketId : session.mobileSocketId;
      if (targetId) io.to(targetId).emit('file:chunk', data);
    }
  });

  socket.on('file:complete', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      const targetId = socket.role === 'mobile' ? session.desktopSocketId : session.mobileSocketId;
      if (targetId) io.to(targetId).emit('file:complete', data);
    }
  });

  socket.on('file:upload', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      io.to(session.desktopSocketId).emit('file:upload', data);
    }
  });

  socket.on('file:uploadComplete', (data) => {
    const session = findSessionBySocket(socket);
    if (session && session.mobileSocketId) {
      io.to(session.mobileSocketId).emit('file:uploadComplete', data);
    }
  });

  // ── Quality Settings ──
  socket.on('mobile:quality', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      io.to(session.desktopSocketId).emit('settings:quality', data);
    }
  });

  // ── Clipboard ──
  socket.on('clipboard:sync', (data) => {
    const session = findSessionBySocket(socket);
    if (session) {
      const targetId = socket.role === 'mobile' ? session.desktopSocketId : session.mobileSocketId;
      if (targetId) io.to(targetId).emit('clipboard:sync', data);
    }
  });

  // ── Disconnect Handling ──
  socket.on('disconnect', () => {
    console.log(`[-] Client disconnected: ${socket.id}`);
    
    const session = findSessionBySocket(socket);
    if (!session) return;

    if (socket.role === 'desktop') {
      // Desktop disconnected - end the session
      if (session.mobileSocketId) {
        io.to(session.mobileSocketId).emit('session:ended', { 
          reason: 'Desktop disconnected' 
        });
      }
      sessions.delete(session.code);
      console.log(`[Session] Ended: ${session.id}`);
    } else if (socket.role === 'mobile') {
      // Mobile disconnected - keep session alive for reconnect
      session.mobileSocketId = null;
      io.to(session.desktopSocketId).emit('mobile:disconnected');
      console.log(`[Mobile] Disconnected from session ${session.id}`);
    }
  });
});

// ─── Helper Functions ────────────────────────────────────────────────────────

function findSessionBySocket(socket) {
  if (!socket.sessionCode) return null;
  return sessions.get(socket.sessionCode);
}

// Clean up stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  const STALE_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

  for (const [code, session] of sessions) {
    const isDesktopAlive = session.desktopSocketId && io.sockets.sockets.has(session.desktopSocketId);
    const shouldRemove = !isDesktopAlive 
      ? (now - session.lastActivity > 10 * 60 * 1000) 
      : (now - session.lastActivity > STALE_TIMEOUT);

    if (shouldRemove) {
      console.log(`[Cleanup] Removing stale session: ${session.id}`);
      
      if (session.desktopSocketId) {
        io.to(session.desktopSocketId).emit('session:ended', { reason: 'Session timed out' });
      }
      if (session.mobileSocketId) {
        io.to(session.mobileSocketId).emit('session:ended', { reason: 'Session timed out' });
      }
      
      sessions.delete(code);
    }
  }
}, 5 * 60 * 1000);

function getNetworkIps() {
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

// ─── Start Server ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ips = getNetworkIps();
  const primaryIp = ips[0] || 'localhost';

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         Mobile-Laptop Bridge  •  Relay Server           ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  💻  Local (on laptop)  : http://localhost:${PORT}          ║`);
  console.log(`║  📱  Mobile (on phone)  : http://${primaryIp}:${PORT}        ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
});
