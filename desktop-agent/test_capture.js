const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const fs = require('fs');

async function test() {
  try {
    const displays = await screenshot.listDisplays();
    console.log('Displays:', displays);

    for (let i = 0; i < displays.length; i++) {
      const d = displays[i];
      console.log(`Capturing display ${d.name || d.id}...`);
      const buf = await screenshot({ screen: d.id, format: 'png' });
      const stats = await sharp(buf).stats();
      console.log(`Display ${d.id} stats:`, stats.channels.map(c => ({ min: c.min, max: c.max, mean: Math.round(c.mean) })));
      fs.writeFileSync(`test_disp_${i}.png`, buf);
    }

    console.log('Capturing default screen...');
    const bufDef = await screenshot({ format: 'png' });
    const statsDef = await sharp(bufDef).stats();
    console.log('Default stats:', statsDef.channels.map(c => ({ min: c.min, max: c.max, mean: Math.round(c.mean) })));
    fs.writeFileSync('test_default.png', bufDef);
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
