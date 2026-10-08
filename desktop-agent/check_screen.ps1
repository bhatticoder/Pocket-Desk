Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
Write-Host "Screen bounds: $($bounds.Width) x $($bounds.Height)"

$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save("test_ps.png", [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "Success: Saved test_ps.png"
} catch {
    Write-Host "Error during CopyFromScreen: $_"
} finally {
    $g.Dispose()
    $bmp.Dispose()
}
