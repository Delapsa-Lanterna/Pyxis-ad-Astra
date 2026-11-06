param([string]$Executable,[string]$Log,[string]$Arguments='',[string]$VerifyDesktop)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public static class DesktopHost {
    [StructLayout(LayoutKind.Sequential)]
    struct SecurityAttributes { public int size; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo {
        public int size;
        public string reserved, desktop, title;
        public int x, y, width, height, columns, rows, fill, flags;
        public short show, reservedBytes;
        public IntPtr reservedData, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    delegate bool WindowCallback(IntPtr window, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, ref SecurityAttributes security);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool SaferCreateLevel(uint scope, uint level, uint flags, out IntPtr handle, IntPtr reserved);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool SaferComputeTokenFromLevel(IntPtr level, IntPtr input, out IntPtr token, uint flags, IntPtr reserved);
    [DllImport("advapi32.dll")] static extern bool SaferCloseLevel(IntPtr level);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessAsUserW(IntPtr token, string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
    [DllImport("kernel32.dll")] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr desktop, WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr window, uint message, IntPtr w, IntPtr l);

    public static void VerifyReleased(string name) {
        // Verify the released owner's windows; Windows may retain an empty desktop object.
        var release = Stopwatch.StartNew();
        IntPtr remaining;
        while ((remaining = OpenDesktopW(name, 0, false, 0x41)) != IntPtr.Zero) {
            bool windows = false;
            EnumDesktopWindows(remaining, (window, data) => { windows = true; return true; }, IntPtr.Zero);
            CloseDesktop(remaining);
            if (!windows) break;
            if (release.Elapsed.TotalSeconds > 10) throw new TimeoutException("Native desktop still owns windows: " + name);
            Thread.Sleep(100);
        }
        Console.WriteLine("DESKTOP_RELEASED " + name);
    }

    public static int Run(string executable, string log, string arguments) {
        string name = "PyxisTesting-" + Guid.NewGuid().ToString("N");
        IntPtr descriptor;
        uint descriptorSize;
        string sid = System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW("D:(A;;GA;;;" + sid + ")(A;;GA;;;RC)(A;;GA;;;AC)S:(ML;;NW;;;LW)", 1, out descriptor, out descriptorSize)) throw new Win32Exception();
        var security = new SecurityAttributes { size = Marshal.SizeOf<SecurityAttributes>(), descriptor = descriptor, inherit = 1 };
        IntPtr desktop;
        try { desktop = CreateDesktopW(name, IntPtr.Zero, IntPtr.Zero, 0, 0x01ff, ref security); }
        finally { LocalFree(descriptor); }
        if (desktop == IntPtr.Zero) throw new Win32Exception();
        IntPtr input = CreateFileW("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
        if (input == new IntPtr(-1)) { CloseDesktop(desktop); throw new Win32Exception(); }
        IntPtr output = CreateFileW(log, 0x40000000, 3, IntPtr.Zero, 1, 0, IntPtr.Zero);
        if (output == new IntPtr(-1)) { CloseHandle(input); CloseDesktop(desktop); throw new Win32Exception(); }
        try {
            if (!SetHandleInformation(input, 1, 1)) throw new Win32Exception();
            if (!SetHandleInformation(output, 1, 1)) throw new Win32Exception();
            if (!SetHandleInformation(desktop, 1, 1)) throw new Win32Exception();
            var startup = new StartupInfo {
                size = Marshal.SizeOf<StartupInfo>(), desktop = "winsta0\\" + name,
                flags = 0x100, input = input, output = output, error = output
            };
            ProcessInfo info;
            var command = new StringBuilder("\"" + executable + "\" " + arguments);
            IntPtr level, token = IntPtr.Zero;
            if (!SaferCreateLevel(1, 0x20000, 1, out level, IntPtr.Zero)) throw new Win32Exception();
            try {
                if (!SaferComputeTokenFromLevel(level, IntPtr.Zero, out token, 0, IntPtr.Zero)) throw new Win32Exception();
                if (!CreateProcessAsUserW(token, executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000000, IntPtr.Zero, null, ref startup, out info)) throw new Win32Exception();
            } finally { CloseHandle(token); SaferCloseLevel(level); }
            CloseHandle(info.thread);
            try {
                using (var application = Process.GetProcessById((int)info.pid)) {
                    Console.WriteLine("DESKTOP_START {\"name\":\"" + name + "\",\"pid\":" + info.pid + "}");
                    Task finished = application.WaitForExitAsync();
                    Task.WhenAny(finished, Task.Run(() => Console.In.ReadLine())).GetAwaiter().GetResult();
                    if (!application.HasExited) {
                        EnumDesktopWindows(desktop, (window, data) => {
                            uint owner;
                            GetWindowThreadProcessId(window, out owner);
                            if (owner == info.pid) PostMessageW(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
                            return true;
                        }, IntPtr.Zero);
                    }
                    finished.GetAwaiter().GetResult();
                    return application.ExitCode;
                }
            } finally { CloseHandle(info.process); }
        } finally {
            CloseHandle(input);
            CloseHandle(output);
            if (!CloseDesktop(desktop)) throw new Win32Exception();
        }
    }
}
'@
if($VerifyDesktop){[DesktopHost]::VerifyReleased($VerifyDesktop);exit 0}
exit [DesktopHost]::Run($Executable,$Log,$Arguments)
