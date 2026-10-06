# Explicit local stdio transport. Do not expose this process through a network listener.
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'AutomationHost.cs'), (Join-Path $PSScriptRoot 'OcxSupport.cs')) -ReferencedAssemblies System.Web.Extensions,System.Windows.Forms,System.Drawing,System.Core
[VB6Interop.AutomationHost]::Run()
