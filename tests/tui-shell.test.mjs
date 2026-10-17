import test from 'node:test';
import assert from 'node:assert/strict';
import {dosModifiers,dosMenuCommands,dosFunctionKeys,dosCycleIndex,DOS_FUNCTION_PAGES} from '../src/ide/dos-shell-model.js';
import {CellBuffer} from '../src/tui/cells.js';
import {paintChrome} from '../src/tui/chrome.js';
import {tuiAttribute} from '../src/tui/appearance.js';

const commands=dosMenuCommands([Object.values(DOS_FUNCTION_PAGES).flat().filter(Boolean).map(id=>({id,label:id}))]);
const context={panes:4,documents:3,document:true,source:true,menu:true,runState:'design'};
const page=(event={},state=context,available=commands)=>dosFunctionKeys(dosModifiers(event),available,state);

test('DOS function keys retain all ten slots and exact existing VB shortcuts',()=>{
  assert.deepEqual(page().map(entry=>entry.id),['help','objectBrowser','findNext','properties','run','dosNextPane','viewCode','stepInto','breakpoint','dosFocusMenu']);
  const shift=page({shiftKey:true}),control=page({ctrlKey:true}),both=page({ctrlKey:true,shiftKey:true});
  assert.equal(shift[1].id,'goToDefinition');assert.equal(shift[1].shortcut,'Shift+F2');
  assert.equal(both[1].id,'lastPosition');assert.equal(both[1].shortcut,'Control+Shift+F2');
  assert.equal(shift[4].id,'stop');assert.equal(shift[4].shortcut,'Shift+F5');
  assert.equal(shift[6].id,'viewForm');assert.equal(shift[7].id,'stepOver');assert.equal(shift[8].id,'quickWatch');
  assert.equal(control[3].id,'dosCloseDocument');assert.equal(control[5].id,'dosNextDocument');assert.equal(control[7].id,'runToCursor');
  assert.equal(both[5].id,'dosPreviousDocument');assert.equal(both[7].id,'stepOut');assert.equal(both[8].id,'clearBreakpoints');
  assert.equal(both[8].displayKey,'CS-F9');
  assert.ok(shift.filter(entry=>!entry.id).every(entry=>!entry.enabled));
});

test('definition navigation uses the installed editor commands and history availability',()=>{
  const menu=history=>dosMenuCommands([[{id:'goToDefinition',label:'Definition'},
    {id:'lastPosition',label:'Last Position',enabled:history>0},
    {id:'nextBookmark',enabled:true},{id:'previousBookmark',enabled:true}]]);
  const definition=page({shiftKey:true},context,menu(0))[1];
  assert.equal(definition.id,'goToDefinition');assert.equal(definition.label,'Definition');assert.equal(definition.enabled,true);
  const unavailable=page({ctrlKey:true,shiftKey:true},context,menu(0))[1];
  assert.equal(unavailable.id,'lastPosition');assert.equal(unavailable.label,'Last pos');assert.equal(unavailable.enabled,false);
  assert.equal(page({ctrlKey:true,shiftKey:true},context,menu(1))[1].enabled,true);
});

test('Meta shortcuts preserve the platform primary modifier; Alt pages advertise no conflicting commands',()=>{
  const meta=page({metaKey:true,shiftKey:true})[7];
  assert.equal(meta.id,'stepOut');assert.equal(meta.shortcut,'Meta+Shift+F8');assert.equal(meta.displayKey,'MS-F8');
  assert.ok(page({altKey:true,ctrlKey:true}).every(entry=>!entry.id&&!entry.enabled));
  assert.equal(dosModifiers({ctrlKey:true,metaKey:true}).primary,'Control');
});

