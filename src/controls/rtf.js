/** An original bounded RTF reader/writer and UTF-16 rich-text run model.
 * HTML, native OLE objects, embedded code and external links are never executed.
 */
import {VBError} from '../language/lexer.js';
import {decodeANSI} from '../runtime/binary-codec.js';
export const RTF_LIMITS=Object.freeze({source:5_000_000,text:2_000_000,runs:100_000,depth:256});
export const RICH_DEFAULTS=Object.freeze({fontName:'Arial',fontSize:10,bold:false,italic:false,underline:false,strike:false,hidden:false,color:null,background:null,alignment:0,leftIndent:0,rightIndent:0,firstIndent:0});
// Preserve whether a value came from the control or an explicit character
// format. Equal values can have different inheritance when the theme changes.
export const RICH_INHERITED_FIELDS=Object.freeze({fontName:1,fontSize:2,bold:4,color:8});
const ALL_INHERITED=15;
const explicitFields=(inherited,patch)=>inherited&~Object.keys(patch).reduce((mask,key)=>mask|(RICH_INHERITED_FIELDS[key]||0),0);
const CHAR_KEYS=['fontName','fontSize','bold','italic','underline','strike','hidden','color','background'];
const PARA_KEYS=['alignment','leftIndent','rightIndent','firstIndent'];
const SKIP_DESTINATIONS=new Set(['stylesheet','info','pict','object','objdata','objclass','objname','objtime','filetbl','listtable','listoverridetable','revtbl','rsidtbl','generator','themedata','datastore','header','headerl','headerr','footer','footerl','footerr','footnote','annotation','fldinst','xmlopen','xmlattrname','xmlattrvalue','fontemb','fontfile']);
const CODE_PAGES={65001:'utf-8',1250:'windows-1250',1251:'windows-1251',1252:'windows-1252',1253:'windows-1253',1254:'windows-1254',1255:'windows-1255',1256:'windows-1256',1257:'windows-1257',1258:'windows-1258',932:'shift_jis',936:'gbk',949:'euc-kr',950:'big5',437:'ibm437',850:'ibm850',10000:'macintosh'};
const CHARSETS={0:0,1:0,128:932,129:949,134:936,136:950,161:1253,162:1254,163:1258,177:1255,178:1256,186:1257,204:1251,238:1250};
const fail=message=>{throw new VBError('RTF: '+message,380);};
const sameStyle=(a,b)=>CHAR_KEYS.concat(PARA_KEYS).every(k=>a[k]===b[k]);
export const richText=value=>String(value??'').replace(/\r\n|\r|\n/g,'\r\n');
function append(runs,text,style,inherited=0){if(!text)return;const previous=runs.at(-1);if(previous&&previous.inherited===inherited&&sameStyle(previous.style,style))previous.text+=text;else{if(runs.length>=RTF_LIMITS.runs)fail('formatting run limit exceeded');runs.push({text,style:{...style},inherited});}}
export function parseRTF(source,defaults={}){
  source=String(source);if(source.length>RTF_LIMITS.source)fail('source exceeds 5,000,000 characters');if(!/^\s*\{\\rtf1\b/.test(source))fail('expected an RTF 1 document');
  const base={...RICH_DEFAULTS,...defaults},runs=[],stack=[],fonts=new Map(),colors=[],warnings=new Set();let baseInheritance=ALL_INHERITED,state={style:{...base},inherited:baseInheritance,destination:'body',uc:1,codepage:1252,fontId:0,ignorable:false},i=0,depth=0,roots=0,textSize=0,skip=0,bytes=[],finalStyle=null,finalInheritance=null;
  const warn=word=>{if(warnings.size<32)warnings.add('Unsupported destination or feature: '+word);};
  const output=text=>{
    if(state.destination==='skip')return;
    if(state.destination==='fonttbl'){const font=fonts.get(state.fontId)||{name:'',codepage:0};font.name+=text;fonts.set(state.fontId,font);return;}
    if(state.destination==='colortbl'){for(const c of text)if(c===';'){const has=state.red!==undefined||state.green!==undefined||state.blue!==undefined;colors.push(has?'#'+[state.red||0,state.green||0,state.blue||0].map(n=>Math.max(0,Math.min(255,n)).toString(16).padStart(2,'0')).join(''):null);delete state.red;delete state.green;delete state.blue;}return;}
    textSize+=text.length;if(textSize>RTF_LIMITS.text)fail('text exceeds 2,000,000 UTF-16 units');append(runs,text,state.style,state.inherited);
  };
  const flush=()=>{if(!bytes.length)return;const raw=Uint8Array.from(bytes);bytes=[];const font=fonts.get(state.fontId),page=font?.codepage||state.codepage;if(page===1252){output(decodeANSI(raw));return;}if(!CODE_PAGES[page])fail('unsupported character code page '+page);try{output(new TextDecoder(CODE_PAGES[page],{fatal:true}).decode(raw));}catch{fail('invalid or unavailable character code page '+page);}};
  const character=c=>{if(skip){skip--;return;}if(state.destination==='skip')return;if(c.charCodeAt(0)<=255)bytes.push(c.charCodeAt(0));else{flush();output(c);}};
  while(i<source.length){const c=source[i++];
    if(c==='{'){flush();if(!depth){roots++;if(roots>1)fail('multiple root groups');}if(++depth>RTF_LIMITS.depth)fail('group nesting limit exceeded');stack.push(state);state={...state,style:{...state.style},ignorable:false};skip=0;continue;}
    if(c==='}'){flush();if(!depth)fail('unbalanced closing group');const destination=state.destination;if(depth===1){finalStyle={...state.style};finalInheritance=state.inherited;}state=stack.pop();depth--;skip=0;if(destination==='fonttbl'&&state.destination==='body'){const font=fonts.get(state.defaultFont||0);if(font){state.fontId=state.defaultFont||0;state.style.fontName=font.name.replace(/;.*$/s,'').trim()||base.fontName;base.fontName=state.style.fontName;state.inherited&=~RICH_INHERITED_FIELDS.fontName;baseInheritance&=~RICH_INHERITED_FIELDS.fontName;}}continue;}
    if(!depth){if(!/\s/.test(c))fail('text outside root group');continue;}
    if(c==='\r'||c==='\n')continue;
    if(c!=='\\'){character(c);continue;}
    if(i>=source.length)fail('truncated control sequence');const symbol=source[i];
    if(symbol==="'"){if(!/^[0-9a-f]{2}$/i.test(source.slice(i+1,i+3)))fail('malformed hexadecimal escape');i+=3;if(skip){skip--;continue;}if(state.destination!=='skip')bytes.push(parseInt(source.slice(i-2,i),16));continue;}
    if(!/[a-zA-Z]/.test(symbol)){i++;if(symbol==='*'){flush();state.ignorable=true;continue;}const mapped={'\\':'\\','{':'{','}':'}','~':'\u00a0','-':'\u00ad','_':'\u2011'}[symbol];if(mapped!==undefined){flush();if(skip)skip--;else output(mapped);}continue;}
    flush();const start=i;while(i<source.length&&/[a-zA-Z]/.test(source[i]))i++;const word=source.slice(start,i);if(word.length>32)fail('control word exceeds 32 characters');let sign=1,value,hasNumber=false;if(source[i]==='-'){sign=-1;i++;}const numberStart=i;while(i<source.length&&/\d/.test(source[i]))i++;if(i>numberStart){value=sign*Number(source.slice(numberStart,i));hasNumber=true;if(!Number.isSafeInteger(value))fail('invalid numeric control parameter');}if(source[i]===' ')i++;
    if(word==='bin'){if(!hasNumber||value<0||i+value>source.length)fail('truncated binary destination');i+=value;continue;}
    if(state.destination==='skip')continue;
    if(state.ignorable){state.ignorable=false;if(!['fonttbl','colortbl'].includes(word)){state.destination='skip';warn(word);continue;}}
    if(SKIP_DESTINATIONS.has(word)){state.destination='skip';if(!['info','generator','fontfile','fldinst'].includes(word))warn(word);continue;}
    if(word==='fonttbl'||word==='colortbl'){state.destination=word;continue;}
    if(word==='f'){if(!hasNumber||value<0)fail('invalid font index');state.fontId=value;if(state.destination==='fonttbl'){if(!fonts.has(value))fonts.set(value,{name:'',codepage:0});}else{const font=fonts.get(value);state.style.fontName=font?.name.replace(/;.*$/s,'').trim()||base.fontName;state.inherited&=~RICH_INHERITED_FIELDS.fontName;}continue;}
    if(state.destination==='fonttbl'){if(word==='fcharset'){if(CHARSETS[value]===undefined){warn('font character set '+value);}else fonts.get(state.fontId).codepage=CHARSETS[value];}if(word==='cpg')fonts.get(state.fontId).codepage=value;if(word!=='u'&&word!=='uc')continue;}
    if(state.destination==='colortbl'){if(['red','green','blue'].includes(word)){if(!hasNumber||value<0||value>255)fail('invalid color table component');state[word]=value;}continue;}
    if(word==='uc'){if(!hasNumber||value<0||value>32767)fail('invalid Unicode fallback length');state.uc=value;continue;}
    if(word==='u'){if(!hasNumber||value< -32768||value>65535)fail('invalid Unicode code unit');output(String.fromCharCode(value&65535));skip=state.uc;continue;}
    if(skip){skip--;continue;}
    if(word==='ansicpg'){if(!hasNumber||!CODE_PAGES[value])fail('unsupported character code page '+value);state.codepage=value;continue;}
    if(word==='ansi'){state.codepage=1252;continue;}if(word==='mac'){state.codepage=10000;continue;}
    if(word==='deff'){state.defaultFont=value;continue;}
    if(word==='plain'){for(const key of CHAR_KEYS)state.style[key]=base[key];state.inherited=baseInheritance;continue;}
    if(word==='pard'){for(const key of PARA_KEYS)state.style[key]=base[key];continue;}
    const booleans={b:'bold',i:'italic',ul:'underline',strike:'strike',v:'hidden'};if(booleans[word]){state.style[booleans[word]]=!hasNumber||value!==0;state.inherited&=~(RICH_INHERITED_FIELDS[booleans[word]]||0);continue;}if(word==='ulnone'){state.style.underline=false;continue;}
    if(word==='fs'){if(!hasNumber||value<1||value>32767)fail('invalid font size');state.style.fontSize=value/2;state.inherited&=~RICH_INHERITED_FIELDS.fontSize;continue;}
    if(word==='cf'||word==='highlight'||word==='cb'){state.style[word==='cf'?'color':'background']=colors[value]||null;if(word==='cf')state.inherited=colors[value]?state.inherited&~RICH_INHERITED_FIELDS.color:state.inherited|RICH_INHERITED_FIELDS.color;continue;}
    const align={ql:0,qr:1,qc:2,qj:3};if(word in align){state.style.alignment=align[word];continue;}
    const indent={li:'leftIndent',ri:'rightIndent',fi:'firstIndent'};if(indent[word]){state.style[indent[word]]=value||0;continue;}
    const special={par:'\r\n',line:'\r\n',tab:'\t',emdash:'\u2014',endash:'\u2013',bullet:'\u2022',lquote:'\u2018',rquote:'\u2019',ldblquote:'\u201c',rdblquote:'\u201d',enspace:'\u2002',emspace:'\u2003'};if(special[word]){output(special[word]);continue;}
    if(['trowd','cell','row','intbl','super','sub','pn','upr','pntext'].includes(word))warn(word);
  }
  flush();if(depth)fail('unclosed group');const document=new RichTextDocument(runs,base,baseInheritance);document.warnings=[...warnings];document.originalRTF=source;document.edited=false;if(!document.length||document.text.endsWith('\r\n')){document.tailStyle=finalStyle;document.tailInheritance=finalInheritance;}return document;
}
function escaped(text){let result='';for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c===13){if(text.charCodeAt(i+1)===10)i++;result+='\\par\n';}else if(c===10)result+='\\par\n';else if(c===9)result+='\\tab ';else if(c===92||c===123||c===125)result+='\\'+text[i];else if(c<32||c>126)result+='\\u'+(c>32767?c-65536:c)+'?';else result+=text[i];}return result;}
export function writeRTF(document,{allowLossy=false}={}){
  if(document.originalRTF&&!document.edited)return document.originalRTF;
  if(document.warnings.length&&!allowLossy)fail('cannot export edited unsupported content without flattening to Text first: '+document.warnings.join('; '));
  const fonts=[...new Set([document.defaults.fontName,...document.runs.map(r=>r.style.fontName),...(document.tailStyle?[document.tailStyle.fontName]:[])])],colors=[...new Set([...document.runs.map(r=>r.style),...(document.tailStyle?[document.tailStyle]:[])].flatMap(s=>[s.color,s.background]).filter(Boolean))];
  let result='{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl'+fonts.map((f,i)=>'{\\f'+i+'\\fnil '+escaped(f)+';}').join('')+'}{\\colortbl;'+colors.map(c=>'\\red'+parseInt(c.slice(1,3),16)+'\\green'+parseInt(c.slice(3,5),16)+'\\blue'+parseInt(c.slice(5,7),16)+';').join('')+'}\n';
  const styled=(text,s,group=true)=>(group?'{':'')+'\\pard'+['\\ql','\\qr','\\qc','\\qj'][s.alignment||0]+'\\li'+s.leftIndent+'\\ri'+s.rightIndent+'\\fi'+s.firstIndent+'\\f'+fonts.indexOf(s.fontName)+'\\fs'+Math.round(s.fontSize*2)+'\\b'+Number(s.bold)+'\\i'+Number(s.italic)+'\\ul'+Number(s.underline)+'\\strike'+Number(s.strike)+'\\v'+Number(s.hidden)+'\\cf'+(colors.indexOf(s.color)+1)+'\\highlight'+(colors.indexOf(s.background)+1)+' '+escaped(text)+(group?'}':'');
  for(const {text,style}of document.runs)result+=styled(text,style);
  if(document.tailStyle)result+=styled('',document.tailStyle,false);
  return result+'}';
}
export class RichTextDocument {
  constructor(runs=[],defaults={},defaultInheritance=0){this.defaults={...RICH_DEFAULTS,...defaults};this.defaultInheritance=defaultInheritance&ALL_INHERITED;this.runs=[];this.warnings=[];this.edited=true;this.originalRTF=null;this.tailStyle=null;this.tailInheritance=null;let length=0;for(const run of runs){const text=String(run.text??'');length+=text.length;if(length>RTF_LIMITS.text)fail('text limit exceeded');append(this.runs,text,{...this.defaults,...run.style},(run.inherited??0)&ALL_INHERITED);}this._text=null;}
  static plain(text,defaults={},inherited=ALL_INHERITED){return new RichTextDocument([{text:richText(text),style:defaults,inherited}],defaults,inherited);}
  get text(){return this._text??=(this.runs.map(r=>r.text).join(''));}
  get length(){return this.text.length;}
  checkRange(start,end=start){if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>this.length)fail('invalid selection range');}
  styleAt(offset){this.checkRange(offset);if(offset===this.length&&this.tailStyle)return {...this.tailStyle};let at=0;for(const run of this.runs){if(at+run.text.length>offset||offset===this.length&&at+run.text.length===offset)return {...run.style};at+=run.text.length;}return {...this.defaults};}
  inheritanceAt(offset){this.checkRange(offset);if(offset===this.length&&this.tailStyle)return this.tailInheritance??this.defaultInheritance;let at=0;for(const run of this.runs){if(at+run.text.length>offset||offset===this.length&&at+run.text.length===offset)return run.inherited;at+=run.text.length;}return this.defaultInheritance;}
  slice(start,end=this.length){this.checkRange(start,end);let at=0;const runs=[];for(const r of this.runs){const a=Math.max(start-at,0),b=Math.min(end-at,r.text.length);if(a<b)append(runs,r.text.slice(a,b),r.style,r.inherited);at+=r.text.length;if(at>=end)break;}const doc=new RichTextDocument(runs,this.defaults,this.defaultInheritance);if(end===this.length&&this.tailStyle){doc.tailStyle={...this.tailStyle};doc.tailInheritance=this.tailInheritance;}return doc;}
  replace(start,end,insert,style=this.styleAt(start),inherited=this.inheritanceAt(start)){
    this.checkRange(start,end);const content=insert instanceof RichTextDocument?insert:RichTextDocument.plain(insert,style,inherited);if(this.length-end+start+content.length>RTF_LIMITS.text)fail('text limit exceeded');
    const next=new RichTextDocument([...this.slice(0,start).runs,...content.runs,...this.slice(end).runs],this.defaults,this.defaultInheritance);next.warnings=[...new Set([...this.warnings,...content.warnings])];const tail=end===this.length?(content.tailStyle||null):this.tailStyle,tailInheritance=end===this.length?content.tailInheritance:this.tailInheritance;this.runs=next.runs;this.warnings=next.warnings;this.tailStyle=tail;this.tailInheritance=tail?tailInheritance:null;this._text=null;this.edited=true;return content.length;
  }
  format(start,end,patch){this.checkRange(start,end);if(start===end)return;const selected=this.slice(start,end);selected.runs=selected.runs.map(r=>({text:r.text,style:{...r.style,...patch},inherited:explicitFields(r.inherited,patch)}));this.replace(start,end,selected);}
  paragraphRanges(start,end){
    this.checkRange(start,end);const text=this.text,previous=start>=2?text.lastIndexOf('\r\n',start-2):-1;let a=previous<0?0:previous+2;const ranges=[];
    for(;;){const newline=text.indexOf('\r\n',a),b=newline<0?text.length:newline+2;ranges.push([a,b]);if(newline<0||b>=end)break;a=b;}
    return ranges;
  }
  formatParagraphs(start,end,patch){
    this.checkRange(start,end);const ranges=this.paragraphRanges(start,end),snapshot=this.snapshot();
    try{for(const [a,b] of ranges){const style=this.styleAt(a),change=typeof patch==='function'?patch(style):patch;if(a===b){const inherited=this.inheritanceAt(a);this.tailStyle={...style,...change};this.tailInheritance=explicitFields(inherited,change);this.edited=true;}else this.format(a,b,change);}}
    catch(error){const old=RichTextDocument.restore(snapshot);Object.assign(this,old);throw error;}
  }
  selectionStyle(start,end,key){this.checkRange(start,end);if(start===end)return this.styleAt(start)[key];const runs=this.slice(start,end).runs,value=runs[0]?.style[key]??this.defaults[key];return runs.every(r=>r.style[key]===value)?value:null;}
  snapshot(){return {runs:structuredClone(this.runs),defaults:{...this.defaults},defaultInheritance:this.defaultInheritance,warnings:[...this.warnings],edited:this.edited,originalRTF:this.originalRTF,tailStyle:this.tailStyle?{...this.tailStyle}:null,tailInheritance:this.tailInheritance};}
  static restore(snapshot){const doc=new RichTextDocument(snapshot.runs,snapshot.defaults,snapshot.defaultInheritance??0);Object.assign(doc,{warnings:[...snapshot.warnings],edited:snapshot.edited,originalRTF:snapshot.originalRTF,tailStyle:snapshot.tailStyle?{...snapshot.tailStyle}:null,tailInheritance:snapshot.tailInheritance??null});return doc;}
  toRTF(options){return writeRTF(this,options);}
}
