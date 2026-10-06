param([string]$Directory='reports/layout/native')
$ErrorActionPreference='Stop'
# Harness only: tested applications contain native x86 code, no CLR or JS runtime.
Add-Type @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;
public static class LayoutWindows {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]public struct Rect{public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc f,IntPtr p);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);
 [DllImport("user32.dll")]public static extern IntPtr GetDlgItem(IntPtr h,int id);
 [DllImport("user32.dll")]public static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect rect);
 [DllImport("user32.dll")]public static extern bool GetClientRect(IntPtr h,out Rect rect);
 [DllImport("user32.dll")]public static extern int MapWindowPoints(IntPtr from,IntPtr to,ref Rect rect,uint points);
 [DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode)]public static extern IntPtr SendTextMessage(IntPtr h,uint m,IntPtr w,StringBuilder text,uint flags,uint timeout,out UIntPtr result);
 public static IntPtr[] Windows(int pid){var list=new List<IntPtr>();EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid)list.Add(h);return true;},IntPtr.Zero);return list.ToArray();}
 public static string Class(IntPtr h){var b=new StringBuilder(256);GetClassName(h,b,256);return b.ToString();}
 public static string Text(IntPtr h){var b=new StringBuilder(4096);UIntPtr r;return SendTextMessage(h,13,(IntPtr)b.Capacity,b,2,1000,out r)==IntPtr.Zero?"":b.ToString();}
 public static int[] Bounds(IntPtr h){Rect r;GetWindowRect(h,out r);MapWindowPoints(IntPtr.Zero,GetParent(h),ref r,2);return new[]{r.Left,r.Top,r.Right-r.Left,r.Bottom-r.Top};}
 public static int[] Client(IntPtr h){Rect r;GetClientRect(h,out r);return new[]{r.Right,r.Bottom};}
 public static bool Resize(IntPtr h,int w,int height){Rect a,b;GetClientRect(h,out a);GetWindowRect(h,out b);return SetWindowPos(h,IntPtr.Zero,0,0,w+b.Right-b.Left-a.Right,height+b.Bottom-b.Top-a.Bottom,0x16);}
}
'@
$checks=[System.Collections.Generic.List[string]]::new();$processes=[System.Collections.Generic.List[System.Diagnostics.Process]]::new();$temp=[System.Collections.Generic.List[string]]::new();$report=@{ok=$false}
function Check([string]$Name,[bool]$Value){if(-not $Value){throw "Failed: $Name"};$checks.Add($Name);Write-Host "PASS $Name"}
function Until([scriptblock]$Condition,[string]$Name){$end=[DateTime]::UtcNow.AddSeconds(15);do{if(& $Condition){return};Start-Sleep -Milliseconds 30}while([DateTime]::UtcNow -lt $end);throw "Timed out: $Name"}
try{
 $cases=Get-Content -Raw (Join-Path $Directory 'cases.json')|ConvertFrom-Json
 foreach($case in $cases){
  $dir=Join-Path ([IO.Path]::GetTempPath()) ('vb6-layout-'+[Guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($dir)|Out-Null;$temp.Add($dir)
  $exe=Join-Path $dir ($case.name+'.exe');Copy-Item (Join-Path $Directory ($case.name+'.exe')) $exe;$process=Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru;$null=$process.Handle;$processes.Add($process)
  $script:form=[IntPtr]::Zero
  Until {foreach($h in [LayoutWindows]::Windows($process.Id)){if([LayoutWindows]::Class($h) -eq 'VB6.Native.Form1' -and [LayoutWindows]::Text($h) -eq 'Layout ready'){$script:form=$h;return $true}};if($process.HasExited){throw "$($case.name) exited early: $($process.ExitCode)"};return $false} ($case.name+' load')
  $handles=@{};$remaining=@($case.controls)
  while($remaining.Count){$next=@();foreach($c in $remaining){if($c.parent -and -not $handles.ContainsKey($c.parent)){$next+=,$c;continue};$parent=$form;if($c.parent){$parent=$handles[$c.parent]};$h=[LayoutWindows]::GetDlgItem($parent,$c.id);Check ($case.name+' HWND '+$c.name) ($h -ne [IntPtr]::Zero);$handles[$c.name]=$h};if($next.Count -eq $remaining.Count){throw 'Unresolved container graph'};$remaining=$next}
  foreach($step in $case.steps){
   Check ($case.name+' resize request') ([LayoutWindows]::Resize($form,($step.width/15),($step.height/15)))
   Until {$size=[LayoutWindows]::Client($form);$size[0] -eq $step.width/15 -and $size[1] -eq $step.height/15} ($case.name+' client resize')
   # Window-position calls are synchronous on the UI thread; query through a
   # bounded window message before observing the complete parent-first layout.
   $null=[LayoutWindows]::Text($form)
   foreach($b in $step.bounds){$actual=[LayoutWindows]::Bounds($handles[$b.name]);$expected=@($b.x,$b.y,$b.width,$b.height);$ok=$true;for($i=0;$i -lt 4;$i++){if([Math]::Abs($actual[$i]-$expected[$i]/15) -gt 1){$ok=$false}};Check ($case.name+' '+$step.width+'x'+$step.height+' '+$b.name+' ['+($actual -join ',')+']') $ok}
  }
  if($case.live){Check 'post native code event' ([LayoutWindows]::PostMessage($form,0x111,[IntPtr]101,$handles['Change']));Until {[LayoutWindows]::Text($form) -eq 'Layout code passed'} 'native code Anchor/Dock/Move/limits/suspend/resume';$b=[LayoutWindows]::Bounds($handles['Target']);Check 'code geometry applied to native HWND' ([Math]::Abs($b[0]-190) -le 1 -and [Math]::Abs($b[1]-120) -le 1)}
  $process.Kill($true);$process.WaitForExit(5000)|Out-Null
 }
 $report=@{ok=$true;architecture=$env:PROCESSOR_ARCHITECTURE;cases=$cases.Count;checks=$checks}
}catch{$report=@{ok=$false;checks=$checks;error=$_.ToString()};throw}
finally{foreach($p in $processes){try{if(-not $p.HasExited){$p.Kill($true)}}catch{}};foreach($dir in $temp){Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue};$report|ConvertTo-Json -Depth 8|Set-Content -Encoding utf8 (Join-Path $Directory 'windows-layout-results.json')}
