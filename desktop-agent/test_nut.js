const nut = require('@nut-tree-fork/nut-js');
const sharp = require('sharp');
const fs = require('fs');

async function testNut() {
  try {
    console.log('Testing nut.screen.grab...');
    const img = await nut.screen.grab();
    console.log('Grabbed image:', img.width, 'x', img.height, 'colorSpace:', img.colorMode, 'byte length:', img.data.length);
    // nut image data is RGBA or BGR
    // let's check with sharp
    const pngBuf = await sharp(img.data, {
      raw: {
        width: img.width,
        height: img.height,
        channels: 4
      }
    }).png().toBuffer();

    const stats = await sharp(pngBuf).stats();
    console.log('nut.js stats:', stats.channels.map(c => ({ min: c.min, max: c.max, mean: Math.round(c.mean) })));
    fs.writeFileSync('test_nut.png', pngBuf);
  } catch (err) {
    console.error('nut.js error:', err);
  }
}

testNut();
