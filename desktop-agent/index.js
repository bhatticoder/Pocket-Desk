/**
 * Mobile-Laptop Bridge — Desktop Agent
 * 
 * Runs on the laptop and provides:
 * - Screen capture & streaming
 * - Mouse/keyboard control
 * - File transfer support
 * - Session management with the relay server
 */

const io = require('socket.io-client');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const { nanoid } = require('nanoid');
const os = require('os');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

// ─── Configuration ───────────────────────────────────────────────────────────

const config = {
  // Relay server URL - change this to your deployed relay server URL
  relayUrl: process.env.RELAY_URL || 'http://localhost:3000',
  publicUrl: process.env.PUBLIC_URL || '',
  
  // Screen capture settings
  captureInterval: 25,  // Adaptive pacing driven by client ACK
  quality: 26,          // Lightweight JPEG quality for ultra-low latency cellular streaming (~18KB)
  maxWidth: 960,        // 960x540: 16:9 full desktop scaled accurately
  maxHeight: 540,
  
  // File transfer
  downloadDir: path.join(os.homedir(), 'Downloads'),
  chunkSize: 512 * 1024, // 512KB chunks
};

// ─── State ───────────────────────────────────────────────────────────────────

let socket = null;
let sessionCode = null;
let sessionId = null;
let isStreaming = false;
let captureTimer = null;
let mobileConnected = false;
let nutInstance = null;
let isFrameInFlight = false;
let lastFrameSentTime = 0;
let desktopWidth = 1920;
let desktopHeight = 1080;

let nativeInputProc = null;

// ─── Initialize Native Input Server (OpenInputDesktop / Interactive session) ─

async function initInputControl() {
  const exePath = path.join(__dirname, 'NativeInputServer.exe');
  if (fs.existsSync(exePath)) {
    try {
      nativeInputProc = spawn(exePath, [], {
        stdio: ['pipe', 'pipe', 'inherit'],
        windowsHide: true
      });

      nativeInputProc.stdout.on('data', data => {
        const line = data.toString().trim();
        if (line.startsWith('READY')) {
          const parts = line.split(' ');
          if (parts.length >= 3) {
            const w = parseInt(parts[1], 10);
            const h = parseInt(parts[2], 10);
            if (w > 0 && h > 0) {
              desktopWidth = w;
              desktopHeight = h;
            }
          }
          console.log(chalk.green(`  ✓ Native Input Server active (Interactive Desktop) - Resolution: ${desktopWidth}x${desktopHeight}`));
        }
      });

      nativeInputProc.on('exit', () => {
        nativeInputProc = null;
      });

      return true;
    } catch (e) {
      console.warn('Could not launch NativeInputServer, falling back to nut.js:', e.message);
    }
  }

  try {
    const nut = require('@nut-tree-fork/nut-js');
    nutInstance = nut;
    nut.mouse.config.autoDelayMs = 0;
    nut.mouse.config.mouseSpeed = 2000;
    nut.keyboard.config.autoDelayMs = 0;
    return true;
  } catch (error) {
    console.log(chalk.yellow('  ⚠ Input control unavailable:'), error.message);
    return false;
  }
}

