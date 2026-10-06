param([string]$Directory='reports/layout/native')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$cases=Get-Content -Raw (Join-Path $Directory 'winforms-reference.json')|ConvertFrom-Json
$checks=New-Object 'System.Collections.Generic.List[object]'
foreach($case in $cases){
 $parent=New-Object System.Windows.Forms.Panel
 $button=New-Object System.Windows.Forms.Button
 try{
  $parent.ClientSize=New-Object System.Drawing.Size(240,180)
  $button.AutoSize=$false
  $button.Bounds=New-Object System.Drawing.Rectangle(20,30,80,45)
  $parent.Controls.Add($button)
  $button.Anchor=[System.Windows.Forms.AnchorStyles]$case.mask
  foreach($step in $case.steps){
   $parent.ClientSize=New-Object System.Drawing.Size($step.width,$step.height)
   $parent.PerformLayout()
   $a=@($button.Left,$button.Top,$button.Width,$button.Height);$e=@($step.bounds.x,$step.bounds.y,$step.bounds.width,$step.bounds.height)
   for($i=0;$i -lt 4;$i++){if([Math]::Abs($a[$i]-$e[$i]) -gt 1){throw "WinForms mismatch mask=$($case.mask) size=$($step.width)x$($step.height) actual=$a expected=$e"}}
   $checks.Add(@{mask=$case.mask;width=$step.width;height=$step.height;actual=$a;expected=$e})
  }
 }finally{$button.Dispose();$parent.Dispose()}
}
@{ok=$true;framework=[Runtime.InteropServices.RuntimeInformation]::FrameworkDescription;checks=$checks}|ConvertTo-Json -Depth 6|Set-Content -Encoding utf8 (Join-Path $Directory 'winforms-reference-results.json')
Write-Host "PASS $($checks.Count) actual Windows Forms anchor comparisons"
