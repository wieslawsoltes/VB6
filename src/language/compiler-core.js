import {parseGraphicsStatement} from './graphics-statements.js';
import {splitPrintList} from './print-list.js';
import {parseDeclarations,parseParameters,parseProcedureHeader,parseTypeFields} from './declarations.js';
import {parseModuleHeader,parseEnumMember} from './module-syntax.js';
import {parseIfHeader,inlineElse} from './statement-syntax.js';
import {parseForHeader,loopVariable,parseLabel,parseComputedBranch,parseFileStatement} from './statement-headers.js';
import {findKeyword,statementParts} from './source-scanner.js';
import {layoutBindingSnapshot,validateLayoutMembers} from '../layout/language-gate.js';
import {validateLayout} from '../layout/contract.js';
import {bindConstants} from './binding.js';
import {defaultIdentifierType,addDefaultTypes} from './default-types.js';
import {validateInterfaces} from './interfaces.js';
import { preprocess } from './conditional.js';
import { VBError, logicalLines, splitTop, tokenize } from './lexer.js';
import { parseExpression, parseCall } from './expression.js';
import { lower } from '../core/core.js';

const E = text => parseExpression(text);
const suffixType = defaultIdentifierType;
export {parseDeclarations,parseParameters};

const DEBUG_SOURCE_LINES=new WeakMap();
const PROCEDURE_END={sub:/^End\s+Sub$/i,function:/^End\s+Function$/i,property:/^End\s+Property$/i};
class ProcedureCompiler {
  constructor(proc,module) { this.proc=proc;this.module=module;this.code=[];this.blocks=[];this.labels=new Map();this.patches=[];this.temp=0;this.debugStatement=null;this.statementDepth=0;this.debugColumns=new Map();if(!DEBUG_SOURCE_LINES.has(module))DEBUG_SOURCE_LINES.set(module,module.source.replace(/\r\n?/g,'\n').split('\n'));this.sourceLines=DEBUG_SOURCE_LINES.get(module); }
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
    if(this.statementDepth>=128)throw new VBError('Statement nesting limit exceeded',1002,this.module.name,line);
    this.statementDepth++;
    const previous=this.debugStatement,text=original.trim(),source=this.sourceLines[line-1]||'';
    const offset=column===null?source.indexOf(text,this.debugColumns.get(line)||0):column-1;
    // Continued statements keep their physical starting line; do not invent a
    // single-line span when the logical statement is absent from that line.
    const found=offset>=0&&source.slice(offset,offset+text.length)===text;
    this.debugStatement={emitted:false,column:found?offset+1:null,endColumn:found?offset+text.length+1:null};
    if(column===null&&found)this.debugColumns.set(line,offset+text.length);
    try{return this.compileStatement(original,line);}finally{this.debugStatement=previous;this.statementDepth--;}
  }
  compileStatement(original,line) {
    let text=original.trim(),m;
    if(!text||/^Rem\b/i.test(text))return;
    if(/^\d+$/.test(text)){const index=this.jump(null,line);this.patches.push({index,label:text});return;}
    if(/^If\b/i.test(text)) {
      const header=parseIfHeader(text),index=this.emit('branch',{test:E(header.condition),target:null},line);
      if(header.body){
        const delimiter=inlineElse(header.body),at=delimiter?.start??-1;
        const yes=at<0?header.body:header.body.slice(0,at),no=at<0?'':header.body.slice(delimiter.end);
        const origin=this.debugStatement.column,bodyOffset=header.bodyStart;
        if(origin)this.code[index].endColumn=origin+bodyOffset;
        const compileParts=(body,offset)=>{for(const part of statementParts(body))this.statement(part.text,line,origin===null?null:origin+offset+part.start);};
        const blocks=this.blocks.length;
        compileParts(yes,bodyOffset);
        if(at>=0){const end=this.jump(null,line,true);this.patch(index,this.code.length);compileParts(no,bodyOffset+delimiter.end);this.patch(end,this.code.length);}else this.patch(index,this.code.length);
        if(this.blocks.length!==blocks)throw new VBError('Block statement is not permitted within a single-line If',1002);
      }else this.blocks.push({type:'If',pending:index,ends:[],hadElse:false});
      return;
    }
    if(/^ElseIf\b/i.test(text)){const b=this.block('If',line);if(b.hadElse)throw new VBError('ElseIf cannot follow Else',1002);const header=parseIfHeader(text);if(header.body)throw new VBError('Unexpected statement after ElseIf Then',1002);b.ends.push(this.jump(null,line,true));this.patch(b.pending,this.code.length);b.pending=this.emit('branch',{test:E(header.condition),target:null},line);return;}
    if(/^Else$/i.test(text)){const b=this.block('If',line);if(b.hadElse)throw new VBError('Duplicate Else',1002);b.hadElse=true;b.ends.push(this.jump(null,line,true));this.patch(b.pending,this.code.length);b.pending=null;return;}
    if(/^End\s*If$/i.test(text)){const b=this.block('If',line);if(b.pending!=null)this.patch(b.pending,this.code.length);for(const i of b.ends)this.patch(i,this.code.length);this.blocks.pop();return;}
    if(/^For\s+/i.test(text)){
      const header=parseForHeader(text);if(this.blocks.some(b=>b.type==='For'&&b.identity===header.identity))throw new VBError('For control variable already in use',1002);
      const {kind,identity,...data}=header,id=`$${kind==='each'?'each':'for'}${this.temp++}`;
      const index=this.emit(kind==='each'?'eachInit':'forInit',{...data,id,target:null},line);
      this.blocks.push({type:'For',kind,id,index,start:this.code.length,name:header.name,identity,exits:[]});return;
    }
    if((m=text.match(/^Next(?:\s+(.+))?$/i))){const names=m[1]?splitTop(m[1]):[''];for(const name of names){const b=this.block('For',line);if(name&&loopVariable(name).identity!==b.identity)throw new VBError('Next control variable does not match For',1002);this.emit(b.kind==='each'?'eachNext':'forNext',{id:b.id,target:b.start},line);this.patch(b.index,this.code.length);for(const i of b.exits)this.patch(i,this.code.length);this.blocks.pop();}return;}
    if((m=text.match(/^Do(?:\s+(While|Until)\s+(.+))?$/i))){const b={type:'Do',start:this.code.length,exits:[]};if(m[1])b.test=this.emit('branch',{test:E(m[2]),invert:/until/i.test(m[1]),target:null},line);this.blocks.push(b);return;}
    if((m=text.match(/^Loop(?:\s+(While|Until)\s+(.+))?$/i))){const b=this.block('Do',line);if(m[1]&&b.test!=null)throw new VBError('Do and Loop cannot both specify a condition',1002);if(m[1]){const end=this.emit('branch',{test:E(m[2]),invert:/until/i.test(m[1]),target:null},line);this.jump(b.start,line);this.patch(end,this.code.length);}else this.jump(b.start,line);if(b.test!=null)this.patch(b.test,this.code.length);for(const i of b.exits)this.patch(i,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^While\s+(.+)$/i))){const start=this.code.length,test=this.emit('branch',{test:E(m[1]),target:null},line);this.blocks.push({type:'While',start,test,exits:[]});return;}
    if(/^Wend$/i.test(text)){const b=this.block('While',line);this.jump(b.start,line);this.patch(b.test,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^Select\s+Case\s+(.+)$/i))){const id=`$select${this.temp++}`;this.emit('temp',{id,expr:E(m[1])},line);this.blocks.push({type:'Select',id,pending:null,ends:[],hasCase:false});return;}
    if((m=text.match(/^Case\s+(.+)$/i))){const b=this.block('Select',line);if(b.hadElse)throw new VBError('Case cannot follow Case Else',1002);if(b.hasCase)b.ends.push(this.jump(null,line,true));if(b.pending!=null)this.patch(b.pending,this.code.length);b.hasCase=true;if(/^Else$/i.test(m[1])){b.pending=null;b.hadElse=true;}else {const cases=splitTop(m[1]).map(s=>{const to=findKeyword(s,'to'),r=to?[s,s.slice(0,to.start),s.slice(to.end)]:null,c=s.match(/^Is\s*(<=|>=|<>|=|<|>)\s*(.+)$/i);return r?{kind:'range',low:E(r[1]),high:E(r[2])}:c?{kind:'compare',op:c[1],expr:E(c[2])}:{kind:'value',expr:E(s)};});b.pending=this.emit('case',{id:b.id,cases,target:null},line);}return;}
    if(/^End\s+Select$/i.test(text)){const b=this.block('Select',line);if(b.pending!=null)this.patch(b.pending,this.code.length);for(const i of b.ends)this.patch(i,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^With\s+(.+)$/i))){this.emit('withPush',{expr:E(m[1])},line);this.blocks.push({type:'With'});return;}
    if(/^End\s+With$/i.test(text)){this.block('With',line);this.emit('withPop',{},line);this.blocks.pop();return;}
    if((m=text.match(/^Exit\s+(Sub|Function|Property|For|Do)$/i))){if(/^(Sub|Function|Property)$/i.test(m[1])){if(lower(m[1])!==this.proc.kind)throw new VBError('Exit '+m[1]+' does not match enclosing procedure',1002);this.emit('return',{},line);}else{const type=m[1].toLowerCase()==='for'?'For':'Do',b=[...this.blocks].reverse().find(b=>b.type===type);if(!b)throw new VBError(`Exit ${m[1]} outside block`,1002);const inner=this.blocks.slice(this.blocks.indexOf(b)+1).filter(x=>x.type==='With').length;if(inner)this.emit('withUnwind',{count:inner},line);b.exits.push(this.jump(null,line));}return;}
    if((m=text.match(/^(Dim|Static|Private|Public)\s+(.+)$/i))){this.emit('dim',{decls:parseDeclarations(m[2],false,this.module.defaultTypes).map(d=>{if(d.withEvents)throw new VBError('WithEvents is valid only at class or form module level',1002);return d;}),static:/static/i.test(m[1])},line);return;}
    if((m=text.match(/^Const\s+(.+)$/i))){this.emit('dim',{decls:parseDeclarations(m[1],true,this.module.defaultTypes)},line);return;}
    if((m=text.match(/^ReDim\s+(Preserve\s+)?(.+)$/i))){this.emit('redim',{decls:parseDeclarations(m[2],false,this.module.defaultTypes),preserve:!!m[1]},line);return;}
    if((m=text.match(/^Erase\s+(.+)$/i))){this.emit('erase',{exprs:splitTop(m[1]).map(E)},line);return;}
    if((m=text.match(/^On\s+Error\s+(.+)$/i))){
      if(/^Resume\s+Next$/i.test(m[1]))this.emit('onError',{mode:'next'},line);
      else{const g=m[1].match(/^GoTo\s+(.+)$/i);if(!g)throw new VBError('Invalid On Error statement',1002);const label=parseLabel(g[1]),off=/^0+$/.test(label),index=this.emit('onError',{mode:off?'off':'goto',target:null},line);if(!off)this.patches.push({index,label});}return;
    }
    if(/^On\s+/i.test(text)){
      const {expr,gosub,labels}=parseComputedBranch(text),index=this.emit('computedJump',{expr,gosub,targets:labels.map(()=>null)},line);
      labels.forEach((label,slot)=>this.patches.push({index,label,slot}));return;
    }
    if((m=text.match(/^Error\s+(.+)$/i))){this.emit('raiseError',{expr:E(m[1])},line);return;}
    if((m=text.match(/^Resume(?:\s+(.+))?$/i))){const mode=!m[1]||/^0+$/.test(m[1])?'retry':/^Next$/i.test(m[1])?'next':'goto',index=this.emit('resume',{mode,target:null},line);if(mode==='goto')this.patches.push({index,label:parseLabel(m[1])});return;}
    if((m=text.match(/^Go(To|Sub)\s+(.+)$/i))){const index=this.emit(/sub/i.test(m[1])?'gosub':'jump',{target:null},line);this.patches.push({index,label:parseLabel(m[2])});return;}
    if(/^Return$/i.test(text)){this.emit('gosubReturn',{},line);return;}
    if((m=text.match(/^Debug\.Print\s*(.*)$/i))){const list=splitPrintList(m[1]);this.emit('print',{outputList:m[1],exprs:list.parts.filter(p=>p.text).map(p=>E(p.text)),newline:list.newline},line);return;}
    if((m=text.match(/^Debug\.Assert\s+(.+)$/i))){this.emit('assert',{expr:E(m[1])},line);return;}
    if(/^Stop$/i.test(text)){this.emit('stop',{},line);return;}
    if(/^End$/i.test(text)){this.emit('end',{},line);return;}
    if((m=text.match(/^(Load|Unload)\s+(.+)$/i))){this.emit('form',{action:m[1].toLowerCase(),expr:E(m[2])},line);return;}
    const fileStatement=parseFileStatement(text);if(fileStatement){const {op,...data}=fileStatement;this.emit(op,data,line);return;}
    if((m=text.match(/^FileCopy\s+(.+)$/i))){const parts=splitTop(m[1]);if(parts.length!==2)throw new VBError('FileCopy requires source and destination',1002);this.emit('fileCopy',{sourcePath:E(parts[0]),destination:E(parts[1])},line);return;}
    if(/^Name\s+/i.test(text)&&!/^Name\s*[=(.!]/i.test(text)){const as=findKeyword(text,'as',4);if(!as)throw new VBError('Expected As in Name statement',1002);this.emit('fileRename',{sourcePath:E(text.slice(4,as.start)),destination:E(text.slice(as.end))},line);return;}
    if((m=text.match(/^Close(?:\s+(.+))?$/i))){this.emit('fileClose',{handles:m[1]?splitTop(m[1]).map(s=>E(s.replace(/^#/,''))):[]},line);return;}
    const graphics=parseGraphicsStatement(text);if(graphics){const {op,...data}=graphics;this.emit(op,data,line);return;}
    if(/^RaiseEvent\b/i.test(text)){this.emit('raiseEvent',{expr:parseCall(text.replace(/^RaiseEvent\s+/i,''),{explicit:true})},line);return;}
    if((m=text.match(/^(LSet|RSet)\s+(.+?)\s*=\s*(.+)$/i))){const target=E(m[2]);if(!['id','member','call'].includes(target.kind))throw new VBError('Expected assignable string variable',1002);this.emit('stringAlign',{target,expr:E(m[3]),right:/rset/i.test(m[1])},line);return;}
    if(/^Mid\$?\s*\(/i.test(text)){
      const tokens=tokenize(text);let level=0,equal;for(const t of tokens){if(t.value==='(')level++;else if(t.value===')')level--;else if(t.value==='='&&level===0){equal=t;break;}}
      if(equal){const call=E(text.slice(0,equal.start));if(call.kind!=='call'||call.args.length<2||call.args.length>3||!['id','member','call'].includes(call.args[0].kind)||call.args.some(a=>['missing','named'].includes(a.kind)))throw new VBError('Invalid Mid assignment',1002);this.emit('stringMid',{target:call.args[0],start:call.args[1],length:call.args[2],expr:E(text.slice(equal.end))},line);return;}
    }
    if(/^(Declare|Implements|Get\s+#|Put\s+#|SetAttr|FileCopy|#If|#Else|#End)/i.test(text))throw new VBError(`Unsupported statement: ${text.split(/\s/)[0]}`,445);
    text=text.replace(/^(Let|Set)\s+/i,'');
    const ts=tokenize(text);let depth=0,eq=null;
    for(const t of ts){if(t.value==='(')depth++;else if(t.value===')')depth--;else if(t.value==='='&&depth===0){eq=t;break;}}
    if(eq){const target=E(text.slice(0,eq.start));if(!['id','member','call'].includes(target.kind))throw new VBError('Invalid assignment target',1002);this.emit('assign',{target,expr:E(text.slice(eq.end)),objectSet:/^Set\s/i.test(original)},line);return;}
    if(/^Call\s+/i.test(text)){this.emit('expr',{expr:parseCall(text.replace(/^Call\s+/i,''),{explicit:true})},line);return;}
    this.emit('expr',{expr:parseCall(text)},line);
  }
}

export function compileModule(input) {
  const module={name:input.name,kind:input.kind||'module',interfaces:[],defaultTypes:{},defaultMember:null,attributes:[...(input.attributes||[])],optionExplicit:false,optionBase:0,optionCompare:'binary',declarations:[],procedures:new Map(),enums:Object.create(null),types:Object.create(null),diagnostics:[],source:input.code||'',form:input.form||null,layoutBindings:input.layoutBindings||layoutBindingSnapshot(input)};
  const allLines=logicalLines(preprocess(module.source,input.conditionalConstants||{},module.name));
  const lines=allLines.filter(e=>{if(/^Attribute\s+/i.test(e.text)){module.attributes.push(e.text);return false;}return true;});let current=null,body=[],enumState=null,typeState=null;
  const typeNames=new Set();
  for(const entry of lines){let {text,line}=entry,m;
    try {
      if(current){if(/^Def(?:Bool|Byte|Int|Lng|Cur|Sng|Dbl|Date|Str|Obj|Var)\b/i.test(text))throw new VBError('Default-type declarations are valid only at module level',1002);if(PROCEDURE_END[current.kind].test(text)){if(input.retainSyntax)current.statements=body.map(entry=>({...entry}));current.code=new ProcedureCompiler(current,module).compile(body);const key=lower(current.name)+(current.kind==='property'?':'+current.accessor:'');if(module.procedures.has(key))throw new VBError(`Ambiguous name detected: ${current.name}`,1002);module.procedures.set(key,current);current=null;body=[];}else body.push(entry);continue;}
      if(enumState){
        if(/^End\s+Enum$/i.test(text)){if(!enumState.previous)throw new VBError('Enum requires at least one member',1002);enumState=null;continue;}
        if(entry.label)throw new VBError('Labels are not allowed in Enum declarations',1002);
        const member=parseEnumMember(text,enumState.previous);
        module.declarations.push({...member,line,type:'Long',explicitType:true,constant:true,scope:enumState.scope,enumName:enumState.name,bounds:null});
        module.enums[enumState.name].members.push(member.name);enumState.previous=member.name;continue;
      }
      if(typeState){
        if(/^End\s+Type$/i.test(text)){if(!typeState.names.size)throw new VBError('Type requires at least one member',1002);typeState=null;continue;}
        if(entry.label)throw new VBError('Labels are not allowed in Type declarations',1002);
        for(const field of parseTypeFields(text)){
          const key=lower(field.name);if(typeState.names.has(key))throw new VBError('Duplicate type member: '+field.name,1002);
          typeState.names.add(key);module.types[typeState.name].push({...field,line});
        }
        continue;
      }
      if(/^Def\w+\b/i.test(text)){addDefaultTypes(module.defaultTypes,text);continue;}
      if((m=text.match(/^Option\s+(Explicit|Base\s+[01]|Compare\s+(?:Text|Binary))$/i))){if(/^Explicit/i.test(m[1]))module.optionExplicit=true;else if(/^Base/i.test(m[1]))module.optionBase=Number(m[1].at(-1));else module.optionCompare=m[1].split(/\s+/)[1].toLowerCase();continue;}
      if(/^(Attribute\s+VB_|VERSION\s+|BEGIN$|END$|MultiUse\s*=|Persistable\s*=|DataBindingBehavior\s*=|DataSourceBehavior\s*=|MTSTransactionMode\s*=)/i.test(text))continue;
      const header=parseProcedureHeader(text,module.defaultTypes);if(header){if(header.scope==='friend'&&module.kind==='module')throw new VBError('Friend procedures are valid only in object modules',1002);current={...header,line,source:module.name};continue;}
      if((m=text.match(/^(?:(Public|Private|Global)\s+)?Const\s+(.+)$/i))){module.declarations.push(...parseDeclarations(m[2],true,module.defaultTypes).map(d=>({...d,line,scope:lower(m[1]||'private')})));continue;}
      if((m=text.match(/^(?:Public|Private|Global|Dim)\s+(.+)$/i))){if(/^(Enum|Type|Event|Declare)\b/i.test(m[1])){/* handled below */}else{module.declarations.push(...parseDeclarations(m[1],false,module.defaultTypes).map(d=>{if(d.withEvents&&module.kind==='module')throw new VBError('WithEvents is valid only in class and form modules',1002);return {...d,line,scope:/^(Public|Global)\b/i.test(text)?'public':'private'};}));continue;}}
      if(/^Option\s+Private\s+Module$/i.test(text))continue;
      const definition=parseModuleHeader(text,module.defaultTypes);
      if(definition){
        const key=lower(definition.name);
        if(definition.kind==='implements'){
          if(module.kind==='module')throw new VBError('Implements is valid only in a class or form module',1002);
          if(module.interfaces.some(i=>lower(i.name)===key))throw new VBError('Duplicate implemented interface: '+definition.name,1002);
          module.interfaces.push({name:definition.name,line});
        }else if(definition.kind==='enum'||definition.kind==='type'){
          if(typeNames.has(key))throw new VBError('Ambiguous type name: '+definition.name,1002);typeNames.add(key);
          if(definition.kind==='enum'){
            enumState={name:definition.name,scope:definition.scope,previous:null};
            module.enums[definition.name]={name:definition.name,scope:definition.scope,members:[]};
          }else{typeState={name:definition.name,names:new Set()};module.types[definition.name]=[];}
        }else if(definition.kind==='event'){
          if(module.kind==='module')throw new VBError('Events can be declared only in class and form modules',1002);
          module.events ||= new Map();if(module.events.has(key))throw new VBError('Ambiguous event name: '+definition.name,1002);
          module.events.set(key,{name:definition.name,line,scope:definition.scope,params:definition.params});
        }else{
          if(module.procedures.has(key))throw new VBError('Ambiguous procedure name: '+definition.name,1002);
          module.procedures.set(key,{name:definition.name,kind:definition.procedureKind,scope:definition.scope,params:definition.params,returnType:definition.returnType,line,source:module.name,code:[],external:definition.external});
        }
        continue;
      }
      throw new VBError(`Invalid statement outside procedure: ${text}`,1002);
    }catch(error){if(error instanceof VBError){error.source ||= module.name;error.line ||= line;}throw error;}
  }
  for(const p of module.procedures.values())if(/^Decimal$/i.test(p.returnType))throw new VBError('Decimal is a Variant subtype; use a Variant return type',1002,module.name,p.line);
  if(current)throw new VBError(`Expected End ${current.kind}`,1002,module.name,current.line);
  if(enumState||typeState)throw new VBError('Unterminated type declaration',1002,module.name,lines.at(-1)?.line);
  for(const attribute of module.attributes){
    const a=String(attribute).match(/^Attribute\s+(\[[^\]]+\]|[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)\.VB_UserMemId\s*=\s*(-?\d+)$/i);
    if(a&&Number(a[2])===0){const key=lower(a[1].replace(/^\[|\]$/g,'')),proc=module.procedures.get(key+':get')||module.procedures.get(key);
      if(!proc||proc.scope!=='public'||!['function','property'].includes(proc.kind))throw new VBError('Default member must be a Public Function or Property Get',1002,module.name,proc?.line||1);
      if(module.defaultMember&&module.defaultMember!==key)throw new VBError('Only one default member is permitted per object module',1002,module.name,proc.line);
      module.defaultMember=key;
    }
  }
  return module;
}
export function compileProject(project,{retainSyntax=false}={}) {
  const modules=new Map(),diagnostics=[];
  try{validateLayout(project,false);}catch(error){diagnostics.push({severity:'error',message:error.message,number:error.number||380,source:error.source||project.name,line:1,column:1});}
  for(const input of project.modules||[]){try{const module=compileModule({...input,retainSyntax,conditionalConstants:project.settings?.conditionalConstants||{}});const key=lower(module.name);if(modules.has(key))throw new VBError(`Duplicate module name: ${module.name}`,1002,module.name,1);modules.set(key,module);}catch(error){diagnostics.push({severity:'error',message:error.message,number:error.number||1002,source:error.source||input.name,line:error.line||1,column:error.column||1});}}
  diagnostics.push(...validateCompiledModules(modules,project.settings));
  return {name:project.name,startup:project.startup,modules,diagnostics,valid:!diagnostics.length,settings:project.settings||{},sourceProject:project};
}

/** Cross-module constraints shared by execution and background diagnostics. */
export function validateCompiledModules(modules,settings={}) {
  const diagnostics=[...bindConstants(modules,settings),...validateLayoutMembers(modules,settings)];
  const recordNames=new Set([...modules.values()].flatMap(m=>Object.keys(m.types).map(lower)));
  for(const module of modules.values())for(const proc of module.procedures.values())for(const param of proc.params)if(!param.byRef&&!param.paramArray&&(recordNames.has(lower(param.type))||param.bounds!==null))diagnostics.push({severity:'error',message:recordNames.has(lower(param.type))?'User-defined type may not be passed ByVal':'Array argument must be ByRef',number:1002,source:module.name,line:proc.line,column:1});
  const parents=[...modules.values()].filter(m=>m.form?.type==='MDIForm');
  if(parents.length>1)diagnostics.push({severity:'error',message:'Only one MDI Form is permitted per project',number:360,source:parents[1].name,line:1,column:1});
  for(const module of modules.values())if(module.form){if(module.form.type==='MDIForm'&&Number(module.form.properties?.MDIChild))diagnostics.push({severity:'error',message:'An MDI Form cannot also be an MDI child',number:380,source:module.name,line:1,column:1});if(Number(module.form.properties?.MDIChild)&&!parents.length)diagnostics.push({severity:'error',message:'An MDI child requires an MDI Form in the project',number:366,source:module.name,line:1,column:1});}
  diagnostics.push(...validateInterfaces(modules));
  return diagnostics;
}

/** Parse an isolated leaf statement with the same grammar used by the VM.
 * Branch/block statements deliberately require the enclosing procedure parser.
 * This API does not evaluate expressions or execute project code. */
export function parseLeafStatement(text, module, procedure, line=1) {
  const compiler=new ProcedureCompiler(procedure,module);
  compiler.statement(text,line);
  if(compiler.blocks.length||compiler.patches.length)throw new VBError('Expected a leaf statement',1002,module.name,line);
  return compiler.code;
}
