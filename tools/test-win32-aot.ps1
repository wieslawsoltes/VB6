param([string]$Directory = 'validation/win32')
$ErrorActionPreference = 'Stop'
# Test harness only: emitted applications contain no C#/PowerShell code or CLR dependency.
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class AotWindowsTest {
 public delegate bool EnumProc(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
 [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
 [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode)] public static extern IntPtr SendTextMessage(IntPtr h, uint m, IntPtr w, StringBuilder text, uint flags, uint timeout, out UIntPtr result);
 public static IntPtr[] Windows(int pid) { var list=new List<IntPtr>(); EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid)list.Add(h);return true;},IntPtr.Zero);return list.ToArray(); }
 public static IntPtr[] Children(IntPtr parent) {var list=new List<IntPtr>();EnumChildWindows(parent,(h,p)=>{list.Add(h);return true;},IntPtr.Zero);return list.ToArray();}
 public static string Text(IntPtr h){var b=new StringBuilder(4096);UIntPtr result;return SendTextMessage(h,0x0D,(IntPtr)b.Capacity,b,2,1000,out result)==IntPtr.Zero?"":b.ToString();}
 public static string Class(IntPtr h){var b=new StringBuilder(256);GetClassName(h,b,b.Capacity);return b.ToString();}
}
'@
$checks = [System.Collections.Generic.List[string]]::new()
$processes = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
function Check([string]$Name, [bool]$Value) { if(-not $Value) { throw "Failed: $Name" }; $checks.Add($Name); Write-Host "PASS $Name" }
function Until([scriptblock]$Condition,[string]$Name) { $end=[DateTime]::UtcNow.AddSeconds(15); do { if(& $Condition){return};Start-Sleep -Milliseconds 40 }while([DateTime]::UtcNow -lt $end);throw "Timed out: $Name" }
function Launch([string]$Name) {
 $file=(Resolve-Path (Join-Path $Directory ($Name+'.exe'))).Path
 # Put just the EXE in an empty folder: no adjacent JS, runtimes, DLLs, or project files.
 $clean=Join-Path ([IO.Path]::GetTempPath()) ('vb6-aot-'+[Guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($clean)|Out-Null
 $isolated=Join-Path $clean ($Name+'.exe');Copy-Item $file $isolated
 $p=Start-Process -FilePath $isolated -WorkingDirectory $clean -PassThru
 # Retain the process handle before exit so ExitCode remains available after dialog dismissal.
 $null=$p.Handle;$processes.Add($p);return $p
}
try {
 $p=Launch 'AotArithmetic'
 Check 'native arithmetic and Declare executable exits' ($p.WaitForExit(15000))
 Check ('native arithmetic, recursion, ByRef, strings, branch/loop, Declare result '+$p.ExitCode) ($p.ExitCode -eq 0)
 foreach($name in @('AotStorage','AotErrors')) {
  $p=Launch $name
  Check ($name+' self-checking native program exits') ($p.WaitForExit(20000))
  Check ($name+' ownership, storage and control-flow assertions; actual '+$p.ExitCode) ($p.ExitCode -eq 0)
 }
 $gui=Launch 'AotWindows';$script:window=[IntPtr]::Zero
 Until { $script:window=([AotWindowsTest]::Windows($gui.Id)|Where-Object { [AotWindowsTest]::Class($_) -eq 'VB6.Native.Form1' }|Select-Object -First 1);$script:window -and [AotWindowsTest]::IsWindowVisible($script:window) } 'native form'
 Check 'native top-level window' ([AotWindowsTest]::IsWindow($window))
 $button=[AotWindowsTest]::GetDlgItem($window,100);$text=[AotWindowsTest]::GetDlgItem($window,101)
 Check 'actual native BUTTON class' ([AotWindowsTest]::Class($button) -eq 'Button')
 Check 'actual native EDIT class' ([AotWindowsTest]::Class($text) -eq 'Edit')
 [AotWindowsTest]::PostMessage($button,0xf5,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 Until { [AotWindowsTest]::Text($text) -eq '42' } 'button event and native text'
 Check 'native caption string expression' ([AotWindowsTest]::Text($window) -eq 'Counter 42')
 $list=[AotWindowsTest]::GetDlgItem($window,104);$combo=[AotWindowsTest]::GetDlgItem($window,105)
 Check 'native ListBox AddItem' ([AotWindowsTest]::SendMessage($list,0x18b,[IntPtr]::Zero,[IntPtr]::Zero).ToInt64() -eq 3)
 Check 'native ComboBox selection' ([AotWindowsTest]::SendMessage($combo,0x147,[IntPtr]::Zero,[IntPtr]::Zero).ToInt64() -eq 1)
 [AotWindowsTest]::PostMessage($window,0x111,[IntPtr]10000,[IntPtr]::Zero)|Out-Null
 Until { [AotWindowsTest]::Text($text) -eq 'Native menu' } 'native menu event'
 Check 'native menu command' $true
 $outerFrame=[AotWindowsTest]::GetDlgItem($window,106);$innerFrame=[AotWindowsTest]::GetDlgItem($outerFrame,107);$nestedButton=[AotWindowsTest]::GetDlgItem($innerFrame,108)
 Check 'nested controls have actual Frame parent HWNDs' ([AotWindowsTest]::IsWindow($nestedButton) -and [AotWindowsTest]::GetParent($nestedButton) -eq $innerFrame -and [AotWindowsTest]::GetParent($innerFrame) -eq $outerFrame)
 [AotWindowsTest]::PostMessage($nestedButton,0xf5,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 Until { [AotWindowsTest]::Text($text) -eq 'Nested native frame' } 'nested control command forwarding'
 Check 'native Frame forwards child events without flattening parentage' $true
 [AotWindowsTest]::PostMessage($window,0x10,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null;Start-Sleep -Milliseconds 200
 Check 'QueryUnload cancels native close' ([AotWindowsTest]::IsWindow($window))
 [AotWindowsTest]::PostMessage([AotWindowsTest]::GetDlgItem($window,102),0xf5,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 $script:modal=[IntPtr]::Zero
 Until { $script:modal=([AotWindowsTest]::Windows($gui.Id)|Where-Object { [AotWindowsTest]::Class($_) -eq 'VB6.Native.Form2' }|Select-Object -First 1);$script:modal -and [AotWindowsTest]::IsWindowVisible($script:modal) } 'modal window'
 Check 'modal blocks native owner' (-not [AotWindowsTest]::IsWindowEnabled($window))
 [AotWindowsTest]::PostMessage([AotWindowsTest]::GetDlgItem($modal,100),0xf5,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 Until { [AotWindowsTest]::Text($text) -eq 'Modal returned' } 'modal call resumes'
 Check 'modal restores original enabled state' ([AotWindowsTest]::IsWindowEnabled($window))
 [AotWindowsTest]::PostMessage([AotWindowsTest]::GetDlgItem($window,103),0xf5,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null;Start-Sleep -Milliseconds 80
 [AotWindowsTest]::PostMessage($window,0x10,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 Check 'last native form unload exits process' ($gui.WaitForExit(15000))
 Check 'native UI exit code' ($gui.ExitCode -eq 0)
 $mdi=Launch 'AotMDI';$script:frame=[IntPtr]::Zero
 Until { $script:frame=([AotWindowsTest]::Windows($mdi.Id)|Where-Object { [AotWindowsTest]::Class($_) -eq 'VB6.Native.Form1' }|Select-Object -First 1);$script:frame -and [AotWindowsTest]::IsWindowVisible($script:frame) } 'MDI parent'
 $client=[AotWindowsTest]::GetDlgItem($frame,1)
 Check 'native MDICLIENT class' ([AotWindowsTest]::Class($client) -eq 'MDIClient')
 $children=@([AotWindowsTest]::Children($client)|Where-Object { [AotWindowsTest]::Class($_) -like 'VB6.Native.*' })
 Check 'two genuine MDI child HWNDs' ($children.Count -eq 2)
 foreach($child in $children) { Check ('MDI parent HWND '+$child) ([AotWindowsTest]::GetParent($child) -eq $client) }
 [AotWindowsTest]::PostMessage([AotWindowsTest]::GetDlgItem($children[0],100),0xf5,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 Until { [AotWindowsTest]::Text($children[0]) -eq 'Native MDI event' } 'MDI child event'
 Check 'MDI child event dispatch' $true
 [AotWindowsTest]::PostMessage($children[0],0x10,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 Until { -not [AotWindowsTest]::IsWindow($children[0]) } 'MDI child destroy'
 Check 'closing child preserves frame and sibling' ([AotWindowsTest]::IsWindow($frame) -and [AotWindowsTest]::IsWindow($children[1]))
 [AotWindowsTest]::PostMessage($frame,0x10,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 Check 'MDI frame shutdown' ($mdi.WaitForExit(15000))
 Check 'MDI exit code' ($mdi.ExitCode -eq 0)
 foreach($fault in @(@('AotOverflow',6),@('AotDivideZero',11),@('AotTextOverflow',6),@('AotTextMismatch',13),@('AotArrayBounds',9),@('AotResumeWithoutError',20),@('AotDisabledHandler',9))) {
  $p=Launch $fault[0];$script:errorWindow=[IntPtr]::Zero
  Until { $script:errorWindow=([AotWindowsTest]::Windows($p.Id)|Where-Object { [AotWindowsTest]::Class($_) -eq '#32770' }|Select-Object -First 1);$script:errorWindow -and [AotWindowsTest]::IsWindowVisible($script:errorWindow) } ('runtime diagnostic '+$fault[0])
  $text=@([AotWindowsTest]::Children($errorWindow)|ForEach-Object { [AotWindowsTest]::Text($_) }) -join ' '
  Check ($fault[0]+' error message') ($text.Contains('Run-time error '+$fault[1]))
  # Dismiss the verified dialog belonging to this test process; do not assume an OK button ID.
  $posted=[AotWindowsTest]::PostMessage($errorWindow,0x10,[IntPtr]::Zero,[IntPtr]::Zero)
  if(-not $posted){throw ('Could not dismiss runtime diagnostic '+$fault[0])}
  $exited=$p.WaitForExit(15000)
  Write-Host ('FAULT '+$fault[0]+' exited='+$exited+' actual='+$p.ExitCode+' expected='+$fault[1])
  Check ($fault[0]+' exits with documented error') ($exited -and $p.ExitCode -eq $fault[1])
 }
 $report=@{ok=$true;architecture=$env:PROCESSOR_ARCHITECTURE;checks=$checks}
} catch { $report=@{ok=$false;checks=$checks;error=$_.ToString()};throw }
finally {
 foreach($p in $processes){try{if(-not $p.HasExited){$p.Kill($true)}}catch{}}
 $report|ConvertTo-Json -Depth 8|Set-Content -Encoding utf8 (Join-Path $Directory 'windows-runtime-results.json')
}
