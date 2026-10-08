using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class TestSwitch
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    public static void Main()
    {
        IntPtr hInput = OpenInputDesktop(0, false, 0x01FF);
        Console.WriteLine("hInput: " + hInput);
        bool setOk = SetThreadDesktop(hInput);
        Console.WriteLine("SetThreadDesktop: " + setOk + " Err: " + Marshal.GetLastWin32Error());

        IntPtr hdc = GetDC(IntPtr.Zero);
        IntPtr hMem = CreateCompatibleDC(hdc);
        IntPtr hBmp = CreateCompatibleBitmap(hdc, 200, 200);
        IntPtr hOld = SelectObject(hMem, hBmp);

        bool blt = BitBlt(hMem, 0, 0, 200, 200, hdc, 0, 0, 0x00CC0020);
        Console.WriteLine("BitBlt on Default: " + blt + " Err: " + Marshal.GetLastWin32Error());

        using (Bitmap bmp = Image.FromHbitmap(hBmp))
        {
            Color c = bmp.GetPixel(100, 100);
            Console.WriteLine("Pixel: " + c);
        }

        SelectObject(hMem, hOld);
        DeleteObject(hBmp);
        DeleteDC(hMem);
        ReleaseDC(IntPtr.Zero, hdc);
    }
}
