using System;
using System.Runtime.InteropServices;
using System.Text;

public class CheckDesktop
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    public static void Main()
    {
        IntPtr fg = GetForegroundWindow();
        StringBuilder sb = new StringBuilder(256);
        GetWindowText(fg, sb, 256);
        Console.WriteLine("Foreground HWND: " + fg + " | Title: [" + sb.ToString() + "]");

        int remote = GetSystemMetrics(0x1000); // SM_REMOTESESSION
        Console.WriteLine("SM_REMOTESESSION: " + remote);
    }
}
