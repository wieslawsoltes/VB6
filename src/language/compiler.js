import {bindConstants} from './binding.js';
import {defaultIdentifierType,addDefaultTypes} from './default-types.js';
import {validateInterfaces} from './interfaces.js';
import { preprocess } from './conditional.js';
import { VBError, logicalLines, splitTop, tokenize } from './lexer.js';
import { parseExpression, parseCall } from './expression.js';
import { lower } from '../core/core.js';

const E = text => parseExpression(text);
const suffixType = defaultIdentifierType;
export function parseDeclarations(text, isConst = false, defaultTypes = {}) {
  return splitTop(text).map(part => {
    const withEvents=/^WithEvents\s+/i.test(part);part=part.replace(/^WithEvents\s+/i,'');
    const m=part.match(/^([A-Za-z_]\w*[$%&!#@]?)(?:\s*\((.*?)\))?\s*(?:As\s+(New\s+)?([\w.]+)(?:\s*\*\s*(\d+))?)?\s*(?:=\s*(.+))?$/i);
    if(!m)throw new VBError(`Invalid declaration: ${part}`,1002);
    if(isConst&&(!m[6]||m[2]!==undefined||m[3]||m[5]))throw new VBError('Constant expression required',1002);
    if(/^Decimal$/i.test(m[4]||''))throw new VBError('Decimal is a Variant subtype; use CDec instead of As Decimal',1002);
    const bounds=m[2]===undefined?null:m[2].trim()===''?[]:splitTop(m[2]).map(b=>{const r=b.split(/\s+To\s+/i);return r.length===2?[E(r[0]),E(r[1])]:[null,E(r[0])];});
    if(withEvents&&(bounds!==null||m[3]||isConst))throw new VBError('WithEvents cannot be combined with arrays, New, or Const',1002);
    return {withEvents,name:m[1],type:m[4]||suffixType(m[1],defaultTypes),explicitType:!!m[4]||/[$%&!#@]$/.test(m[1]),autoNew:!!m[3],fixedLength:m[5]?Number(m[5]):null,bounds,constant:isConst,initial:m[6]?E(m[6]):null};
  });
}
export function parseParameters(text,defaultTypes={}) {
  if(!text.trim())return [];
  const params=splitTop(text).map(part=>{
    let optional=false,byRef=true,paramArray=false;const modifiers=new Set();
    while(true){const m=part.match(/^(Optional|ByVal|ByRef|ParamArray)\b\s*/i);if(!m)break;
      const key=lower(m[1]);if(modifiers.has(key)||(['byval','byref'].includes(key)&&[...modifiers].some(v=>['byval','byref'].includes(v))))throw new VBError('Invalid parameter modifier',1002);
      modifiers.add(key);if(key==='optional')optional=true;if(key==='byval')byRef=false;if(key==='paramarray'){paramArray=true;byRef=false;}part=part.slice(m[0].length);
    }
    const decl=parseDeclarations(part,false,defaultTypes)[0];return {...decl,optional,byRef,paramArray};
  });
  let optionalSeen=false;const names=new Set();
  for(let i=0;i<params.length;i++){const p=params[i],key=lower(p.name);if(names.has(key))throw new VBError('Duplicate parameter: '+p.name,1002);names.add(key);
    if(p.paramArray){if(i!==params.length-1||p.optional||p.bounds?.length!==0||lower(p.type)!=='variant'||p.initial)throw new VBError('ParamArray must be the final Variant array parameter',1002);}
    else if(optionalSeen&&!p.optional)throw new VBError('Required parameter cannot follow Optional parameter',1002);
    if(p.initial&&!p.optional)throw new VBError('Default value requires Optional',1002);
    if(p.autoNew||p.fixedLength)throw new VBError('Invalid procedure parameter declaration',1002);
    optionalSeen ||= p.optional;
  }
  return params;
}

const DEBUG_SOURCE_LINES=new WeakMap();
class ProcedureCompiler {
  constructor(proc,module) { this.proc=proc;this.module=module;this.code=[];this.blocks=[];this.labels=new Map();this.patches=[];this.temp=0;this.debugStatement=null;this.debugColumns=new Map();if(!DEBUG_SOURCE_LINES.has(module))DEBUG_SOURCE_LINES.set(module,module.source.replace(/\r\n?/g,'\n').split('\n'));this.sourceLines=DEBUG_SOURCE_LINES.get(module); }
  emit(op,data={},line=0){
    const index=this.code.length,statement=this.debugStatement;
    // A VB statement may lower to several instructions. Only its first visible
    // instruction is a sequence point; declarations and synthetic jumps are not.
    const sequencePoint=!!statement&&!statement.emitted&&!data.implicit&&op!=='dim'&&data.sequencePoint!==false;
    if(sequencePoint)statement.emitted=true;
    this.code.push({op,...data,line,source:this.module.name,procedure:this.proc.name,sequencePoint,...(sequencePoint&&statement.column?{column:statement.column,endColumn:statement.endColumn}:{})});return index;
  }
  jump(target,line,hidden=false){return this.emit('jump',{target,...(hidden?{sequencePoint:false}:{})},line);}
  patch(index,target){this.code[index].target=target;}
  block(type,line){const b=this.blocks.at(-1);if(!b||b.type!==type)throw new VBError(`Expected matching ${type} block`,1002,this.module.name,line);return b;}
  compile(lines) {
    for(const {text,line,label} of lines) {
      try { if(label){this.label(text,line);continue;} this.statement(text,line); }
      catch(error){if(error instanceof VBError){error.source ||= this.module.name;error.line ||= line;}throw error;}
    }
    if(this.blocks.length)throw new VBError(`Unclosed ${this.blocks.at(-1).type} block`,1002,this.module.name,lines.at(-1)?.line||1);
    this.emit('return',{implicit:true},lines.at(-1)?.line||this.proc.line);
    for(const {index,label,field='target',slot} of this.patches){if(!this.labels.has(/^\d+$/.test(label)?String(Number(label)):lower(label)))throw new VBError(`Label not defined: ${label}`,1002,this.module.name,this.code[index].line);if(slot===undefined)this.code[index][field]=this.labels.get(/^\d+$/.test(label)?String(Number(label)):lower(label));else this.code[index].targets[slot]=this.labels.get(/^\d+$/.test(label)?String(Number(label)):lower(label));}
    return this.code;
  }
  label(name,line){const key=/^\d+$/.test(name)?String(Number(name)):lower(name);if(this.labels.has(key))throw new VBError(`Duplicate label: ${name}`,1002,this.module.name,line);this.labels.set(key,this.code.length);if(/^\d+$/.test(name)){const number=Number(name);if(number>65535)throw new VBError('Line number must be between 0 and 65535',1002,this.module.name,line);this.emit('lineNumber',{number,implicit:true},line);}}
  statement(original,line,column=null) {
    const previous=this.debugStatement,text=original.trim(),source=this.sourceLines[line-1]||'';
    const offset=column===null?source.indexOf(text,this.debugColumns.get(line)||0):column-1;
    // Continued statements keep their physical starting line; do not invent a
    // single-line span when the logical statement is absent from that line.
    const found=offset>=0&&source.slice(offset,offset+text.length)===text;
    this.debugStatement={emitted:false,column:found?offset+1:null,endColumn:found?offset+text.length+1:null};
    if(column===null&&found)this.debugColumns.set(line,offset+text.length);
    try{return this.compileStatement(original,line);}finally{this.debugStatement=previous;}
  }
  compileStatement(original,line) {
    let text=original.trim(),m;
    if(!text||/^Rem\b/i.test(text))return;
    if(/^\d+$/.test(text)){const index=this.jump(null,line);this.patches.push({index,label:text});return;}
    if((m=text.match(/^If\s+(.+?)\s+Then\s*(.*)$/i))) {
      const index=this.emit('branch',{test:E(m[1]),target:null},line);
      if(m[2]){
        const p=new RegExp('\\bElse\\b','ig');let match,at=-1,quoted=false;
        // Use tokens to distinguish an Else keyword from string contents.
        const ts=tokenize(m[2]);const et=ts.find(t=>t.type==='id'&&lower(t.value)==='else');if(et)at=et.start;
        const yes=at<0?m[2]:m[2].slice(0,at), no=at<0?'':m[2].slice(at+4);
        const origin=this.debugStatement.column,bodyOffset=text.length-m[2].length;
        if(origin)this.code[index].endColumn=origin+bodyOffset;
        const compileParts=(body,offset)=>{let cursor=0;for(const s of splitTop(body,':')){const at=body.indexOf(s,cursor);this.statement(s,line,origin===null?null:origin+offset+at);cursor=at+s.length;}};
        compileParts(yes,bodyOffset);
        if(no){const end=this.jump(null,line,true);this.patch(index,this.code.length);compileParts(no,bodyOffset+at+4);this.patch(end,this.code.length);}else this.patch(index,this.code.length);
      }else this.blocks.push({type:'If',pending:index,ends:[]});
      return;
    }
    if((m=text.match(/^ElseIf\s+(.+?)\s+Then$/i))){const b=this.block('If',line);b.ends.push(this.jump(null,line,true));this.patch(b.pending,this.code.length);b.pending=this.emit('branch',{test:E(m[1]),target:null},line);return;}
    if(/^Else$/i.test(text)){const b=this.block('If',line);b.ends.push(this.jump(null,line,true));this.patch(b.pending,this.code.length);b.pending=null;return;}
    if(/^End\s*If$/i.test(text)){const b=this.block('If',line);if(b.pending!=null)this.patch(b.pending,this.code.length);for(const i of b.ends)this.patch(i,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^For\s+Each\s+(\w+)\s+In\s+(.+)$/i))){const id=`$each${this.temp++}`,index=this.emit('eachInit',{name:m[1],expr:E(m[2]),id,target:null},line);this.blocks.push({type:'For',kind:'each',id,index,start:this.code.length,name:m[1],exits:[]});return;}
    if((m=text.match(/^For\s+([\w.$%&!#@]+)\s*=\s*(.+?)\s+To\s+(.+?)(?:\s+Step\s+(.+))?$/i))){const id=`$for${this.temp++}`,index=this.emit('forInit',{name:m[1],start:E(m[2]),end:E(m[3]),step:E(m[4]||'1'),id,target:null},line);this.blocks.push({type:'For',kind:'numeric',id,index,start:this.code.length,name:m[1],exits:[]});return;}
    if((m=text.match(/^Next(?:\s+(.+))?$/i))){const names=m[1]?splitTop(m[1]):[''];for(const name of names){const b=this.block('For',line);if(name&&lower(name)!==lower(b.name))throw new VBError('Next control variable does not match For',1002);this.emit(b.kind==='each'?'eachNext':'forNext',{id:b.id,target:b.start},line);this.patch(b.index,this.code.length);for(const i of b.exits)this.patch(i,this.code.length);this.blocks.pop();}return;}
    if((m=text.match(/^Do(?:\s+(While|Until)\s+(.+))?$/i))){const b={type:'Do',start:this.code.length,exits:[]};if(m[1])b.test=this.emit('branch',{test:E(m[2]),invert:/until/i.test(m[1]),target:null},line);this.blocks.push(b);return;}
    if((m=text.match(/^Loop(?:\s+(While|Until)\s+(.+))?$/i))){const b=this.block('Do',line);if(m[1]){const end=this.emit('branch',{test:E(m[2]),invert:/until/i.test(m[1]),target:null},line);this.jump(b.start,line);this.patch(end,this.code.length);}else this.jump(b.start,line);if(b.test!=null)this.patch(b.test,this.code.length);for(const i of b.exits)this.patch(i,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^While\s+(.+)$/i))){const start=this.code.length,test=this.emit('branch',{test:E(m[1]),target:null},line);this.blocks.push({type:'While',start,test,exits:[]});return;}
    if(/^Wend$/i.test(text)){const b=this.block('While',line);this.jump(b.start,line);this.patch(b.test,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^Select\s+Case\s+(.+)$/i))){const id=`$select${this.temp++}`;this.emit('temp',{id,expr:E(m[1])},line);this.blocks.push({type:'Select',id,pending:null,ends:[],hasCase:false});return;}
    if((m=text.match(/^Case\s+(.+)$/i))){const b=this.block('Select',line);if(b.hasCase)b.ends.push(this.jump(null,line,true));if(b.pending!=null)this.patch(b.pending,this.code.length);b.hasCase=true;if(/^Else$/i.test(m[1]))b.pending=null;else {const cases=splitTop(m[1]).map(s=>{const r=s.match(/^(.+)\s+To\s+(.+)$/i),c=s.match(/^Is\s*(<=|>=|<>|=|<|>)\s*(.+)$/i);return r?{kind:'range',low:E(r[1]),high:E(r[2])}:c?{kind:'compare',op:c[1],expr:E(c[2])}:{kind:'value',expr:E(s)};});b.pending=this.emit('case',{id:b.id,cases,target:null},line);}return;}
    if(/^End\s+Select$/i.test(text)){const b=this.block('Select',line);if(b.pending!=null)this.patch(b.pending,this.code.length);for(const i of b.ends)this.patch(i,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^With\s+(.+)$/i))){this.emit('withPush',{expr:E(m[1])},line);this.blocks.push({type:'With'});return;}
    if(/^End\s+With$/i.test(text)){this.block('With',line);this.emit('withPop',{},line);this.blocks.pop();return;}
    if((m=text.match(/^Exit\s+(Sub|Function|Property|For|Do)\b/i))){if(/^(Sub|Function|Property)$/i.test(m[1]))this.emit('return',{},line);else{const type=m[1].toLowerCase()==='for'?'For':'Do',b=[...this.blocks].reverse().find(b=>b.type===type);if(!b)throw new VBError(`Exit ${m[1]} outside block`,1002);const inner=this.blocks.slice(this.blocks.indexOf(b)+1).filter(x=>x.type==='With').length;if(inner)this.emit('withUnwind',{count:inner},line);b.exits.push(this.jump(null,line));}return;}
    if((m=text.match(/^(Dim|Static|Private|Public)\s+(.+)$/i))){this.emit('dim',{decls:parseDeclarations(m[2],false,this.module.defaultTypes).map(d=>{if(d.withEvents)throw new VBError('WithEvents is valid only at class or form module level',1002);return d;}),static:/static/i.test(m[1])},line);return;}
    if((m=text.match(/^Const\s+(.+)$/i))){this.emit('dim',{decls:parseDeclarations(m[1],true,this.module.defaultTypes)},line);return;}
    if((m=text.match(/^ReDim\s+(Preserve\s+)?(.+)$/i))){this.emit('redim',{decls:parseDeclarations(m[2],false,this.module.defaultTypes),preserve:!!m[1]},line);return;}
    if((m=text.match(/^Erase\s+(.+)$/i))){this.emit('erase',{exprs:splitTop(m[1]).map(E)},line);return;}
    if((m=text.match(/^On\s+Error\s+(.+)$/i))){if(/^Resume\s+Next$/i.test(m[1]))this.emit('onError',{mode:'next'},line);else{const g=m[1].match(/^GoTo\s+(\w+)$/i);if(!g)throw new VBError('Invalid On Error statement',1002);const index=this.emit('onError',{mode:g[1]==='0'?'off':'goto',target:null},line);if(g[1]!=='0')this.patches.push({index,label:g[1]});}return;}
    if(/^On\s+/i.test(text)){
      const tokens=tokenize(text),branch=tokens.find(t=>t.type==='id'&&/^(GoTo|GoSub)$/i.test(t.value));
      if(!branch)throw new VBError('Expected GoTo or GoSub',1002);
      const labels=splitTop(text.slice(branch.end));
      if(!labels.length||labels.some(v=>! /^(?:[A-Za-z_]\w*|\d+)$/.test(v)))throw new VBError('Expected a list of line labels',1002);
      const index=this.emit('computedJump',{expr:E(text.slice(tokens[0].end,branch.start)),gosub:/gosub/i.test(branch.value),targets:labels.map(()=>null)},line);
      labels.forEach((label,slot)=>this.patches.push({index,label,slot}));return;
    }
    if((m=text.match(/^Error\s+(.+)$/i))){this.emit('raiseError',{expr:E(m[1])},line);return;}
    if((m=text.match(/^Resume(?:\s+(\w+))?$/i))){const index=this.emit('resume',{mode:!m[1]||m[1]==='0'?'retry':/^Next$/i.test(m[1])?'next':'goto',target:null},line);if(m[1]&&m[1]!=='0'&&!/^Next$/i.test(m[1]))this.patches.push({index,label:m[1]});return;}
    if((m=text.match(/^Go(To|Sub)\s+(\w+)$/i))){const index=this.emit(/sub/i.test(m[1])?'gosub':'jump',{target:null},line);this.patches.push({index,label:m[2]});return;}
    if(/^Return$/i.test(text)){this.emit('gosubReturn',{},line);return;}
    if((m=text.match(/^Debug\.Print\s*(.*)$/i))){this.emit('print',{exprs:splitTop(m[1].replace(/;\s*$/,'').replace(/;(?=(?:[^"\n]*"[^"\n]*")*[^"\n]*$)/g,',')).filter(Boolean).map(E),newline:!m[1].endsWith(';')},line);return;}
    if((m=text.match(/^Debug\.Assert\s+(.+)$/i))){this.emit('assert',{expr:E(m[1])},line);return;}
    if(/^Stop$/i.test(text)){this.emit('stop',{},line);return;}
    if(/^End$/i.test(text)){this.emit('end',{},line);return;}
    if((m=text.match(/^(Load|Unload)\s+(.+)$/i))){this.emit('form',{action:m[1].toLowerCase(),expr:E(m[2])},line);return;}
    if((m=text.match(/^Open\s+(.+?)\s+For\s+(Input|Output|Append|Binary|Random)(?:\s+Access\s+(Read\s+Write|Read|Write))?(?:\s+(Shared|Lock\s+Read\s+Write|Lock\s+Read|Lock\s+Write))?\s+As\s+#?(.+?)(?:\s+Len\s*=\s*(.+))?$/i))){this.emit('fileOpen',{path:E(m[1]),mode:m[2].toLowerCase(),access:m[3]?.toLowerCase(),sharing:m[4]?.toLowerCase(),handle:E(m[5]),recordLength:m[6]?E(m[6]):null},line);return;}
    if((m=text.match(/^(Get|Put)\s+#?([^,]+),\s*([^,]*),\s*(.+)$/i))){const target=E(m[4]);if(!['id','member','call'].includes(target.kind))throw new VBError('Get/Put requires a variable',1002);this.emit('fileRecord',{action:m[1].toLowerCase(),handle:E(m[2]),position:m[3].trim()?E(m[3]):null,target},line);return;}
    if((m=text.match(/^Seek\s+#?([^,]+),\s*(.+)$/i))){this.emit('fileSeek',{handle:E(m[1]),position:E(m[2])},line);return;}
    if((m=text.match(/^(Lock|Unlock)\s+#?([^,]+)(?:,\s*(.+?)(?:\s+To\s+(.+))?)?$/i))){this.emit('fileLock',{unlock:/unlock/i.test(m[1]),handle:E(m[2]),start:m[3]?E(m[3]):null,end:m[4]?E(m[4]):null},line);return;}
    if((m=text.match(/^FileCopy\s+(.+?),\s*(.+)$/i))){this.emit('fileCopy',{sourcePath:E(m[1]),destination:E(m[2])},line);return;}
    if((m=text.match(/^Name\s+(.+?)\s+As\s+(.+)$/i))){this.emit('fileRename',{sourcePath:E(m[1]),destination:E(m[2])},line);return;}
    if((m=text.match(/^Close(?:\s+(.+))?$/i))){this.emit('fileClose',{handles:m[1]?splitTop(m[1]).map(s=>E(s.replace(/^#/,''))):[]},line);return;}
    if((m=text.match(/^(Print|Write)\s+#([^,]+),?\s*(.*)$/i))){this.emit('filePrint',{handle:E(m[2]),exprs:splitTop(m[3],/Write/i.test(m[1])?',':';').filter(Boolean).map(E),csv:/Write/i.test(m[1]),newline:!m[3].endsWith(';')},line);return;}
    if((m=text.match(/^(Line\s+Input|Input)\s+#([^,]+),\s*(.+)$/i))){this.emit('fileInput',{handle:E(m[2]),targets:splitTop(m[3]).map(E),whole:/Line/i.test(m[1])},line);return;}
    // VB graphics syntax: Picture1.Line (x1,y1)-(x2,y2), color, BF
    if((m=text.match(/^(?:(.+)\.)?Line\s*\(([^,]+),([^\)]+)\)\s*-\s*\(([^,]+),([^\)]+)\)(?:\s*,\s*([^,]+))?(?:\s*,\s*(B|BF))?$/i))){this.emit('graphics',{object:E(m[1]||'Me'),kind:m[7]?'rect':'line',coords:[m[2],m[3],m[4],m[5]].map(E),color:E(m[6]||'0'),fill:/bf/i.test(m[7]||'')},line);return;}
    if((m=text.match(/^(?:(.+)\.)?PSet\s*\(([^,]+),([^\)]+)\)(?:\s*,\s*(.+))?$/i))){this.emit('graphics',{object:E(m[1]||'Me'),kind:'pixel',coords:[E(m[2]),E(m[3])],color:E(m[4]||'0')},line);return;}
    if((m=text.match(/^(?:(.+)\.)?Circle\s*\(([^,]+),([^\)]+)\)\s*,\s*([^,]+)(?:\s*,\s*(.+))?$/i))){this.emit('graphics',{object:E(m[1]||'Me'),kind:'circle',coords:[E(m[2]),E(m[3]),E(m[4])],color:E(m[5]||'0')},line);return;}
    if(/^RaiseEvent\b/i.test(text)){this.emit('raiseEvent',{expr:parseCall(text.replace(/^RaiseEvent\s+/i,''))},line);return;}
    if((m=text.match(/^(LSet|RSet)\s+(.+?)\s*=\s*(.+)$/i))){const target=E(m[2]);if(!['id','member','call'].includes(target.kind))throw new VBError('Expected assignable string variable',1002);this.emit('stringAlign',{target,expr:E(m[3]),right:/rset/i.test(m[1])},line);return;}
    if(/^Mid\$?\s*\(/i.test(text)){
      const tokens=tokenize(text);let level=0,equal;for(const t of tokens){if(t.value==='(')level++;else if(t.value===')')level--;else if(t.value==='='&&level===0){equal=t;break;}}
      if(equal){const call=E(text.slice(0,equal.start));if(call.kind!=='call'||call.args.length<2||call.args.length>3||!['id','member','call'].includes(call.args[0].kind)||call.args.some(a=>['missing','named'].includes(a.kind)))throw new VBError('Invalid Mid assignment',1002);this.emit('stringMid',{target:call.args[0],start:call.args[1],length:call.args[2],expr:E(text.slice(equal.end))},line);return;}
    }
    if(/^(Declare|Implements|Get\s+#|Put\s+#|SetAttr|FileCopy|Name\s+.+\s+As|#If|#Else|#End)/i.test(text))throw new VBError(`Unsupported statement: ${text.split(/\s/)[0]}`,445);
    text=text.replace(/^(Let|Set)\s+/i,'');
    const ts=tokenize(text);let depth=0,eq=null;
    for(const t of ts){if(t.value==='(')depth++;else if(t.value===')')depth--;else if(t.value==='='&&depth===0){eq=t;break;}}
    if(eq){const target=E(text.slice(0,eq.start));if(!['id','member','call'].includes(target.kind))throw new VBError('Invalid assignment target',1002);this.emit('assign',{target,expr:E(text.slice(eq.end)),objectSet:/^Set\s/i.test(original)},line);return;}
    if(/^Call\s+/i.test(text)){this.emit('expr',{expr:parseCall(text.replace(/^Call\s+/i,''))},line);return;}
    this.emit('expr',{expr:parseCall(text)},line);
  }
}

export function compileModule(input) {
  const module={name:input.name,kind:input.kind||'module',interfaces:[],defaultTypes:{},defaultMember:null,attributes:[...(input.attributes||[])],optionExplicit:false,optionBase:0,optionCompare:'binary',declarations:[],procedures:new Map(),enums:{},types:{},diagnostics:[],source:input.code||'',form:input.form||null};
  const allLines=logicalLines(preprocess(module.source,input.conditionalConstants||{},module.name));
  const lines=allLines.filter(e=>{if(/^Attribute\s+/i.test(e.text)){module.attributes.push(e.text);return false;}return true;});let current=null,body=[],enumState=null,typeState=null;
  for(const entry of lines){let {text,line}=entry,m;
    try {
      if(current){if(/^Def(?:Bool|Byte|Int|Lng|Cur|Sng|Dbl|Date|Str|Obj|Var)\b/i.test(text))throw new VBError('Default-type declarations are valid only at module level',1002);if(new RegExp(`^End\\s+${current.kind==='property'?'Property':current.kind}$`,'i').test(text)){current.code=new ProcedureCompiler(current,module).compile(body);const key=lower(current.name)+(current.kind==='property'?':'+current.accessor:'');if(module.procedures.has(key))throw new VBError(`Ambiguous name detected: ${current.name}`,1002);module.procedures.set(key,current);current=null;body=[];}else body.push(entry);continue;}
      if(enumState){if(/^End\s+Enum$/i.test(text)){if(!enumState.previous)throw new VBError('Enum requires at least one member',1002);enumState=null;continue;}const e=text.match(/^(\w+)(?:\s*=\s*(.+))?$/);if(!e)throw new VBError('Invalid Enum member',1002);const value=e[2]?E(e[2]):enumState.previous?{kind:'binary',op:'+',left:{kind:'id',name:enumState.previous},right:{kind:'literal',value:1}}:{kind:'literal',value:0};module.declarations.push({name:e[1],line,type:'Long',explicitType:true,constant:true,scope:enumState.scope,enumName:enumState.name,initial:value,bounds:null});module.enums[enumState.name].members.push(e[1]);enumState.previous=e[1];continue;}
      if(typeState){if(/^End\s+Type$/i.test(text)){typeState=null;continue;}if(splitTop(text).some(t=>! /\bAs\s+/i.test(t)))throw new VBError('User-defined type members require an explicit As type',1002);module.types[typeState].push(...parseDeclarations(text));continue;}
      if(/^Def\w+\b/i.test(text)){addDefaultTypes(module.defaultTypes,text);continue;}
      if((m=text.match(/^Implements\s+([A-Za-z_]\w*)$/i))){if(module.kind==='module')throw new VBError('Implements is valid only in a class or form module',1002);if(module.interfaces.some(i=>lower(i.name)===lower(m[1])))throw new VBError('Duplicate implemented interface: '+m[1],1002);module.interfaces.push({name:m[1],line});continue;}
      if((m=text.match(/^Option\s+(Explicit|Base\s+[01]|Compare\s+(?:Text|Binary))$/i))){if(/^Explicit/i.test(m[1]))module.optionExplicit=true;else if(/^Base/i.test(m[1]))module.optionBase=Number(m[1].at(-1));else module.optionCompare=m[1].split(/\s+/)[1].toLowerCase();continue;}
      if(/^(Attribute\s+VB_|VERSION\s+|BEGIN$|END$|MultiUse\s*=|Persistable\s*=|DataBindingBehavior\s*=|DataSourceBehavior\s*=|MTSTransactionMode\s*=)/i.test(text))continue;
      if((m=text.match(/^(?:(Public\s+Static|Private\s+Static|Friend\s+Static|Public|Private|Friend|Static)\s+)?(Sub|Function|Property\s+(Get|Let|Set))\s+([A-Za-z_]\w*[$%&!#@]?)\s*\((.*)\)\s*(?:As\s+(\w+))?$/i))){const kind=/^Property/i.test(m[2])?'property':m[2].toLowerCase();current={name:m[4],kind,accessor:m[3]?.toLowerCase(),scope:(m[1]?.toLowerCase().split(/\s+/)[0]==='static'?'public':m[1]?.toLowerCase().split(/\s+/)[0])||'public',static:/static/i.test(m[1]||''),params:parseParameters(m[5],module.defaultTypes),returnType:m[6]||suffixType(m[4],module.defaultTypes),line,source:module.name};continue;}
      if((m=text.match(/^(?:(Public|Private|Global)\s+)?Const\s+(.+)$/i))){module.declarations.push(...parseDeclarations(m[2],true,module.defaultTypes).map(d=>({...d,line,scope:lower(m[1]||'private')})));continue;}
      if((m=text.match(/^(?:Public|Private|Global|Dim)\s+(.+)$/i))){if(/^(Enum|Type|Event|Declare)\b/i.test(m[1])){/* handled below */}else{module.declarations.push(...parseDeclarations(m[1],false,module.defaultTypes).map(d=>{if(d.withEvents&&module.kind==='module')throw new VBError('WithEvents is valid only in class and form modules',1002);return {...d,line,scope:/^(Public|Global)\b/i.test(text)?'public':'private'};}));continue;}}
      if((m=text.match(/^(?:(Public|Private)\s+)?Enum\s+(\w+)$/i))){if(Object.keys(module.enums).some(n=>lower(n)===lower(m[2])))throw new VBError('Ambiguous enum name: '+m[2],1002);enumState={name:m[2],scope:lower(m[1]||'public'),previous:null};module.enums[m[2]]={name:m[2],scope:enumState.scope,members:[]};continue;}
      if((m=text.match(/^(?:Public\s+|Private\s+)?Type\s+(\w+)$/i))){typeState=m[1];module.types[typeState]=[];continue;}
      if((m=text.match(/^(?:Public\s+|Private\s+)?Event\s+(\w+)\s*\((.*)\)$/i))){if(module.kind==='module')throw new VBError('Events can be declared only in class and form modules',1002);module.events ||= new Map();const key=lower(m[1]);if(module.events.has(key))throw new VBError('Ambiguous event name: '+m[1],1002);module.events.set(key,{name:m[1],line,scope:/^Private\b/i.test(text)?'private':'public',params:parseParameters(m[2],module.defaultTypes)});continue;}
      if(/^Option\s+Private\s+Module$/i.test(text))continue;
      if(/^(?:Public\s+|Private\s+)?Declare\b/i.test(text)){
        const d=text.match(/^(?:(Public|Private)\s+)?Declare\s+(Function|Sub)\s+([A-Za-z_]\w*[$%&!#@]?)\s+Lib\s+"([^"\r\n]+)"\s*(?:Alias\s+"([^"\r\n]+)"\s*)?\((.*)\)\s*(?:As\s+(\w+))?$/i);
        if(!d)throw new VBError('Invalid Declare statement',1002);
        const name=d[3],key=lower(name);if(module.procedures.has(key))throw new VBError('Ambiguous procedure name: '+name,1002);
        const params=parseParameters(d[6],module.defaultTypes);
        if(params.some(p=>p.optional||p.paramArray||p.autoNew))throw new VBError('Declare parameters cannot be Optional, ParamArray or As New',1002);
        if(lower(d[2])==='sub'&&d[7])throw new VBError('Declare Sub cannot have a return type',1002);
        module.procedures.set(key,{name,kind:lower(d[2]),scope:lower(d[1]||'public'),params,returnType:d[7]||suffixType(name,module.defaultTypes),line,source:module.name,code:[],external:{library:d[4],entry:d[5]||name}});continue;
      }
      throw new VBError(`Invalid statement outside procedure: ${text}`,1002);
    }catch(error){if(error instanceof VBError){error.source ||= module.name;error.line ||= line;}throw error;}
  }
  for(const p of module.procedures.values())if(/^Decimal$/i.test(p.returnType))throw new VBError('Decimal is a Variant subtype; use a Variant return type',1002,module.name,p.line);
  if(current)throw new VBError(`Expected End ${current.kind}`,1002,module.name,current.line);
  if(enumState||typeState)throw new VBError('Unterminated type declaration',1002,module.name,lines.at(-1)?.line);
  for(const attribute of module.attributes){
    const a=String(attribute).match(/^Attribute\s+(\w+)\.VB_UserMemId\s*=\s*(-?\d+)$/i);
    if(a&&Number(a[2])===0){const key=lower(a[1]),proc=module.procedures.get(key+':get')||module.procedures.get(key);
      if(!proc||proc.scope!=='public'||!['function','property'].includes(proc.kind))throw new VBError('Default member must be a Public Function or Property Get',1002,module.name,proc?.line||1);
      if(module.defaultMember&&module.defaultMember!==key)throw new VBError('Only one default member is permitted',1002,module.name,proc.line);
      module.defaultMember=key;
    }
  }
  return module;
}
export function compileProject(project) {
  const modules=new Map(),diagnostics=[];
  for(const input of project.modules||[]){try{const module=compileModule({...input,conditionalConstants:project.settings?.conditionalConstants||{}});const key=lower(module.name);if(modules.has(key))throw new VBError(`Duplicate module name: ${module.name}`,1002,module.name,1);modules.set(key,module);}catch(error){diagnostics.push({severity:'error',message:error.message,number:error.number||1002,source:error.source||input.name,line:error.line||1,column:error.column||1});}}
  diagnostics.push(...validateCompiledModules(modules));
  return {name:project.name,startup:project.startup,modules,diagnostics,valid:!diagnostics.length,settings:project.settings||{},sourceProject:project};
}

/** Cross-module constraints shared by execution and background diagnostics. */
export function validateCompiledModules(modules) {
  const diagnostics=bindConstants(modules);
  const recordNames=new Set([...modules.values()].flatMap(m=>Object.keys(m.types).map(lower)));
  for(const module of modules.values())for(const proc of module.procedures.values())for(const param of proc.params)if(!param.byRef&&!param.paramArray&&(recordNames.has(lower(param.type))||param.bounds!==null))diagnostics.push({severity:'error',message:recordNames.has(lower(param.type))?'User-defined type may not be passed ByVal':'Array argument must be ByRef',number:1002,source:module.name,line:proc.line,column:1});
  const parents=[...modules.values()].filter(m=>m.form?.type==='MDIForm');
  if(parents.length>1)diagnostics.push({severity:'error',message:'Only one MDI Form is permitted per project',number:360,source:parents[1].name,line:1,column:1});
  for(const module of modules.values())if(module.form){if(module.form.type==='MDIForm'&&Number(module.form.properties?.MDIChild))diagnostics.push({severity:'error',message:'An MDI Form cannot also be an MDI child',number:380,source:module.name,line:1,column:1});if(Number(module.form.properties?.MDIChild)&&!parents.length)diagnostics.push({severity:'error',message:'An MDI child requires an MDI Form in the project',number:366,source:module.name,line:1,column:1});}
  diagnostics.push(...validateInterfaces(modules));
  return diagnostics;
}
