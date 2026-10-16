import {Vim} from './vim-adapter.js';

let installed = false;
/** Define against each adapter's host, never a captured IDE or active buffer. */
export function installIdeVimCommands() {
  if (installed) return; installed = true;
  for (const [name, prefix, command] of [
    ['write', 'w', 'save'], ['wall', 'wa', 'save'],
    ['quit', 'q', 'close'], ['close', 'clo', 'close'], ['bdelete', 'bd', 'close'],
    ['wq', 'wq', 'saveAndClose'], ['xit', 'x', 'saveAndClose'],
    ['bnext', 'bn', 'nextBuffer'], ['bprevious', 'bp', 'previousBuffer'], ['bNext', 'bN', 'previousBuffer'],
    ['buffer', 'b', 'buffer'], ['buffers', 'buffers', 'buffers'], ['ls', 'ls', 'buffers'],
    ['split', 'sp', 'split'], ['vsplit', 'vs', 'vsplit'], ['only', 'on', 'only'],
    ['run', 'run', 'run'], ['stop', 'stop', 'stop'], ['build', 'build', 'build'],
    ['help', 'h', 'help'], ['normalmode', 'normalmode', 'defaultInputMode'], ['vim', 'vim', 'vimInputMode'],
    ['explore', 'ex', 'explore']
  ]) Vim.defineEx(name, prefix, (adapter, args) => adapter.host.execute(command, args));
}

function sourceKey(ide, editor) {
  const tool = [...(ide.documents.tools?.values() || [])].find(value => value.editor === editor);
  if (tool) return tool.key;
  const id = editor.module?.id || [...ide.documents.editors].find(([, value]) => value === editor)?.[0];
  return id ? id + ':code' : ide.documents.mdi.active;
}

function focusCurrentSource(service) {
  const ide = service.ide, tool = ide.documents.tools.get(ide.documents.mdi.active);
  const editor = tool?.editor || (ide.activeDoc?.view === 'code' ? ide.editor : null);
  const record = service.records.get(editor);
  if (record) { service.activate(record); record.host.focus(); }
}

export function executeIdeVimCommand(service, record, command, args = {}) {
  const ide = service.ide, editor = record.host.editor, surface = ide.advancedEditor?.runtime?.surfaces.get(editor);
  const text = String(args.argString ?? args.args?.join(' ') ?? '').trim();
  const close = () => {
    if (surface?.views.length > 1) return surface.setSplit(false);
    if (editor.secondary) return editor.toggleSplit(false);
    return ide.closeDocument(sourceKey(ide, editor));
  };
  switch (command) {
    case 'save':
      if (text) throw new Error('Use the IDE Save As command to choose a project filename.');
      return ide.saveProject();
    case 'saveAndClose': {
      if (text) throw new Error('Use the IDE Save As command to choose a project filename.');
      const project = ide.project, key = sourceKey(ide, editor);
      return Promise.resolve(ide.saveProject()).then(saved => {
        if (saved !== false && !service.disposed && project === ide.project) ide.closeDocument(key);
        return saved;
      });
    }
    case 'close': return close();
    case 'nextBuffer': case 'previousBuffer': {
      const modules = ide.project.modules;
      if (!modules.length) return;
      const index = modules.findIndex(module => module.id === record.host.moduleId);
      const delta = command === 'nextBuffer' ? 1 : -1;
      const module = modules[(Math.max(0, index) + delta + modules.length) % modules.length];
      ide.openDocument(module.id, 'code'); focusCurrentSource(service); return;
    }
    case 'buffer': {
      if (!text) return service.notify(record, ide.project.modules.find(module => module.id === record.host.moduleId)?.name || 'No active buffer');
      const modules = ide.project.modules, name = text.replace(/\.(bas|frm|cls)$/i, '').toLowerCase();
      const module = /^\d+$/.test(text) ? modules[Number(text) - 1] : modules.find(value => value.name.toLowerCase() === name);
      if (!module) throw new Error('No source buffer named ' + text);
      ide.openDocument(module.id, 'code'); focusCurrentSource(service); return;
    }
    case 'buffers': return service.notify(record, ide.project.modules.map((module, index) => `${index + 1}${module.id === record.host.moduleId ? ' % ' : '   '}${module.name}`).join('\n'));
    case 'split': case 'vsplit': {
      const direction = command === 'vsplit' ? 'vertical' : 'horizontal';
      if (surface) { surface.setSplit(true); surface.setSplitOrientation?.(direction); }
      else if (editor.toggleSplit) { editor.toggleSplit(true); editor.setSplitOrientation?.(direction); editor.activatePane(editor.secondary); editor.input.focus(); }
      else throw new Error('This editor does not support split panes.');
      return;
    }
    case 'only':
      if (surface) return surface.setSplit(false);
      return editor.toggleSplit?.(false);
    case 'help': return service.help?.();
    case 'defaultInputMode': return service.configure({mode: 'default'});
    case 'vimInputMode': return service.configure({mode: 'vim'});
    case 'explore': ide.command('projectExplorer'); ide.projectTree.focus(); return;
    case 'build': return ide.checkSyntax();
    case 'run': case 'stop': return ide.command(command);
    case 'fold':
      if (surface) return surface.run('editor.toggleFold');
      return editor.toggleFold?.();
    case 'goToDefinition': case 'goToDeclaration':
      if (surface) return surface.run('editor.action.revealDefinition');
      if (record.host.xaml) return editor.action('definition');
      return ide.command('goToDefinition');
    case 'autocomplete': return editor.complete?.();
    default: throw new Error('Vim command is not provided by this editor: ' + command);
  }
}

export function executeWindowKey(service, record, key) {
  const ide = service.ide, editor = record.host.editor, surface = ide.advancedEditor?.runtime?.surfaces.get(editor);
  if (key === '<Esc>') return;
  if (key === 's' || key === '<C-s>') return executeIdeVimCommand(service, record, 'split');
  if (key === 'v' || key === '<C-v>') return executeIdeVimCommand(service, record, 'vsplit');
  if (key === 'o' || key === '<C-o>') return executeIdeVimCommand(service, record, 'only');
  if (key === 'c' || key === 'q') return executeIdeVimCommand(service, record, 'close');
  if (key === '=') { if (surface) surface.setSplitOrientation?.(surface.splitOrientation || 'horizontal'); else editor.setSplitRatio?.(.5); return; }
  if (['h', 'j', 'k', 'l', 'w', 'W', 'p', '<C-w>', '<Left>', '<Right>', '<Up>', '<Down>', '<C-h>', '<C-j>', '<C-k>', '<C-l>'].includes(key)) {
    const previous = ['h', 'k', 'W', '<Left>', '<Up>', '<C-h>', '<C-k>'].includes(key);
    if (surface?.views.length > 1) {
      const index = surface.views.findIndex(value => value.view === surface.view);
      surface.views[(index + (previous ? -1 : 1) + surface.views.length) % surface.views.length].view.focus(); return;
    }
    if (editor.secondary) { editor.activatePane(editor.activePane === editor.primary ? editor.secondary : editor.primary); editor.input.focus(); return; }
    ide.documents.mdi.cycle(previous ? -1 : 1); focusCurrentSource(service); return;
  }
  throw new Error('Unknown window command: Ctrl+W ' + key);
}
