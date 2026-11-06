param([Parameter(Mandatory)][string]$Output)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class DesktopProbe {
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr value,int kind,StringBuilder name,uint bytes,out uint needed);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateWindowExW(uint extended,string name,string title,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr data);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetFocus();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    static string Name(IntPtr desktop) {
        var name=new StringBuilder(512);uint needed;
        if(!GetUserObjectInformationW(desktop,2,name,1024,out needed))throw new Win32Exception();
        return name.ToString();
    }
    public static object Run() {
        IntPtr input=OpenInputDesktop(0,false,1);
        if(input==IntPtr.Zero)throw new Win32Exception();
        try {
            IntPtr window=CreateWindowExW(0,"STATIC","Isolated focus probe",0x00cf0000,0,0,400,300,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
            if(window==IntPtr.Zero)throw new Win32Exception();
            try {
                ShowWindow(window,1);bool foreground=SetForegroundWindow(window);SetFocus(window);
                return new { desktop=Name(GetThreadDesktop(GetCurrentThreadId())),inputDesktop=Name(input),threadFocus=GetFocus()==window,foregroundAccepted=foreground };
            }finally{DestroyWindow(window);}
        }finally{CloseDesktop(input);}
    }
}
'@
[IO.File]::WriteAllText($Output,([DesktopProbe]::Run()|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
