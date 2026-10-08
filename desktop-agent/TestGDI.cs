using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class TestGDI
{
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateDC(string lpszDriver, string lpszDevice, string lpszOutput, IntPtr lpInitData);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    public const int SRCCOPY = 0x00CC0020;
    public const int CAPTUREBLT = 0x40000000;

    public static void Main(string[] args)
    {
        int w = GetSystemMetrics(0); // SM_CXSCREEN
        int h = GetSystemMetrics(1); // SM_CYSCREEN
        Console.WriteLine("Metrics: " + w + "x" + h);

        IntPtr hdcDisplay = CreateDC("DISPLAY", null, null, IntPtr.Zero);
        Console.WriteLine("hdcDisplay: " + hdcDisplay + " Error: " + Marshal.GetLastWin32Error());

        IntPtr hdcMem = CreateCompatibleDC(hdcDisplay);
        Console.WriteLine("hdcMem: " + hdcMem + " Error: " + Marshal.GetLastWin32Error());

        IntPtr hBitmap = CreateCompatibleBitmap(hdcDisplay, w, h);
        Console.WriteLine("hBitmap: " + hBitmap + " Error: " + Marshal.GetLastWin32Error());

        IntPtr hOld = SelectObject(hdcMem, hBitmap);

        bool blt = BitBlt(hdcMem, 0, 0, w, h, hdcDisplay, 0, 0, SRCCOPY);
        Console.WriteLine("BitBlt (CreateDC): " + blt + " Error: " + Marshal.GetLastWin32Error());

        SelectObject(hdcMem, hOld);
        DeleteDC(hdcMem);
        DeleteDC(hdcDisplay);

        using (Bitmap bmp = Image.FromHbitmap(hBitmap))
        {
            Color p = bmp.GetPixel(w / 2, h / 2);
            Console.WriteLine("Center pixel: " + p);
            bmp.Save("test_gdi_createdc.png", ImageFormat.Png);
        }
        DeleteObject(hBitmap);
    }
}
