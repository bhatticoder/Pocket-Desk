using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class NativeInputServer
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern short VkKeyScan(char ch);

    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;

    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern int GetDeviceCaps(IntPtr hdc, int nIndex);

    public const int DESKTOPHORZRES = 118;
    public const int DESKTOPVERTRES = 117;

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    static void EnsureDesktop()
    {
        IntPtr hInput = OpenInputDesktop(0, false, 0x01FF);
        if (hInput != IntPtr.Zero)
        {
            SetThreadDesktop(hInput);
        }
    }

    public static void Main(string[] args)
    {
        try { SetProcessDPIAware(); } catch { }
        Console.OutputEncoding = Encoding.UTF8;
        
        Thread worker = new Thread(() =>
        {
            EnsureDesktop();
            StreamReader reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);

            IntPtr hdc = GetDC(IntPtr.Zero);
            int sw = GetDeviceCaps(hdc, DESKTOPHORZRES);
            int sh = GetDeviceCaps(hdc, DESKTOPVERTRES);
            ReleaseDC(IntPtr.Zero, hdc);

            if (sw <= 0) sw = GetSystemMetrics(0);
            if (sh <= 0) sh = GetSystemMetrics(1);
            if (sw <= 0) sw = 1920;
            if (sh <= 0) sh = 1080;
            Console.WriteLine("READY " + sw + " " + sh);

            string line;
            while ((line = reader.ReadLine()) != null)
            {
                line = line.Trim();
                if (string.IsNullOrEmpty(line)) continue;

                EnsureDesktop();

                try
                {
                    string[] parts = line.Split(' ');
                    string cmd = parts[0].ToUpperInvariant();

                    if (cmd == "MOVE" && parts.Length >= 3)
                    {
                        int x = int.Parse(parts[1]);
                        int y = int.Parse(parts[2]);
                        SetCursorPos(x, y);
                    }
                    else if (cmd == "CLICK" && parts.Length >= 4)
                    {
                        int x = int.Parse(parts[1]);
                        int y = int.Parse(parts[2]);
                        string btn = parts[3].ToLowerInvariant();
                        SetCursorPos(x, y);

                        if (btn == "right")
                        {
                            mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                            mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                        }
                        else if (btn == "middle")
                        {
                            mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0);
                            mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0);
                        }
                        else
                        {
                            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                        }
                    }
                    else if (cmd == "DBLCLICK" && parts.Length >= 3)
                    {
                        int x = int.Parse(parts[1]);
                        int y = int.Parse(parts[2]);
                        SetCursorPos(x, y);
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                        Thread.Sleep(30);
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    }
                    else if (cmd == "DOWN" && parts.Length >= 4)
                    {
                        int x = int.Parse(parts[1]);
                        int y = int.Parse(parts[2]);
                        string btn = parts[3].ToLowerInvariant();
                        SetCursorPos(x, y);

                        if (btn == "right") mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                        else if (btn == "middle") mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0);
                        else mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                    }
                    else if (cmd == "UP" && parts.Length >= 4)
                    {
                        int x = int.Parse(parts[1]);
                        int y = int.Parse(parts[2]);
                        string btn = parts[3].ToLowerInvariant();
                        SetCursorPos(x, y);

                        if (btn == "right") mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                        else if (btn == "middle") mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0);
                        else mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    }
                    else if (cmd == "SCROLL" && parts.Length >= 4)
                    {
                        int x = int.Parse(parts[1]);
                        int y = int.Parse(parts[2]);
                        int dy = int.Parse(parts[3]);
                        SetCursorPos(x, y);
                        // Windows wheel delta is in multiples of 120
                        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, dy, 0);
                    }
                    else if (cmd == "KEY" && parts.Length >= 3)
                    {
                        byte vk = byte.Parse(parts[1]);
                        bool down = parts[2].ToLowerInvariant() == "down";
                        uint flags = down ? 0 : KEYEVENTF_KEYUP;
                        keybd_event(vk, 0, flags, 0);
                    }
                    else if (cmd == "KEYPRESS" && parts.Length >= 2)
                    {
                        byte vk = byte.Parse(parts[1]);
                        keybd_event(vk, 0, 0, 0);
                        Thread.Sleep(20);
                        keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
                    }
                    else if (cmd == "TEXT" && parts.Length >= 2)
                    {
                        string b64 = parts[1];
                        string text = Encoding.UTF8.GetString(Convert.FromBase64String(b64));
                        foreach (char c in text)
                        {
                            keybd_event(0, (byte)c, KEYEVENTF_UNICODE, 0);
                            keybd_event(0, (byte)c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0);
                        }
                    }
                    else if (cmd == "WIN")
                    {
                        // Open Start Menu
                        keybd_event(0x5B, 0, 0, 0); // VK_LWIN
                        Thread.Sleep(20);
                        keybd_event(0x5B, 0, KEYEVENTF_KEYUP, 0);
                    }
                    else if (cmd == "DESKTOP")
                    {
                        // Win + D (Minimize all / Show Desktop)
                        keybd_event(0x5B, 0, 0, 0); // VK_LWIN
                        keybd_event(0x44, 0, 0, 0); // 'D'
                        Thread.Sleep(20);
                        keybd_event(0x44, 0, KEYEVENTF_KEYUP, 0);
                        keybd_event(0x5B, 0, KEYEVENTF_KEYUP, 0);
                    }
                }
                catch (Exception ex)
                {
                    // Ignore malformed command
                }
            }
        });

        worker.IsBackground = true;
        worker.Start();
        worker.Join();
    }
}
