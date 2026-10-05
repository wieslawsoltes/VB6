import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {NativeDebugError, integer} from './protocol.mjs';
const exec = promisify(execFile);

/** Invoke DebugBreakProcess from the target's bitness. A native 64-bit break in
 * WOW64 can be invisible to an x86 debugger. Query the actual target rather than
 * guessing from the Node process, CDB path, executable name or selected frame.
 * Only the validated PID is interpolated; no application-supplied script runs.
 * https://learn.microsoft.com/windows/win32/winprog64/debugging-wow64
 * https://learn.microsoft.com/windows/win32/api/wow64apiset/nf-wow64apiset-iswow64process
 */
export async function breakWindowsProcess(pid, {platform = process.platform, execute = exec, environment = process.env, architecture = process.arch} = {}) {
  integer(pid, 'process ID', 1);
  if (platform !== 'win32') throw new NativeDebugError('A Windows host is required', 'WINDOWS_REQUIRED');
  const root = environment.SystemRoot || 'C:\\Windows';
  const directory = architecture === 'ia32' && environment.PROCESSOR_ARCHITEW6432 ? 'Sysnative' : 'System32';
  const powershell = path.win32.join(root, directory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const declarations = 'using System; using System.Runtime.InteropServices; public static class VB6DebugBreak { [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid); [DllImport("kernel32.dll",SetLastError=true)] public static extern bool IsWow64Process(IntPtr process,out bool wow64); [DllImport("kernel32.dll",SetLastError=true)] public static extern bool DebugBreakProcess(IntPtr process); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle); }';
  const prefix = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition '${declarations}'; $h=[VB6DebugBreak]::OpenProcess(0x1F0FFF,$false,${pid}); if($h -eq [IntPtr]::Zero){throw ('OpenProcess denied: '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())};`;
  const direct = `${prefix} try { if(-not [VB6DebugBreak]::DebugBreakProcess($h)){throw ('DebugBreakProcess failed: '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())} } finally { [void][VB6DebugBreak]::CloseHandle($h) }`;
  // The child command is a fixed string, quoted as PowerShell data. It only runs
  // the same API call in the installed system x86 host, with no elevation.
  const script = `${prefix} $wow64=$false; try { if(-not [VB6DebugBreak]::IsWow64Process($h,[ref]$wow64)){throw 'Target bitness is unavailable'}; if([IntPtr]::Size -eq 8 -and $wow64){ $helper=Join-Path $env:SystemRoot 'SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe'; if(-not (Test-Path -LiteralPath $helper)){throw 'Matching x86 break helper is unavailable'}; & $helper -NoProfile -NonInteractive -Command '${direct.replaceAll("'", "''")}'; if($LASTEXITCODE -ne 0){throw 'x86 DebugBreakProcess failed'} } else { if(-not [VB6DebugBreak]::DebugBreakProcess($h)){throw ('DebugBreakProcess failed: '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())} } } finally { [void][VB6DebugBreak]::CloseHandle($h) }`;
  await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {windowsHide: true, timeout: 15000, maxBuffer: 65536});
}
