import {EventEmitter} from 'node:events';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export {breakWindowsProcess} from './windows-break.mjs';
import {breakWindowsProcess} from './windows-break.mjs';
import {NativeDebugError, integer, address, symbol, expression, location, parseProcesses, parseThreads, parseRegisters, parseMemory, parseStack, debuggerFailure} from './protocol.mjs';
const exec = promisify(execFile);
const PROMPT = /(?:^|\r?\n)(\d+):([0-9a-f]+)(?::([a-z0-9]+))?>\s*$/i;
const MAX_OUTPUT = 2 * 1024 * 1024;

export async function findCdb(configured = process.env.VB6_CDB_PATH) {
  if (process.platform !== 'win32') throw new NativeDebugError('Native Windows debugging requires a Windows host', 'WINDOWS_REQUIRED');
  const candidates = configured ? [configured] : [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'Debuggers', process.arch === 'arm64' ? 'arm64' : 'x64', 'cdb.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'Debuggers', 'x86', 'cdb.exe')
  ];
  for (const candidate of candidates) { try { const file = await fs.realpath(candidate); if (path.isAbsolute(file) && path.basename(file).toLowerCase() === 'cdb.exe' && (await fs.stat(file)).isFile()) return file; } catch {} }
  throw new NativeDebugError('Install Microsoft Debugging Tools for Windows, or set VB6_CDB_PATH to its cdb.exe', 'CDB_NOT_FOUND');
}
export async function listWindowsProcesses() {
  if (process.platform !== 'win32') throw new NativeDebugError('A Windows host is required', 'WINDOWS_REQUIRED');
  const {stdout} = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process | Select-Object Id,ProcessName | ConvertTo-Json -Compress'], {windowsHide: true, timeout: 10000, maxBuffer: MAX_OUTPUT});
  const items = JSON.parse(stdout || '[]');
  return (Array.isArray(items) ? items : [items]).map(p => ({pid: p.Id, name: p.ProcessName}));
}

/** Single Windows debugger process. CDB supplies native x86/x64/WOW64 stack,
 * symbols and machine instructions; the bridge does not pretend these are VB6
 * P-code interpreter frames. One session has one serialized command stream. */
