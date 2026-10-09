import {canonicalPlatformThemeId} from './platform-themes.js';
/** Original semantic vector artwork for every IDE command and toolbox type.
 * Fluent: fine monoline; macOS: rounded duotone; Motif: square relief;
 * CDE: colored square relief. No fonts, images, remote URLs or platform assets.
 * Geometry is shared semantically, not traced from the classic pixel atlas. */
import {ICON_ART,CONTROL_ART} from './icon-art.js';
const P=(d,fill=false)=>({kind:'path',d,fill});
const R=(x,y,w,h,fill=false)=>({kind:'rect',x,y,w,h,fill});
const C=(x,y,r,fill=false)=>({kind:'circle',x,y,r,fill});
const L=(x,y,u,v)=>P(`M${x} ${y}L${u} ${v}`);
const window=()=>[R(1.5,2.5,13,11,true),L(1.5,5.5,14.5,5.5),L(3.5,4,4,4)];
const page=()=>[P('M3 1.5h7l3 3v10H3z',true),P('M10 1.5v3h3')];
const folder=(open=false)=>open?[P('M1.5 4V3h5l2 2h6v2',true),P('M1.5 6h13l-2 8h-11z',true)]:[P('M1.5 4V2.5h5l2 2h6v9h-13z',true)];
const lines=(x=5,y=7)=>[L(x,y,11.5,y),L(x,y+2.5,10,y+2.5),L(x,y+5,11.5,y+5)];
const arrow=(dir)=>({left:P('M13 8H3m4-4L3 8l4 4'),right:P('M3 8h10M9 4l4 4-4 4'),up:P('M8 13V3M4 7l4-4 4 4'),down:P('M8 3v10M4 9l4 4 4-4')})[dir];
const badge=(kind)=>({plus:[C(11.5,11.5,3.5,true),P('M9.5 11.5h4m-2-2v4')],check:[P('M8.5 11.5l2 2 4-5')],arrow:[P('M9 11h5m-2-2 2 2-2 2')],minus:[C(11.5,11.5,3.5,true),L(9.5,11.5,13.5,11.5)],dots:[P('M10 10h.1m2 0h.1m2 0h.1')],gear:[C(11.5,11.5,3,true),C(11.5,11.5,1)],cross:[P('M9 9l5 5m0-5-5 5')]})[kind];
const search=()=>[C(6.5,6.5,4.5),L(10,10,14.5,14.5)];
const grid=()=>[R(1.5,2.5,13,11,true),L(1.5,6,14.5,6),L(1.5,10,14.5,10),L(5.5,2.5,5.5,13.5),L(10.5,2.5,10.5,13.5)];
const cube=()=>[P('M8 1.5l6 3.2v6.5l-6 3.3-6-3.3V4.7z',true),P('m2 4.7 6 3.4 6-3.4M8 8v6.5')];
const picture=()=>[R(1.5,2.5,13,11,true),C(10.5,6,1.2),P('m2 12 4-4 3 3 2-2 3 3')];
const list=()=>[R(1.5,1.5,13,13,true),P('M4 4h.1M4 8h.1M4 12h.1M7 4h5M7 8h5M7 12h4')];
const book=()=>[P('M2 2.5h4q2 0 2 2 0-2 2-2h4v11h-4q-2 0-2 1-1-1-2-1H2z',true),L(8,4.5,8,14.5)];
const terminal=()=>[R(1.5,2.5,13,11,true),P('m4 6 2.5 2L4 10m4 0h4')];
const chart=()=>[P('M2 2v12h12'),R(4,8,2,4,true),R(8,5,2,7,true),R(12,2,2,10,true)];
const eye=()=>[P('M1 8q7-10 14 0Q8 18 1 8z'),C(8,8,2.3,true)];
const bookmark=()=>[P('M4 1.5h8v13l-4-3-4 3z',true)];
const code=()=>[...page(),P('m6 7-2 2 2 2m4-4 2 2-2 2')];
const keyboard=()=>[R(1.5,4,13,8,true),P('M4 6h.1m3 0h.1m3 0h.1m-6 2h.1m3 0h.1m3 0h.1M4 10h7')];
const commands={};const controls={};
const add=(id,...shapes)=>{if(Object.hasOwn(commands,id))throw Error('Duplicate pack icon '+id);commands[id]=shapes.flat();};
add('missing',R(1.5,1.5,13,13),P('M5.5 5.5q0-3 3-2 3 1 0 3.5L8 9M8 12h.1'));
add('new',page());add('open',folder(true),P('M8 8h5m-2-2 2 2-2 2'));
add('save',P('M2 1.5h10l2 2v11H2z',true),R(5,1.5,6,4),R(4.5,9,7,5.5));
add('save-module',page(),R(8,8,6.5,6.5,true),P('M10 8v2h3V8m-3 5h3'));
add('export',page(),badge('arrow'));add('export-sources',folder(),badge('arrow'));
add('print',R(2,5,12,6,true),R(4,1.5,8,3.5),R(4,9,8,5.5),L(11,7.5,12,7.5));
add('form',window(),R(4,8,4,3),L(10,10,12,10));
add('mdi-form',R(1,1.5,10,10),L(1,4,11,4),R(5.5,6,9,8,true),L(5.5,8.5,14.5,8.5));
add('code',code());add('module',window(),lines(4,7));add('class',cube(),R(10,10,4.5,4.5,true));
add('folder',folder());add('folder-open',folder(true));
add('project',R(1,1,5,4,true),R(10,6,5,4,true),R(10,11.5,5,3.5,true),P('M3.5 5v8h6.5M3.5 8h6.5'));
add('properties',R(2,1.5,12,13,true),P('M7 2v12M4 5h1m4 0h3M4 9h1m4 0h3M4 12h1m4 0h3'));
add('object',cube(),C(4,10,2,true));add('toolbox',R(1.5,5,13,9,true),P('M5 5V2h6v3M2 8h12M7 8v2h2V8'));
add('form-layout',window(),R(4,7.5,7,4.5,true),L(12.5,7,12.5,13));
add('component',P('M2 2h5q-1 4 2 4t2-4h3v5q-4-1-4 2t4 2v3H9q1-4-2-4t-2 4H2z',true));
add('references',book(),P('M10 6h2m-2 3h2'));add('options',C(8,8,4,true),C(8,8,1.5),P('M8 1v3m0 8v3M1 8h3m8 0h3M3 3l2 2m6 6 2 2M3 13l2-2m6-6 2-2'));
add('palette',P('M14.5 7a6.5 6.5 0 1 0-6.5 7c2 0 1-2 1-3s2-2 3-1 2-1 2.5-3z',true),C(4,6,1),C(7,3.8,.8),C(11,5,.8),C(4.5,10,.8));
add('minimize',L(3,12,13,12));add('maximize',R(2.5,2.5,11,11));add('restore',P('M5 5V2h9v9h-3'),R(2,5,9,9));add('close',P('M3 3l10 10M13 3 3 13'));
add('arrow-down',P('m3 6 5 5 5-5'));add('arrow-right',P('m6 3 5 5-5 5'));add('check',P('m2 8 4 4 8-9'));
add('cut',C(4,11.5,2.5),C(12,11.5,2.5),P('m3 2 7.5 7.5M13 2 5.5 9.5'));
add('copy',R(1.5,1.5,9,10),R(5.5,5,9,10,true));add('paste',R(3,3,10,11.5,true),R(5,1.5,6,3),lines(5,7));
add('undo',P('M1.5 7h4m-4 0V3M2 7q3-6 8-3t2 10'));
add('redo',P('M14.5 7h-4m4 0V3m-.5 4q-3-6-8-3T4 14'));
add('delete',P('M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 6v6m2-6v6'));
add('select',P('M3 1.5v12l3.5-3 3 4 2-1.5-3-4H14z',true));
add('pointer',P('M2 1v13l4-3 3 4 2-1-2.5-4.5H14z'));
add('find',search());add('find-project',folder(),C(10,10,3),L(12.3,12.3,15,15));
add('replace',P('M2 4h10m-2-2 2 2-2 2M14 12H4m2-2-2 2 2 2'),R(2,7,3,3),C(11.5,8,1.5));
add('replace-project',folder(),P('M7 9h7l-2-2m2 5H7l2 2'));
for(const [id,dir]of [['indent','right'],['outdent','left']])add(id,P('M8 3h6M8 6h4M8 10h6M8 13h4'),dir==='right'?P('m2 5 3 3-3 3'):P('m5 5-3 3 3 3'));
add('comment',P('M2 2.5h12v9H7l-4 3v-3H2z',true),L(4,6,12,6));add('uncomment',P('M2 2.5h12v9H7l-4 3v-3H2z'),L(1,15,15,1));
add('bookmark',bookmark());add('bookmark-next',bookmark(),P('m10 7 4 3-4 3'));add('bookmark-previous',bookmark(),P('m6 7-4 3 4 3'));
add('definition',code(),badge('arrow'));add('last-position',P('M3 2v7h9M6 6 3 9l3 3'),C(12,4,2,true));
add('list-members',list(),badge('dots'));add('list-constants',list(),P('m9 9 3-2 3 2-3 4z',true));
add('quick-info',C(8,8,6.5),P('M8 7v5m0-8h.1'));
add('parameter-info',P('M4 2Q0 8 4 14M12 2q4 6 0 12'),P('M8 7v5m0-8h.1'));
add('complete-word',P('M1.5 12 5 3l3.5 9M3 8h4'),badge('check'));
add('procedure',R(2,4,12,9,true),P('M4 6h4m-4 3h7m-7 2h3'));
add('full-module',page(),lines(5,6));add('add-procedure',code(),badge('plus'));add('procedure-attributes',code(),badge('gear'));
add('run',P('m4 2 10 6-10 6z',true));add('pause',R(3,2,3,12,true),R(10,2,3,12,true));add('stop',R(3,3,10,10,true));
add('step-into',P('M8 1v8M4 5l4 4 4-4'),R(3,12,10,2,true));commands.step=commands['step-into'];
add('step-over',P('M2 8q0-10 11-2m0-4v4H9'),R(5,11,6,3,true));
add('step-out',P('M8 10V1M4 5l4-4 4 4'),R(3,12,10,2,true));
add('run-to-cursor',P('m1 4 7 4-7 4z',true),P('M12 2v12m-2-12h4m-4 12h4'));
add('next-statement',P('M2 8h7M6 5l3 3-3 3'),P('M11 3h4m-4 5h4m-4 5h4'));
add('breakpoint',C(8,8,5.5,true));add('clear-breakpoints',C(5.5,5.5,3.5,true),badge('cross'));
add('watch',eye());add('locals',list(),P('M9 9l4 4m0-4-4 4'));
add('immediate',terminal());add('add-watch',eye(),badge('plus'));add('quick-watch',eye(),P('M2 2h3M2 2v3'));
add('call-stack',R(2,1.5,9,4,true),R(4,6,9,4,true),R(6,10.5,9,4,true));add('check-syntax',code(),badge('check'));
for(const [id,axis,position] of [['align-left','x',2],['align-right','x',14],['align-center','x',8],['align-top','y',2],['align-bottom','y',14],['align-middle','y',8]]){
 const shapes=[];if(axis==='x'){shapes.push(L(position,1,position,15));for(const [i,w]of [7,4,9].entries())shapes.push(R(position===2?3:position===14?13-w:8-w/2,2+i*4.5,w,2.5,true));}
 else {shapes.push(L(1,position,15,position));for(const [i,h]of [7,4,9].entries())shapes.push(R(2+i*4.5,position===2?3:position===14?13-h:8-h/2,2.5,h,true));}add(id,shapes);
}
add('same-width',R(1.5,1.5,5,6,true),R(9.5,1.5,5,9,true),P('M1.5 13h13m-11-2-2 2 2 2m9-4 2 2-2 2'));
add('same-height',R(1.5,1.5,6,5,true),R(1.5,9.5,9,5,true),P('M13 1.5v13m-2-11 2-2 2 2m-4 9 2 2 2-2'));
add('same-size',R(1,1,5,5,true),R(10,10,5,5,true),P('M6 8h5M6 6h5'));
add('distribute-horizontal',R(1.5,4,2.5,8,true),R(7,4,2,8,true),R(12,4,2.5,8,true),P('M1.5 1v14M14.5 1v14M4 8h3m2 0h3'));
add('distribute-vertical',R(4,1.5,8,2.5,true),R(4,7,8,2,true),R(4,12,8,2.5,true),P('M1 1.5h14M1 14.5h14M8 4v3m0 2v3'));
add('bring-front',R(1.5,1.5,8,8),R(6.5,6.5,8,8,true));add('send-back',R(6.5,6.5,8,8,true),R(1.5,1.5,8,8));
add('grid',[2,6,10,14].flatMap(x=>[2,6,10,14].map(y=>C(x,y,.5,true))));add('align-grid',R(5,5,6,6,true),P('M2 2h.1m4 0h.1m4 0h.1M2 6h.1M2 10h.1M14 2v12H2'));
add('lock',R(3,7,10,7,true),P('M5 7V4a3 3 0 0 1 6 0v3'),L(8,9,8,12));
add('menu',window(),R(3.5,6,9,8,true),P('M6 8h4m-4 3h4'));
add('tab-order',R(1,1,5,5,true),R(10,10,5,5,true),P('M8 3h5v5m-2-2 2 2 2-2M3 8v5h5m-2-2 2 2-2 2'));
for(const dir of ['left','right','up','down'])add(dir,arrow(dir));
add('method',P('M5 2H3v4L1 8l2 2v4h2M11 2h2v4l2 2-2 2v4h-2'),C(8,8,1.5,true));
add('property',page(),L(4,7,10,7),badge('gear'));add('constant',P('M2 3h6m-3 0v10M10 5h4m-4 4h4'));
add('event',P('M9 1 3 9h4l-1 6 7-9H9z',true));add('refresh',P('M13.5 5a6 6 0 0 0-10-1L1.5 6m0-4v4h4M2.5 11a6 6 0 0 0 10 1l2-2m0 4v-4h-4'));
add('help',book(),P('M10 5q3-1 2 2l-1 1m0 3h.1'));
add('question',C(8,8,6.5,true),P('M5.5 5.5q0-3 3-2 3 1 0 3.5L8 9M8 12h.1'));
add('information',C(8,8,6,true),P('M8 7v5m0-8h.1'));add('error',C(8,8,6.5,true),P('m5 5 6 6m0-6-6 6'));
add('warning',P('M8 1.5 15 14H1z',true),P('M8 6v4m0 2h.1'));
// Toolbox glyphs are individual UI metaphors, not a generic component fallback.
const ctl=(id,...shapes)=>{controls[id]=shapes.flat();};
ctl('Pointer',P('M2 1v13l4-3 3 4 2-1-2.5-4.5H14z',true));
ctl('PictureBox',picture(),P('M1 1v14h14'));ctl('Image',picture());
ctl('Label',P('M2 14 8 2l6 12M4 10h8'));
ctl('TextBox',R(1.5,3,13,10,true),P('M3.5 10 5.5 6l2 4M4.5 8h2M11 5v6m-1-6h2m-2 6h2'));
ctl('Frame',P('M4 4H1.5v10h13V4H11M5 2h5v4H5z',true));
ctl('CommandButton',R(1.5,4,13,8,true),L(5,8,11,8));
ctl('CheckBox',R(2,2,12,12,true),P('m4 8 3 3 5-6'));
ctl('OptionButton',C(8,8,6,true),C(8,8,2.5,true));
ctl('ListBox',list());ctl('ComboBox',R(1.5,2,13,5,true),P('m10 4 1.5 1.5L13 4M2 9h12M2 12h8'));
ctl('HScrollBar',R(1,5,14,6,true),P('m4 7-1 1 1 1m8-2 1 1-1 1M7 5v6m2-6v6'));
ctl('VScrollBar',R(5,1,6,14,true),P('m7 4 1-1 1 1m-2 8 1 1 1-1M5 7h6m-6 2h6'));
ctl('Timer',C(8,9,5.5,true),P('M6 1h4M8 1v2m0 3v3l3 1M2 3 1 4m13-1 1 1'));
ctl('DriveListBox',R(1.5,4,13,8,true),P('M4 7h8M11 10h.1m2 0h.1'));
ctl('DirListBox',folder());ctl('FileListBox',R(1.5,1.5,13,13),R(3.5,3,3,4,true),R(3.5,9,3,4,true),P('M8 5h4m-4 6h4'));
ctl('Shape',C(5,5,4,true),R(7,7,7,7,true));ctl('Line',P('M2 14 14 2'),C(2,14,.7,true),C(14,2,.7,true));
ctl('Adodc',C(8,3,4,true),P('M4 3v3q4 3 8 0V3'),R(1.5,9,13,5),P('m5 10-2 1.5L5 13m6-3 2 1.5-2 1.5'));
ctl('Data',R(1.5,5,13,7,true),P('M3 7v3m2-3-2 1.5L5 10m6-3 2 1.5-2 1.5m2-3v3'));
ctl('OLE',R(1.5,3,9,10,true),R(6.5,7,8,7),P('m7 5 4-3m0 0v3m0-3H8'));
ctl('TreeView',P('M3 3v9h7M3 7h7'),R(1.5,1,4,4,true),R(10,5,4.5,4,true),R(10,10,4.5,4,true));
ctl('ListView',R(1.5,1.5,13,13),P('M2 5h12M6 5v9M8 8h4m-4 3h4'),R(3,7,1.5,2,true),R(3,10.5,1.5,2,true));
ctl('ProgressBar',R(1.5,5,13,6),R(3.5,7,7,2,true));
ctl('Slider',L(1,8,15,8),R(5.5,3,4,10,true),P('M2 12v2m10-2v2m3-2v2'));
ctl('UpDown',R(4,1.5,8,13,true),P('M4 8h8m-6-3 2-2 2 2m-4 6 2 2 2-2'));
ctl('Toolbar',R(1.5,4,13,8),R(3,6,3,4,true),R(7.5,6,3,4,true),L(12.5,5.5,12.5,10.5));
ctl('StatusBar',window(),P('M2 10h12m-8 0v3m4-3v3'));
ctl('TabStrip',P('M1.5 6V2H7v4h7.5v8h-13z',true),P('M7 3h6v3M2 6h5'));
ctl('SSTab',P('M1.5 6V2H7v4h7.5v8h-13z',true),P('M7 3h6v3M2 6h5'),R(4,9,7,3));
ctl('WebBrowser',C(8,8,6.5,true),P('M8 1.5q-6 6.5 0 13m0-13q6 6.5 0 13M1.5 8h13M3 4.5h10M3 11.5h10'));
ctl('RichTextBox',page(),P('M5 6h5M5 8h4M5 11h6M6 6v3m-1 0h2'));
ctl('MSFlexGrid',grid());ctl('MSHFlexGrid',grid(),P('M3 7v5h2M3 9h2'));
ctl('DataGrid',grid(),P('m2.5 7.5 2 1.5-2 1.5',true));
ctl('MonthView',R(1.5,3,13,11,true),P('M5 1.5v3M11 1.5v3M2 6h12M4 8h.1m3 0h.1m3 0h.1'),R(7,10,3,3));
ctl('DTPicker',R(1.5,3,13,10,true),P('M4 1.5v3M8 1.5v3M2 6h8m1 2 1.5 2L14 8'),R(4,8,3,3));
ctl('ImageList',R(1,1,10,10),R(5,5,10,10,true),C(12,8,1),P('m5 13 4-4 5 5'));
ctl('CommonDialog',window(),R(5,6,9.5,8.5,true),P('M7 9h5m-5 3h3'));
ctl('MSChart',chart());
for(const id of Object.keys(ICON_ART))if(!commands[id])throw Error('Missing command pack artwork: '+id);
for(const id of Object.keys(CONTROL_ART))if(!controls[id])throw Error('Missing control pack artwork: '+id);
function geometry(shape,family){
 const rounded=family==='macos26'?1.8:family==='fluent'?1:0;
 if(shape.kind==='path')return `d="${shape.d}"`;
 if(shape.kind==='circle')return `cx="${shape.x}" cy="${shape.y}" r="${shape.r}"`;
 return `x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${Math.min(rounded,shape.w/3,shape.h/3)}"`;
}
function render(shapes,family){
 const square=family.startsWith('x11'),mac=family==='macos26';
 const attrs=`stroke="currentColor" stroke-width="${mac?'1.35':square?'1':'1.05'}" stroke-linecap="${square?'square':'round'}" stroke-linejoin="${square?'miter':'round'}"`;
 const nodes=shapes.map(shape=>`<${shape.kind} ${geometry(shape,family)} ${attrs} fill="${shape.fill&&(mac||square)?'var(--vb-pack-fill,currentColor)':'none'}"${shape.fill&&(mac||square)?' fill-opacity="'+(square?'.2':'.14')+'"':''}/>`).join('');
 // Relief is separate authored edge paint, never a filter over the whole UI.
 const relief=square?'<g aria-hidden="true" transform="translate(.5 .5)" opacity=".45" style="color:var(--vb-light)">'+shapes.filter(s=>s.fill).map(s=>`<${s.kind} ${geometry(s,family)} fill="none" stroke="currentColor" stroke-width="1.5"/>`).join('')+'</g>':'';
 return `<g class="icon-pack-body" style="color:var(--vb-pack-ink,currentColor)">${relief}${nodes}</g>`;
}
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
export const ICON_PACKS=freeze(Object.fromEntries(['fluent','macos26','x11'].map(id=>[id,{id,
  icons:Object.fromEntries(Object.entries(commands).map(([name,shapes])=>[name,render(shapes,id)])),
  controls:Object.fromEntries(Object.entries(controls).map(([name,shapes])=>[name,render(shapes,id)]))}])));
