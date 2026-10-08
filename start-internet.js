/**
 * Mobile-Laptop Bridge — One-Click Internet Starter
 *
 * Automatically:
 * 1. Launches Relay Server on port 3000
 * 2. Launches Cloudflare Tunnel to expose it over the public internet
 * 3. Launches Desktop Agent with the public URL
 * 4. Prints direct connection links and keeps processes running
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = __dirname;
const RELAY_DIR = path.join(PROJECT_ROOT, 'relay-server');
const DESKTOP_DIR = path.join(PROJECT_ROOT, 'desktop-agent');

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
let desktopProcess = null;
let publicUrl = null;
let tunnelBuffer = '';

// Cleanup on exit
function cleanup() {
  console.log('\n[Shutting down processes...]');
  if (desktopProcess) try { desktopProcess.kill(); } catch (e) {}
  if (tunnelProcess) try { tunnelProcess.kill(); } catch (e) {}
  if (relayProcess) try { relayProcess.kill(); } catch (e) {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  if (desktopProcess) try { desktopProcess.kill(); } catch (e) {}
  if (tunnelProcess) try { tunnelProcess.kill(); } catch (e) {}
  if (relayProcess) try { relayProcess.kill(); } catch (e) {}
});

// Step 1: Start Relay Server
console.log('[1/3] Starting Relay Server (port 3000)...');
relayProcess = spawn(process.execPath, [path.join(RELAY_DIR, 'index.js')], {
  cwd: RELAY_DIR,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: '3000' }
});

relayProcess.stdout.on('data', data => {
  const line = data.toString();
  if (line.includes('Server running') || line.includes('Local (on laptop)')) {
    console.log('  ✓ Relay Server is running locally on port 3000.');
  }
});

relayProcess.stderr.on('data', data => {
  process.stderr.write(`[Relay] ${data}`);
});

// Step 2: Start Cloudflare Tunnel
console.log('[2/3] Establishing Cloudflare Internet Tunnel...');
tunnelProcess = spawn(CLOUDFLARED_PATH, ['tunnel', '--url', 'http://localhost:3000'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

function handleTunnelOutput(chunk) {
  const text = chunk.toString();
  tunnelBuffer += text;

  if (text.includes('Requesting new quick Tunnel')) {
    console.log('  ⏳ Requesting public domain from Cloudflare...');
  }
  if (text.includes('Registered tunnel connection')) {
    console.log('  ✓ Tunnel connection registered with Cloudflare edge.');
  }

  // Look for the quick tunnel URL (format: https://word-word-word-word.trycloudflare.com)
  const matches = tunnelBuffer.matchAll(/https:\/\/([a-zA-Z0-9-]+)\.trycloudflare\.com/g);
  for (const m of matches) {
    const subdomain = m[1].toLowerCase();
    if (subdomain !== 'api' && subdomain.includes('-') && !publicUrl) {
      publicUrl = m[0];
      console.log(`\n  ✓ Internet Tunnel Active!`);
      console.log(`  🔗 Public URL: ${publicUrl}\n`);
      startDesktopAgent(publicUrl);
      break;
    }
  }
}

tunnelProcess.stdout.on('data', handleTunnelOutput);
tunnelProcess.stderr.on('data', handleTunnelOutput);

tunnelProcess.on('error', err => {
  console.error('\n[!] Failed to start cloudflared:', err.message);
  console.error('Make sure cloudflared is installed or accessible at:', CLOUDFLARED_PATH);
});

// Step 3: Start Desktop Agent once publicUrl is known
function startDesktopAgent(url) {
  console.log('[3/3] Starting Desktop Agent connected to internet tunnel...');
  
  desktopProcess = spawn(process.execPath, [path.join(DESKTOP_DIR, 'index.js')], {
    cwd: DESKTOP_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      RELAY_URL: 'http://localhost:3000',
      PUBLIC_URL: url
    }
  });

  desktopProcess.on('exit', code => {
    console.log(`\nDesktop Agent exited with code ${code}`);
    cleanup();
  });
}
