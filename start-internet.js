/**
 * Mobile-Laptop Bridge — One-Click Internet Starter & Immortal Supervisor
 *
 * Automatically:
 * 1. Configures Windows Power scheme so laptop never sleeps when lid is closed or left idle
 * 2. Launches Relay Server on port 3000 (with auto-restart watchdog)
 * 3. Launches Cloudflare Tunnel to expose it over public internet (with auto-reconnect & fallback)
 * 4. Launches Desktop Agent with public URL (with auto-restart watchdog)
 * 5. Saves current public URL to current-url.txt
 * 6. Keeps all processes alive continuously for unattended hostel-to-university access
 */

const { spawn, execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = __dirname;
const RELAY_DIR = path.join(PROJECT_ROOT, 'relay-server');
const DESKTOP_DIR = path.join(PROJECT_ROOT, 'desktop-agent');
const URL_FILE = path.join(PROJECT_ROOT, 'current-url.txt');

const CLOUDFLARED_PATH = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
  'cloudflared'
].find(p => p === 'cloudflared' || fs.existsSync(p)) || 'cloudflared';

console.log('\n================================================================');
console.log('  🌐 Starting Mobile-Laptop Bridge over the Internet...');
console.log('================================================================\n');

let relayProcess = null;
let tunnelProcess = null;
let fallbackTunnelProcess = null;
let desktopProcess = null;
let publicUrl = null;
let tunnelBuffer = '';
let tunnelAttempts = 0;
const MAX_CLOUDFLARE_ATTEMPTS = 5;
let isShuttingDown = false;

// Cleanup ONLY on intentional user shutdown (Ctrl+C / SIGINT)
function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n[Shutting down all processes...]');
  if (desktopProcess) try { desktopProcess.kill(); } catch (e) {}
  if (tunnelProcess) try { tunnelProcess.kill(); } catch (e) {}
  if (fallbackTunnelProcess) try { fallbackTunnelProcess.kill(); } catch (e) {}
  if (relayProcess) try { relayProcess.kill(); } catch (e) {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  if (isShuttingDown) {
    if (desktopProcess) try { desktopProcess.kill(); } catch (e) {}
    if (tunnelProcess) try { tunnelProcess.kill(); } catch (e) {}
    if (fallbackTunnelProcess) try { fallbackTunnelProcess.kill(); } catch (e) {}
    if (relayProcess) try { relayProcess.kill(); } catch (e) {}
  }
});

// Clean up any lingering processes and free port 3000 before initial startup
function cleanupLingeringProcesses() {
  if (process.platform === 'win32') {
    try {
      execSync('taskkill /F /IM cloudflared.exe', { stdio: 'ignore' });
    } catch (e) {}

    try {
      const out = execSync('netstat -ano | findstr :3000', { encoding: 'utf8' });
      const lines = out.trim().split('\n');
      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0' && pid !== String(process.pid)) {
            try {
              process.kill(parseInt(pid, 10));
            } catch (e) {
              try {
                execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
              } catch (e2) {}
            }
          }
        }
      }
    } catch (err) {}
  }
}

cleanupLingeringProcesses();

// Prevent laptop from sleeping or disconnecting when lid is closed or left idle
function configurePowerScheme() {
  if (process.platform === 'win32') {
    try {
      exec('powercfg /change standby-timeout-ac 0 && powercfg /change monitor-timeout-ac 0 && powercfg /change hibernate-timeout-ac 0 && powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 && powercfg /setactive SCHEME_CURRENT', () => {});
    } catch (e) {}
  }
}
configurePowerScheme();

// Step 1: Start Relay Server (with automatic watchdog revival)
function startRelay() {
  if (isShuttingDown) return;
  console.log('[1/3] Starting Relay Server (port 3000)...');
  
  relayProcess = spawn(process.execPath, [path.join(RELAY_DIR, 'index.js')], {
    cwd: RELAY_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3000' }
  });

  let relayReady = false;

  relayProcess.stdout.on('data', data => {
    const line = data.toString();
    if (!relayReady && (line.includes('Server running') || line.includes('Local (on laptop)'))) {
      relayReady = true;
      console.log('  ✓ Relay Server is running locally on port 3000.');
      if (!tunnelProcess && !fallbackTunnelProcess) {
        startTunnel();
      }
    }
  });

  relayProcess.stderr.on('data', data => {
    process.stderr.write(`[Relay] ${data}`);
  });

  relayProcess.on('exit', code => {
    if (isShuttingDown) return;
    console.warn(`[Relay] Exited with code ${code}. Reviving in 2 seconds...`);
    relayProcess = null;
    setTimeout(() => {
      if (!isShuttingDown) startRelay();
    }, 2000);
  });
}

startRelay();

