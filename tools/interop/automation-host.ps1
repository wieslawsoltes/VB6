# Explicit local stdio transport. Do not expose this process through a network listener.
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'AutomationHost.cs'), (Join-Path $PSScriptRoot 'NativeDispatch.cs'), (Join-Path $PSScriptRoot 'NativeEnumeration.cs'), (Join-Path $PSScriptRoot 'OcxSupport.cs'), (Join-Path $PSScriptRoot 'OcxPersistence.cs'), (Join-Path $PSScriptRoot 'OcxContainer.cs'), (Join-Path $PSScriptRoot 'OcxPropertyBrowsing.cs')) -ReferencedAssemblies System.Web.Extensions,System.Windows.Forms,System.Drawing,System.Core
[VB6Interop.AutomationHost]::Run()
