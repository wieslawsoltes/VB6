# Explicit local stdio transport. Do not expose this process through a network listener.
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'AutomationHost.cs'), (Join-Path $PSScriptRoot 'NativeDispatch.cs')) -ReferencedAssemblies System.Web.Extensions,System.Windows.Forms,System.Drawing
[VB6Interop.AutomationHost]::Run()
