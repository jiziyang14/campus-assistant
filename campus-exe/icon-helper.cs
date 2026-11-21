// 校园助手：给 Edge 应用窗口设置高清图标，解决 250% 缩放下任务栏/标题栏图标模糊。
// 编译（.NET Framework 4.8）：csc /nologo /target:winexe /out:icon-helper.exe icon-helper.cs
// 用法：icon-helper.exe <icon.ico 路径> <窗口标题 1> [窗口标题 2 ...]
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Program
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    private const uint WM_SETICON = 0x0080;
    private const int ICON_SMALL = 0;
    private const int ICON_BIG = 1;
    private const uint IMAGE_ICON = 1;
    private const uint LR_LOADFROMFILE = 0x0010;
    private const int SWP_NOSIZE = 0x0001;
    private const int SWP_NOMOVE = 0x0002;
    private const int SWP_NOZORDER = 0x0004;
    private const int SWP_NOACTIVATE = 0x0010;
    private const int SWP_FRAMECHANGED = 0x0020;

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int maxCount);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);

    private static List<IntPtr> matches = new List<IntPtr>();
    private static HashSet<string> titles = new HashSet<string>(StringComparer.Ordinal);
    private static IntPtr bigIcon = IntPtr.Zero;
    private static IntPtr smallIcon = IntPtr.Zero;

    private static bool Callback(IntPtr hWnd, IntPtr lParam)
    {
        if (!IsWindowVisible(hWnd))
        {
            return true;
        }
        StringBuilder className = new StringBuilder(64);
        GetClassName(hWnd, className, className.Capacity);
        if (className.ToString() != "Chrome_WidgetWin_1")
        {
            return true;
        }
        StringBuilder title = new StringBuilder(256);
        GetWindowText(hWnd, title, title.Capacity);
        if (!titles.Contains(title.ToString()))
        {
            return true;
        }
        if (!matches.Contains(hWnd))
        {
            matches.Add(hWnd);
        }
        return true;
    }

    private static void Apply(IntPtr hWnd)
    {
        SendMessage(hWnd, WM_SETICON, new IntPtr(ICON_BIG), bigIcon);
        SendMessage(hWnd, WM_SETICON, new IntPtr(ICON_SMALL), smallIcon);
        // 触发一次窗口框架重绘，让任务栏/标题栏尽快取到新图标
        SetWindowPos(hWnd, IntPtr.Zero, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }

    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            return 2;
        }
        string iconPath = args[0];
        for (int i = 1; i < args.Length; i++)
        {
            titles.Add(args[i]);
        }
        bigIcon = LoadImage(IntPtr.Zero, iconPath, IMAGE_ICON, 256, 256, LR_LOADFROMFILE);
        smallIcon = LoadImage(IntPtr.Zero, iconPath, IMAGE_ICON, 48, 48, LR_LOADFROMFILE);
        if (bigIcon == IntPtr.Zero && smallIcon == IntPtr.Zero)
        {
            return 3;
        }

        // 等窗口出现（最多 60 秒）
        DateTime deadline = DateTime.UtcNow.AddSeconds(60);
        while (DateTime.UtcNow < deadline && matches.Count == 0)
        {
            EnumWindows(Callback, IntPtr.Zero);
            if (matches.Count == 0)
            {
                Thread.Sleep(500);
            }
        }
        if (matches.Count == 0)
        {
            return 4;
        }

        // 连续设置 6 秒，覆盖 Edge 在 favicon 加载后再次设置图标的时机
        for (int round = 0; round < 12; round++)
        {
            for (int i = 0; i < matches.Count; i++)
            {
                Apply(matches[i]);
            }
            Thread.Sleep(500);
            // 新开窗口也补上
            EnumWindows(Callback, IntPtr.Zero);
        }
        return 0;
    }
}
