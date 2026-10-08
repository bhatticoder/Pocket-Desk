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

    public static void Main(string[] args)
    {
        try { SetProcessDPIAware(); } catch { }

        int quality = 55;
        if (args.Length > 0) int.TryParse(args[0], out quality);
        if (quality <= 0 || quality > 100) quality = 55;

        int targetWidth = 1280;
        int targetHeight = 720;
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
            MemoryStream ms = new MemoryStream(256 * 1024);

            byte[] cmdBuf = new byte[1];

            while (true)
            {
                int r = inStream.Read(cmdBuf, 0, 1);
                if (r <= 0) break;

                // Re-bind to active input desktop if it changed
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

                IntPtr hdcMem = CreateCompatibleDC(hdcScreen);
                IntPtr hBmp = CreateCompatibleBitmap(hdcScreen, w, h);
                IntPtr hOld = SelectObject(hdcMem, hBmp);

                BitBlt(hdcMem, 0, 0, w, h, hdcScreen, 0, 0, SRCCOPY);

                using (Bitmap srcBmp = Image.FromHbitmap(hBmp))
                {
                    ms.SetLength(0);

                    // Resize if larger than target
                    if (w > targetWidth || h > targetHeight)
                    {
                        float scale = Math.Min((float)targetWidth / w, (float)targetHeight / h);
                        int scaledW = (int)(w * scale);
                        int scaledH = (int)(h * scale);
                        using (Bitmap resized = new Bitmap(scaledW, scaledH))
                        {
                            using (Graphics g = Graphics.FromImage(resized))
                            {
                                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                                g.DrawImage(srcBmp, 0, 0, scaledW, scaledH);
                            }
                            resized.Save(ms, jpgEncoder, encParams);
                        }
                    }
                    else
                    {
                        srcBmp.Save(ms, jpgEncoder, encParams);
                    }
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
