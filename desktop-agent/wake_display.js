const { execSync } = require('child_process');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');

// Wake display using SendInput / mouse_event and SetThreadExecutionState
const wakeScript = `
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class DisplayWake {
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
    
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
    
    public const uint ES_CONTINUOUS = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED = 0x00000001;
    public const uint ES_DISPLAY_REQUIRED = 0x00000002;
    public const uint MOUSEEVENTF_MOVE = 0x0001;
    
    public static void Wake() {
        SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
        mouse_event(MOUSEEVENTF_MOVE, 1, 0, 0, 0);
        mouse_event(MOUSEEVENTF_MOVE, unchecked((uint)-1), 0, 0, 0);
    }
}
';
[DisplayWake]::Wake();
`;

try {
  console.log('Running DisplayWake...');
  execSync(`powershell -ExecutionPolicy Bypass -Command "${wakeScript}"`);
  console.log('DisplayWake executed.');
  
  setTimeout(async () => {
    try {
      const buf = await screenshot({ format: 'png' });
      const stats = await sharp(buf).stats();
      console.log('Post-wake stats:', stats.channels.map(c => ({ min: c.min, max: c.max, mean: Math.round(c.mean) })));
      console.log('Buffer size:', buf.length);
    } catch (e) {
      console.error(e);
    }
  }, 1000);
} catch (e) {
  console.error(e);
}
