import {el} from '../core/core.js';
import {EditorInputModeService} from '../editor/input-modes/service.js';
import {registerModalContribution} from './modal-contributions.js';
import {closeMenu,modal,showMenu,tabbedPages} from './ui.js';

const MODE_COMMAND_PREFIX='inputMode:';

function referenceTable(title,rows){
  return el('table',{class:'input-mode-reference'},
    el('caption',{},title),
    el('thead',{},el('tr',{},el('th',{scope:'col'},'Keys'),el('th',{scope:'col'},'Action'))),
    el('tbody',{},...rows.map(([keys,description])=>el('tr',{},
      el('th',{scope:'row'},el('code',{},keys)),el('td',{},description)))));
}

function vimReference(){
  const modes=el('div',{class:'input-mode-help-page'},
    el('p',{},'Choose an input mode from Tools > Input Mode, the status bar, or Tools > Options > Editor. Default keeps the familiar editor shortcuts. The selected mode applies across workspace presentations and editor backends.'),
    referenceTable('Vim modes',[
      ['Esc / Ctrl+[','Return to Normal mode; cancel a pending command.'],
      ['i / a','Insert before / after the cursor.'],
      ['I / A','Insert at the first nonblank character / end of the line.'],
      ['o / O','Open a line below / above and enter Insert mode.'],
      ['R','Enter Replace mode.'],
      ['v / V / Ctrl+V','Start character, line, or block Visual selection.']
    ]),
    referenceTable('Motions',[
      ['h j k l','Move left, down, up, and right.'],
      ['gj gk','Move down or up by a displayed row, including wrapped rows.'],
      ['w / b / e','Next word, previous word, and end of word; uppercase uses whitespace-delimited words.'],
      ['0 / ^ / $','Beginning of line, first nonblank character, and end of line.'],
      ['gg / G / 12G','First line, last line, and a numbered line.'],
      ['f{char} / t{char}','Find a character / stop before it; F and T search backward.'],
      ['; / ,','Repeat the last character search forward / backward.'],
      ['% / { / }','Matching bracket, previous paragraph, and next paragraph.'],
      ['Ctrl+D / Ctrl+U','Move down / up half a page.'],
      ['Ctrl+F / Ctrl+B','Move down / up a page.']
    ]));
  const editing=el('div',{class:'input-mode-help-page'},
    el('p',{},'Combine a count, an operator, and a motion. For example, 3dw deletes three words, ci" changes the contents of a quoted string, and >ap indents a paragraph.'),
    referenceTable('Operators and editing',[
      ['d{motion} / c{motion} / y{motion}','Delete, change, or yank the range selected by a motion.'],
      ['dd / cc / yy','Delete, change, or yank a complete line.'],
      ['x / X / r{char}','Delete under / before the cursor, or replace one character.'],
      ['D / C','Delete / change from the cursor to the end of the line.'],
      ['p / P','Paste after / before the cursor.'],
      ['u / Ctrl+R','Undo / redo.'],
      ['.','Repeat the last change; a count overrides its repeat count.'],
      ['J / gJ','Join lines with / without inserted whitespace.'],
      ['>> / << / ==','Indent, outdent, or reindent a line.'],
      ['~ / gu{motion} / gU{motion}','Toggle case, lowercase a range, or uppercase a range.']
    ]),
    referenceTable('Text objects, registers, and macros',[
      ['iw / aw / iW / aW','Inner / around a word or a whitespace-delimited word.'],
      ['i" / a" / i\' / a\'','Inner / around quoted text.'],
      ['i( / a( / i[ / a[ / i{ / a{','Inner / around paired delimiters.'],
      ['ip / ap','Inner / around a paragraph.'],
      ['"a{command}','Use register a; for example, "ayy yanks a line and "ap pastes it.'],
      ['q{register} … q','Record a macro in a register; q ends recording.'],
      ['@{register} / @@','Play a macro / repeat the last macro.'],
      ['m{letter} / \'{letter} / `{letter}','Set a mark, jump to its line, or jump to its exact position.']
    ]));
  const searching=el('div',{class:'input-mode-help-page'},
    referenceTable('Search and Ex commands',[
      ['/pattern / ?pattern','Search forward / backward; Enter accepts and Esc cancels.'],
      ['n / N','Repeat the search in the same / opposite direction.'],
      ['* / #','Search forward / backward for the word under the cursor.'],
      [':','Open the Ex command line.'],
      [':12','Jump to line 12.'],
      [':%s/old/new/g','Substitute every match throughout the document.'],
      [':3,8s/old/new/g','Substitute within a line range.'],
      [':%s/old/new/gc','Confirm each substitution.']
    ]),
    referenceTable('IDE commands',[
      [':w / :write / :wall','Save the current project using the IDE save workflow.'],
      [':q / :quit / :close','Close the active split pane, or its editor document when unsplit.'],
      [':wq / :x','Save successfully, then close the originally requested pane or document.'],
      [':bn / :bp / :buffer NAME','Move to the next / previous source buffer, or select a named buffer.'],
      [':ls / :buffers','List source buffers.'],
      [':split / :vsplit / :only','Split the editor or return to one editor pane.'],
      ['Ctrl+W, then h / j / k / l','Move to a neighboring pane in that direction.'],
      ['Ctrl+W, then w / W / p','Cycle panes or return to the other pane.'],
      ['Ctrl+W, then t / b','Select the top-left / bottom-right pane.'],
      ['Ctrl+W, then s / v / o / =','Split horizontally / vertically, retain this pane, or equalize sizes.'],
      [':run / :stop / :build','Run, stop, or build through the IDE.'],
      [':help / :normalmode / :vim','Open this reference, use Default input, or enable Vim input.']
    ]),
    el('p',{class:'option-note'},'Ex commands operate on the open IDE project and its editors. Shell execution, filesystem commands, and arbitrary Vimscript are not provided by the browser integration.'),
    el('p',{class:'option-note'},'Counts and registers can be combined with editing commands. Normal, Insert, Replace, and Visual state is shown in the status bar. Escape leaves an editing state; use the Input Mode menu to return to Default.'));
  return tabbedPages([
    {id:'modes',label:'Modes & Motion',node:modes},
    {id:'editing',label:'Editing & Macros',node:editing},
    {id:'search',label:'Search & Commands',node:searching}
  ],{label:'Vim key reference'});
}

