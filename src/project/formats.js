import {serializeVBW,nativeWindowStatePath} from './native-window-state.js';
import {dataSidecarPath,encodeDataSidecar} from '../data/project-sidecar.js';
import {importNativeFiles,parseNativeProject,patchNativeProject,workspaceFiles,normalizedEntries,listProjectEntries,parseVBG,workspaceProjects,selectWorkspaceProject} from './native-project.js';
import {encodeNativeText,nativePathValue} from './native-text.js';
import {patchNativeSource,serializeNativeCode} from './native-source.js';
import {readRES,writeRES} from './res.js';
import {newId,createForm,newProject,normalizeProject,CONTROL_DEFAULTS,BASIC_CONTROL_TYPES,EXTENDED_CONTROL_TYPES} from './model.js';
import {VBError} from '../language/lexer.js';
import {decodeANSI,encodeANSI} from '../runtime/binary-codec.js';
import {cleanProjectPath,relativeProjectPath,resolveProjectPath,hydrateResources,prepareResources,toBase64} from './frx.js';
export function parseVBValue(value){
  let quoted=false;for(let i=0;i<value.length;i++){if(value[i]==='"'){if(quoted&&value[i+1]==='"'){i++;continue;}quoted=!quoted;}else if(value[i]==="'"&&!quoted){value=value.slice(0,i);break;}}
  value=value.trim();const match=value.match(/^(\$?)"((?:[^"]|"")*)"(.*)$/);if(match){const name=match[2].replace(/""/g,'"'),tail=match[3].trim();return tail?{resource:name,offset:tail.replace(/^:\s*/,''),...(match[1]?{text:true}:{})}:name;}
  if(/^&H/i.test(value)){let n=parseInt(value.slice(2).replace(/&$/,''),16);if(n>2147483647)n-=4294967296;return n;}if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(value))return Number(value.replace(/[dD]/,'e'));if(/^True$/i.test(value))return -1;if(/^False$/i.test(value))return 0;return value;
}
export function serializeVBValue(value){if(typeof value==='string')return '"'+value.replace(/"/g,'""')+'"';if(typeof value==='boolean')return value?'-1':'0';if(value?.resource)return (value.text?'$':'')+'"'+value.resource.replace(/"/g,'""')+'":'+value.offset;return String(value??0);}
const nativePropertyNames=new Map(['Name','Index','Caption','Text','Left','Top','Width','Height','ClientWidth','ClientHeight','ClientLeft','ClientTop','Visible','Enabled','TabIndex','TabStop','Tag','FontName','FontSize','FontBold','FontItalic','FontUnderline','FontStrikethrough','FontCharset','FontWeight',...Object.keys(createForm().form.properties),...Object.values(CONTROL_DEFAULTS).flatMap(Object.keys)].map(k=>[k.toLowerCase(),k]));
const nativeControlNames=new Map([...BASIC_CONTROL_TYPES,...EXTENDED_CONTROL_TYPES,'Form','MDIForm','Menu','UserControl','PropertyPage','UserDocument'].map(k=>[k.toLowerCase(),k]));
const fontKeys={Name:'FontName',Size:'FontSize',Weight:'FontWeight',Charset:'FontCharset',Italic:'FontItalic',Underline:'FontUnderline',Strikethrough:'FontStrikethrough'};
function splitAttributes(lines){const attributes=lines.filter(line=>/^Attribute\s+/i.test(line.trim())).map(l=>l.trim()),code=lines.filter(line=>!/^Attribute\s+/i.test(line.trim())).join('\n').trim()+'\n';return {attributes,code};}
export function parseFRM(text,fileName='Form1.frm'){
  const lines=text.replace(/\r\n?/g,'\n').split('\n'),module=createForm(fileName.split(/[\\/]/).at(-1).replace(/\.(frm|ctl|pag|dob)$/i,'')),stack=[],groups=[],diagnostics=[];let rootSeen=false,rootEnded=false,codeStart=lines.length;module.form.controls=[];module.form.menus=[];module.nativeHeaders=[];
  for(let i=0;i<lines.length;i++){const line=lines[i].trim();let m;if(rootEnded){codeStart=i;break;}
    if(/^VERSION\b/i.test(line)||/^Object\s*=/i.test(line)){module.nativeHeaders.push(line);continue;}if(!line)continue;
    if((m=line.match(/^Begin\s+(\S+)\s+(\w+)\s*(?:'.*)?$/i))){if(groups.length)throw new VBError('Control declaration inside a property group',1002);if(stack.length>=128||module.form.controls.length+module.form.menus.length>=10000)throw new VBError('Designer nesting/control limit exceeded',1002);const rawType=m[1].split('.').at(-1),type=nativeControlNames.get(rawType.toLowerCase())||rawType,node={id:newId(),name:m[2],type,originalType:m[1],nativeParentId:stack.at(-1)?.id||null,parent:stack.length>1?stack.at(-1).name:null,properties:{Name:m[2]},propertyGroups:[]};if(!rootSeen){module.name=m[2];module.form={...node,controls:[],menus:[]};rootSeen=true;stack.push(module.form);}else{if(type==='Menu'){module.form.menus.push(node);node.parent=stack.at(-1)?.type==='Menu'?stack.at(-1).name:null;}else module.form.controls.push(node);stack.push(node);}continue;}
    if((m=line.match(/^BeginProperty\s+(\w+(?:\(\d+\))?)(.*)$/i))){if(!stack.length)throw new VBError('Property group outside a control',1002);if(groups.length>=128)throw new VBError('Property group nesting limit exceeded',1002);const group={name:m[1],suffix:m[2],entries:[],groups:[]};(groups.length?groups.at(-1).groups:stack.at(-1).propertyGroups).push(group);groups.push(group);continue;}
    if(/^EndProperty\s*(?:'.*)?$/i.test(line)){if(!groups.length)throw new VBError('Unexpected EndProperty',1002);groups.pop();continue;}
    if(/^End\s*(?:'.*)?$/i.test(line)){if(groups.length)throw new VBError('Unterminated property group',1002);stack.pop();if(!stack.length&&rootSeen)rootEnded=true;continue;}
    if((m=line.match(/^([A-Za-z_]\w*(?:\(\d+\))?(?:\.[A-Za-z_]\w*(?:\(\d+\))?)*)\s*=\s*(.*)$/))&&stack.length){if(/^(?:__proto__|prototype|constructor)$/i.test(m[1]))throw new VBError('Unsafe property name',1002);const value=parseVBValue(m[2]),node=stack.at(-1),property=nativePropertyNames.get(m[1].toLowerCase())||m[1];if(groups.length){const path=groups.map(g=>g.name).join('.'),key=path.toLowerCase()==='font'?(fontKeys[Object.keys(fontKeys).find(k=>k.toLowerCase()===m[1].toLowerCase())]||'Font'+m[1]):path+'.'+m[1];groups.at(-1).entries.push({name:m[1],key});node.properties[key]=value;if(path.toLowerCase()==='font'&&m[1].toLowerCase()==='weight')node.properties.FontBold=Number(value)>=700?-1:0;}else node.properties[property]=value;}
  }
  if(!rootSeen)throw new VBError('No Begin VB.Form declaration found in '+fileName,1002);if(!rootEnded)throw new VBError('Unterminated form declaration in '+fileName,1002);
  Object.assign(module,splitAttributes(lines.slice(codeStart)),{kind:'form',id:newId(),sourcePath:cleanProjectPath(fileName)});return {module,diagnostics};
}
export function serializeFRM(module,strict=false){
  const lines=module.nativeHeaders?.length?[...module.nativeHeaders]:['VERSION 5.00'],form=module.form;
  const write=(node,depth)=>{const grouped=new Set();const collect=g=>{for(const e of g.entries||[])grouped.add(e.key);for(const child of g.groups||[])collect(child);};for(const g of node.propertyGroups||[])collect(g);const indent='   '.repeat(depth),type=node.originalType||(['Form','MDIForm','Menu','PictureBox','Label','TextBox','Frame','CommandButton','CheckBox','OptionButton','ComboBox','ListBox','HScrollBar','VScrollBar','Timer','DriveListBox','DirListBox','FileListBox','Shape','Line','Image','Data','OLE'].includes(node.type)?'VB.'+node.type:node.type);lines.push(`${indent}Begin ${type} ${node.name}`);
    for(const [key,value]of Object.entries(node.properties||{})){if(key==='Name'||['FontName','FontSize','FontWeight','FontBold','FontItalic','FontUnderline','FontStrikethrough','FontCharset'].includes(key)||grouped.has(key)||['List','GridData','Nodes','Columns','Items','Tabs','Panels','Buttons'].includes(key)&&!value?.resource||typeof value==='object'&&!value?.resource)continue;lines.push(`${indent}   ${key.padEnd(16)}=   ${serializeVBValue(value)}`);}
    const writeGroup=(g,level)=>{const tab='   '.repeat(level);lines.push(`${tab}BeginProperty ${g.name}${g.suffix||''}`);for(const e of g.entries){const value=node.properties[e.key];if(value!==undefined)lines.push(`${tab}   ${e.name.padEnd(16)}=   ${serializeVBValue(e.key==='FontWeight'&&node.properties.FontBold!==undefined?(node.properties.FontBold?700:400):value)}`);}for(const child of g.groups)writeGroup(child,level+1);lines.push(tab+'EndProperty');};
    const groups=node.propertyGroups||[];for(const group of groups)writeGroup(group,depth+1);
    if(node.properties.FontName&&!groups.some(g=>g.name.toLowerCase()==='font')){lines.push(`${indent}   BeginProperty Font`,`${indent}      Name            =   ${serializeVBValue(node.properties.FontName)}`,`${indent}      Size            =   ${node.properties.FontSize||8.25}`,`${indent}      Charset         =   ${node.properties.FontCharset||0}`,`${indent}      Weight          =   ${node.properties.FontBold?700:400}`,`${indent}      Underline       =   ${node.properties.FontUnderline||0}`,`${indent}      Italic          =   ${node.properties.FontItalic||0}`,`${indent}      Strikethrough   =   ${node.properties.FontStrikethrough||0}`,`${indent}   EndProperty`);}
    const belongs=c=>{const parent=c.parent||null;if(parent!==(node===form?null:node.name))return false;const old=[...form.controls,...form.menus].find(p=>p.id===c.nativeParentId);return !old||old.name!==parent||old===node;};for(const c of form.controls.filter(belongs))write(c,depth+1);for(const c of form.menus.filter(belongs))write(c,depth+1);lines.push(indent+'End');
  };write(form,0);lines.push(serializeNativeCode(module,['Attribute VB_GlobalNameSpace = False','Attribute VB_Creatable = False','Attribute VB_PredeclaredId = True','Attribute VB_Exposed = False'],strict));return lines.join('\r\n')+'\r\n';
}
export function parseCodeModule(text,fileName){const name=text.match(/^\s*Attribute\s+VB_Name\s*=\s*"([^"]+)"/im)?.[1]||fileName.split(/[\\/]/).at(-1).replace(/\.(bas|cls|dsr)$/i,''),kind=/\.cls$/i.test(fileName)?'class':'module';let code=text.replace(/\r\n?/g,'\n'),nativeClassHeader;
  if(kind==='class'){const wrapper=code.match(/^VERSION[^\n]*\nBEGIN[\s\S]*?^END\s*\n/im);if(wrapper){nativeClassHeader=wrapper[0].trim();code=code.replace(wrapper[0],'');}}
  return {id:newId(),name,kind,...splitAttributes(code.split('\n')),sourcePath:cleanProjectPath(fileName),...(nativeClassHeader?{nativeClassHeader}:{})};
}
export function parseVBP(text){return parseNativeProject(text);}
function modulePath(m){return m.sourcePath||m.name+(m.kind==='form'?'.frm':m.kind==='class'?'.cls':'.bas');}
function serializeVBPBase(project){const native=project.nativeProject||{},owner=native.path||project.name+'.vbp',raw=(native.entries||[]).filter(e=>!project.resources||e.key.toLowerCase()!=='resfile32'),lines=raw.length?raw.map(e=>e.key+'='+e.value):['Type=Exe','MajorVer=0','MinorVer=2','RevisionVer=0','AutoIncrementVer=0'];for(const m of project.modules){const path=nativePathValue(relativeProjectPath(owner,modulePath(m)));{const kind=m.nativeKind||(m.kind==='form'?'Form':m.kind==='class'?'Class':'Module');lines.push(`${kind}=${['Module','Class'].includes(kind)?m.name+'; ':''}${path}`);};}if(project.resources)lines.push('ResFile32="'+relativeProjectPath(owner,project.resources.fileName)+'"');for(const r of project.references||[])lines.push(`${r.kind}=${r.value}`);lines.push(`Startup="${project.startup}"`,`Name="${project.name}"`);if(!raw.some(e=>e.key.toLowerCase()==='title'))lines.push(`Title="${project.name}"`);return lines.join('\r\n')+'\r\n';}
export function serializeVBP(project){return patchNativeProject(project,serializeVBPBase(project));}
export function canonicalSource(m,strict=false){
  if(m.kind==='form')return serializeFRM(m,strict);
  return (m.kind==='class'?(m.nativeClassHeader||'VERSION 1.0 CLASS\nBEGIN\n  MultiUse = -1\nEND').replace(/\r\n?/g,'\n').replace(/\n/g,'\r\n')+'\r\n':'')+serializeNativeCode(m,[],strict)+'\r\n';
}
function singleSourceFiles(project,options={}){
  const prepared=prepareResources(project),files=Object.assign(Object.create(null),prepared.files),seen=new Set(Object.keys(files).map(p=>p.toLowerCase()));
  const put=(path,value)=>{path=cleanProjectPath(path);const key=path.toLowerCase();if(seen.has(key))throw new VBError('Native output path collision: '+path,1002);seen.add(key);files[path]=value;};
  const owner=project.nativeProject?.path||project.name+'.vbp';
  const sidecar=encodeDataSidecar(project);if(sidecar)put(dataSidecarPath(owner),sidecar);
  if(project.resources)put(project.resources.fileName,writeRES(project.resources));
  put(owner,encodeNativeText(serializeVBP({...project,modules:prepared.modules}),project.nativeProject?.document,options.encoding));
  for(const m of prepared.modules){for(const node of m.form?[m.form,...m.form.controls,...m.form.menus]:[])for(const [key,value]of Object.entries(node.properties||{}))if(value&&typeof value==='object'&&!value.resource&&Object.keys(value).length)throw new VBError('Native export cannot encode structured property '+node.name+'.'+key+'. Save as a browser project to retain this data.',1002);const source=patchNativeSource(m,canonicalSource(m,!m.nativeSource),parseVBValue);put(modulePath(m),encodeNativeText(source,m.nativeSource||{encoding:m.sourceEncoding||'windows-1252',bom:false},options.encoding));}
  if(project.nativeWindowState){const path=nativeWindowStatePath(project);if(!/\.vbw$/i.test(path))throw new Error('Invalid VBW companion path');const existing=Object.keys(files).find(p=>p.toLowerCase()===path.toLowerCase());files[existing||path]=serializeVBW(project);}
  return files;
}
export function sourceFiles(project,options={}){const files=project.nativeWorkspace?workspaceFiles(project,options,singleSourceFiles):singleSourceFiles(project,options);normalizedEntries(Object.entries(files));return files;}
export async function importFiles(entries,options={}){return importNativeFiles(entries,options,{parseFRM,parseCodeModule,canonicalSource});}
export {listProjectEntries,parseVBG,workspaceProjects,selectWorkspaceProject};
