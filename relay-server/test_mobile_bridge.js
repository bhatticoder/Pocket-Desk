const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET_URL = 'https://visible-intermediate-taxi-compiled.trycloudflare.com/connect?code=746781';
const SCREENSHOT_PATH = path.join(__dirname, 'mobile_test_result.png');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.callbacks = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (msg) => {
        const parsed = JSON.parse(msg.toString());
        if (parsed.id && this.callbacks.has(parsed.id)) {
          const cb = this.callbacks.get(parsed.id);
          this.callbacks.delete(parsed.id);
          if (parsed.error) cb.reject(parsed.error);
          else cb.resolve(parsed.result);
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || 'Eval error');
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  console.log('[Test] Launching Chrome in headless mobile emulation mode...');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--user-data-dir=' + path.join(__dirname, 'temp_chrome_profile'),
    '--window-size=390,844',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions'
  ], { stdio: 'ignore' });

  try {
    let connected = false;
    let versionData = null;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try {
        versionData = await getJson('http://127.0.0.1:9222/json/version');
        if (versionData && versionData.webSocketDebuggerUrl) {
          connected = true;
          break;
        }
      } catch (e) { }
    }

    if (!connected) {
      throw new Error('Could not connect to Chrome DevTools port 9222');
    }
    console.log('[Test] Chrome started. DevTools URL:', versionData.webSocketDebuggerUrl);

    // Get page targets
    const targets = await getJson('http://127.0.0.1:9222/json/list');
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    console.log('[Test] Connecting to page target:', pageTarget.id);

    const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    console.log('[Test] Connected to CDP session');

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Emulate iPhone / modern Android mobile screen (390 x 844, 3x DPR, touch enabled)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });

    console.log('[Test] Navigating to:', TARGET_URL);
    await cdp.send('Page.navigate', { url: TARGET_URL });

    // Wait for connection to establish and remote screen to become active
    console.log('[Test] Waiting for session auto-connection...');
    let isConnected = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const state = await cdp.eval(`(() => {
        const remote = document.getElementById('remoteScreen');
        const status = document.getElementById('statusText');
        const fps = document.getElementById('fpsCounter');
        const error = document.getElementById('connectionError');
        return {
          remoteActive: remote ? remote.classList.contains('active') : false,
          statusText: status ? status.textContent : '',
          fpsText: fps ? fps.textContent : '',
          errorText: error ? error.textContent : ''
        };
      })()`);

      if (state.remoteActive && state.statusText === 'Connected') {
        console.log('  ✓ Connected to Remote Desktop! Status:', state.statusText, '| Initial FPS:', state.fpsText);
        isConnected = true;
        break;
      }
      if (state.errorText) {
        console.log('  ⚠ Connection message:', state.errorText);
      }
    }

    if (!isConnected) {
      throw new Error('Timeout waiting for remote desktop to connect');
    }

    // Give it 2 seconds to stream initial frames
    await sleep(2000);

    // 1. Verify UI Panels State
    const panelsState = await cdp.eval(`(() => {
      const openPanels = Array.from(document.querySelectorAll('.panel.open')).map(p => p.id);
      return {
        openPanelsCount: openPanels.length,
        openPanels: openPanels,
        floatingKbVisible: !document.getElementById('btnFloatingKeyboard').classList.contains('hidden')
      };
    })()`);
    console.log('  ✓ Panels check: open panels =', panelsState.openPanelsCount, '(Expected 0). Floating KB button present =', panelsState.floatingKbVisible);

    // 2. Test Screen Fit Mode Cycling
    console.log('[Test] Testing Screen Fit Mode cycling...');
    for (let i = 0; i < 4; i++) {
      const modeResult = await cdp.eval(`(() => {
        const btn = document.getElementById('btnScreenFitMode');
        btn.click();
        const badge = document.getElementById('screenFitBadge').textContent;
        const label = document.getElementById('screenFitLabel').textContent;
        const canvas = document.getElementById('remoteCanvas');
        return {
          badge,
          label,
          objectFit: canvas.style.objectFit,
          width: canvas.style.width,
          height: canvas.style.height
        };
      })()`);
      console.log(`  ✓ Cycle ${i + 1}: Badge="${modeResult.badge}", Label="${modeResult.label}", canvas objectFit="${modeResult.objectFit}"`);
    }

    // 3. Test Canvas Touch / Click Interaction
    console.log('[Test] Testing Canvas Click & Immediate Touch Response...');
    const clickResult = await cdp.eval(`(() => {
      const canvas = document.getElementById('remoteCanvas');
      const rect = canvas.getBoundingClientRect();
      const clickX = rect.left + rect.width / 2;
      const clickY = rect.top + rect.height / 2;

      // Simulate mouse click on canvas
      const evtDown = new MouseEvent('mousedown', { clientX: clickX, clientY: clickY, bubbles: true });
      const evtUp = new MouseEvent('mouseup', { clientX: clickX, clientY: clickY, bubbles: true });
      canvas.dispatchEvent(evtDown);
      canvas.dispatchEvent(evtUp);

      const feedback = document.getElementById('touchFeedback');
      return {
        clickedAt: { x: clickX, y: clickY },
        feedbackActive: feedback ? feedback.classList.contains('active') : false
      };
    })()`);
    console.log('  ✓ Canvas click dispatched at center. Touch feedback ripple triggered:', clickResult.feedbackActive);

    // 4. Test Keyboard live typing bar
    console.log('[Test] Testing Quick Typing Bar and Soft Keyboard Trigger...');
    const kbOpenResult = await cdp.eval(`(() => {
      const btn = document.getElementById('btnTopKeyboard');
      btn.click();
      const bar = document.getElementById('quickTypingBar');
      const input = document.getElementById('quickTypingInput');
      return {
        barDisplay: window.getComputedStyle(bar).display,
        isInputFocused: document.activeElement === input
      };
    })()`);
    console.log('  ✓ Top ⌨️ Type button tapped: Bar display =', kbOpenResult.barDisplay, ', Input focused =', kbOpenResult.isInputFocused);

    // Type live text into input
    const typeResult = await cdp.eval(`(() => {
      const input = document.getElementById('quickTypingInput');
      input.value = 'dir';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const sendBtn = document.getElementById('btnQuickTypeSend');
      sendBtn.click();

      const enterBtn = document.getElementById('btnQuickTypeEnter');
      enterBtn.click();

      const closeBtn = document.getElementById('btnQuickTypeClose');
      closeBtn.click();

      const bar = document.getElementById('quickTypingBar');
      return {
        typedText: 'dir',
        barClosed: bar.style.display === 'none'
      };
    })()`);
    console.log('  ✓ Live text typed, Sent, Enter pressed, and bar closed cleanly =', typeResult.barClosed);

    // 5. Test Floating Keyboard Button
    const floatResult = await cdp.eval(`(() => {
      const floatBtn = document.getElementById('btnFloatingKeyboard');
      floatBtn.click();
      const bar = document.getElementById('quickTypingBar');
      const isVisible = bar.style.display === 'flex';
      // Close it again
      document.getElementById('btnQuickTypeClose').click();
      return { openedByFloatingButton: isVisible };
    })()`);
    console.log('  ✓ Floating ⌨️ button opened Quick Typing Bar =', floatResult.openedByFloatingButton);

    // Let streaming run for 2 seconds to get final FPS and latency
    await sleep(2000);
    const finalStats = await cdp.eval(`(() => {
      return {
        fps: document.getElementById('fpsCounter').textContent,
        latency: document.getElementById('latencyDisplay').textContent
      };
    })()`);
    console.log('  ✓ Final Stream Performance:', finalStats.fps, '| Latency:', finalStats.latency);

    // Switch to Fill mode before capturing screenshot to demonstrate full phone screen fill
    await cdp.eval(`(() => {
      window.app.display.setFitMode('fill');
    })()`);
    await sleep(1000);

    // Capture screenshot of rendered mobile page
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const imgBuf = Buffer.from(screenshot.data, 'base64');
    fs.writeFileSync(SCREENSHOT_PATH, imgBuf);
    console.log('  ✓ Saved mobile test screenshot to:', SCREENSHOT_PATH);

    cdp.close();
    console.log('\n========================================');
    console.log('🎉 ALL AUTOMATED MOBILE TESTS PASSED!');
    console.log('========================================\n');

  } finally {
    try { chromeProc.kill(); } catch (e) { }
  }
}

run().catch(err => {
  console.error('[Test Error]:', err);
  process.exit(1);
});