/** Input is an IDE preference. Presentation, project contents, editor backend,
 * and document ownership remain independent of this UI contribution. */
export function installInputModes(ide){
  if(ide.inputModes)return ide.inputModes;
  const service=new EditorInputModeService(ide);
  ide.inputModes=service;
  const view=ide.root.ownerDocument.defaultView;
  let disposed=false,statusMenu=null;

  const fields=()=>{
    const modes=service.listModes(),select=el('select',{'aria-label':'Editor input mode'},
      ...modes.map(mode=>el('option',{value:mode.id},mode.label)));
    select.value=service.settings.mode;
    const description=el('p',{class:'option-note input-mode-description'});
    const describe=()=>{description.textContent=modes.find(mode=>mode.id===select.value)?.description||'';};
    select.addEventListener('change',describe);describe();
    const group=el('fieldset',{class:'options-group input-mode-options'},
      el('legend',{},'Input Mode'),
      el('label',{class:'option-field'},el('span',{},'Editor input mode:'),select),description,
      el('p',{class:'option-note'},'A preference for this IDE. Applies to code editors in Classic, Figma, and DOS / TUI workspaces.'),
      el('button',{type:'button',onclick:()=>service.help()},'Vim Key Reference…'));
    return {group,read:()=>({mode:select.value})};
  };

  service.help=()=>modal('Vim Key Reference',{
    width:680,content:vimReference(),buttons:[{label:'Close',value:true,primary:true}]
  });
  service.options=()=>{
    const options=fields();
    return modal('Input Mode Options',{width:540,content:options.group,buttons:[
      {label:'OK',value:true,primary:true,action:()=>{service.configure(options.read());}},
      {label:'Cancel',value:false}
    ]});
  };

  const unregisterOptions=registerModalContribution('Options',({content,buttons})=>{
    if(disposed)return;
    const editor=content?.querySelector('[data-tab-page="editor"]');
    if(!editor)return;
    const options=fields();editor.prepend(options.group);
    for(const button of buttons)if(button.value===true){
      const original=button.action;
      button.action=async()=>{
        const requested=options.read(),result=await original?.();
        if(result!==false&&!disposed)service.configure(requested);
        return result;
      };
    }
  });

  const modeItems=()=>[
    ...service.listModes().map(mode=>({
      id:MODE_COMMAND_PREFIX+mode.id,label:mode.label,checked:service.settings.mode===mode.id
    })),
    null,{id:'inputModeOptions',label:'Input Mode Options…'},
    {id:'inputModeHelp',label:'Vim Key Reference…'}
  ];
  const originalMenu=ide.menu,originalCommand=ide.command;
  const chooseMode=mode=>{
    const result=service.configure({mode});
    const tool=ide.documents.tools.get(ide.documents.mdi.active);
    if(tool?.editor||ide.activeDoc?.view==='code')service.currentRecord()?.host.focus();
    return result;
  };
  const menu=function(name){
    const items=originalMenu.call(this,name);
    if(!disposed&&name==='Tools')items.push(null,{label:'Input Mode',items:modeItems()});
    return items;
  };
  const command=function(id,...args){
    if(!disposed){
      if(id==='inputModeOptions')return service.options();
      if(id==='inputModeHelp')return service.help();
      if(id==='inputModeToggle')return chooseMode(service.settings.mode==='vim'?'default':'vim');
      if(typeof id==='string'&&id.startsWith(MODE_COMMAND_PREFIX))return chooseMode(id.slice(MODE_COMMAND_PREFIX.length));
    }
    return originalCommand.call(this,id,...args);
  };
  ide.menu=menu;ide.command=command;

  const modeLabel=el('span',{class:'input-mode-label'}),stateLabel=el('span',{class:'input-mode-state'}),keysLabel=el('span',{class:'input-mode-keys'});
  const status=el('button',{
    type:'button',class:'status-field input-mode-status','aria-haspopup':'menu','aria-expanded':'false',
    'data-input-mode-status':''
  },modeLabel,' ',stateLabel,' ',keysLabel);
  const openStatusMenu=()=>{
    if(disposed)return;
    const bounds=status.getBoundingClientRect();
    statusMenu=showMenu(modeItems(),bounds.left,bounds.top,id=>ide.command(id),{
      opener:status,label:'Input Mode',focusFirst:true
    });
  };
  status.addEventListener('click',openStatusMenu);
  status.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();event.stopPropagation();openStatusMenu();
    }
  });
  ide.statusbar.append(status);
  const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  const attribute=(name,value)=>{if(status.getAttribute(name)!==value)status.setAttribute(name,value);};
  const refresh=()=>{
    if(disposed)return;
    const snapshot=service.snapshot(),mode=String(snapshot.mode||service.settings.mode),
      label=String(snapshot.label||service.listModes().find(item=>item.id===mode)?.label||mode),
      state=mode==='default'?'':String(snapshot.state||'').replaceAll('-',' ').replaceAll('_',' ').toUpperCase(),
      keys=Array.isArray(snapshot.keys)?snapshot.keys.join(''):String(snapshot.keys||''),
      message=String(snapshot.message||'');
    text(modeLabel,label.toUpperCase());text(stateLabel,state);text(keysLabel,keys);
    if(stateLabel.hidden===!!state)stateLabel.hidden=!state;
    if(keysLabel.hidden===!!keys)keysLabel.hidden=!keys;
    attribute('data-input-mode',mode);
    attribute('data-input-state',String(snapshot.state||''));
    const columns=String(Math.min(34,Array.from([label.toUpperCase(),state,keys].filter(Boolean).join(' ')).length+4));
    if(status.style.getPropertyValue('--input-mode-status-columns')!==columns)status.style.setProperty('--input-mode-status-columns',columns);
    const summary=[label,state,keys,message].filter(Boolean).join(' — ');
    attribute('title',summary+'\nChange editor input mode');
    attribute('aria-label','Editor input mode: '+summary+'. Change input mode.');
  };
  const unsubscribe=service.on('change',refresh);refresh();

  const originalDispose=service.dispose;
  const dispose=function(){
    if(disposed)return;
    disposed=true;unregisterOptions();unsubscribe();
    if(statusMenu?.isConnected)closeMenu(false);
    statusMenu=null;status.remove();
    view.removeEventListener('pagehide',pagehide);
    if(ide.menu===menu)ide.menu=originalMenu;
    if(ide.command===command)ide.command=originalCommand;
    if(ide.inputModes===service)delete ide.inputModes;
    return originalDispose.call(service);
  };
  const pagehide=event=>{if(!event.persisted)service.dispose();};
  service.dispose=dispose;
  view.addEventListener('pagehide',pagehide);
  return service;
}
