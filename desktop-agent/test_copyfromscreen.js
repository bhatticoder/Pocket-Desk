const { execSync } = require('child_process');
const sharp = require('sharp');
const fs = require('fs');

// Test .NET Graphics.CopyFromScreen via powershell
try {
  const psCmd = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0, 0, 0, 0, $b.Size); $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg); [System.Convert]::ToBase64String($ms.ToArray())`;
  
  const b64 = execSync(`powershell -NoProfile -Command "${psCmd}"`, { maxBuffer: 10 * 1024 * 1024 }).toString().trim();
  const buf = Buffer.from(b64, 'base64');
  console.log('CopyFromScreen buffer length:', buf.length);
  
  sharp(buf).stats().then(stats => {
    console.log('CopyFromScreen stats:', stats.channels.map(c => ({ min: c.min, max: c.max, mean: Math.round(c.mean) })));
  });
} catch (e) {
  console.error('Error:', e);
}
