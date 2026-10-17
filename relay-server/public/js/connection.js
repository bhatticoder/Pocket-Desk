/**
 * Connection Manager
 * Handles Socket.io connection to the relay server and session management
 */

class ConnectionManager {
  constructor() {
    this.socket = null;
    this.sessionId = null;
    this.desktopInfo = null;
    this.connected = false;

    this.sessionCode = null;
    this.reconnecting = false;
    this.onConnected = null;
    this.onReconnecting = null;
    this.onReconnected = null;
    this.onDisconnected = null;
    this.onFrame = null;
    this.onScreenInfo = null;
    this.onError = null;
    this.onFileList = null;
    this.onFileChunk = null;
    this.onFileComplete = null;
    this.onFileUploadComplete = null;
    this.onClipboard = null;
  }

  /**
   * Initialize the Socket.io connection
   */
  init() {
    // Connect to the relay server (same origin)
    const serverUrl = window.location.origin;
    
    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 3000,
      timeout: 15000
    });

    this.socket.on('connect', () => {
      console.log('[Connection] Connected to relay server');
      const savedCode = this.sessionCode || (typeof localStorage !== 'undefined' ? localStorage.getItem('pocketdesk_code') : null);
      if (savedCode && !this.connected) {
        console.log('[Connection] Auto-restoring desktop session with code:', savedCode);
        this.connectToDesktop(savedCode).then(() => {
          this.reconnecting = false;
          if (this.onReconnected) this.onReconnected();
        }).catch(err => {
          console.warn('[Connection] Reconnect attempt error:', err.message);
        });
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[Connection] Disconnected:', reason);
      this.connected = false;
      if (reason === 'io client disconnect') {
        if (this.onDisconnected) this.onDisconnected(reason);
      } else {
        this.reconnecting = true;
        if (this.onReconnecting) this.onReconnecting(reason);
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('[Connection] Error:', error.message);
    });

    // ── Screen Events ──
    this.socket.on('screen:frame', (data) => {
      if (this.onFrame) this.onFrame(data);
    });

    this.socket.on('screen:info', (data) => {
      if (this.onScreenInfo) this.onScreenInfo(data);
    });

    this.socket.on('screen:state', (data) => {
      if (this.onScreenState) this.onScreenState(data);
    });

    // ── Session Events ──
    this.socket.on('session:ended', (data) => {
      this.connected = false;
      if (this.onDisconnected) {
        this.onDisconnected(data.reason || 'Session ended');
      }
    });

    // ── File Events ──
    this.socket.on('file:list', (data) => {
      if (this.onFileList) this.onFileList(data);
    });

    this.socket.on('file:chunk', (data) => {
      if (this.onFileChunk) this.onFileChunk(data);
    });

    this.socket.on('file:complete', (data) => {
      if (this.onFileComplete) this.onFileComplete(data);
    });

    this.socket.on('file:uploadComplete', (data) => {
      if (this.onFileUploadComplete) this.onFileUploadComplete(data);
    });

    // ── Clipboard Events ──
    this.socket.on('clipboard:sync', (data) => {
      if (this.onClipboard) this.onClipboard(data);
    });
  }

  /**
   * Connect to a desktop session using a 6-digit code
   */
  connectToDesktop(code) {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Relay connection not initialized'));
        return;
      }

      let timeoutHandle = null;

      const doEmit = () => {
        this.socket.emit('mobile:connect', { code }, (response) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (response.success) {
            this.sessionCode = code;
            this.sessionId = response.sessionId;
            this.desktopInfo = response.desktopInfo;
            this.connected = true;
            
            console.log('[Connection] Connected to desktop:', this.sessionId);
            
            if (this.onConnected) {
              this.onConnected(response);
            }
            
            resolve(response);
          } else {
            reject(new Error(response.error || 'Connection failed'));
          }
        });
      };

      timeoutHandle = setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Connection timed out. Please verify the code.'));
        }
      }, 12000);

      if (this.socket.connected) {
        doEmit();
      } else {
        // Socket still establishing connection (e.g. over Cloudflare or cellular)
        console.log('[Connection] Waiting for socket to connect before session join...');
        this.socket.once('connect', () => {
          doEmit();
        });
      }
    });
  }

  // ── Input & Frame Flow Control Event Emitters ──

  sendFrameAck() {
    if (this.connected && this.socket) {
      this.socket.emit('mobile:frameAck');
    }
  }

  sendMouseMove(x, y, extra = {}) {
    if (this.connected) {
      this.socket.volatile.emit('mobile:mouseMove', { x, y, ...extra });
    }
  }

  sendMouseClick(x, y, button = 'left', extra = {}) {
    if (this.connected) {
      this.socket.emit('mobile:mouseClick', { x, y, button, ...extra });
    }
  }

  sendMouseDoubleClick(x, y, button = 'left', extra = {}) {
    if (this.connected) {
      this.socket.emit('mobile:mouseDoubleClick', { x, y, button, ...extra });
    }
  }

  sendMouseDown(x, y, button = 'left', extra = {}) {
    if (this.connected) {
      this.socket.emit('mobile:mouseDown', { x, y, button, ...extra });
    }
  }

  sendMouseUp(x, y, button = 'left', extra = {}) {
    if (this.connected) {
      this.socket.emit('mobile:mouseUp', { x, y, button, ...extra });
    }
  }

  sendScroll(x, y, deltaX, deltaY, extra = {}) {
    if (this.connected) {
      this.socket.emit('mobile:scroll', { x, y, deltaX, deltaY, ...extra });
    }
  }

  sendKeyPress(key) {
    if (this.connected) {
      this.socket.emit('mobile:keyPress', { key });
    }
  }

  sendText(text) {
    if (this.connected) {
      this.socket.emit('mobile:text', { text });
    }
  }

  sendKeyDown(key) {
    if (this.connected) {
      this.socket.emit('mobile:keyDown', { key });
    }
  }

  sendKeyUp(key) {
    if (this.connected) {
      this.socket.emit('mobile:keyUp', { key });
    }
  }

  sendKeyCombo(keys) {
    if (this.connected) {
      this.socket.emit('mobile:keyCombo', { keys });
    }
  }

  // ── Settings ──

  sendQualitySettings(settings) {
    if (this.connected) {
      this.socket.emit('mobile:quality', settings);
    }
  }

  // ── File Transfer ──

  requestFileList(path) {
    if (this.connected) {
      this.socket.emit('file:request', { action: 'list', path });
    }
  }

  requestFileDownload(filePath) {
    if (this.connected) {
      this.socket.emit('file:request', { action: 'download', path: filePath });
    }
  }

  sendFileUpload(data) {
    if (this.connected) {
      this.socket.emit('file:upload', data);
    }
  }

  // ── Clipboard ──

  sendClipboard(text) {
    if (this.connected) {
      this.socket.emit('clipboard:sync', { text });
    }
  }

  wakeScreen() {
    if (this.socket && this.connected) {
      this.socket.emit('mobile:wakeScreen');
    }
  }

  /**
   * Disconnect from the current session
   */
  disconnect() {
    this.connected = false;
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Export as global
window.ConnectionManager = ConnectionManager;
