import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {NativeDebugError, integer} from './protocol.mjs';
const exec = promisify(execFile);
const DEADLINE_MS = 15000;

// The two possible hosts execute this same fixed code. No shell, child process,
// component activation, elevation or application-supplied script is involved.
// Microsoft: DebugBreakProcess, IsWow64Process, GetProcessTimes and
// CheckRemoteDebuggerPresent. IsWow64Process retains the existing x86/x64 scope;
// this does not certify every ARM64 emulation combination.
const declarations = `using System;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
public static class VB6DebugBreak {
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsWow64Process(IntPtr process,out bool wow64);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long creation,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CheckRemoteDebuggerPresent(IntPtr process,out bool present);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DebugBreakProcess(IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool success,string operation) {
    if(!success)throw new Win32Exception(Marshal.GetLastWin32Error(),operation+" failed");
  }
  public static string Request(uint pid,string expectedCreation) {
    IntPtr handle=OpenProcess(0x1F0FFF,false,pid);
    if(handle==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenProcess denied");
    try {
      long creation,exit,kernel,user;
      Check(GetProcessTimes(handle,out creation,out exit,out kernel,out user),"GetProcessTimes");
      string identity=creation.ToString("x16",CultureInfo.InvariantCulture);
      // The query and matching-bitness call own separate handles. A reused PID
      // must never redirect the already approved break to a different process.
      if(!String.IsNullOrEmpty(expectedCreation) && !String.Equals(identity,expectedCreation,StringComparison.Ordinal))throw new InvalidOperationException("Target process identity changed");
      bool wow64;
      Check(IsWow64Process(handle,out wow64),"IsWow64Process");
      if(!String.IsNullOrEmpty(expectedCreation) && (IntPtr.Size!=4 || !wow64))throw new InvalidOperationException("Matching x86 break helper is required");
      bool debugged;
      Check(CheckRemoteDebuggerPresent(handle,out debugged),"CheckRemoteDebuggerPresent");
      if(!debugged)throw new InvalidOperationException("Target is no longer being debugged");
      // Return a typed routing response instead of spawning a nested PowerShell
      // which execFile cannot directly own, cancel or reap.
      if(IntPtr.Size==8 && wow64)return "VB6_BREAK_ROUTE:"+pid.ToString(CultureInfo.InvariantCulture)+":"+identity;
      Check(DebugBreakProcess(handle),"DebugBreakProcess");
      return "VB6_BREAK_DONE:"+pid.ToString(CultureInfo.InvariantCulture)+":"+identity+":"+(IntPtr.Size*8).ToString(CultureInfo.InvariantCulture);
    } finally { Check(CloseHandle(handle),"CloseHandle"); }
  }
}`;

/** Issue one break from the actual target bitness. Both a successful helper
 * acknowledgement and a CDB stop are required by CdbSession. A helper timeout
 * is never silently accepted just because the target happened to stop.
 *
 * https://learn.microsoft.com/windows/win32/winprog64/debugging-wow64
 * https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes
 * https://nodejs.org/docs/latest-v22.x/api/child_process.html#child_processexecfilefile-args-options-callback
 */
export async function breakWindowsProcess(pid, {platform = process.platform, execute = exec, environment = process.env, architecture = process.arch, signal, now = () => performance.now()} = {}) {
  integer(pid, 'process ID', 1);
  if (platform !== 'win32') throw new NativeDebugError('A Windows host is required', 'WINDOWS_REQUIRED');
  signal?.throwIfAborted();
  const started = now(), phases = [];
  const root = environment.SystemRoot || 'C:\\Windows';
  const directory = architecture === 'ia32' && environment.PROCESSOR_ARCHITEW6432 ? 'Sysnative' : 'System32';
  const host = directory => path.win32.join(root, directory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const invoke = async (file, identity, phase) => {
    signal?.throwIfAborted();
    const timeout = Math.floor(DEADLINE_MS - (now() - started));
    if (timeout <= 0) throw Object.assign(new NativeDebugError('Native break deadline expired before '+phase, 'TIMEOUT'), {phase, elapsedMs: now()-started});
    // Only a validated integer and a strictly parsed hex FILETIME are inserted.
    // Suppress progress serialization and avoid management-module auto-loading:
    // there is no nested command, Test-Path, Join-Path or ConvertTo-Json here.
    const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type -TypeDefinition '${declarations}'; [Console]::Out.WriteLine([VB6DebugBreak]::Request(${pid},${identity ? "'"+identity+"'" : '$null'}))`;
    const phaseStarted = now();
    try {
      const {stdout} = await execute(file, ['-NoProfile', '-NonInteractive', '-Command', script], {windowsHide: true, shell: false, timeout, maxBuffer: 65536, signal});
      signal?.throwIfAborted();
      const text = String(stdout ?? '').trim();
      const result = /^VB6_BREAK_(ROUTE|DONE):([1-9][0-9]*):([0-9a-f]{16})(?::(32|64))?$/.exec(text);
      if (!result || result[2] !== String(pid) || (result[1] === 'DONE') !== !!result[4] || (identity && (result[1] !== 'DONE' || result[3] !== identity || result[4] !== '32'))) {
        throw new NativeDebugError('Invalid native break acknowledgement', 'BREAK_PROTOCOL');
      }
      phases.push({phase, elapsedMs: now()-phaseStarted});
      return {kind:result[1], identity:result[3], bitness:Number(result[4] || 0)};
    } catch (error) {
      // Preserve the original native/execFile error and exit/timeout details.
      // Diagnostics do not turn a missing acknowledgement into a success.
      error.phase = phase; error.elapsedMs = now()-started; error.breakPhases = phases.slice();
      throw error;
    }
  };
  let result = await invoke(host(directory), null, 'native-host');
  const routed = result.kind === 'ROUTE';
  if (routed) result = await invoke(host('SysWOW64'), result.identity, 'x86-host');
  return {pid, routed, bitness:result.bitness, elapsedMs:now()-started, phases};
}
