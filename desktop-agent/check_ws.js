// Check if session is locked or non-interactive
const { execSync } = require('child_process');
const ffi = require('util');

try {
  const out = execSync('powershell -ExecutionPolicy Bypass -Command "$h = [System.Diagnostics.Process]::GetCurrentProcess().Handle; $name = (Get-ItemProperty \'HKCU:\\Control Panel\\Desktop\').ScreenSaveActive; Write-Host \'ScreenSaver:\' $name"').toString();
  console.log(out);
} catch (e) {
  console.error(e);
}
