// 校园助手：给 Edge 应用窗口设置高清图标，解决任务栏/标题栏图标模糊。
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

    private const int SM_CXICON = 11;
    private const int SM_CYICON = 12;
    private const int SM_CXSMICON = 49;
    private const int SM_CYSMICON = 50;

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

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    private static List<IntPtr> matches = new List<IntPtr>();
    private static HashSet<string> titles = new HashSet<string>(StringComparer.Ordinal);
    private static Dictionary<int, IntPtr> smallIcons = new Dictionary<int, IntPtr>();
    private static IntPtr bigIcon = IntPtr.Zero;
    private static string iconFile = "";

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
        if (bigIcon != IntPtr.Zero)
        {
            SendMessage(hWnd, WM_SETICON, new IntPtr(ICON_BIG), bigIcon);
        }
        IntPtr small = SmallIconFor(hWnd);
        if (small != IntPtr.Zero)
        {
            SendMessage(hWnd, WM_SETICON, new IntPtr(ICON_SMALL), small);
        }
        // 触发一次窗口框架重绘，让任务栏/标题栏尽快取到新图标
        SetWindowPos(hWnd, IntPtr.Zero, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }

    /// <summary>按窗口所在显示器的缩放比例取任务栏实际绘制尺寸，避免 Windows 二次缩放导致发糊。</summary>
    private static int TaskbarSizeForWindow(IntPtr hWnd)
    {
        uint dpi = 0;
        try
        {
            dpi = GetDpiForWindow(hWnd);
        }
        catch (EntryPointNotFoundException)
        {
            // Windows 10 1607 之前没有这个接口，退回系统 DPI
        }
        if (dpi >= 96)
        {
            // 任务栏图标 100% 时为 24px：125%→30，150%→36，200%→48
            return Math.Max(16, (int)Math.Round(24.0 * dpi / 96.0));
        }
        int small = GetSystemMetrics(SM_CXSMICON);
        if (small <= 0)
        {
            small = 16;
        }
        return Math.Max(16, (int)Math.Round(small * 1.5));
    }

    /// <summary>同一窗口重复设置时复用已加载的 HICON。</summary>
    private static IntPtr SmallIconFor(IntPtr hWnd)
    {
        int size = TaskbarSizeForWindow(hWnd);
        IntPtr icon;
        if (smallIcons.TryGetValue(size, out icon))
        {
            return icon;
        }
        icon = LoadImage(IntPtr.Zero, iconFile, IMAGE_ICON, size, size, LR_LOADFROMFILE);
        if (icon == IntPtr.Zero)
        {
            int fallback = Math.Max(16, GetSystemMetrics(SM_CXSMICON));
            icon = LoadImage(IntPtr.Zero, iconFile, IMAGE_ICON, fallback, fallback, LR_LOADFROMFILE);
        }
        if (icon != IntPtr.Zero)
        {
            smallIcons[size] = icon;
        }
        return icon;
    }

    private static void EnableDpiAwareness()
    {
        try
        {
            // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
            if (SetProcessDpiAwarenessContext(new IntPtr(-4)))
            {
                return;
            }
        }
        catch (EntryPointNotFoundException)
        {
            // Windows 10 1703 之前没有这个接口
        }
        try
        {
            SetProcessDPIAware();
        }
        catch (EntryPointNotFoundException)
        {
            // 极旧系统忽略，仍按默认 DPI 取尺寸
        }
    }

    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            return 2;
        }
        EnableDpiAwareness();
        iconFile = args[0];
        for (int i = 1; i < args.Length; i++)
        {
            titles.Add(args[i]);
        }

        bigIcon = LoadImage(IntPtr.Zero, iconFile, IMAGE_ICON, 256, 256, LR_LOADFROMFILE);
        if (bigIcon == IntPtr.Zero)
        {
            bigIcon = LoadImage(IntPtr.Zero, iconFile, IMAGE_ICON, 128, 128, LR_LOADFROMFILE);
        }
        if (bigIcon == IntPtr.Zero)
        {
            bigIcon = LoadImage(IntPtr.Zero, iconFile, IMAGE_ICON, 48, 48, LR_LOADFROMFILE);
        }
        IntPtr probe = LoadImage(IntPtr.Zero, iconFile, IMAGE_ICON, 24, 24, LR_LOADFROMFILE);
        if (bigIcon == IntPtr.Zero && probe == IntPtr.Zero)
        {
            return 3;
        }
        if (probe != IntPtr.Zero)
        {
            smallIcons[24] = probe;
        }

        // 等窗口出现（最多 90 秒）：慢机器上页面标题可能很久才被设置
        DateTime deadline = DateTime.UtcNow.AddSeconds(90);
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

        // Edge 会在页面加载后用自己的 favicon 再覆盖一次图标，持续一段时间的重复设置才能稳定压住
        for (int round = 0; round < 90; round++)
        {
            EnumWindows(Callback, IntPtr.Zero);
            for (int i = 0; i < matches.Count; i++)
            {
                Apply(matches[i]);
            }
            Thread.Sleep(1000);
        }
        return 0;
    }
}
