const nut = require('@nut-tree-fork/nut-js');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');

async function wakeAndCapture() {
  try {
    console.log('Sending wake up mouse wiggle...');
    const pos = await nut.mouse.getPosition();
    await nut.mouse.setPosition({ x: pos.x + 5, y: pos.y + 5 });
    await nut.mouse.setPosition({ x: pos.x, y: pos.y });
    await nut.keyboard.pressKey(nut.Key.LeftShift);
    await nut.keyboard.releaseKey(nut.Key.LeftShift);

    await new Promise(r => setTimeout(r, 500));

    console.log('Capturing after wake...');
    const buf = await screenshot({ format: 'png' });
    const stats = await sharp(buf).stats();
    console.log('Stats after wake:', stats.channels.map(c => ({ min: c.min, max: c.max, mean: Math.round(c.mean) })));
  } catch (e) {
    console.error('Error:', e);
  }
}

wakeAndCapture();
