using System;
using System.Runtime.InteropServices;
using System.Text;

public class Diag
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetProcessWindowStation();

    [DllImport("user32.dll")]
    public static extern IntPtr GetThreadDesktop(int dwThreadId);

    [DllImport("kernel32.dll")]
    public static extern int GetCurrentThreadId();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, [Out] byte[] pvInfo, int nLength, out int lpnLengthNeeded);

    [DllImport("kernel32.dll")]
    public static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public static string GetObjName(IntPtr handle)
    {
        byte[] buf = new byte[512];
        int len;
        if (GetUserObjectInformation(handle, 2, buf, 512, out len))
        {
            return Encoding.Unicode.GetString(buf, 0, len).TrimEnd('\0');
        }
        return "Unknown(err=" + Marshal.GetLastWin32Error() + ")";
    }

    public static void Main()
    {
        uint activeSession = WTSGetActiveConsoleSessionId();
        int mySession = System.Diagnostics.Process.GetCurrentProcess().SessionId;
        Console.WriteLine("Active Console Session ID: " + activeSession);
        Console.WriteLine("My Process Session ID: " + mySession);

        IntPtr winSta = GetProcessWindowStation();
        Console.WriteLine("WindowStation: " + GetObjName(winSta));

        IntPtr threadDesk = GetThreadDesktop(GetCurrentThreadId());
        Console.WriteLine("Thread Desktop: " + GetObjName(threadDesk));

        IntPtr inputDesk = OpenInputDesktop(0, false, 0x01FF);
        if (inputDesk != IntPtr.Zero)
        {
            Console.WriteLine("Input Desktop: " + GetObjName(inputDesk));
        }
        else
        {
            Console.WriteLine("OpenInputDesktop failed: " + Marshal.GetLastWin32Error());
        }

        int count = 0;
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd))
            {
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                if (!string.IsNullOrEmpty(title))
                {
                    Console.WriteLine("  Visible Window: [" + title + "]");
                    count++;
                }
            }
            return count < 10;
        }, IntPtr.Zero);
        Console.WriteLine("Total visible windows listed: " + count);
    }
}