export class CdbSession extends EventEmitter {
  constructor({cdbPath, spawnProcess = spawn, breakProcess = breakWindowsProcess, timeout = 15000, platform = process.platform} = {}) {
    super(); this.cdbPath = cdbPath; this.spawnProcess = spawnProcess; this.breakProcess = breakProcess;
    this.timeout = integer(timeout, 'command timeout', 100, 120000); this.platform = platform;
    this.generation = 0; this.processIds = new Map(); this.operations = Promise.resolve(); this.state = 'new'; this.pauseId = 0; this.queue = Promise.resolve(); this.buffer = ''; this.pending = null; this.breakpoints = new Map(); this.sequence = 0;
  }
  snapshot() { return {state: this.state, stepMode:this.stepMode||'assembly', pauseId: this.pauseId, pid: this.pid ?? null, targetPid: this.targetPid ?? null, processIndex: this.processIndex ?? 0, threadIndex: this.threadIndex ?? 0, breakpoints: [...this.breakpoints.values()].map(value=>({...value}))}; }
  setState(state) { this.state = state; this.emit('state', this.snapshot()); }
  async start({pid, executable, args = [], debugChildren = false} = {}) {
    if (this.state !== 'new') throw new NativeDebugError('Debugger session already started', 'INVALID_STATE');
    if (this.platform !== 'win32') throw new NativeDebugError('A Windows host is required', 'WINDOWS_REQUIRED');
    if ((pid !== undefined) === (executable !== undefined)) throw new NativeDebugError('Choose a process ID or an executable, not both', 'INVALID_ARGUMENT');
    if (pid !== undefined) this.pid = this.targetPid = integer(pid, 'process ID', 1);
    if (!Array.isArray(args) || args.length > 128 || args.some(s => typeof s !== 'string' || s.length > 8192 || s.includes('\0'))) throw new NativeDebugError('Invalid application arguments', 'INVALID_ARGUMENT');
    if (typeof debugChildren !== 'boolean') throw new NativeDebugError('Invalid child-process option', 'INVALID_ARGUMENT');
    if (executable !== undefined) {
      if (typeof executable !== 'string' || !path.win32.isAbsolute(executable) || !/\.exe$/i.test(executable) || /[\0\r\n]/.test(executable)) throw new NativeDebugError('Select an absolute Windows executable path', 'INVALID_ARGUMENT');
    }
    const generation = ++this.generation;
    const check = () => { if (generation !== this.generation) throw new NativeDebugError('Debugger startup was cancelled', 'DEBUGGER_EXITED'); };
    this.setState('starting');
    try {
      if (executable !== undefined && this.platform === process.platform) { executable = await fs.realpath(executable); check(); if (!(await fs.stat(executable)).isFile()) throw new NativeDebugError('Executable not found'); check(); }
      const cdb = this.cdbPath || await findCdb(); check();
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vb6-debugger-'));
      if (generation !== this.generation) { await fs.rm(directory, {recursive:true, force:true}); check(); }
      this.directory = directory;
      const initial = path.join(directory, 'initial.txt'); await fs.writeFile(initial, '', {mode: 0o600}); check();
      const argv = ['-pd', '-G', '-ee', 'masm', '-lines', '-noshell', '-noinh', '-nosqm', '-sins', '-netsyms:no', '-cf', initial];
      if (debugChildren) argv.push('-o');
      if (pid !== undefined) argv.push('-p', String(pid)); else argv.push(executable, ...args);
      this.child = this.spawnProcess(cdb, argv, {cwd: this.directory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false});
      this.child.stdout.on('data', bytes => this.receive(bytes));
      this.child.stderr.on('data', bytes => this.receive(bytes));
      this.child.on('error', error => this.fail(error));
      this.child.on('exit', (code, signal) => { this.settlePending(new NativeDebugError('Debugger exited', 'DEBUGGER_EXITED')); if (this.state !== 'closed') { this.setState('closed'); this.emit('closed', {code, signal}); } this.cleanup(); });
      await this.waitPaused();
      if (debugChildren) await this.command('.childdbg 1');
      this.rememberProcesses(parseProcesses(await this.command('|')), true);
      this.targetPid ??= this.pid;
      this.emit('ready', this.snapshot()); return this.snapshot();
    } catch (error) { await this.abort(); throw error; }
  }
  rememberProcesses(items, replace = false) {
    if (replace) this.processIds.clear();
    for (const item of items) this.processIds.set(item.index, item.pid);
    this.pid = this.processIds.get(this.processIndex) ?? null;
    return items;
  }
  cleanup() { const dir = this.directory; this.directory = null; if (dir) fs.rm(dir, {recursive: true, force: true}).catch(() => {}); }
  fail(error) { if (this.state === 'closed') return; this.lastFailure = error; this.settlePending(error); this.setState('failed'); this.emit('failure', {message: error.message}); }
  settlePending(error, value) { const pending = this.pending; this.pending = null; if (!pending) return; clearTimeout(pending.timer); error ? pending.reject(error) : pending.resolve(value); }
  receive(bytes) {
    if (['closed', 'failed'].includes(this.state)) return;
    const text = bytes.toString('utf8'); this.emit('output', {text: text.slice(0, 65536)}); this.buffer += text;
    if (this.buffer.length > MAX_OUTPUT) { this.fail(new NativeDebugError('Debugger output limit exceeded', 'OUTPUT_LIMIT')); void this.abort(); return; }
    const prompt = PROMPT.exec(this.buffer); if (!prompt) return;
    this.processIndex = Number(prompt[1]); this.threadIndex = Number(prompt[2]); this.architecture = prompt[3] || null;
    this.pid = this.processIds.get(this.processIndex) ?? null;
    if (this.pending) {
      const marker = '\n' + this.pending.marker + '\n', normalized = this.buffer.replaceAll('\r\n', '\n');
      const end = normalized.lastIndexOf(marker); if (end < 0 && !normalized.startsWith(this.pending.marker + '\n')) return;
      const output = normalized.slice(0, end < 0 ? 0 : end); this.buffer = '';
      debuggerFailure(output) ? this.settlePending(new NativeDebugError(output.trim(), 'COMMAND_FAILED')) : this.settlePending(null, output.trim());
    } else if (['starting', 'running', 'breaking'].includes(this.state)) {
      this.lastStop = this.buffer.slice(0, prompt.index).trim(); this.buffer = ''; this.pauseId++; this.setState('paused'); this.emit('paused', {...this.snapshot(), reason: this.lastStop.slice(-8192)});
    } else this.buffer = '';
  }
  waitPaused() {
    if (this.state === 'paused') return Promise.resolve(this.snapshot());
    if (this.state === 'failed') return Promise.reject(this.lastFailure || new NativeDebugError('Debugger failed', 'DEBUGGER_EXITED'));
    if (['closed', 'new', 'detaching'].includes(this.state)) return Promise.reject(new NativeDebugError('Debugger is not waiting for a stop', 'DEBUGGER_EXITED'));
    return new Promise((resolve, reject) => {
      const finish = (error, value) => { clearTimeout(timer); this.off('paused', paused); this.off('closed', closed); this.off('failure', failed); error ? reject(error) : resolve(value); };
      const paused = value => finish(null, value), closed = () => finish(new NativeDebugError('Debugger exited before stopping', 'DEBUGGER_EXITED')), failed = e => finish(new NativeDebugError(e.message));
      const timer = setTimeout(() => finish(new NativeDebugError('Debugger did not stop before the timeout', 'TIMEOUT')), this.timeout);
      this.on('paused', paused); this.on('closed', closed); this.on('failure', failed);
    });
  }
  assertPaused(pauseId) {
    if (this.state !== 'paused') throw new NativeDebugError('Pause the native process first', 'NOT_PAUSED');
    if (pauseId !== undefined && integer(pauseId, 'pause ID') !== this.pauseId) throw new NativeDebugError('Native pause changed; refresh before changing the target', 'STALE_PAUSE');
  }
  command(command, pauseId) {
    // Private engine operation; exported HTTP service never takes command text.
    const perform = () => { this.assertPaused(pauseId); return new Promise((resolve, reject) => {
      const marker = 'VB6_' + randomBytes(18).toString('hex'); this.buffer = '';
      const timer = setTimeout(() => { this.fail(new NativeDebugError('Debugger command timed out', 'TIMEOUT')); void this.abort(); }, this.timeout);
      this.pending = {resolve, reject, timer, marker};
      this.child.stdin.write(command + '; .echo ' + marker + '\n', error => { if (error) this.fail(error); });
    }); };
    const result = this.queue.then(perform); this.queue = result.catch(() => {}); return result;
  }
  request(operation, params = {}) {
    if((this.pendingOperations||0)>=256)return Promise.reject(new NativeDebugError('Native command queue is full','QUEUE_LIMIT'));
    let snapshot;try{snapshot=structuredClone(params);}catch{return Promise.reject(new NativeDebugError('Native arguments must be data values','INVALID_ARGUMENT'));}
    this.pendingOperations=(this.pendingOperations||0)+1;
    const result = this.operations.then(() => this.perform(operation, snapshot)).finally(()=>{this.pendingOperations--;});
    this.operations = result.catch(() => {}); return result;
  }
  async resumeCommand(command,pause){
    await this.queue;this.assertPaused(pause);this.buffer='';this.setState('running');
    try{await new Promise((resolve,reject)=>this.child.stdin.write(command+'\n',error=>error?reject(error):resolve()));}
    catch(error){this.fail(error);await this.abort();throw error;}
    return this.snapshot();
  }
  async perform(operation, params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new NativeDebugError('Invalid command arguments', 'INVALID_ARGUMENT');
    const pause = params.pauseId;
    // A Run to Address stop at any other breakpoint cancels that temporary
    // request. A one-shot already consumed by CDB must not be cleared twice.
    if(this.state==='paused'&&this.temporaryBreakpoint!==undefined&&operation!=='status'){
      this.assertPaused(pause);
      const id=this.temporaryBreakpoint,text=await this.command('bl',pause);
      if(new RegExp('(?:^|\\n)\\s*'+id+'\\s+[ed]\\s').test(text))await this.command('bc '+id,pause);
      this.breakpoints.delete(id);this.temporaryBreakpoint=undefined;
    }
    switch (operation) {
      case 'status': return this.snapshot();
      case 'pause': { if (this.state === 'paused') return this.snapshot(); if (this.state !== 'running') throw new NativeDebugError('Process is not running'); const pid = this.pid || this.targetPid; if (!pid) throw new NativeDebugError('Target PID is unavailable'); const stopped = this.waitPaused(); this.setState('breaking'); try { await this.breakProcess(pid); return await stopped; } catch (error) { stopped.catch(() => {}); if (this.state === 'breaking') this.setState('running'); throw error; } }
      case 'continue': case 'stepInto': case 'stepOver': case 'stepOut': {
        return this.resumeCommand({continue:'g',stepInto:'t',stepOver:'p',stepOut:'gu'}[operation],pause);
      }
      case 'processes': return {processes: this.rememberProcesses(parseProcesses(await this.command('|', pause)), true)};
      case 'threads': return {threads: parseThreads(await this.command('~', pause))};
      case 'selectThread': { await this.command('~' + integer(params.index, 'thread index', 0, 100000) + 's', pause); this.pauseId++; return this.snapshot(); }
      case 'selectProcess': { await this.command('|' + integer(params.index, 'process index', 0, 10000) + 's', pause); this.rememberProcesses(parseProcesses(await this.command('|.'))); this.pauseId++; return this.snapshot(); }
      case 'stack': { const text = await this.command('kn 0x' + integer(params.count ?? 64, 'frame count', 1, 256).toString(16), pause); return {frames: parseStack(text), text}; }
      case 'allStacks': return {text: await this.command('~* kn 0x' + integer(params.count ?? 32, 'frame count', 1, 128).toString(16), pause)};
      case 'allProcessStacks': {
        this.assertPaused(pause);const processIndex=this.processIndex,threadIndex=this.threadIndex,processes=this.rememberProcesses(parseProcesses(await this.command('|',pause)), true);
        if(processes.length>64)throw new NativeDebugError('Select at most 64 processes for one stack snapshot','PROCESS_LIMIT');
        const result=[];
        try{for(const process of processes){await this.command('|'+process.index+'s');result.push({process,text:await this.command('~* kn 0x'+integer(params.count??32,'frame count',1,128).toString(16))});}}
        finally{try{await this.command('|'+processIndex+'s');await this.command('~'+threadIndex+'s');}finally{this.pauseId++;}}
        return {processes:result,pauseId:this.pauseId};
      }
      case 'stepMode': {if(!['source','assembly'].includes(params.mode))throw new NativeDebugError('Select source or assembly stepping');await this.command(params.mode==='source'?'l+t; l+s':'l-t',pause);this.stepMode=params.mode;return {mode:params.mode};}
      case 'symbolPath': {
        const directory=params.path;
        if(typeof directory!=='string'||directory.length>4096||!/^[a-z]:[\\/]/i.test(directory)||/[\r\n\0;"'`*<>|]/.test(directory))throw new NativeDebugError('Choose one local absolute symbol directory without debugger commands','INVALID_ARGUMENT');
        await this.command('.sympath '+directory+'; .reload',pause);return {path:directory};
      }
      case 'continueHandled': case 'continueUnhandled': {
        return this.resumeCommand(operation==='continueHandled'?'gh':'gn',pause);
      }
      case 'registers': return {registers: parseRegisters(await this.command('r', pause))};
      case 'modules': return {text: await this.command('lm', pause)};
      case 'locals': { const index = integer(params.frame ?? 0, 'frame index', 0, 255); return {text: await this.command('.frame 0x' + index.toString(16) + '; dv /t /v', pause)}; }
      case 'evaluate': return {text: await this.command('? ' + expression(params.expression), pause)};
      case 'resolveSymbol': { const text=await this.command('? '+symbol(params.symbol),pause),match=/=\s*(?:0x)?([0-9a-f`]+)\s*$/im.exec(text);if(!match)throw new NativeDebugError('Symbol address is unavailable','SYMBOL_NOT_FOUND');return {symbol:params.symbol,address:address(match[1].replaceAll('`',''))}; }
      case 'disassemble': { const where = params.address === undefined ? '@$ip' : address(params.address); return {text: await this.command('u ' + where + ' L0x' + integer(params.count ?? 32, 'instruction count', 1, 256).toString(16), pause)}; }
      case 'readMemory': { const where = address(params.address), count = integer(params.count ?? 128, 'byte count', 1, 4096); return parseMemory(await this.command('db ' + where + ' L0x' + count.toString(16), pause), where, count); }
      case 'writeMemory': {
        const where = address(params.address), bytes = params.bytes; if (!Array.isArray(bytes) || !bytes.length || bytes.length > 256) throw new NativeDebugError('Write between 1 and 256 bytes'); bytes.forEach(b => integer(b, 'byte', 0, 255));
        this.assertPaused(pause);
        try{
          await this.command('eb ' + where + ' ' + bytes.map(b => b.toString(16).padStart(2, '0')).join(' '), pause);
          const result = await this.perform('readMemory', {address: where, count: bytes.length, pauseId: pause});
          if (JSON.stringify(result.bytes) !== JSON.stringify(bytes)) throw new NativeDebugError('Memory verification failed; the write may be partial', 'PARTIAL_WRITE');
          return {...result,pauseId:this.pauseId+1};
        }finally{this.pauseId++;} // A failed command may still have written some bytes.
      }
      case 'setRegister': {
        const register = params.register; if (typeof register !== 'string' || !/^(?:[re]?(?:ax|bx|cx|dx|si|di|bp|sp)|r(?:[89]|1[0-5])|eip|rip|efl)$/i.test(register)) throw new NativeDebugError('Invalid register');
        await this.command('r ' + register + '=' + address(params.value), pause); this.pauseId++; return {...await this.perform('registers'),pauseId:this.pauseId};
      }
      case 'setBreakpoint': {
        const where = location(params.location);
        return this.installBreakpoint(where.startsWith('0x')?'bp':'bu',where,where,pause);
      }
      case 'setDataBreakpoint': {
        const where=address(params.address),size=integer(params.size??1,'watch size',1,8),access=params.access??'write';
        if(!['write','readWrite','execute'].includes(access)||![1,2,4,8].includes(size)||(access==='execute'&&size!==1)||BigInt(where)%BigInt(size)!==0n)throw new NativeDebugError('Choose an aligned watch address, 1/2/4/8 bytes, and write/readWrite/execute access','INVALID_ARGUMENT');
        const mode={write:'w',readWrite:'r',execute:'e'}[access];
        // CDB rejects unsupported target widths and exhausted hardware slots.
        // Never silently downgrade an 8-byte watch to a shorter range.
        return this.installBreakpoint('ba',mode+' '+size+' '+where,where,pause,{kind:'data',access,size});
      }
      case 'removeBreakpoint': { const id = integer(params.id, 'breakpoint ID', 1); if (!this.breakpoints.has(id)) throw new NativeDebugError('Unknown breakpoint'); await this.command('bc ' + id, pause); this.breakpoints.delete(id); return this.snapshot(); }
      case 'enableBreakpoint': { const id = integer(params.id, 'breakpoint ID', 1); if (!this.breakpoints.has(id) || typeof params.enabled !== 'boolean') throw new NativeDebugError('Unknown breakpoint or invalid enabled value'); await this.command((params.enabled ? 'be ' : 'bd ') + id, pause); this.breakpoints.get(id).enabled = params.enabled; return this.snapshot(); }
      case 'runToAddress': {const where=address(params.address),bp=await this.installBreakpoint('bp','/1 '+where,where,pause,{temporary:true});this.temporaryBreakpoint=bp.id;return this.resumeCommand('g',pause);}
      case 'exceptionPolicy': { const code = address(params.code); if (!['firstChance', 'secondChance'].includes(params.mode)) throw new NativeDebugError('Invalid exception policy'); await this.command((params.mode === 'firstChance' ? 'sxe ' : 'sxd ') + code, pause); return {code, mode: params.mode}; }
      case 'detach': return this.detach();
      default: throw new NativeDebugError('Unsupported native debugger operation: ' + operation, 'UNKNOWN_OPERATION');
    }
  }
  async installBreakpoint(command,argumentsText,where,pause,metadata={}){
    if(this.breakpoints.size>=128)throw new NativeDebugError('At most 128 breakpoints are supported');
    const id=++this.sequence;
    await this.command(command+id+' '+argumentsText,pause);
    const text=await this.command('bl',pause);
    if(!new RegExp('(?:^|\\n)\\s*'+id+'\\s+[ed]\\s').test(text))throw new NativeDebugError('The debugger did not install the breakpoint');
    const value={id,location:where,enabled:true,...metadata};this.breakpoints.set(id,value);return {...value};
  }
  async detach() {
    if (['new', 'closed'].includes(this.state)) { this.cleanup(); return this.snapshot(); }
    if (this.state === 'running') await this.perform('pause');
    await this.queue; this.assertPaused();
    const closed = new Promise((resolve, reject) => { const timer = setTimeout(() => { this.off('closed', finish); reject(new NativeDebugError('Detach did not finish', 'TIMEOUT')); }, this.timeout); const finish = () => { clearTimeout(timer); resolve(this.snapshot()); }; this.once('closed', finish); });
    this.setState('detaching'); this.child.stdin.write('qd\n'); return closed;
  }
  async abort() {
    this.generation++;
    this.settlePending(new NativeDebugError('Debugger session closed', 'DEBUGGER_EXITED'));
    // -pd prevents ending this debugger from terminating the attached target.
    if (this.child && !this.child.killed && this.state !== 'closed') this.child.kill();
    if (this.state !== 'closed') { this.setState('closed'); this.emit('closed', {aborted:true}); } this.cleanup();
  }
}
