param([string]$Directory = 'validation/numeric')
$ErrorActionPreference='Stop'
# Windows verification only; exported applications have no CLR or script runtime.
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class NumericWindowsTest {
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
 [DllImport("user32.dll",EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr h,int index);
 [DllImport("gdi32.dll",EntryPoint="GetObjectW")] public static extern int GetFontObject(IntPtr h,int size,byte[] bytes);
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

function Diagnostic($p) {
 return @([NumericWindowsTest]::Windows($p.Id)|ForEach-Object { [NumericWindowsTest]::Text($_); [NumericWindowsTest]::Children($_)|ForEach-Object { [NumericWindowsTest]::Text($_) } }) -join ' '
}
function WaitForm($p) {
 $script:form=[IntPtr]::Zero
 Until { $script:form=([NumericWindowsTest]::Windows($p.Id)|Where-Object { [NumericWindowsTest]::Class($_) -eq 'VB6.Native.frmCalculator' }|Select-Object -First 1);$script:form -and [NumericWindowsTest]::IsWindowVisible($script:form) } 'Calculator native form'
 return $script:form
}
function Click([int]$id) {
 $button=[NumericWindowsTest]::GetDlgItem($script:form,$id)
 if(-not [NumericWindowsTest]::PostMessage($button,0xf5,[IntPtr]::Zero,[IntPtr]::Zero)){throw "Could not click button $id"}
 # Preserve event ordering and allow the cooperative dialog/error path to run.
 Start-Sleep -Milliseconds 35
}
function Digits([string]$value) {
 foreach($char in $value.ToCharArray()) { if($char -eq '.') { Click 115 } else { Click (101+[int]::Parse([string]$char)) } }
}
function Display([string]$expected,[string]$name) {
 try { Until { [NumericWindowsTest]::Text($script:display) -ceq $expected } $name }
 catch { throw ($name+': expected ['+$expected+'] actual ['+[NumericWindowsTest]::Text($script:display)+'] '+(Diagnostic $script:app)) }
 Check $name $true
}
try {
 $p=Launch 'AotNumbers'
 $exited=$p.WaitForExit(30000)
 if(-not $exited){throw ('Numeric program did not exit: '+(Diagnostic $p))}
 Check ('62 native floating/ABI/array/error assertions and 2000 FPU recursion cycles; exit '+$p.ExitCode) ($p.ExitCode -eq 0)
 $script:app=Launch 'Calculator';$script:form=WaitForm $app;$script:display=[NumericWindowsTest]::GetDlgItem($form,100)
 Check 'Calculator uses native EDIT control' ([NumericWindowsTest]::Class($display) -eq 'Edit')
 Check 'Calculator display retains right alignment' (([NumericWindowsTest]::GetWindowLong($display,-16) -band 3) -eq 2)
 $font=[NumericWindowsTest]::SendMessage($display,0x31,[IntPtr]::Zero,[IntPtr]::Zero);$fontBytes=[byte[]]::new(92)
 Check 'Calculator design font is applied to native edit' ($font -ne [IntPtr]::Zero -and [NumericWindowsTest]::GetFontObject($font,92,$fontBytes) -eq 92 -and [BitConverter]::ToInt32($fontBytes,0) -le -20)
 Display '0' 'Form_Load initializes display'
 $buttons=@([NumericWindowsTest]::Children($form)|Where-Object { [NumericWindowsTest]::Class($_) -eq 'Button' })
 Check 'all 17 native Calculator button HWNDs are independent' ($buttons.Count -eq 17 -and @($buttons|Select-Object -Unique).Count -eq 17)
 foreach($digit in 0..9){Click 117;Click (101+$digit);Display ([string]$digit) ('digit '+$digit+' uses its Index event argument')}
 Click 117;Digits '1.5';Click 111;Digits '2.25';Click 116;Display '3.75' 'fractional addition'
 Click 117;Digits '2.25';Click 112;Digits '4.5';Click 116;Display '-2.25' 'fractional subtraction and negative display'
 Click 117;Digits '1.5';Click 113;Digits '2.5';Click 116;Display '3.75' 'fractional multiplication'
 Click 117;Digits '3';Click 114;Digits '2';Click 116;Display '1.5' 'division is not integer truncation'
 Click 117;Digits '3000000000';Click 111;Digits '0.5';Click 116;Display '3000000000.5' 'Double values beyond Long storage range'
 Click 117;Digits '1.2';Click 115;Digits '3';Display '1.23' 'InStr prevents duplicate decimal point'
 Click 117;Digits '5';Click 114;Digits '0';Click 116
 $script:dialog=[IntPtr]::Zero
 Until { $script:dialog=([NumericWindowsTest]::Windows($app.Id)|Where-Object { [NumericWindowsTest]::Class($_) -eq '#32770' }|Select-Object -First 1);$script:dialog -and [NumericWindowsTest]::IsWindowVisible($script:dialog) } 'Calculator division error handler'
 $message=@([NumericWindowsTest]::Children($dialog)|ForEach-Object { [NumericWindowsTest]::Text($_) }) -join ' '
 Check 'On Error displays the original Calculator diagnostic' ($message -match 'Division by zero' -and [NumericWindowsTest]::Text($dialog) -eq 'Calculator')
 [NumericWindowsTest]::PostMessage($dialog,0x10,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 Until { -not [NumericWindowsTest]::IsWindow($script:dialog) } 'dismiss identified Calculator dialog'
 Click 117;Digits '7';Click 111;Digits '0.5';Click 116;Display '7.5' 'Calculator recovers after division-by-zero'
 [NumericWindowsTest]::PostMessage($form,0x10,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 Check 'Calculator closes cleanly' ($app.WaitForExit(15000) -and $app.ExitCode -eq 0)
 $script:app=Launch 'AotIndexedControls';$script:form=WaitForm $app;$script:display=[NumericWindowsTest]::GetDlgItem($form,100)
 Display 'INDEXED OK' 'control array Count, bounds, Index, writes and error 340'
 Click 108;Display 'D7' 'indexed caption read and Index callback'
 Click 110;Display 'D9' 'distinct indexed element state'
 [NumericWindowsTest]::PostMessage($form,0x10,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
 Check 'indexed controls close cleanly' ($app.WaitForExit(15000) -and $app.ExitCode -eq 0)
 $report=@{ok=$true;checks=$checks;architecture=$env:PROCESSOR_ARCHITECTURE}
} catch { $report=@{ok=$false;checks=$checks;error=$_.ToString()};throw }
finally {
 foreach($p in $processes){try{if(-not $p.HasExited){$p.Kill($true)}}catch{}}
 $report|ConvertTo-Json -Depth 8|Set-Content -Encoding utf8 (Join-Path $Directory 'numeric-windows-results.json')
}