test('canonical command disablement and unavailable contexts propagate to the strip',()=>{
  const disabled=dosMenuCommands([[{id:'help',enabled:false},{id:'stop',enabled:false},{id:'viewCode'}]]);
  assert.equal(page({},context,disabled)[0].enabled,false);
  assert.equal(page({shiftKey:true},context,disabled)[4].enabled,false);
  assert.equal(page({},context,disabled)[1].enabled,false,'absent commands are not invented');
  assert.equal(page({}, {...context,panes:1})[5].enabled,false);
  assert.equal(page({}, {...context,source:false})[2].enabled,false);
  assert.equal(page({shiftKey:true}, {...context,source:false})[2].enabled,false);
  assert.equal(page({ctrlKey:true}, {...context,documents:1})[5].enabled,false);
  assert.equal(page({ctrlKey:true}, {...context,detached:true})[9].enabled,false);
  assert.equal(page({}, {...context,runState:'paused'})[4].label,'Continue');
  assert.equal(page({ctrlKey:true}, {...context,maximized:true})[9].label,'Restore');
  for(const event of [{},{shiftKey:true},{ctrlKey:true},{ctrlKey:true,shiftKey:true}])assert.ok(page(event,{...context,blocked:true}).every(entry=>!entry.enabled));
});

test('menu command scans preserve inherited disablement and do not invoke lazy menu factories',()=>{
  let calls=0;
  const trees=[[{label:'Bookmarks',enabled:false,items:[{id:'toggleBookmark',enabled:true}]},{id:'help'},{label:'Lazy',items:()=>{calls++;return [{id:'injected'}];}}]];
  const entries=dosMenuCommands(trees);
  assert.equal(entries.get('toggleBookmark').enabled,false);assert.equal(entries.get('help').enabled,true);
  assert.equal(entries.has('injected'),false);assert.equal(calls,0);
  assert.equal(dosMenuCommands([[{id:'same',enabled:false}],[{id:'same',enabled:true}]]).get('same').enabled,false);
});

test('recursive and oversized extension menus are bounded without losing already discovered commands',()=>{
  const cycle=[{id:'help'}];cycle.push({items:cycle});
  assert.equal(dosMenuCommands([cycle]).get('help').enabled,true);
  const entries=dosMenuCommands(Array.from({length:10000},(_,i)=>({id:'command'+i})));
  assert.ok(entries.has('command0'));assert.ok(entries.size<=8192);assert.equal(entries.has('command9999'),false);
});

test('pane traversal wraps, reverses and recovers after the current pane has disappeared',()=>{
  assert.equal(dosCycleIndex(4,3,1),0);assert.equal(dosCycleIndex(4,0,-1),3);
  assert.equal(dosCycleIndex(4,-1,1),0);assert.equal(dosCycleIndex(4,-1,-1),3);
  assert.equal(dosCycleIndex(4,8,1),0);assert.equal(dosCycleIndex(0,0),-1);
  assert.equal(dosCycleIndex(Infinity,0),-1);assert.equal(dosCycleIndex(1,0,-1),0);
});

for(const profile of ['turbo','commander','win31','monochrome'])test('function strip paints disabled and keyboard-focused states in '+profile,()=>{
  const buffer=new CellBuffer(32,1);
  paintChrome(buffer,{functionBar:true,items:[
    {kind:'function',x:0,y:0,width:16,height:1,key:'S-F5',text:'Stop',disabled:true},
    {kind:'function',x:16,y:0,width:16,height:1,key:'F6',text:'Next pane',selected:true}
  ]},profile);
  const disabled=tuiAttribute(profile,'disabled'),selected=tuiAttribute(profile,'selected');
  assert.equal(buffer.colors[0],disabled.foreground|disabled.background<<4);
  assert.equal(buffer.colors[6],disabled.foreground|disabled.background<<4);
  assert.equal(buffer.colors[16],selected.hotkey|selected.background<<4);
  assert.equal(buffer.colors[20],selected.foreground|selected.background<<4);
  assert.match(buffer.toText(),/S-F5 Stop/);assert.match(buffer.toText(),/F6 Next pane/);
});
