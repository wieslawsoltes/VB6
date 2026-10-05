/** Only typed operations cross the browser/native boundary. Never accept raw
 * debugger commands, extension names, scripts or debugger process arguments. */
export class NativeDebugError extends Error {
  constructor(message, code = 'DEBUGGER_ERROR') { super(message); this.name = 'NativeDebugError'; this.code = code; }
}
export function integer(value, name, min = 0, max = 0x7fffffff) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new NativeDebugError('Invalid ' + name, 'INVALID_ARGUMENT');
  return value;
}
export function address(value) {
  if (typeof value !== 'string' || !/^(?:0x)?[0-9a-fA-F]{1,16}$/.test(value)) throw new NativeDebugError('Use a hexadecimal address string, not a JavaScript number', 'INVALID_ADDRESS');
  return '0x' + BigInt('0x' + value.replace(/^0x/, '')).toString(16);
}
export function symbol(value) {
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z_][A-Za-z0-9_.$]*![A-Za-z_?@$][A-Za-z0-9_?@$:.<>]*(?:\+0x[0-9a-fA-F]+)?$/.test(value)) throw new NativeDebugError('Use a module!symbol name without debugger commands', 'INVALID_SYMBOL');
  return value;
}
export function expression(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || !/^[a-zA-Z0-9_@$!+\-*/%&|^~<>=().?: \t]+$/.test(value) || /[\r\n;"'`\\{}\[\]]/.test(value)) throw new NativeDebugError('Only bounded debugger expressions are accepted', 'INVALID_EXPRESSION');
  // MASM memory-reading functions are useful, but .shell/.call/aliases are not.
  if (/\b(?:shell|call|load|script|system|exec)\b/i.test(value)) throw new NativeDebugError('Debugger commands are not expressions', 'INVALID_EXPRESSION');
  return value.trim();
}
export function location(value) { return /^(?:0x)?[0-9a-f]+$/i.test(value || '') ? address(value) : symbol(value); }
export function parseProcesses(text) {
  const result = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([.#]?)\s*(\d+)\s+id:\s*([0-9a-f]+)\s+.*?name:\s*(.+)$/i.exec(line);
    if (m) result.push({index: Number(m[2]), pid: parseInt(m[3], 16), name: m[4].trim(), current: m[1] === '.', exception: m[1] === '#'});
  }
  return result;
}
export function parseThreads(text) {
  const result = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([.#]?)\s*(\d+)\s+Id:\s*([0-9a-f]+)\.([0-9a-f]+)\s*(.*)$/i.exec(line);
    if (m) result.push({index: Number(m[2]), pid: parseInt(m[3], 16), tid: parseInt(m[4], 16), current: m[1] === '.', exception: m[1] === '#', details: m[5].trim()});
  }
  return result;
}
export function parseRegisters(text) {
  const registers = {};
  for (const match of text.matchAll(/\b([a-z][a-z0-9]{1,10})=([0-9a-f`]+)\b/gi)) registers[match[1].toLowerCase()] = address(match[2].replaceAll('`', ''));
  return registers;
}
export function parseMemory(text, start, count) {
  const bytes = Array(count).fill(null), first = BigInt(address(start));
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([0-9a-f`]+)\s{2,}(.+)$/i.exec(line); if (!m) continue;
    const offset = BigInt('0x' + m[1].replaceAll('`', '')) - first;
    if (offset < 0n || offset >= BigInt(count)) continue;
    // Only the hex column, never the ASCII rendering to its right.
    const values = m[2].split(/\s{2,}/)[0].replaceAll('-', ' ').trim().split(/\s+/);
    for (let i = 0; i < values.length && Number(offset) + i < count; i++) {
      if (!/^(?:[0-9a-f]{2}|\?\?)$/i.test(values[i])) break;
      bytes[Number(offset) + i] = values[i] === '??' ? null : parseInt(values[i], 16);
    }
  }
  return {address: address(start), bytes, unreadableBytes: bytes.filter(b => b === null).length};
}
export function parseStack(text) {
  const frames = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([0-9a-f]{1,3})\s+([0-9a-f`]+)\s+([0-9a-f`]+)\s+(.+)$/i.exec(line);
    if (m) frames.push({index: parseInt(m[1], 16), stackAddress: address(m[2].replaceAll('`', '')), returnAddress: address(m[3].replaceAll('`', '')), symbol: m[4].trim()});
  }
  return frames;
}
export function debuggerFailure(text) {
  return /(?:^|\n)\s*(?:\^\s*)?(?:Syntax error|Couldn't resolve|Unable to|Could not|Cannot |Invalid |No runnable|No current|The system cannot|Memory access error|Couldn't insert|Command execution error)/i.test(text);
}