// Step 2: Start Cloudflare Tunnel with auto-retry and metrics port collision prevention
function startTunnel() {
  if (isShuttingDown) return;
  tunnelAttempts++;
  console.log(`[2/3] Establishing Cloudflare Internet Tunnel (attempt ${tunnelAttempts}/${MAX_CLOUDFLARE_ATTEMPTS})...`);
  tunnelBuffer = '';

  const args = [
    'tunnel',
    '--url', 'http://localhost:3000',
    '--metrics', '127.0.0.1:0',
    '--retries', '10',
    '--edge-ip-version', 'auto',
    '--no-autoupdate'
  ];

  try {
    tunnelProcess = spawn(CLOUDFLARED_PATH, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    console.warn(`  [!] Could not spawn cloudflared: ${err.message}`);
    startFallbackTunnel();
    return;
  }

  function handleTunnelOutput(chunk) {
    const text = chunk.toString();
    tunnelBuffer += text;

    if (text.includes('Requesting new quick Tunnel')) {
      console.log('  ⏳ Requesting public domain from Cloudflare...');
    }
    if (text.includes('Registered tunnel connection')) {
      console.log('  ✓ Tunnel connection registered with Cloudflare edge.');
    }

    // Look for the quick tunnel URL (format: https://subdomain.trycloudflare.com)
    const matches = tunnelBuffer.matchAll(/https:\/\/([a-zA-Z0-9-]+)\.trycloudflare\.com/g);
    for (const m of matches) {
      const subdomain = m[1].toLowerCase();
      if (subdomain !== 'api' && !publicUrl) {
        publicUrl = m[0];
        try { fs.writeFileSync(URL_FILE, publicUrl, 'utf8'); } catch (e) {}

        console.log(`\n  ==============================================================`);
        console.log(`  🎉 Cloudflare Internet Tunnel Active!`);
        console.log(`  🔗 Mobile Web URL:  ${publicUrl}`);
        console.log(`  ==============================================================\n`);
        tunnelAttempts = 0;
        startDesktopAgent(publicUrl);
        break;
      }
    }
  }

  tunnelProcess.stdout.on('data', handleTunnelOutput);
  tunnelProcess.stderr.on('data', handleTunnelOutput);

  tunnelProcess.on('error', err => {
    console.warn(`\n  [!] Cloudflare tunnel error: ${err.message}`);
  });

  tunnelProcess.on('exit', code => {
    if (isShuttingDown) return;
    tunnelProcess = null;

    if (!publicUrl) {
      console.warn(`  [!] Cloudflare Tunnel attempt ${tunnelAttempts} exited with code ${code}.`);

      if (tunnelAttempts < MAX_CLOUDFLARE_ATTEMPTS) {
        const delay = tunnelAttempts * 2000;
        console.log(`  ⏳ Retrying Cloudflare tunnel in ${delay / 1000}s...`);
        setTimeout(() => {
          if (!publicUrl && !isShuttingDown) startTunnel();
        }, delay);
      } else {
        console.log(`\n  ⚠️ Cloudflare quick tunnel unavailable. Starting fallback tunnel (localtunnel)...`);
        startFallbackTunnel();
      }
    } else {
      // Tunnel dropped after being active (e.g. edge rebalance)
      console.warn(`\n  ⚠️ Cloudflare Internet tunnel connection dropped (code ${code}). Reconnecting...`);
      publicUrl = null;
      setTimeout(() => {
        if (!isShuttingDown) startTunnel();
      }, 2000);
    }
  });
}

// Fallback Tunnel using localtunnel if Cloudflare is unreachable
function startFallbackTunnel() {
  if (fallbackTunnelProcess || publicUrl || isShuttingDown) return;
  console.log('[Fallback] Establishing tunnel via localtunnel...');

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  fallbackTunnelProcess = spawn(npxCmd, ['--yes', 'localtunnel', '--port', '3000'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let ltBuffer = '';
  function handleLtOutput(chunk) {
    const text = chunk.toString();
    ltBuffer += text;

    const match = ltBuffer.match(/https:\/\/([a-zA-Z0-9-]+)\.loca\.lt/);
    if (match && !publicUrl) {
      publicUrl = match[0];
      try { fs.writeFileSync(URL_FILE, publicUrl, 'utf8'); } catch (e) {}

      console.log(`\n  ==============================================================`);
      console.log(`  🎉 Fallback Internet Tunnel Active!`);
      console.log(`  🔗 Mobile Web URL:  ${publicUrl}`);
      console.log(`  ==============================================================\n`);
      startDesktopAgent(publicUrl);
    }
  }

  fallbackTunnelProcess.stdout.on('data', handleLtOutput);
  fallbackTunnelProcess.stderr.on('data', handleLtOutput);

  fallbackTunnelProcess.on('exit', code => {
    if (isShuttingDown) return;
    fallbackTunnelProcess = null;
    if (!publicUrl) {
      console.warn(`  [Fallback] Tunnel exited with code ${code}. Retrying in 3s...`);
      setTimeout(() => {
        if (!isShuttingDown && !publicUrl) startFallbackTunnel();
      }, 3000);
    }
  });
}

// Step 3: Start Desktop Agent once publicUrl is known (with auto-restart watchdog)
function startDesktopAgent(url) {
  if (desktopProcess) {
    console.log(`  ✓ Desktop Agent is already running and streaming.`);
    return;
  }
  if (isShuttingDown) return;

  console.log('[3/3] Starting Desktop Agent connected to internet tunnel...');
  
  desktopProcess = spawn(process.execPath, [path.join(DESKTOP_DIR, 'index.js')], {
    cwd: DESKTOP_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      RELAY_URL: 'http://localhost:3000',
      PUBLIC_URL: url
    }
  });

  desktopProcess.stdout.pipe(process.stdout);
  desktopProcess.stderr.pipe(process.stderr);

  desktopProcess.on('exit', code => {
    if (isShuttingDown) return;
    console.log(`\nDesktop Agent exited with code ${code}. Reviving in 2 seconds...`);
    desktopProcess = null;
    setTimeout(() => {
      if (!isShuttingDown) startDesktopAgent(publicUrl || url);
    }, 2000);
  });

  desktopProcess.on('error', err => {
    console.error('\n[!] Desktop Agent error:', err.message);
  });
}
