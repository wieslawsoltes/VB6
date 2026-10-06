/** Open only an internally generated OpenAI authorization URL, without a shell.
 * A successful launch is NOT evidence that the browser rendered it or signed in.
 */
import {spawn} from 'node:child_process';
import path from 'node:path';
import {chatGPTLoginURL} from '../src/agents/chatgpt-protocol.js';

export function chatGPTBrowserCommand(value, platform = process.platform, env = process.env) {
  const url = chatGPTLoginURL(value);
  if (platform === 'darwin') return {file: '/usr/bin/open', args: [url]};
  if (platform === 'linux') return {file: 'xdg-open', args: [url]};
  if (platform === 'win32') {
    const root = env.SystemRoot || 'C:\\Windows';
    if (!/^[A-Za-z]:\\[^\r\n"<>|]+$/.test(root)) throw new Error('Invalid Windows system directory.');
    return {file: path.win32.join(root, 'System32', 'rundll32.exe'), args: ['url.dll,FileProtocolHandler', url]};
  }
  return null;
}

export async function openChatGPTBrowser(value, {signal, platform = process.platform, env = process.env, spawnImpl = spawn, timeoutMs = 5000} = {}) {
  const command = chatGPTBrowserCommand(value, platform, env);
  if (!command) return false;
  signal?.throwIfAborted();
  return new Promise(resolve => {
    let child, timer, settled = false;
    const done = success => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      // Do not kill the user's browser. The short-lived OS launcher owns its lifetime.
      child?.unref?.(); resolve(success);
    };
    const abort = () => done(false);
    try {
      child = spawnImpl(command.file, command.args, {shell: false, stdio: 'ignore', windowsHide: true});
      child.once('error', () => done(false));
      child.once('exit', code => done(code === 0 && !signal?.aborted));
      signal?.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => done(false), Math.max(1, Math.min(5000, timeoutMs)));
      if (signal?.aborted) abort();
    } catch { done(false); }
  });
}
