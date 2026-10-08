using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;

public class InputTest {
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool GetCursorPos(out POINT lpPoint);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

    public static void Main() {
        Thread t = new Thread(() => {
            IntPtr h = OpenInputDesktop(0, false, 0x01FF);
            bool attached = false;
            if (h != IntPtr.Zero) attached = SetThreadDesktop(h);
            bool setOk = SetCursorPos(500, 300);
            POINT p;
            bool getOk = GetCursorPos(out p);
            Console.WriteLine("Attached: " + attached + " SetOk: " + setOk + " Pos: " + p.X + "," + p.Y);
        });
        t.Start();
        t.Join();
    }
}
