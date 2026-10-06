$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$paths = @(
  'AutomationHost.cs', 'NativeDispatch.cs', 'NativeEnumeration.cs',
  'OcxSupport.cs', 'OcxPersistence.cs', 'OcxContainer.cs'
) | ForEach-Object { Join-Path $PSScriptRoot $_ }
$paths += Join-Path $root 'tests/fixtures/ocx/ContainerContracts.cs'
Add-Type -Path $paths -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions,System.Core
try {
  [VB6Interop.AutomationHost]::RunOcxContainerContracts()
} catch {
  # Keep the native managed stack, not just PowerShell's invocation wrapper.
  $failure = $_.Exception
  while ($failure.InnerException) { $failure = $failure.InnerException }
  [Console]::Error.WriteLine($failure.ToString())
  throw
}
