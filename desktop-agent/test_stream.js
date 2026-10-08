const { spawn } = require('child_process');
const path = require('path');
const sharp = require('sharp');

const binPath = path.join(__dirname, 'FastCaptureServer.exe');
const proc = spawn(binPath, ['55', '1280', '720'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let buffer = Buffer.alloc(0);
let pendingResolve = null;

proc.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const frameLen = buffer.readInt32LE(0);
    if (buffer.length >= 4 + frameLen) {
      const frameData = buffer.slice(4, 4 + frameLen);
      buffer = buffer.slice(4 + frameLen);
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve(frameData);
      }
    } else {
      break;
    }
  }
});

function getFrame() {
  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    proc.stdin.write(Buffer.from([1]));
  });
}

async function run() {
  console.log('Testing FastCaptureServer...');
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const frame = await getFrame();
    const dt = Date.now() - t0;
    const stats = await sharp(frame).stats();
    console.log(`Frame ${i}: ${frame.length} bytes in ${dt}ms | stats:`, stats.channels.map(c => ({ min: c.min, max: c.max, mean: Math.round(c.mean) })));
  }
  proc.kill();
  console.log('Done!');
}

run();
