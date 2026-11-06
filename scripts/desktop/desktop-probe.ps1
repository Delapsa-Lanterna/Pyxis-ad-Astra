param([Parameter(Mandatory)][string]$Output,[switch]$WaitForClose)
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
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr window,UIntPtr id,uint milliseconds,IntPtr callback);
    [DllImport("user32.dll")] static extern int GetMessageW(IntPtr message,IntPtr window,uint minimum,uint maximum);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessageW(IntPtr message);
    static string Name(IntPtr desktop) {
        var name=new StringBuilder(512);uint needed;
        if(!GetUserObjectInformationW(desktop,2,name,1024,out needed))throw new Win32Exception();
        return name.ToString();
    }
    public static object Run(bool waitForClose) {
        IntPtr input=OpenInputDesktop(0,false,1);
        if(input==IntPtr.Zero)throw new Win32Exception();
        try {
            IntPtr window=CreateWindowExW(0,"STATIC","Desktop focus probe",0x00cf0000,0,0,400,300,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
            if(window==IntPtr.Zero)throw new Win32Exception();
            try {
                ShowWindow(window,1);bool foreground=SetForegroundWindow(window);SetFocus(window);
                var result=new { desktop=Name(GetThreadDesktop(GetCurrentThreadId())),inputDesktop=Name(input),threadFocus=GetFocus()==window,foregroundAccepted=foreground };
                if(waitForClose){
                    if(SetTimer(window,new UIntPtr(1),10000,IntPtr.Zero)==UIntPtr.Zero)throw new Win32Exception();
                    IntPtr message=Marshal.AllocHGlobal(64);
                    try{
                        Console.WriteLine("PROBE_READY");
                        while(IsWindow(window)&&GetMessageW(message,IntPtr.Zero,0,0)>0){
                            if(Marshal.ReadInt32(message,IntPtr.Size)==0x0113)throw new TimeoutException("Owned window did not close");
                            DispatchMessageW(message);
                        }
                    }finally{Marshal.FreeHGlobal(message);}
                }
                return result;
            }finally{if(IsWindow(window))DestroyWindow(window);}
        }finally{CloseDesktop(input);}
    }
}
'@
[IO.File]::WriteAllText($Output,([DesktopProbe]::Run($WaitForClose.IsPresent)|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