function sendNativeInput(cmd) {
  if (nativeInputProc && nativeInputProc.stdin && !nativeInputProc.killed) {
    try {
      nativeInputProc.stdin.write(cmd + '\n');
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

// ─── Screen Capture ──────────────────────────────────────────────────────────

const { spawn } = require('child_process');

let fastCaptureProc = null;
let fastCaptureBuf = Buffer.alloc(0);
let pendingFrameResolvers = [];

function initFastCapture() {
  const exePath = path.join(__dirname, 'FastCaptureServer.exe');
  if (!fs.existsSync(exePath)) {
    return false;
  }

  try {
    fastCaptureProc = spawn(exePath, [String(config.quality), String(config.maxWidth), String(config.maxHeight)], {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true
    });

    fastCaptureProc.stdout.on('data', chunk => {
      fastCaptureBuf = Buffer.concat([fastCaptureBuf, chunk]);
      while (fastCaptureBuf.length >= 4) {
        const frameLen = fastCaptureBuf.readInt32LE(0);
        if (fastCaptureBuf.length >= 4 + frameLen) {
          const frameData = fastCaptureBuf.slice(4, 4 + frameLen);
          fastCaptureBuf = fastCaptureBuf.slice(4 + frameLen);
          if (pendingFrameResolvers.length > 0) {
            const resolve = pendingFrameResolvers.shift();
            resolve(frameData);
          }
        } else {
          break;
        }
      }
    });

    fastCaptureProc.on('exit', () => {
      fastCaptureProc = null;
    });

    console.log(chalk.green('  ✓ Native high-speed screen capture initialized (FastCaptureServer)'));
    return true;
  } catch (err) {
    console.log(chalk.yellow('  ⚠ Could not start FastCaptureServer, falling back to screenshot-desktop'));
    return false;
  }
}

async function captureScreen() {
  if (fastCaptureProc) {
    return new Promise(resolve => {
      pendingFrameResolvers.push(resolve);
      try {
        fastCaptureProc.stdin.write(Buffer.from([1]));
      } catch (e) {
        resolve(null);
      }
    });
  }

  try {
    // Fallback: screenshot-desktop
    const imgBuffer = await screenshot({ format: 'png' });
    const processed = await sharp(imgBuffer, { fastShrinkOnLoad: true })
      .resize(config.maxWidth, config.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: config.quality, mozjpeg: false })
      .toBuffer();
    return processed;
  } catch (error) {
    console.error(chalk.red('Screen capture error:'), error.message);
    return null;
  }
}

async function getScreenInfo() {
  return {
    width: desktopWidth || 1920,
    height: desktopHeight || 1080,
    scaledWidth: Math.min(desktopWidth || 1920, config.maxWidth),
    scaledHeight: Math.min(desktopHeight || 1080, config.maxHeight)
  };
}

let isCapturing = false;

let lastBlackCheck = 0;
let isScreenLockedReported = false;

function keepLaptopAwake() {
  try {
    const { exec } = require('child_process');
    exec('powershell -NoProfile -Command "Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class W { [DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f); public static void K() { SetThreadExecutionState(0x80000003); } }\'; [W]::K()"', () => {});
  } catch (e) {}
}

function wakeLaptopScreen() {
  keepLaptopAwake();
  if (sendNativeInput('MOVE 100 100') && sendNativeInput('MOVE 102 102')) {
    // Native wake executed
  } else if (nutInstance) {
    try {
      nutInstance.mouse.move([new nutInstance.Point(100, 100), new nutInstance.Point(102, 102)]).catch(() => {});
    } catch (e) {}
  }
  triggerImmediateFrame();
}

function checkScreenState(buffer) {
  const now = Date.now();
  if (now - lastBlackCheck < 3000) return;
  lastBlackCheck = now;

  sharp(buffer).stats().then(stats => {
    const isPureBlack = stats.channels.every(c => c.mean < 1 && c.max < 2);
    if (isPureBlack) {
      if (!isScreenLockedReported) {
        isScreenLockedReported = true;
        console.log(chalk.yellow('\n  ⚠️  Notice: Captured screen is black. The laptop screen may be asleep or locked!'));
        console.log(chalk.yellow('      Please wake up the laptop display or unlock the laptop with your password/PIN.\n'));
        if (socket && socket.connected) {
          socket.emit('desktop:screenState', { isLocked: true });
        }
      }
    } else {
      if (isScreenLockedReported) {
        isScreenLockedReported = false;
        console.log(chalk.green('\n  ✓ Laptop screen is active and unlocked! Streaming live desktop.\n'));
        if (socket && socket.connected) {
          socket.emit('desktop:screenState', { isLocked: false });
        }
      }
    }
  }).catch(() => {});
}

let frameAckTimeout = null;

async function doCaptureAndSend() {
  if (!isStreaming || !mobileConnected) return;
  if (isCapturing) return;
  if (isFrameInFlight) return; // Strict backpressure: prevent buffer bloat
  
  isCapturing = true;
  try {
    const frame = await captureScreen();
    if (frame && socket && socket.connected) {
      isFrameInFlight = true;
      socket.emit('desktop:frame', {
        image: frame,
        timestamp: Date.now()
      });
      checkScreenState(frame);

      // Safety timeout: If mobile doesn't ACK within 2500ms (packet loss fallback), resume streaming
      if (frameAckTimeout) clearTimeout(frameAckTimeout);
      frameAckTimeout = setTimeout(() => {
        isFrameInFlight = false;
        if (isStreaming && mobileConnected) {
          doCaptureAndSend();
        }
      }, 2500);
    }
  } catch (err) {
    console.error('Frame send error:', err.message);
    isFrameInFlight = false;
  } finally {
    isCapturing = false;
  }
}

function triggerImmediateFrame() {
  if (isStreaming && mobileConnected) {
    isFrameInFlight = false;
    if (frameAckTimeout) clearTimeout(frameAckTimeout);
    if (captureTimer) clearTimeout(captureTimer);
    // Immediate frame right after click/input
    captureTimer = setTimeout(doCaptureAndSend, 15);
    // Follow-up frame 85ms later to catch any OS redraw/window animation
    setTimeout(() => {
      isFrameInFlight = false;
      doCaptureAndSend();
    }, 85);
  }
}

function startStreaming() {
  if (isStreaming) return;
  isStreaming = true;
  isCapturing = false;
  isFrameInFlight = false;
  
  console.log(chalk.cyan('  ▶ Continuous live screen streaming started'));
  doCaptureAndSend();
}

function handleFrameAck() {
  if (frameAckTimeout) {
    clearTimeout(frameAckTimeout);
    frameAckTimeout = null;
  }
  isFrameInFlight = false;
  if (isStreaming && mobileConnected && !isCapturing) {
    if (captureTimer) clearTimeout(captureTimer);
    // Send next frame after 15ms (smooth adaptive frame rate)
    captureTimer = setTimeout(doCaptureAndSend, 15);
  }
}

function stopStreaming() {
  isStreaming = false;
  isCapturing = false;
  isFrameInFlight = false;
  if (frameAckTimeout) {
    clearTimeout(frameAckTimeout);
    frameAckTimeout = null;
  }
  if (captureTimer) {
    clearTimeout(captureTimer);
    captureTimer = null;
  }
  console.log(chalk.cyan('  ■ Screen streaming stopped'));
}

// ─── Input Handling ──────────────────────────────────────────────────────────

// Map of key names to nut.js Key enum
function getKeyMapping(key) {
  if (!nutInstance) return null;
  
  const Key = nutInstance.Key;
  
  const keyMap = {
    'Backspace': Key.Backspace,
    'Tab': Key.Tab,
    'Enter': Key.Enter,
    'Return': Key.Enter,
    'Shift': Key.LeftShift,
    'Control': Key.LeftControl,
    'Ctrl': Key.LeftControl,
    'Alt': Key.LeftAlt,
    'Meta': Key.LeftWin,
    'Win': Key.LeftWin,
    'Windows': Key.LeftWin,
    'Start': Key.LeftWin,
    'Super': Key.LeftWin,
    'Escape': Key.Escape,
    'Esc': Key.Escape,
    'Space': Key.Space,
    ' ': Key.Space,
    'Delete': Key.Delete,
    'Home': Key.Home,
    'End': Key.End,
    'PageUp': Key.PageUp,
    'PageDown': Key.PageDown,
    'ArrowUp': Key.Up,
    'ArrowDown': Key.Down,
    'ArrowLeft': Key.Left,
    'ArrowRight': Key.Right,
    'F1': Key.F1, 'F2': Key.F2, 'F3': Key.F3, 'F4': Key.F4,
    'F5': Key.F5, 'F6': Key.F6, 'F7': Key.F7, 'F8': Key.F8,
    'F9': Key.F9, 'F10': Key.F10, 'F11': Key.F11, 'F12': Key.F12,
    'PrintScreen': Key.Print,
    'a': Key.A, 'b': Key.B, 'c': Key.C, 'd': Key.D,
    'e': Key.E, 'f': Key.F, 'g': Key.G, 'h': Key.H,
    'i': Key.I, 'j': Key.J, 'k': Key.K, 'l': Key.L,
    'm': Key.M, 'n': Key.N, 'o': Key.O, 'p': Key.P,
    'q': Key.Q, 'r': Key.R, 's': Key.S, 't': Key.T,
    'u': Key.U, 'v': Key.V, 'w': Key.W, 'x': Key.X,
    'y': Key.Y, 'z': Key.Z,
    'A': Key.A, 'B': Key.B, 'C': Key.C, 'D': Key.D,
    'E': Key.E, 'F': Key.F, 'G': Key.G, 'H': Key.H,
    'I': Key.I, 'J': Key.J, 'K': Key.K, 'L': Key.L,
    'M': Key.M, 'N': Key.N, 'O': Key.O, 'P': Key.P,
    'Q': Key.Q, 'R': Key.R, 'S': Key.S, 'T': Key.T,
    'U': Key.U, 'V': Key.V, 'W': Key.W, 'X': Key.X,
    'Y': Key.Y, 'Z': Key.Z,
    '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3,
    '4': Key.Num4, '5': Key.Num5, '6': Key.Num6, '7': Key.Num7,
    '8': Key.Num8, '9': Key.Num9,
    '-': Key.Minus, '=': Key.Equal,
    '[': Key.LeftBracket, ']': Key.RightBracket,
    '\\': Key.Backslash, ';': Key.Semicolon,
    "'": Key.Quote, ',': Key.Comma, '.': Key.Period,
    '/': Key.Slash, '`': Key.Grave
  };
  
  return keyMap[key] || null;
}

function mapCoordinates(data) {
  let x, y;
  if (typeof data.xRatio === 'number' && typeof data.yRatio === 'number') {
    x = Math.round(data.xRatio * desktopWidth);
    y = Math.round(data.yRatio * desktopHeight);
  } else if (data.screenWidth && data.screenHeight) {
    x = Math.round((data.x / data.screenWidth) * desktopWidth);
    y = Math.round((data.y / data.screenHeight) * desktopHeight);
  } else {
    x = Math.round(data.x);
    y = Math.round(data.y);
  }
  return {
    x: Math.max(0, Math.min(desktopWidth - 1, x)),
    y: Math.max(0, Math.min(desktopHeight - 1, y))
  };
}

const VK_MAP = {
  'Backspace': 0x08, 'Tab': 0x09, 'Enter': 0x0D, 'Return': 0x0D,
  'Shift': 0x10, 'Control': 0x11, 'Ctrl': 0x11, 'Alt': 0x12,
  'Escape': 0x1B, 'Esc': 0x1B, 'Space': 0x20, ' ': 0x20,
  'PageUp': 0x21, 'PageDown': 0x22, 'End': 0x23, 'Home': 0x24,
  'ArrowLeft': 0x25, 'ArrowUp': 0x26, 'ArrowRight': 0x27, 'ArrowDown': 0x28,
  'Delete': 0x2E, 'Del': 0x2E,
  'Meta': 0x5B, 'Win': 0x5B, 'Windows': 0x5B, 'Start': 0x5B,
  'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73, 'F5': 0x74, 'F6': 0x75,
  'F7': 0x76, 'F8': 0x77, 'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B
};

async function handleMouseMove(data) {
  const coords = mapCoordinates(data);
  if (sendNativeInput(`MOVE ${coords.x} ${coords.y}`)) return;
  if (nutInstance) {
    try {
      await nutInstance.mouse.setPosition(coords);
    } catch (e) { /* ignore */ }
  }
}

async function handleMouseClick(data) {
  const coords = mapCoordinates(data);
  const btn = data.button || 'left';
  if (sendNativeInput(`CLICK ${coords.x} ${coords.y} ${btn}`)) {
    triggerImmediateFrame();
    return;
  }
  if (nutInstance) {
    try {
      const Button = nutInstance.Button;
      await nutInstance.mouse.setPosition(coords);
      const button = btn === 'right' ? Button.RIGHT : (btn === 'middle' ? Button.MIDDLE : Button.LEFT);
      await nutInstance.mouse.click(button);
      triggerImmediateFrame();
    } catch (e) {
      console.error('Mouse click error:', e.message);
    }
  }
}

async function handleMouseDoubleClick(data) {
  const coords = mapCoordinates(data);
  if (sendNativeInput(`DBLCLICK ${coords.x} ${coords.y}`)) {
    triggerImmediateFrame();
    return;
  }
  if (nutInstance) {
    try {
      await nutInstance.mouse.setPosition(coords);
      await nutInstance.mouse.doubleClick(nutInstance.Button.LEFT);
      triggerImmediateFrame();
    } catch (e) {
      console.error('Mouse double click error:', e.message);
    }
  }
}

async function handleMouseDown(data) {
  const coords = mapCoordinates(data);
  const btn = data.button || 'left';
  if (sendNativeInput(`DOWN ${coords.x} ${coords.y} ${btn}`)) return;
  if (nutInstance) {
    try {
      const Button = nutInstance.Button;
      await nutInstance.mouse.setPosition(coords);
      const button = btn === 'right' ? Button.RIGHT : (btn === 'middle' ? Button.MIDDLE : Button.LEFT);
      await nutInstance.mouse.pressButton(button);
    } catch (e) { /* ignore */ }
  }
}

async function handleMouseUp(data) {
  const coords = mapCoordinates(data);
  const btn = data.button || 'left';
  if (sendNativeInput(`UP ${coords.x} ${coords.y} ${btn}`)) {
    triggerImmediateFrame();
    return;
  }
  if (nutInstance) {
    try {
      const Button = nutInstance.Button;
      await nutInstance.mouse.setPosition(coords);
      const button = btn === 'right' ? Button.RIGHT : (btn === 'middle' ? Button.MIDDLE : Button.LEFT);
      await nutInstance.mouse.releaseButton(button);
      triggerImmediateFrame();
    } catch (e) { /* ignore */ }
  }
}

async function handleScroll(data) {
  const coords = mapCoordinates(data);
  const dy = Math.round(data.deltaY || 0);
  if (sendNativeInput(`SCROLL ${coords.x} ${coords.y} ${dy}`)) {
    triggerImmediateFrame();
    return;
  }
  if (nutInstance) {
    try {
      const amount = Math.round(dy / 10);
      if (amount > 0) {
        await nutInstance.mouse.scrollDown(Math.abs(amount));
      } else if (amount < 0) {
        await nutInstance.mouse.scrollUp(Math.abs(amount));
      }
      triggerImmediateFrame();
    } catch (e) { /* ignore */ }
  }
}

async function handleKeyPress(data) {
  const key = data.key;
  if (key === 'Meta' || key === 'Win' || key === 'Windows') {
    if (sendNativeInput('WIN')) {
      triggerImmediateFrame();
      return;
    }
  }
  const vk = VK_MAP[key];
  if (vk) {
    if (sendNativeInput(`KEYPRESS ${vk}`)) {
      triggerImmediateFrame();
      return;
    }
  } else if (typeof key === 'string' && key.length === 1) {
    const b64 = Buffer.from(key, 'utf8').toString('base64');
    if (sendNativeInput(`TEXT ${b64}`)) {
      triggerImmediateFrame();
      return;
    }
  }
  if (nutInstance) {
    try {
      const mappedKey = getKeyMapping(key);
      if (mappedKey !== null) {
        await nutInstance.keyboard.pressKey(mappedKey);
        await nutInstance.keyboard.releaseKey(mappedKey);
      } else {
        await nutInstance.keyboard.type(key);
      }
      triggerImmediateFrame();
    } catch (e) {
      console.error('Key press error:', e.message);
    }
  }
}

async function handleTextInput(data) {
  if (!data || !data.text) return;
  const b64 = Buffer.from(data.text, 'utf8').toString('base64');
  if (sendNativeInput(`TEXT ${b64}`)) {
    triggerImmediateFrame();
    return;
  }
  if (nutInstance) {
    try {
      await nutInstance.keyboard.type(data.text);
      triggerImmediateFrame();
    } catch (e) {
      console.error('Text typing error:', e.message);
    }
  }
}

async function handleKeyDown(data) {
  const vk = VK_MAP[data.key];
  if (vk && sendNativeInput(`KEY ${vk} down`)) return;
  if (nutInstance) {
    try {
      const mappedKey = getKeyMapping(data.key);
      if (mappedKey !== null) {
        await nutInstance.keyboard.pressKey(mappedKey);
      }
    } catch (e) { /* ignore */ }
  }
}

async function handleKeyUp(data) {
  const vk = VK_MAP[data.key];
  if (vk && sendNativeInput(`KEY ${vk} up`)) {
    triggerImmediateFrame();
    return;
  }
  if (nutInstance) {
    try {
      const mappedKey = getKeyMapping(data.key);
      if (mappedKey !== null) {
        await nutInstance.keyboard.releaseKey(mappedKey);
      }
      triggerImmediateFrame();
    } catch (e) { /* ignore */ }
  }
}

async function handleKeyCombo(data) {
  if (!data || !data.keys) return;
  const comboStr = data.keys.join('+').toLowerCase();
  if (comboStr === 'meta+d' || comboStr === 'win+d') {
    if (sendNativeInput('DESKTOP')) {
      triggerImmediateFrame();
      return;
    }
  }
  if (nutInstance) {
    try {
      const keys = data.keys.map(k => getKeyMapping(k)).filter(k => k !== null);
      if (keys.length > 0) {
        for (let i = 0; i < keys.length; i++) {
          await nutInstance.keyboard.pressKey(keys[i]);
        }
        await new Promise(r => setTimeout(r, 50));
        for (let i = keys.length - 1; i >= 0; i--) {
          await nutInstance.keyboard.releaseKey(keys[i]);
        }
      }
      triggerImmediateFrame();
    } catch (e) {
      console.error('Key combo error:', e.message);
    }
  }
}

// ─── File Transfer ───────────────────────────────────────────────────────────

async function handleFileRequest(data) {
  if (data.action === 'list') {
    await listDirectory(data.path);
  } else if (data.action === 'download') {
    await sendFile(data.path);
  }
}

async function listDirectory(dirPath) {
  try {
    const resolvedPath = dirPath === '~' ? os.homedir() : path.resolve(dirPath);
    const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
    
    const files = [];
    for (const entry of entries) {
      // Skip hidden files and system files
      if (entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(resolvedPath, entry.name);
      let size = 0;
      
      try {
        if (!entry.isDirectory()) {
          const stat = await fs.promises.stat(fullPath);
          size = stat.size;
        }
      } catch (e) {}
      
      files.push({
        name: entry.name,
        path: fullPath,
        isDir: entry.isDirectory(),
        size
      });
    }
    
    // Sort: directories first, then by name
    files.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    
    socket.emit('file:list', { files, currentPath: resolvedPath });
  } catch (error) {
    console.error(chalk.red('File list error:'), error.message);
    socket.emit('file:list', { files: [], error: error.message });
  }
}

async function sendFile(filePath) {
  try {
    const resolvedPath = path.resolve(filePath);
    const stat = await fs.promises.stat(resolvedPath);
    const fileName = path.basename(resolvedPath);
    const fileId = nanoid(8);
    const totalChunks = Math.ceil(stat.size / config.chunkSize);
    
    // Determine MIME type
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      '.pdf': 'application/pdf', '.txt': 'text/plain',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
      '.zip': 'application/zip', '.doc': 'application/msword',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    
    console.log(chalk.blue(`  📤 Sending file: ${fileName} (${formatSize(stat.size)})`));
    
    const fileHandle = await fs.promises.open(resolvedPath, 'r');
    
    for (let i = 0; i < totalChunks; i++) {
      const buffer = Buffer.alloc(config.chunkSize);
      const { bytesRead } = await fileHandle.read(buffer, 0, config.chunkSize, i * config.chunkSize);
      
      const chunk = buffer.subarray(0, bytesRead).toString('base64');
      
      socket.emit('file:chunk', {
        fileId,
        fileName,
        chunk,
        chunkIndex: i,
        totalChunks,
        totalSize: stat.size,
        mimeType
      });
      
      // Throttle to avoid overwhelming the connection
      await new Promise(r => setTimeout(r, 50));
    }
    
    await fileHandle.close();
    
    socket.emit('file:complete', { fileId, fileName });
    console.log(chalk.green(`  ✓ File sent: ${fileName}`));
    
  } catch (error) {
    console.error(chalk.red('File send error:'), error.message);
  }
}

// Handle incoming file uploads
const uploadChunks = {};

function handleFileUpload(data) {
  const { fileId, fileName, chunk, chunkIndex, totalChunks, totalSize } = data;
  
  if (!uploadChunks[fileId]) {
    uploadChunks[fileId] = {
      fileName,
      chunks: new Array(totalChunks),
      received: 0,
      totalSize
    };
    console.log(chalk.blue(`  📥 Receiving file: ${fileName}`));
  }
  
  uploadChunks[fileId].chunks[chunkIndex] = Buffer.from(chunk);
  uploadChunks[fileId].received++;
  
  // Check if all chunks received
  if (uploadChunks[fileId].received === totalChunks) {
    const combined = Buffer.concat(uploadChunks[fileId].chunks.filter(Boolean));
    const savePath = path.join(config.downloadDir, fileName);
    
    fs.promises.writeFile(savePath, combined)
      .then(() => {
        console.log(chalk.green(`  ✓ File saved: ${savePath}`));
        socket.emit('file:uploadComplete', { fileName, size: totalSize, path: savePath });
      })
      .catch(err => {
        console.error(chalk.red(`  ✗ File save error: ${err.message}`));
      });
    
    delete uploadChunks[fileId];
  }
}

// ─── Socket Connection ───────────────────────────────────────────────────────

async function connectToRelay() {
  const screenInfo = await getScreenInfo();
  
  console.log(chalk.cyan('\n  Connecting to relay server...'));
  console.log(chalk.gray(`  URL: ${config.relayUrl}`));
  
  socket = io(config.relayUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log(chalk.green('  ✓ Connected to relay server'));
    
    // Register as desktop agent
    socket.emit('desktop:register', {
      hostname: os.hostname(),
      platform: os.platform(),
      screenWidth: screenInfo.width,
      screenHeight: screenInfo.height,
      username: os.userInfo().username
    }, (response) => {
      if (response.success) {
        sessionCode = response.code;
        sessionId = response.sessionId;
        
        printSessionInfo(response.code);
        
        // Send screen info
        socket.emit('desktop:screenInfo', {
          width: screenInfo.scaledWidth,
          height: screenInfo.scaledHeight,
          originalWidth: screenInfo.width,
          originalHeight: screenInfo.height
        });
      }
    });
  });

  socket.on('disconnect', (reason) => {
    console.log(chalk.yellow(`\n  ⚠ Disconnected from relay: ${reason}`));
    stopStreaming();
    mobileConnected = false;
  });

  socket.on('connect_error', (error) => {
    console.log(chalk.red(`  ✗ Connection error: ${error.message}`));
  });

  // ── Mobile Events ──
  socket.on('mobile:connected', (data) => {
    mobileConnected = true;
    wakeLaptopScreen();
    console.log(chalk.green('\n  📱 Mobile device connected!'));
    console.log(chalk.green('  ▶ Starting screen stream...'));
    startStreaming();
  });

  socket.on('mobile:disconnected', () => {
    mobileConnected = false;
    console.log(chalk.yellow('\n  📱 Mobile device disconnected'));
    stopStreaming();
  });

  // ── Screen Flow Control & Wake ──
  socket.on('screen:ack', handleFrameAck);
  socket.on('screen:wake', () => {
    console.log(chalk.cyan('  ⚡ Received screen wake request from mobile'));
    wakeLaptopScreen();
  });

  // ── Input Events ──
  socket.on('input:mouseMove', handleMouseMove);
  socket.on('input:mouseClick', handleMouseClick);
  socket.on('input:mouseDoubleClick', handleMouseDoubleClick);
  socket.on('input:mouseDown', handleMouseDown);
  socket.on('input:mouseUp', handleMouseUp);
  socket.on('input:scroll', handleScroll);
  socket.on('input:keyPress', handleKeyPress);
  socket.on('input:text', handleTextInput);
  socket.on('input:keyDown', handleKeyDown);
  socket.on('input:keyUp', handleKeyUp);
  socket.on('input:keyCombo', handleKeyCombo);

  // ── Settings Events ──
  socket.on('settings:quality', (data) => {
    if (data.quality) config.quality = data.quality;
    if (data.fps) config.captureInterval = Math.round(1000 / data.fps);
    
    // Apply resolution based on quality
    if (data.type === 'low') {
      config.maxWidth = 854;
      config.maxHeight = 480;
    } else if (data.type === 'medium') {
      config.maxWidth = 1280;
      config.maxHeight = 720;
    } else if (data.type === 'high') {
      config.maxWidth = 1920;
      config.maxHeight = 1080;
    }
    
    console.log(chalk.gray(`  ⚙ Quality: ${config.quality}%, ${Math.round(1000/config.captureInterval)} FPS, ${config.maxWidth}x${config.maxHeight}`));
  });

  // ── File Events ──
  socket.on('file:request', handleFileRequest);
  socket.on('file:upload', handleFileUpload);

  // ── Session Events ──
  socket.on('session:ended', (data) => {
    console.log(chalk.red(`\n  Session ended: ${data.reason}`));
    stopStreaming();
    mobileConnected = false;
    
    // Disconnect and reconnect to re-register fresh session
    setTimeout(() => {
      console.log(chalk.cyan('\n  Reconnecting to relay server...'));
      socket.disconnect();
      socket.connect();
    }, 2000);
  });
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

function getNetworkIps() {
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

function printSessionInfo(code) {
  const formattedCode = `${code.slice(0, 3)} ${code.slice(3)}`;
  const ips = getNetworkIps();
  const primaryIp = ips[0] || 'YOUR_LAPTOP_IP';
  
  let port = 3000;
  try {
    const url = new URL(config.relayUrl);
    port = url.port || 3000;
  } catch (e) {}

  const publicUrl = config.publicUrl ? config.publicUrl.replace(/\/+$/, '') : null;
  const mobileUrl = publicUrl || `http://${primaryIp}:${port}`;
  const directConnectUrl = publicUrl ? `${publicUrl}/connect?code=${code}` : `http://${primaryIp}:${port}/connect?code=${code}`;

  console.log('');
  console.log(chalk.bold('  ╔════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold('  ║                 🖥️  Desktop Agent Ready                       ║'));
  console.log(chalk.bold('  ╠════════════════════════════════════════════════════════════════╣'));
  console.log(chalk.bold(`  ║   Connection Code :  ${chalk.cyan.bold(formattedCode)}                                    ║`));
  console.log(chalk.bold('  ╠════════════════════════════════════════════════════════════════╣'));
  console.log(chalk.bold('  ║   📱 HOW TO OPEN ON YOUR MOBILE PHONE:                         ║'));
  console.log(chalk.bold('  ║                                                                ║'));
  if (publicUrl) {
    console.log(chalk.bold(`  ║   🌐 Over the Internet (Any Network / 4G / 5G / Wi-Fi):        ║`));
    console.log(chalk.bold(`  ║   1. Open browser on your phone and go to:                     ║`));
    console.log(chalk.bold(`  ║      ${chalk.green.bold(mobileUrl)}       ║`));
    console.log(chalk.bold(`  ║      (enter code: ${chalk.cyan.bold(formattedCode)})                                  ║`));
    console.log(chalk.bold('  ║                                                                ║'));
    console.log(chalk.bold('  ║   Direct connect URL (auto-connects with code):                ║'));
    console.log(chalk.bold(`  ║      ${chalk.yellow(directConnectUrl)} ║`));
  } else {
    console.log(chalk.bold(`  ║   1. Make sure phone is on the SAME Wi-Fi as laptop            ║`));
    console.log(chalk.bold(`  ║   2. Open browser on your phone and go to:                     ║`));
    console.log(chalk.bold(`  ║      ${chalk.green.bold(mobileUrl)}                                     ║`));
    console.log(chalk.bold(`  ║      (enter code: ${chalk.cyan.bold(formattedCode)})                                  ║`));
    console.log(chalk.bold('  ║                                                                ║'));
    console.log(chalk.bold('  ║   Direct connect URL:                                          ║'));
    console.log(chalk.bold(`  ║      ${chalk.yellow(directConnectUrl)}          ║`));
  }
  console.log(chalk.bold('  ╚════════════════════════════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.gray(`  Relay: ${config.relayUrl}`));
  console.log(chalk.gray(`  Host: ${os.hostname()} (${os.platform()})`));
  console.log(chalk.gray(`  User: ${os.userInfo().username}`));
  console.log('');
  console.log(chalk.cyan('  Waiting for mobile connection...'));
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(chalk.bold.magenta('  ═══════════════════════════════════════════'));
  console.log(chalk.bold.magenta('  ║  Mobile-Laptop Bridge • Desktop Agent  ║'));
  console.log(chalk.bold.magenta('  ═══════════════════════════════════════════'));
  console.log('');
  
  console.log(chalk.gray('  Initializing...'));
  
  // Init input control
  await initInputControl();

  // Init native fast capture
  initFastCapture();
  
  // Test screen capture
  console.log(chalk.gray('  Testing screen capture...'));
  const testCapture = await captureScreen();
  if (testCapture) {
    console.log(chalk.green(`  ✓ Screen capture working (${formatSize(testCapture.length)} per frame)`));
  } else {
    console.log(chalk.red('  ✗ Screen capture failed'));
    console.log(chalk.red('    Make sure screenshot-desktop is properly installed'));
  }
  
  // Connect to relay
  await connectToRelay();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n  Shutting down...'));
  stopStreaming();
  if (fastCaptureProc) try { fastCaptureProc.kill(); } catch (e) {}
  if (socket) socket.disconnect();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('  Uncaught exception:'), error.message);
});

main().catch(err => {
  console.error(chalk.red('  Fatal error:'), err);
  process.exit(1);
});
