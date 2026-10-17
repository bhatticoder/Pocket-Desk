using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public class FastCaptureServer
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

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern bool StretchBlt(IntPtr hdcDest, int nXOriginDest, int nYOriginDest, int nWidthDest, int nHeightDest, IntPtr hdcSrc, int nXOriginSrc, int nYOriginSrc, int nWidthSrc, int nHeightSrc, int dwRop);

    [DllImport("gdi32.dll")]
    public static extern int SetStretchBltMode(IntPtr hdc, int iStretchMode);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("gdi32.dll")]
    public static extern int GetDeviceCaps(IntPtr hdc, int nIndex);

    public const int SM_CXSCREEN = 0;
    public const int SM_CYSCREEN = 1;
    public const int DESKTOPHORZRES = 118;
    public const int DESKTOPVERTRES = 117;
    public const int SRCCOPY = 0x00CC0020;
    public const int HALFTONE = 4;

    public static void Main(string[] args)
    {
        try { SetProcessDPIAware(); } catch { }

        int quality = 42;
        if (args.Length > 0) int.TryParse(args[0], out quality);
        if (quality <= 0 || quality > 100) quality = 42;

        int targetWidth = 1920;
        int targetHeight = 1080;
        if (args.Length > 1) int.TryParse(args[1], out targetWidth);
        if (args.Length > 2) int.TryParse(args[2], out targetHeight);

        Thread worker = new Thread(() =>
        {
            IntPtr hInput = OpenInputDesktop(0, false, 0x01FF);
            if (hInput != IntPtr.Zero)
            {
                SetThreadDesktop(hInput);
            }

            ImageCodecInfo jpgEncoder = null;
            foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders())
            {
                if (codec.FormatID == ImageFormat.Jpeg.Guid)
                {
                    jpgEncoder = codec;
                    break;
                }
            }

            EncoderParameters encParams = new EncoderParameters(1);
            encParams.Param[0] = new EncoderParameter(Encoder.Quality, (long)quality);

            Stream inStream = Console.OpenStandardInput();
            Stream outStream = Console.OpenStandardOutput();
            MemoryStream ms = new MemoryStream(512 * 1024);

            byte[] cmdBuf = new byte[1];

            while (true)
            {
                int r = inStream.Read(cmdBuf, 0, 1);
                if (r <= 0) break;

                // Command 2: Dynamic config change (quality & resolution)
                if (cmdBuf[0] == 2)
                {
                    int newQ = inStream.ReadByte();
                    byte[] dimBuf = new byte[4];
                    int rdDim = 0;
                    while (rdDim < 4)
                    {
                        int n = inStream.Read(dimBuf, rdDim, 4 - rdDim);
                        if (n <= 0) break;
                        rdDim += n;
                    }
                    if (rdDim == 4)
                    {
                        if (newQ > 0 && newQ <= 100)
                        {
                            quality = newQ;
                            encParams.Param[0] = new EncoderParameter(Encoder.Quality, (long)quality);
                        }
                        int nw = BitConverter.ToInt16(dimBuf, 0);
                        int nh = BitConverter.ToInt16(dimBuf, 2);
                        if (nw > 0) targetWidth = nw;
                        if (nh > 0) targetHeight = nh;
                    }
                    continue;
                }

                // Command 1: Capture and encode screen frame
                IntPtr curInput = OpenInputDesktop(0, false, 0x01FF);
                if (curInput != IntPtr.Zero)
                {
                    SetThreadDesktop(curInput);
                }

                IntPtr hdcScreen = GetDC(IntPtr.Zero);
                int w = GetDeviceCaps(hdcScreen, DESKTOPHORZRES);
                int h = GetDeviceCaps(hdcScreen, DESKTOPVERTRES);
                if (w <= 0) w = 1920;
                if (h <= 0) h = 1080;

                // Determine capture size
                int outW = w;
                int outH = h;
                bool needsScale = (w > targetWidth || h > targetHeight);
                if (needsScale)
                {
                    float scale = Math.Min((float)targetWidth / w, (float)targetHeight / h);
                    outW = Math.Max(1, (int)(w * scale));
                    outH = Math.Max(1, (int)(h * scale));
                }

                IntPtr hdcMem = CreateCompatibleDC(hdcScreen);
                IntPtr hBmp = CreateCompatibleBitmap(hdcScreen, outW, outH);
                IntPtr hOld = SelectObject(hdcMem, hBmp);

                if (needsScale)
                {
                    SetStretchBltMode(hdcMem, HALFTONE);
                    StretchBlt(hdcMem, 0, 0, outW, outH, hdcScreen, 0, 0, w, h, SRCCOPY);
                }
                else
                {
                    BitBlt(hdcMem, 0, 0, w, h, hdcScreen, 0, 0, SRCCOPY);
                }

                ms.SetLength(0);
                using (Bitmap srcBmp = Image.FromHbitmap(hBmp))
                {
                    srcBmp.Save(ms, jpgEncoder, encParams);
                }

                SelectObject(hdcMem, hOld);
                DeleteObject(hBmp);
                DeleteDC(hdcMem);
                ReleaseDC(IntPtr.Zero, hdcScreen);

                byte[] imgBytes = ms.ToArray();
                byte[] lenBytes = BitConverter.GetBytes(imgBytes.Length);

                outStream.Write(lenBytes, 0, 4);
                outStream.Write(imgBytes, 0, imgBytes.Length);
                outStream.Flush();
            }
        });

        worker.IsBackground = true;
        worker.Start();
        worker.Join();
    }
}
