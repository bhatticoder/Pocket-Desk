const { execSync } = require('child_process');

const script = `
Add-Type -TypeDefinition '
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinInfo {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);

    public static string GetActive() {
        IntPtr h = GetForegroundWindow();
        StringBuilder sb = new StringBuilder(256);
        GetWindowText(h, sb, 256);
        return h.ToString() + ": " + sb.ToString();
    }
}
';
[WinInfo]::GetActive();
`;

try {
  const res = execSync(`powershell -ExecutionPolicy Bypass -Command "${script}"`).toString().trim();
  console.log('Foreground window:', res);
} catch (e) {
  console.error(e);
}
