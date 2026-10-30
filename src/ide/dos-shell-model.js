/** Presentation of existing IDE shortcuts. These tables never dispatch keyboard
 * events: the source editor, menus and debugger keep their original handlers. */
const pages = {
  plain: ['help','objectBrowser','findNext','properties','run','dosNextPane','viewCode','stepInto','breakpoint','dosFocusMenu'],
  shift: [null,'goToDefinition','dosFindPrevious',null,'stop','dosPreviousPane','viewForm','stepOver','quickWatch',null],
  control: [null,'toggleBookmark',null,'dosCloseDocument',null,'dosNextDocument',null,'runToCursor','setNextStatement','dosMaximizeDocument'],
  controlShift: [null,'lastPosition',null,'dosCloseDocument',null,'dosPreviousDocument',null,'stepOut','clearBreakpoints','dosMaximizeDocument'],
  alt: Array(10).fill(null)
};
for (const page of Object.values(pages)) Object.freeze(page);
export const DOS_FUNCTION_PAGES = Object.freeze(pages);
export const DOS_SHELL_COMMANDS = Object.freeze([
  'dosNextPane','dosPreviousPane','dosFocusMenu','dosNextDocument',
  'dosPreviousDocument','dosCloseDocument','dosMaximizeDocument','dosFindPrevious'
]);
const labels = Object.freeze({
  help:'Help',objectBrowser:'Objects',findNext:'Find next',properties:'Properties',run:'Run',
  viewCode:'Code',stepInto:'Step',breakpoint:'Breakpt',goToDefinition:'Definition',stop:'Stop',
  viewForm:'Design',stepOver:'Over',quickWatch:'Watch',toggleBookmark:'Mark',runToCursor:'To cursor',
  setNextStatement:'Next stmt',lastPosition:'Last pos',stepOut:'Step out',clearBreakpoints:'Clear BPs',
  dosNextPane:'Next pane',dosPreviousPane:'Prev pane',dosFocusMenu:'Menu',dosNextDocument:'Next doc',
  dosPreviousDocument:'Prev doc',dosCloseDocument:'Close doc',dosMaximizeDocument:'Maximize',dosFindPrevious:'Find prev'
});

export function dosModifiers(event = {}) {
  const control = !!(event.ctrlKey || event.metaKey), shift = !!event.shiftKey, alt = !!event.altKey;
  return {control,shift,alt,primary:event.metaKey&&!event.ctrlKey?'Meta':'Control',
    page:alt?'alt':control?(shift?'controlShift':'control'):shift?'shift':'plain'};
}

/** Follow materialized menu arrays only. Lazy submenus belong to their opener
 * and are not executed just to paint a status strip. Inherited disablement and
 * repeated/cyclic extension arrays cannot enable or stall a command scan. */
export function dosMenuCommands(trees) {
  const commands = new Map(), seen = new WeakMap(), pending = [{items:trees,enabled:true}];
  let visited = 0;
  while (pending.length && visited < 8192) {
    const {items,enabled} = pending.pop();
    if (!Array.isArray(items)) continue;
    const bit = enabled?1:2, prior = seen.get(items)||0;
    if (prior&bit) continue;
    seen.set(items,prior|bit);
    for (const item of items) {
      if (++visited>8192) break;
      if (Array.isArray(item)) {pending.push({items:item,enabled});continue;}
      if (!item || typeof item !== 'object') continue;
      const available = enabled && item.enabled !== false;
      if (typeof item.id === 'string') {
        const previous = commands.get(item.id);
        commands.set(item.id,{label:String(item.label||item.id),shortcut:String(item.shortcut||''),
          enabled:available&&(previous?.enabled!==false),checked:item.checked===true});
      }
      if (Array.isArray(item.items)) pending.push({items:item.items,enabled:available});
    }
  }
  return commands;
}

export function dosFunctionKeys(modifiers, commands, context = {}) {
  const page = DOS_FUNCTION_PAGES[modifiers?.page] || DOS_FUNCTION_PAGES.plain;
  const prefix = [modifiers?.control?(modifiers.primary==='Meta'?'Meta':'Control'):null,modifiers?.shift?'Shift':null,modifiers?.alt?'Alt':null].filter(Boolean);
  const compact = prefix.map(value=>({Control:'C',Meta:'M',Shift:'S',Alt:'A'})[value]).join('');
  const internal = {
    dosNextPane:context.panes>1,dosPreviousPane:context.panes>1,dosFocusMenu:!!context.menu,
    dosNextDocument:context.documents>1,dosPreviousDocument:context.documents>1,
    dosCloseDocument:!!context.document,dosMaximizeDocument:!!context.document&&!context.detached,
    dosFindPrevious:!!context.source
  };
  return page.map((id,index)=>{
    const key='F'+(index+1),entry=id?commands.get(id):null;
    let enabled=!!id&&(Object.hasOwn(internal,id)?internal[id]:!!entry&&entry.enabled);
    if(id==='findNext'&&!context.source)enabled=false;
    if(context.blocked)enabled=false;
    let label=labels[id]||'';
    if(id==='run'&&context.runState==='paused')label='Continue';
    if(id==='dosMaximizeDocument'&&context.maximized)label='Restore';
    return {key,id,label,enabled,shortcut:[...prefix,key].join('+'),displayKey:compact?compact+'-'+key:key,
      title:entry?.label||label};
  });
}

/** Cycle over the live pane list, including when a previously focused pane was
 * removed. Callers supply only eligible panes and retain native focus targets. */
export function dosCycleIndex(count,index,direction=1) {
  if(!Number.isSafeInteger(count)||count<1)return -1;
  if(!Number.isInteger(index)||index<0||index>=count)return direction<0?count-1:0;
  return (index+(direction<0?-1:1)+count)%count;
}