export function iconPackForTheme(theme){theme=canonicalPlatformThemeId(theme);if(typeof theme!=='string')return 'classic';const base=theme.replace(/-dark$/,'');return Object.hasOwn(ICON_PACKS,base)?base:'classic';}
export function iconPackBody(name,control,pack){pack=canonicalPlatformThemeId(pack);const profile=typeof pack==='string'&&Object.hasOwn(ICON_PACKS,pack)?ICON_PACKS[pack]:null;if(!profile)return '';
 const table=control?profile.controls:profile.icons;return typeof name==='string'&&Object.hasOwn(table,name)?table[name]:profile.icons.missing;}
export function captionPackSVG(name,pack){pack=canonicalPlatformThemeId(pack);let shapes={detach:[P('M3 5H1.5v9h9V12M7 1.5h7.5V9M14 2 6 10')],help:commands['quick-info'],close:commands.close,maximize:commands.maximize,minimize:commands.minimize,restore:commands.restore}[name];
 if(typeof name!=='string'||!Array.isArray(shapes)||typeof pack!=='string'||!Object.hasOwn(ICON_PACKS,pack))throw new RangeError('Unknown caption glyph');
 if(pack==='macos26')shapes=({maximize:[P('M3 7V3h4zM9 13h4V9z',true)],restore:[P('M3 7h4V3zM9 13V9h4z',true)],minimize:[L(3,8,13,8)],close:[P('m4 4 8 8m0-8-8 8')]}[name]||shapes);
 if(pack==='x11')shapes=({minimize:[R(6,6,4,4)],maximize:[R(3,3,10,10)],restore:[R(5,5,6,6)]}[name]||shapes);
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'+shapes.map(s=>`<${s.kind} ${geometry(s,pack)} fill="${s.fill?'black':'none'}" stroke="black" stroke-width="${pack==='macos26'?1.6:1.3}" stroke-linecap="${pack.startsWith('x11')?'square':'round'}"/>`).join('')+'</svg>';
}
