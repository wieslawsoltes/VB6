import {paintText} from './text-layout.js';
import {TUI_PROFILES,mnemonic} from './cells.js';
import {tuiAttribute} from './appearance.js';
import {paintShape} from './shapes.js';
import {layoutText} from './text-layout.js';
/** The shared model/event implementation remains the authority. These are paint
 * capabilities, not replacement controls. Native islands deliberately preserve
 * graphics, rich content, and third-party browser/OCX interaction. */
export const TUI_CONTROL_CAPABILITIES = Object.freeze(Object.fromEntries([
  ...['Label','TextBox','CommandButton','CheckBox','OptionButton','ComboBox','ListBox','HScrollBar','VScrollBar','Timer','DriveListBox','DirListBox','FileListBox','Shape','Line','Data','TreeView','ListView','ProgressBar','Slider','StatusBar','Toolbar','RichTextBox','MSFlexGrid','MSHFlexGrid','DataGrid','DTPicker','MonthView','UpDown','ImageList','CommonDialog','Adodc'].map(type=>[type,'cells']),
  ...['Form','MDIForm','Frame','PictureBox','TabStrip','SSTab'].map(type=>[type,'container']),
  ...['Image','MSChart'].map(type=>[type,'raster']),
  ...['OLE','WebBrowser'].map(type=>[type,'native'])
]));
export class TuiControlRegistry {
  constructor(){this.adapters=new Map();}
  register(type,paint,{capability='cells'}={}) {
    if(typeof type!=='string'||!type||typeof paint!=='function'||!['cells','container','native','raster'].includes(capability))throw new TypeError('Invalid TUI adapter');
    if(this.adapters.has(type))throw new Error(`TUI adapter already registered: ${type}`);
    const adapter={paint,capability};this.adapters.set(type,adapter);return ()=>{if(this.adapters.get(type)===adapter)this.adapters.delete(type);};
  }
  capability(type){return this.adapters.get(type)?.capability??(Object.hasOwn(TUI_CONTROL_CAPABILITIES,type)?TUI_CONTROL_CAPABILITIES[type]:'native');}
  paint(buffer,state,profile){return (this.adapters.get(state.type)?.paint??paintControl)(buffer,state,profile);}
}
export function paintControl(b,s,profile='turbo') {
  const role=['TextBox','RichTextBox','ComboBox','DTPicker'].includes(s.type)?'field':'panel';
  const normal=tuiAttribute(profile,role),disabled=tuiAttribute(profile,'disabled'),selection=tuiAttribute(profile,'selected');
  const a=s.disabled?disabled:normal,w=b.columns,h=b.rows,fg=a.foreground,bg=a.background;
  const p={foreground:fg,background:bg,accent:selection.foreground,selection:selection.background,
    border:tuiAttribute(profile,'border').foreground,button:tuiAttribute(profile,'button').background};
  const line=(x,y,text,width=w-x,selected=false,mnemonics=false)=>b.text(x,y,text,{width:Math.max(0,width),foreground:selected?selection.foreground:fg,background:selected?selection.background:bg,hotkey:a.hotkey,mnemonics});
  function paintRows(){
    // Sticky table/column headers paint above scrolled body rows, matching the
    // canonical DOM stacking order rather than the document traversal order.
    for(const row of [...s.rows.filter(row=>row.kind!=='header'),...s.rows.filter(row=>row.kind==='header')]){
      if(![row.x,row.y,row.width,row.height??1].every(Number.isSafeInteger)||row.width<=0)continue;
      const height=Math.max(1,row.height||1);if(row.y>=h||row.y+height<=0)continue;
      const unavailable=s.disabled||row.disabled;
      const attribute=unavailable?disabled:row.selected?selection:row.kind==='button'?tuiAttribute(profile,row.pressed?'selected':row.focused?'focusedButton':'button'):row.kind==='header'?tuiAttribute(profile,'menu'):a;
      const ink=attribute.foreground,paper=attribute.background;
      b.pushClip(row.x,row.y,row.width,height);
      let clipped=false;
      try{
        if(row.clip){
          const {x,y,width,height}=row.clip;
          if(![x,y,width,height].every(Number.isSafeInteger)||width<0||height<0)continue;
          b.pushClip(x,y,width,height);clipped=true;
        }
        b.fill(row.x,row.y,row.width,height,' ',ink,paper);
        const width=Math.max(0,row.width-(row.separator?1:0)),text=String(row.text??'');let length=0;
        // Alignment needs at most one visible row of scalar measurement; an
        // enormous cell value must not allocate an equally enormous array.
        for(const glyph of text){if(length>=width)break;length++;}
        const offset=Math.max(0,row.alignment==='right'?width-length:row.alignment==='center'?Math.floor((width-length)/2):0);
        b.text(row.x+offset,row.y,text,{width:width-offset,foreground:ink,background:paper});
        if(row.separator)b.fill(row.x+row.width-1,row.y,1,height,'│',unavailable?ink:p.border,paper);
      }
      finally{if(clipped)b.popClip();b.popClip();}
    }
  }
  b.fill(0,0,w,h,' ',fg,bg);const middle=Math.floor((h-1)/2);
  switch(s.type) {
    case 'CommandButton': {
      const a=s.disabled?disabled:tuiAttribute(profile,s.pressed?'selected':s.focused?'focusedButton':'button');
      b.fill(0,0,w,h,' ',a.foreground,a.background);
      const caption=String(s.caption??s.name??''),value=s.mnemonics!==false?mnemonic(caption):{text:caption,hotkeys:[]};
      const labelLength=Array.from(value.text).length,left=Math.max(0,Math.floor((w-labelLength)/2));
      if(s.defaultButton&&w>=4){b.put(0,middle,'[',a.foreground,a.background);b.put(w-1,middle,']',a.foreground,a.background);}
      b.text(left,middle,caption,{width:w-left,...a,mnemonics:s.mnemonics!==false});break;
    }
    case 'Label': {
      const caption=String(s.caption??s.text??''),value=s.mnemonics!==false?mnemonic(caption):{text:caption,hotkeys:[]};
      const layout=layoutText(value.text,{columns:w,rows:h,wrap:true,alignment:s.alignment});
      // A mnemonic index is a scalar index, whereas line wrapping may create a
      // new row. Follow non-newline scalar consumption without UTF-16 slicing.
      const scalarHot=new Set(value.hotkeys),hot=new Set();let offset=0,index=0;
      for(const glyph of value.text){if(scalarHot.has(index++))hot.add(offset);offset+=glyph.length;}
      for(const cell of layout.cells){b.put(cell.x,cell.y,cell.glyph,hot.has(cell.sourceStart)?a.hotkey:fg,bg);}break;
    }
    case 'CheckBox':case 'OptionButton': {
      const attribute=s.disabled?disabled:s.focused?selection:a;
      b.fill(0,0,w,h,' ',attribute.foreground,attribute.background);
      b.text(0,middle,(s.type==='OptionButton'?`(${s.checked?'•':' '}) `:`[${s.indeterminate?'▒':s.checked?'X':' '}] `)+(s.caption??''),{width:w,...attribute,mnemonics:s.mnemonics!==false});break;
    }
    case 'TextBox':case 'RichTextBox': {paintText(b,s,p);break;}
    case 'ComboBox': {
      if(s.rows?.length)paintRows();
      const width=Math.max(1,w-(s.simple?0:1)),height=Math.min(h,s.inputHeight||1);
      b.fill(0,0,w,height,' ',fg,bg);paintText(b,s,p,{width,height});
      if(!s.simple)line(w-1,0,'▼',1);break;
    }
    case 'DTPicker':case 'DriveListBox': {
      const lines=String(s.text??'').split(/\r?\n/),start=Math.max(0,Math.floor(s.scrollRow||0)),offset=Math.max(0,Math.floor(s.scrollColumn||0));
      for(let y=0;y<Math.min(h,lines.length-start);y++){const visible=Array.from(lines[start+y]).slice(offset,offset+w).join('');line(0,y,s.password?'•'.repeat(Array.from(visible).length):visible,w-(['ComboBox','DriveListBox','DTPicker'].includes(s.type)?1:0));}
      if(['ComboBox','DriveListBox','DTPicker'].includes(s.type))line(w-1,0,'▼',1);break;
    }
    case 'HScrollBar':case 'VScrollBar':case 'Slider':case 'ProgressBar': {
      const vertical=s.type==='VScrollBar'||s.vertical,extent=vertical?h:w,ratio=Math.max(0,Math.min(1,(s.value-s.min)/(s.max-s.min||1)));
      if(s.type==='ProgressBar'){const filled=Math.round(extent*ratio),ink=s.disabled?fg:tuiAttribute(profile,'selected').background;for(let n=0;n<extent;n++)b.put(vertical?Math.floor(w/2):n,vertical?h-1-n:middle,n<filled?'█':'░',n<filled?(ink===bg?fg:ink):fg,bg);break;}
      const attribute=s.disabled?disabled:s.focused?selection:a,ink=attribute.foreground,paper=attribute.background;
      b.fill(0,0,w,h,' ',ink,paper);
      for(let n=0;n<extent;n++)b.put(vertical?Math.floor(w/2):n,vertical?n:middle,n===0?(vertical?'▲':'◄'):n===extent-1?(vertical?'▼':'►'):'░',ink,paper);
      const n=extent<3?0:1+Math.round((extent-3)*(s.reverse?1-ratio:ratio));b.put(vertical?Math.floor(w/2):n,vertical?n:middle,'█',attribute.hotkey===paper?ink:attribute.hotkey,paper);break;
    }
    case 'UpDown':if(!s.rows?.length){line(0,0,'▲');if(h>1)line(0,h-1,'▼');break;}
      // Native stepper button rectangles also cover horizontal orientation.
      paintRows();break;
    case 'Line':b.fill(0,middle,w,1,'─',fg,bg);break;
    case 'Shape':paintShape(b,s,a);break;
    case 'Timer':case 'ImageList':case 'CommonDialog':line(0,0,({Timer:'◷',ImageList:'▧',CommonDialog:'[…]'}[s.type]));break;
    default:
      if(s.rows?.length)paintRows();
      else line(0,0,s.text||s.caption||s.name);
  }
  return b;
}
