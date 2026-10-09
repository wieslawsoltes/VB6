/** Authored classic IDE pixel artwork, not extracted Microsoft resources.
 * Every cell is one native 16px pixel. Keep semantic variants separate: a size,
 * alignment, step, or bookmark command must never masquerade as a generic form.
 * See docs/ICON-AUDIT.md for reference provenance and comparison boundaries. */
export const ICON_PALETTE=Object.freeze({k:'#000000',w:'#ffffff',f:'#c0c0c0',s:'#808080',d:'#404040',n:'#000080',b:'#0000ff',t:'#008080',c:'#00ffff',g:'#008000',l:'#00ff00',o:'#808000',y:'#ffff00',h:'#ffff80',r:'#800000',e:'#ff0000',m:'#800080'});
class Pixels {
 constructor(){this.data=Array(256).fill('.');}
 dot(x,y,c='k'){if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>15||y<0||y>15||!(c==='.'||Object.hasOwn(ICON_PALETTE,c)))throw new RangeError('Invalid icon pixel');this.data[y*16+x]=c;return this;}
 rect(x,y,w,h,c='k'){for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)this.dot(i,j,c);return this;}
 line(x,y,u,v,c='k'){const dx=Math.abs(u-x),sx=x<u?1:-1,dy=-Math.abs(v-y),sy=y<v?1:-1;let error=dx+dy;for(;;){this.dot(x,y,c);if(x===u&&y===v)break;const twice=2*error;if(twice>=dy){error+=dy;x+=sx;}if(twice<=dx){error+=dx;y+=sy;}}return this;}
 frame(x,y,w,h,c='k',fill='w'){return this.rect(x,y,w,h,c).rect(x+1,y+1,w-2,h-2,fill);}
 bevel(x,y,w,h){return this.rect(x,y,w,h,'k').rect(x,y,w-1,h-1,'s').rect(x,y,w-2,h-2,'w').rect(x+1,y+1,w-3,h-3,'f');}
 oval(x,y,w,h,edge='k',fill='w'){for(let j=0;j<h;j++)for(let i=0;i<w;i++){const a=(i-(w-1)/2)/(w/2),b=(j-(h-1)/2)/(h/2);if(a*a+b*b<=1){const inner=((i-(w-1)/2)/Math.max(.5,w/2-1))**2+((j-(h-1)/2)/Math.max(.5,h/2-1))**2;this.dot(x+i,y+j,inner<=1?fill:edge);}}return this;}
 text(text,x,y,c='k'){for(const ch of text){const rows=FONT[ch];if(!rows)throw new Error('Unmapped icon letter '+ch);rows.split('/').forEach((row,j)=>[...row].forEach((v,i)=>{if(v==='1')this.dot(x+i,y+j,c);}));x+=4;}return this;}
 copy(other,x=0,y=0){other.data.forEach((c,i)=>{if(c!=='.'&&i%16+x<16&&Math.floor(i/16)+y<16&&i%16+x>=0&&Math.floor(i/16)+y>=0)this.dot(i%16+x,Math.floor(i/16)+y,c);});return this;}
 flip(){this.data=this.data.map((_,i)=>this.data[Math.floor(i/16)*16+15-i%16]);return this;}
 turn(){this.data=this.data.map((_,i)=>this.data[(15-i%16)*16+Math.floor(i/16)]);return this;}
 finish(){return this.data.join('');}
}
const FONT={A:'010/101/111/101/101',B:'110/101/110/101/110',C:'011/100/100/100/011',D:'110/101/101/101/110',E:'111/100/110/100/111',F:'111/100/110/100/100',I:'111/010/010/010/111',L:'100/100/100/100/111',M:'101/111/111/101/101',N:'101/111/111/111/101',O:'010/101/101/101/010',P:'110/101/110/100/100',R:'110/101/110/101/101',S:'011/100/010/001/110',T:'111/010/010/010/010',V:'101/101/101/101/010',W:'101/101/111/111/101',X:'101/101/010/101/101',Z:'111/001/010/100/111','0':'111/101/101/101/111','1':'010/110/010/010/111','2':'110/001/010/100/111','3':'110/001/010/001/110','?':'110/001/010/000/010','!':'010/010/010/000/010','+':'000/010/111/010/000','-':'000/000/111/000/000','=':'000/111/000/111/000'};
const p=()=>new Pixels(),art={},controls={};
const add=(name,pixels)=>{if(Object.hasOwn(art,name))throw new Error('Duplicate icon '+name);art[name]=pixels.finish();};
const ctl=(name,pixels)=>{controls[name]=pixels.finish();};
const page=(lines=true)=>{const a=p().frame(3,1,10,14).rect(10,1,3,3,'f').line(10,1,12,3).line(10,4,12,4);if(lines)a.line(5,6,10,6,'n').line(5,8,10,8,'n').line(5,10,8,10,'n');return a;};
const form=()=>p().bevel(1,2,14,12).rect(2,3,12,2,'n').frame(3,7,5,4,'s').bevel(10,8,4,4);
const folder=()=>p().frame(1,4,14,10,'o','h').rect(2,2,5,3,'o').rect(3,3,3,2,'h').line(2,5,13,5,'w');
const arrow=(direction='right',x=1,y=5,color='n')=>{const a=p().rect(x,y+2,7,2,color);for(let i=0;i<4;i++)a.line(x+4+i,y+i,x+4+i,y+6-i,color);if(direction==='left')a.flip();if(direction==='down')a.turn();if(direction==='up')a.turn().turn().turn();return a;};
const grid=()=>p().frame(1,2,14,12).rect(2,3,12,3,'n').rect(2,7,3,6,'f').line(1,6,14,6,'s').line(1,10,14,10,'s').line(5,2,5,13,'s').line(10,2,10,13,'s');
const lines=(c='n')=>p().line(6,2,14,2,c).line(6,5,12,5,c).line(6,8,14,8,c).line(6,11,12,11,c).line(6,14,14,14,c);
const tick=()=>p().line(2,8,5,11).line(2,9,5,12).line(5,11,12,4).line(5,12,12,5);
const cube=(x=3,y=3,c='h')=>p().frame(x,y+2,9,9,'o',c).line(x,y+2,x+4,y,'o').line(x+4,y,x+8,y+2,'o').line(x,y+2,x+4,y+4,'o').line(x+4,y+4,x+8,y+2,'o').line(x+4,y+4,x+4,y+10,'o');
const picture=()=>p().frame(1,2,14,12).rect(2,3,12,5,'c').rect(2,8,12,5,'w').rect(10,4,2,2,'y').line(2,11,6,7,'g').line(6,7,11,12,'g').line(7,12,11,8,'t').line(11,8,13,10,'t').line(3,12,8,12,'g');
const book=(mark='t')=>p().frame(3,1,10,14,'n','w').rect(4,2,3,12,mark).line(8,5,11,5,'n').line(8,8,11,8,'n');
const magnify=()=>p().oval(1,1,10,10,'k','w').rect(4,3,3,2,'c').line(9,10,13,14).line(10,10,14,14).dot(14,13);
const binoculars=()=>p().rect(3,2,3,4).rect(10,2,3,4).rect(2,5,5,7).rect(9,5,5,7).rect(6,6,4,3).frame(1,8,6,6,'k','w').frame(9,8,6,6,'k','w').rect(2,10,3,2,'f').rect(10,10,3,2,'f').dot(3,3,'w').dot(10,3,'w');
const windowList=(kind)=>{const a=p().bevel(1,2,14,12).rect(2,3,12,2,'n');if(kind==='immediate')a.line(3,7,5,9).line(5,9,3,11).line(7,11,11,11);else{a.rect(2,6,12,7,'w').line(2,9,13,9,'s').line(7,6,7,12,'s');if(kind==='watch')a.dot(3,7,'e').line(9,7,12,7,'n').line(3,11,5,11,'n');else a.text('X',3,7,'n').line(9,11,12,11,'n');}return a;};
// File, shell, project tree, and window chrome.
add('missing',p().frame(1,1,14,14,'r','h').text('?',6,5,'r'));
add('new',page(false));add('open',folder().line(2,9,14,9,'o').line(1,14,4,8,'o').line(4,8,15,8,'o').line(15,8,12,14,'o').line(1,14,12,14,'o'));
add('save',p().frame(1,1,14,14,'k','n').rect(3,2,9,5,'f').rect(9,2,2,4,'k').frame(3,9,10,6,'k','w').line(5,11,10,11,'n').line(5,13,10,13,'n'));
add('save-module',page().copy(p().frame(7,8,8,8,'k','n').rect(9,9,4,2,'f').rect(9,13,4,2,'w')));
add('export',page().copy(arrow('right',7,7,'g')));add('export-sources',folder().text('B',3,7,'n').text('A',8,7,'n'));
add('print',p().frame(4,0,8,5).bevel(1,4,14,8).line(3,7,12,7).dot(12,5,'l').frame(4,9,8,7).line(6,11,9,11).line(6,13,9,13));
add('form',form());add('mdi-form',form().copy(p().bevel(6,6,10,10).rect(7,7,8,2,'n').rect(8,11,5,3,'w')));add('code',page());
add('module',p().bevel(1,2,14,12).rect(2,3,12,2,'n').line(3,7,7,7).line(3,9,11,9).line(3,11,9,11));
add('class',p().copy(cube(1,0)).copy(cube(6,5)));add('folder',folder());add('folder-open',folder().rect(2,7,12,6,'y').line(1,14,4,7,'o').line(4,7,15,7,'o').line(15,7,12,14,'o').line(1,14,12,14,'o'));
add('project',p().bevel(0,0,10,10).rect(1,1,8,2,'n').frame(3,5,12,10,'k','f').frame(6,3,8,7,'k','w').rect(7,4,6,2,'n').rect(1,5,4,3,'h').line(2,9,2,13,'s').line(2,13,5,13,'s').frame(6,11,7,4,'o','h'));
// Properties is the classic hand over a property sheet, not a pencil/grid.
add('properties',p().frame(0,5,11,10).line(2,10,3,10).line(5,10,8,10).line(2,12,3,12).line(5,12,8,12).rect(13,1,3,7,'n').line(7,1,12,1).line(6,2,12,2,'f').line(5,3,6,3).line(7,3,12,3,'f').line(4,4,5,4).dot(6,4,'f').line(7,4,12,4,'f').line(3,5,4,5).dot(5,5,'f').dot(7,5).line(8,5,12,5,'f').line(2,6,3,6).dot(4,6,'f').dot(6,6).dot(8,6,'f').line(9,6,12,6).dot(2,7).dot(5,7).dot(7,7,'f').dot(8,8).dot(6,8));
// The documented Object Browser is a linked family of colored objects.
add('object',p().oval(0,0,5,5,'k','b').frame(12,0,4,4,'k','r').frame(8,2,3,5,'k','g').line(5,3,7,3).line(4,4,4,6).line(3,7,4,6).line(2,8,3,7).line(2,8,4,10).line(4,10,6,8).line(6,8,4,6).frame(11,6,4,3,'k','f').line(6,8,10,8).frame(10,9,4,5,'k','o').frame(4,10,8,6,'k','y'));
add('toolbox',p().frame(1,6,14,9,'k','f').frame(5,3,6,4,'s','f').line(2,8,13,8,'w').line(3,2,11,13,'k').line(4,2,12,13,'y').rect(1,1,5,3,'s').line(12,1,3,13,'k').line(13,1,4,13,'s').line(11,1,14,4,'s'));
add('form-layout',p().bevel(0,1,16,12).rect(2,3,12,8,'t').frame(4,4,7,5,'k','f').rect(5,5,5,1,'n').rect(6,13,4,1,'s').rect(4,14,8,1,'k'));
add('component',cube(0,1).copy(cube(7,5)));add('references',book('h').copy(p().frame(0,8,7,7,'o','h').text('+',2,9,'g')));
add('options',p().bevel(1,2,14,12).line(3,5,12,5,'s').line(3,8,12,8,'s').line(3,11,12,11,'s').bevel(5,3,4,4).bevel(9,6,4,4).bevel(3,9,4,4));
add('palette',p().oval(1,1,14,14,'k','h').rect(3,3,3,3,'e').rect(9,3,3,3,'b').rect(3,8,3,3,'g').rect(8,7,3,3,'m').oval(9,11,4,3,'k','f'));
add('minimize',p().rect(3,11,7,2));add('maximize',p().frame(2,3,11,10,'k','.').rect(2,3,11,2));add('restore',p().frame(5,2,9,9,'k','f').rect(5,2,9,2).frame(2,6,9,8,'k','f').rect(2,6,9,2));
add('close',p().line(4,4,11,11).line(5,4,12,11).line(11,4,4,11).line(12,4,5,11));
add('arrow-down',p().line(4,6,10,6).line(5,7,9,7).line(6,8,8,8).dot(7,9));add('arrow-right',p().line(6,4,6,10).line(7,5,7,9).line(8,6,8,8).dot(9,7));add('check',tick());
// Editing, code assistance, and bookmarks.
add('cut',p().oval(0,9,6,6,'k','.').oval(8,9,6,6,'k','.').line(4,10,12,1).line(9,10,3,1).dot(6,7,'s'));
add('copy',p().frame(0,1,10,11).line(2,3,6,3,'n').line(2,5,6,5,'n').frame(5,5,10,11).line(7,8,12,8,'n').line(7,10,12,10,'n').line(7,12,11,12,'n'));
add('paste',p().frame(1,2,11,13,'o','h').frame(4,0,6,4,'k','f').frame(6,6,10,10).line(8,8,12,8,'n').line(8,10,13,10,'n').line(8,12,11,12,'n'));
const undo=()=>p().line(2,5,10,5,'n').line(10,5,13,8,'n').line(13,8,13,12,'n').line(2,5,5,2,'n').line(2,5,5,8,'n');
add('undo',undo());add('redo',undo().flip());add('delete',p().line(3,3,12,12,'r').line(4,3,13,12,'r').line(12,3,3,12,'r').line(13,3,4,12,'r'));
add('select',p().rect(3,4,10,8,'n').line(5,6,11,6,'w').line(5,9,9,9,'w').line(1,2,14,2).line(1,14,14,14).line(1,2,1,14).line(14,2,14,14).rect(3,2,2,1,'.').rect(7,2,2,1,'.').rect(11,2,2,1,'.'));
add('find',binoculars());add('find-project',folder().copy(binoculars()));add('replace',binoculars().rect(3,0,11,6,'f').text('A',3,0,'n').text('B',11,0,'r').line(7,2,9,2,'g').dot(8,1,'g').dot(8,3,'g'));add('replace-project',page().copy(arrow('right',7,7,'g')).dot(1,1,'y').dot(1,3,'y'));
add('indent',lines().copy(arrow('right',0,4)));add('outdent',lines().copy(p().line(4,5,1,8,'n').line(1,8,4,11,'n').line(1,8,5,8,'n')));
add('comment',lines('g').rect(1,2,2,3,'g').dot(0,5,'g'));add('uncomment',lines('g').rect(1,2,2,3,'g').dot(0,5,'g').line(0,12,14,1,'r'));
const bookmark=()=>p().rect(2,2,9,9,'c').line(1,1,12,1,'n').line(1,1,1,14,'n').line(12,1,12,14,'n').line(1,14,6,10,'n').line(6,10,12,14,'n');
add('bookmark',bookmark());add('bookmark-next',bookmark().copy(arrow('right',7,8)));add('bookmark-previous',bookmark().copy(arrow('left',7,8)));add('definition',page().copy(arrow('right',0,6,'g')));add('last-position',page().copy(arrow('left',1,8,'g')));
add('list-members',p().copy(cube(0,0)).frame(6,6,10,10).line(8,8,13,8,'n').line(8,11,13,11,'n').line(8,14,11,14,'n'));
add('list-constants',p().frame(2,1,13,14).rect(3,2,11,3,'n').text('=',5,6,'n').text('1',5,10,'r'));
add('quick-info',page().rect(0,7,15,7,'h').line(0,7,14,7,'o').line(0,13,14,13,'o').text('I',2,8,'n').line(7,9,12,9).line(7,11,10,11));
add('parameter-info',p().line(1,2,13,2,'n').text('F',1,4,'n').line(6,4,5,5).line(5,5,5,9).line(5,9,6,10).line(13,4,14,5).line(14,5,14,9).line(14,9,13,10).text('X',8,5,'r').rect(0,12,16,3,'h'));
add('complete-word',p().text('A',0,3,'n').text('B',4,3,'n').copy(tick()).line(0,13,13,13,'g'));
add('procedure',p().frame(2,2,12,12).rect(3,3,10,2,'n').line(4,7,10,7,'n').line(4,9,8,9,'n').line(4,11,10,11,'n'));
add('full-module',p().frame(2,2,12,12).line(4,4,10,4,'n').line(4,6,8,6,'n').line(3,8,12,8,'s').line(4,10,10,10,'n').line(4,12,8,12,'n'));
add('add-procedure',page().copy(p().rect(0,10,7,3,'g').rect(2,8,3,7,'g')));add('procedure-attributes',page().copy(p().frame(7,8,8,7,'o','h').text('P',9,9,'n')));
// Debugger. Arrows explicitly communicate entering, passing over, and leaving code.
add('run',p().line(5,3,5,12,'n').line(6,4,6,11,'n').line(7,5,7,10,'n').line(8,6,8,9,'n').line(9,7,10,8,'n'));
add('pause',p().rect(4,3,3,10,'n').rect(10,3,3,10,'n'));add('stop',p().rect(4,4,8,8,'n'));
const debugLines=()=>p().line(7,3,14,3).line(9,5,14,5).line(9,7,14,7).line(9,9,14,9).line(7,11,14,11);
const into=()=>debugLines().line(1,1,7,1,'n').line(0,2,0,6,'n').line(1,7,4,7,'n').rect(3,5,1,5,'n').rect(4,6,1,3,'n').dot(5,7,'n');
add('step-into',into());add('step',into());
add('step-over',debugLines().line(1,0,6,0,'n').line(0,1,0,12,'n').line(1,13,4,13,'n').rect(3,11,1,5,'n').rect(4,12,1,3,'n').dot(5,13,'n'));
add('step-out',p().line(7,8,14,8).line(9,10,14,10).line(9,12,14,12).line(7,14,14,14).line(1,8,6,8,'n').line(0,4,0,7,'n').line(1,3,4,3,'n').rect(3,1,1,5,'n').rect(4,2,1,3,'n').dot(5,3,'n'));
add('run-to-cursor',lines().copy(arrow('right',0,4,'n')).line(13,7,13,14).line(11,7,15,7).line(11,14,15,14));
add('next-statement',lines().copy(arrow('right',0,4,'y')).line(0,7,3,7,'o').line(3,5,6,8,'o').line(6,8,3,11,'o'));
const breakpoint=()=>p().oval(2,2,12,12,'k','r');add('breakpoint',breakpoint());add('clear-breakpoints',breakpoint().line(1,14,14,1,'w').line(2,14,14,2,'s'));
add('watch',windowList('watch'));add('locals',windowList('locals'));add('immediate',windowList('immediate'));
add('add-watch',windowList('watch').copy(p().rect(8,11,8,3,'g').rect(11,8,3,8,'g')));add('quick-watch',windowList('watch').copy(magnify()));
add('call-stack',p().frame(0,1,10,6,'k','w').rect(1,2,8,1,'n').frame(3,5,10,6,'k','w').rect(4,6,8,1,'n').frame(6,9,10,6,'k','w').rect(7,10,8,1,'n'));
add('check-syntax',page().copy(tick()));
// Form Editor: red registration guides, cyan controls, and explicit size arrows.
const align=(mode)=>{const a=p();if(['left','right','center'].includes(mode)){const x=mode==='left'?1:mode==='right'?14:7;a.line(x,0,x,15,'r');const widths=[7,11,5];widths.forEach((w,i)=>a.frame(mode==='left'?2:mode==='right'?14-w:7-Math.floor(w/2),1+i*5,w,4,'k','c'));}else{const y=mode==='top'?1:mode==='bottom'?14:7;a.line(0,y,15,y,'r');[7,11,5].forEach((h,i)=>a.frame(1+i*5,mode==='top'?2:mode==='bottom'?14-h:7-Math.floor(h/2),4,h,'k','c'));}return a;};
for(const [name,mode] of [['align-left','left'],['align-right','right'],['align-top','top'],['align-bottom','bottom'],['align-center','center'],['align-middle','middle']])add(name,align(mode));
const width=()=>p().frame(1,1,6,5,'k','c').frame(9,1,6,10,'k','c').line(1,13,14,13,'n').line(1,13,3,11,'n').line(1,13,3,15,'n').line(14,13,12,11,'n').line(14,13,12,15,'n');
add('same-width',width());add('same-height',width().turn());add('same-size',p().frame(0,0,6,6,'k','c').frame(9,9,6,6,'k','c').text('=',6,4,'n'));
const distribute=()=>p().frame(0,3,3,10,'k','c').frame(6,3,3,10,'k','c').frame(13,3,3,10,'k','c').line(0,0,0,15,'r').line(15,0,15,15,'r').line(3,7,5,7,'n').line(9,7,12,7,'n').dot(4,6,'n').dot(4,8,'n').dot(11,6,'n').dot(11,8,'n');
add('distribute-horizontal',distribute());add('distribute-vertical',distribute().turn());
add('bring-front',p().frame(1,1,9,9,'k','w').frame(5,5,10,10,'k','c').rect(7,7,2,2,'w'));
add('send-back',p().frame(5,5,10,10,'k','c').frame(1,1,9,9,'k','w').rect(3,3,2,2,'f'));
const dots=()=>{const a=p();for(let y=1;y<16;y+=3)for(let x=1;x<16;x+=3)a.dot(x,y,'s');return a;};
add('grid',dots());add('align-grid',dots().frame(4,4,7,7,'k','c').line(0,4,3,4,'r').line(4,0,4,3,'r'));
add('lock',p().oval(4,1,8,11,'k','f').oval(6,3,4,7,'k','.').frame(2,7,12,8,'o','h').rect(7,9,2,3).dot(8,12));
add('menu',p().bevel(0,1,16,14).rect(1,2,14,2,'n').rect(2,5,12,2,'w').frame(3,6,10,9,'k','f').rect(4,7,8,2,'n').line(5,10,10,10).line(5,12,8,12));
add('tab-order',p().frame(0,1,7,7,'k','w').text('1',2,2,'n').frame(9,8,7,7,'k','w').text('2',11,9,'n').line(3,10,3,13,'n').line(3,13,7,13,'n').dot(6,12,'n').dot(6,14,'n'));
for(const dir of ['left','right','up','down'])add(dir,arrow(dir));
// Object Browser member kinds and status/help glyphs.
add('method',p().rect(2,1,5,12,'n').rect(3,2,3,10,'c').line(7,6,13,6,'n').line(13,6,13,13,'n').text('M',9,8,'n'));
add('property',p().frame(1,2,9,12).rect(2,3,7,2,'n').line(3,7,7,7,'s').copy(p().line(5,14,14,5,'k').line(6,14,14,6,'y').dot(14,4)));
add('constant',p().text('1',1,4,'n').text('=',5,4,'n').text('A',10,4,'r').line(1,12,13,12,'s'));
add('event',p().line(7,0,3,8,'o').line(3,8,7,8,'o').line(7,8,5,15,'o').line(5,15,13,5,'o').line(13,5,9,5,'o').line(9,5,11,0,'o').line(7,0,11,0,'o').line(8,2,5,7,'y').line(5,7,9,7,'y').line(9,7,7,11,'y'));
add('refresh',p().line(2,6,2,11,'n').line(2,11,5,14,'n').line(5,14,10,14,'n').line(10,14,13,11,'n').line(13,9,13,4,'n').line(13,4,10,1,'n').line(10,1,5,1,'n').line(5,1,2,4,'n').line(0,3,2,5,'n').line(2,5,5,5,'n').line(10,10,13,10,'n').line(13,10,15,12,'n'));
for(const [name,letter,edge,fill,ink] of [['help','?','o','h','n'],['question','?','k','n','w'],['information','I','k','n','w'],['error','X','k','r','w']])add(name,p().oval(1,1,14,14,edge,fill).text(letter,6,5,ink));
add('warning',p().line(7,0,0,14).line(7,0,15,14).line(0,14,15,14).line(7,2,2,13,'y').line(7,2,13,13,'y').rect(4,8,8,6,'y').text('!',6,7));
// Intrinsic toolbox, in VB6 order. The native image is 16px, centered, not 20px stretched.
const pointer=()=>p().line(2,0,2,13,'w').line(3,1,3,12).line(4,2,4,11).line(5,3,5,10).line(6,4,6,12).line(7,5,7,14).line(8,6,8,15).line(9,7,9,9).line(10,8,11,9).line(9,13,10,14,'w');
ctl('Pointer',pointer());add('pointer',pointer());ctl('PictureBox',picture().bevel(0,1,3,14).line(3,14,14,14,'s'));ctl('Image',picture());
ctl('Label',p().line(2,14,7,1).line(3,14,8,1).line(8,1,13,14).line(9,2,14,14).line(5,9,11,9).line(1,14,5,14).line(11,14,15,14));
ctl('TextBox',p().frame(0,2,16,12,'s','w').text('A',2,6).text('B',6,6).line(12,4,12,11).line(11,4,13,4).line(11,11,13,11));
ctl('Frame',p().frame(1,4,14,11,'s','f').line(2,14,14,14,'w').line(14,5,14,14,'w').rect(3,2,8,4,'f').line(4,2,4,5).line(4,2,8,2).line(4,4,7,4));
ctl('CommandButton',p().bevel(0,4,16,9).line(4,8,11,8));ctl('CheckBox',p().frame(1,2,13,12,'s','w').copy(tick()));ctl('OptionButton',p().oval(1,1,14,14,'s','w').oval(5,5,6,6,'k','k'));
const list=()=>p().frame(1,1,14,14).rect(11,2,3,12,'f').line(3,4,9,4,'n').line(3,7,8,7,'n').line(3,10,9,10,'n').line(3,13,7,13,'n').dot(12,3).dot(12,12);
ctl('ListBox',list());ctl('ComboBox',list().frame(1,1,14,6).bevel(10,1,5,6).line(11,3,13,3).dot(12,4));
const scroll=()=>p().frame(0,4,16,8,'s','f').bevel(0,4,5,8).bevel(11,4,5,8).line(3,6,1,8).line(1,8,3,10).line(12,6,14,8).line(14,8,12,10).bevel(6,4,4,8);
ctl('HScrollBar',scroll());ctl('VScrollBar',scroll().turn());ctl('Timer',p().oval(2,3,12,12,'k','w').rect(6,0,4,2).rect(7,2,2,2,'s').line(8,5,8,9).line(8,9,11,11).line(1,3,3,1).line(12,1,14,3));
ctl('DriveListBox',p().bevel(0,4,16,9).rect(2,6,10,2,'s').line(2,10,10,10).dot(13,10,'l'));
ctl('DirListBox',folder());ctl('FileListBox',p().frame(1,1,14,14).rect(2,2,4,5,'f').line(7,3,12,3,'n').line(7,5,11,5,'n').rect(2,9,4,5,'f').line(7,10,12,10,'n').line(7,12,11,12,'n'));
ctl('Shape',p().oval(0,0,10,10,'n','c').frame(6,6,10,10,'r','e'));ctl('Line',p().line(1,14,14,1));
ctl('Adodc',p().bevel(0,5,16,9).line(2,7,2,11).line(5,7,3,9).line(3,9,5,11).line(10,7,12,9).line(12,9,10,11).line(13,7,13,11).rect(4,0,8,4,'n').text('A',6,0,'w'));
ctl('Data',p().bevel(0,4,16,9).line(2,6,2,10).line(5,6,3,8).line(3,8,5,10).line(10,6,12,8).line(12,8,10,10).line(13,6,13,10));ctl('OLE',p().frame(0,3,16,11,'s','w').text('OLE',2,6));
// Distinct common-controls/ActiveX silhouettes (not generic grid aliases).
ctl('TreeView',p().frame(0,0,16,16).line(3,3,3,12,'s').line(3,7,8,7,'s').line(3,12,8,12,'s').frame(1,1,5,4,'o','h').frame(8,5,6,4,'o','h').frame(8,10,6,4,'o','h'));
ctl('ListView',p().frame(0,1,16,14).rect(1,2,14,3,'f').rect(2,6,3,3,'c').rect(2,11,3,3,'h').line(7,7,12,7,'n').line(7,12,12,12,'n'));
ctl('ProgressBar',p().frame(0,5,16,7,'s','w').rect(2,7,3,3,'n').rect(6,7,3,3,'n').rect(10,7,3,3,'n'));
ctl('Slider',p().frame(0,6,16,3,'s','w').bevel(5,2,6,10).line(2,12,2,14).line(6,12,6,14).line(10,12,10,14).line(14,12,14,14));
ctl('UpDown',p().bevel(4,0,9,8).bevel(4,8,9,8).line(7,4,9,4).dot(8,3).line(7,11,9,11).dot(8,12));
ctl('Toolbar',p().bevel(0,3,16,11).bevel(1,5,5,7).bevel(6,5,5,7).line(13,5,13,11,'s').dot(2,7,'e').dot(7,7,'n'));
ctl('StatusBar',form().frame(1,10,14,5,'s','f').line(6,11,6,13,'s').line(11,11,11,13,'s').dot(13,13));
const tab=()=>p().bevel(0,5,16,11).bevel(0,1,7,6).bevel(7,2,7,4).rect(1,5,5,2,'f').line(2,3,4,3);
ctl('TabStrip',tab());ctl('SSTab',tab().frame(3,8,10,5,'s','w').rect(4,9,4,3,'n'));
ctl('WebBrowser',p().oval(1,1,14,14,'n','c').oval(5,1,6,14,'n','c').line(1,7,14,7,'n').line(3,4,12,4,'n').line(3,11,12,11,'n'));
ctl('RichTextBox',page(false).text('R',5,5,'n').line(5,11,11,11,'r').line(5,13,9,13));
ctl('MSFlexGrid',grid());ctl('MSHFlexGrid',grid().rect(2,3,12,3,'t').rect(2,7,3,6,'w').line(3,7,3,11,'s').line(3,11,6,11,'s').frame(2,7,3,3,'s','w'));
ctl('DataGrid',grid().rect(2,7,12,3,'n').line(2,7,4,8,'w').line(4,8,2,9,'w'));
const calendar=()=>{const a=p().frame(1,1,14,14).rect(2,2,12,3,'n');for(let y=7;y<14;y+=3)for(let x=3;x<14;x+=3)a.dot(x,y);return a;};
ctl('MonthView',calendar().frame(8,9,4,4,'r','w').dot(9,10));ctl('DTPicker',p().frame(0,3,16,10).text('1',2,6).text('2',6,6).bevel(11,3,5,10).line(12,7,14,7).dot(13,8));
ctl('ImageList',p().copy(picture(),-2,-2).copy(picture(),3,3));ctl('CommonDialog',form().copy(p().bevel(4,5,12,11).rect(5,6,10,2,'n').frame(6,9,5,4,'s','w').bevel(12,10,3,4)));
ctl('MSChart',p().frame(0,1,16,14,'s','w').rect(2,9,3,4,'r').rect(6,6,3,7,'g').rect(10,3,3,10,'n').line(1,13,14,13));
export const ICON_ART=Object.freeze(art);
export const CONTROL_ART=Object.freeze(controls);
