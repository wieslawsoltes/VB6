import {UIError, LIMITS, safeKey} from './safety.js';
import {parseExpression} from './expression.js';
import {CATALOG, validProp} from './catalog.js';

/** Original DIL-inspired syntax compiler. Produces inert JSON instructions, never JavaScript. */
export function compile(source, {partial = false, catalog = CATALOG} = {}) {
  if(typeof source!=='string'||source.length>LIMITS.source)throw new UIError('source_limit','UI source must contain at most 100,000 characters.');
  let pos=0,count=0,depth=0;const constants=Object.create(null),diagnostics=[],recoveryDiagnostics=[];
  const diag=(code,message,offset=pos,recovery=false)=>{const d={code,message,offset};(recovery?recoveryDiagnostics:diagnostics).push(d);};
  const key = at => 'n'+at;
  const expression=(value,at)=>{try{return parseExpression(value);}catch(error){diag(error.code||'expression',error.message,at);return {t:'literal',v:null};}};
  function balanced(start) {
    let nesting=0,quote='',escaped=false;
    for(let i=start;i<source.length;i++){
      const c=source[i];
      if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
      if(c==='"'||c==="'"){quote=c;continue;}
      if(c==='{')nesting++;if(c==='}'&&!--nesting)return {value:source.slice(start+1,i),end:i+1};
    }
    return null;
  }
  function text(value,at,inline=false){if(!value)return null;const id=key(at);constants[id]=value;return {t: inline?'literalText':'markdown',key:id,constant:id};}
  function declaration(value,at){
    let match=/^\s*const\s+\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*DIL\.useState\s*\(([\s\S]*)\)\s*;?\s*$/.exec(value);
    if(match){for(const name of match.slice(1,3))checkName(name);if(match[1]===match[2])throw new UIError('declaration','State and setter must have different names.',at);return {t:'state',key:key(at),name:match[1],setter:match[2],value:expression(match[3],at)};}
    match=/^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(value);
    if(match){checkName(match[1]);return {t:'let',key:key(at),name:match[1],value:expression(match[2],at)};}
    diag('unsupported_statement','Use const name = expression or const [value,setValue] = DIL.useState(initial).',at);return null;
  }
  function checkName(name){safeKey(name);if(['DIL','GenUI','Math','JSON','Number','String','Boolean','data'].includes(name))throw new UIError('declaration','Reserved binding: '+name);parseExpression(name);}
  function children(closeTag=null,block=null,inline=false){
    if(++depth>LIMITS.depth)throw new UIError('depth_limit','UI nesting exceeds limit.',pos);
    const nodes=[];let stop=null;
    const add=node=>{if(!node)return;if(++count>LIMITS.nodes)throw new UIError('node_limit','UI source has too many nodes.',pos);nodes.push(node);};
    while(pos<source.length){
      const at=pos;
      if(source.startsWith('</',pos)){
        const end=source.indexOf('>',pos);if(end<0){diag('unterminated_tag','Incomplete closing tag.',pos,true);pos=source.length;break;}
        const tag=source.slice(pos+2,end).trim();pos=end+1;
        if(tag===closeTag){stop='close';break;}
        diag('mismatched_tag','Unexpected closing tag: '+tag,at);continue;
      }
      if(source.startsWith('{:',pos)||source.startsWith('{/',pos)){
        const part=balanced(pos);if(!part){diag('unclosed_block','Incomplete block ending.',pos,true);pos=source.length;break;}
        if(block){stop=part.value;pos=part.end;break;}diag('mismatched_block','Unexpected block ending.',pos);pos=part.end;continue;
      }
      if(source.startsWith('{@body',pos)){
        const part=balanced(pos);if(!part){diag('unterminated_statement','Incomplete body statement.',pos,true);pos=source.length;break;}
        pos=part.end;try{add(declaration(part.value.slice(5),at));}catch(error){diag(error.code,error.message,at);}continue;
      }
      if(source.startsWith('{#if ',pos)){
        const part=balanced(pos);if(!part){diag('unclosed_block','Incomplete condition.',pos,true);pos=source.length;break;}
        pos=part.end;const branches=[],condition=expression(part.value.slice(4),at);let result=children(null,'if',inline);branches.push({test:condition,children:result.nodes});
        while(result.stop?.startsWith(':else if ')){const test=expression(result.stop.slice(9),pos);result=children(null,'if',inline);branches.push({test,children:result.nodes});}
        let otherwise=[];if(result.stop===':else'){result=children(null,'if',inline);otherwise=result.nodes;}
        if(result.stop!=='/if')diag('unclosed_block','Unclosed if block.',at,true);
        add({t:'if',key:key(at),branches,otherwise});continue;
      }
      if(source.startsWith('{#each ',pos)){
        const part=balanced(pos);if(!part){diag('unclosed_block','Incomplete loop.',pos,true);pos=source.length;break;}
        const match=/^#each\s+([\s\S]+?)\s+as\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?(?:\s*\(([^]+)\))?\s*$/.exec(part.value);pos=part.end;
        if(!match){diag('loop','Use {#each expression as item, index (item.id)}.',at);continue;}
        try{checkName(match[2]);if(match[3])checkName(match[3]);}catch(error){diag(error.code,error.message,at);}
        const result=children(null,'each',inline);if(result.stop!=='/each')diag('unclosed_block','Unclosed each block.',at,true);
        add({t:'each',key:key(at),value:expression(match[1],at),name:match[2],index:match[3]||null,itemKey:match[4]?expression(match[4],at):null,children:result.nodes});continue;
      }
      if(source[pos]==='{'&&!source.startsWith('{#',pos)){
        const part=balanced(pos);if(!part){diag('unterminated_braced_value','Incomplete interpolation.',pos,true);pos=source.length;break;}
        pos=part.end;add({t:'expression',key:key(at),value:expression(part.value,at)});continue;
      }
      if(source[pos]==='<'&&/[A-Za-z]/.test(source[pos+1]||'')){
        const name=/^<([A-Za-z][\w]*)/.exec(source.slice(pos));if(!name){pos++;add(text('<',at,inline));continue;}pos+=name[0].length;
        const type=name[1], props=Object.create(null);let ended=false,selfClosing=false;
        while(pos<source.length){
          while(/\s/.test(source[pos]||'')&&pos<source.length)pos++;
          if(source.startsWith('/>',pos)){pos+=2;ended=selfClosing=true;break;}if(source[pos]==='>'){pos++;ended=true;break;}
          const attr=/^[A-Za-z][\w-]*/.exec(source.slice(pos));if(!attr){diag('attribute','Invalid component property.',pos);const end=source.indexOf('>',pos);pos=end<0?source.length:end+1;break;}
          const attrAt=pos,prop=attr[0];pos+=prop.length;while(pos<source.length&&/\s/.test(source[pos]))pos++;
          let value={t:'literal',v:true};
          if(source[pos]==='='){
            pos++;while(pos<source.length&&/\s/.test(source[pos]))pos++;
            if(source[pos]==='{'){const part=balanced(pos);if(!part){diag('unterminated_braced_value','Incomplete property expression.',pos,true);pos=source.length;break;}value=expression(part.value,pos);pos=part.end;}
            else if(source[pos]==='"'||source[pos]==="'"){const q=source[pos++],start=pos;while(pos<source.length&&source[pos]!==q)pos++;if(pos===source.length){diag('unterminated_tag','Incomplete quoted property.',at,true);break;}value={t:'literal',v:source.slice(start,pos++)};}
            else {diag('attribute','Property values require quotes or braces.',pos);while(pos<source.length&&!/[\s>]/.test(source[pos]))pos++;continue;}
          }
          if(!Object.hasOwn(catalog,type)||!Object.hasOwn(catalog[type],prop)){diag('unknown_prop','Unknown property '+type+'.'+prop,attrAt);continue;}
          if(Object.hasOwn(props,prop)){diag('duplicate_prop','Duplicate property: '+prop,attrAt);continue;}
          if(value.t==='literal'&&!validProp(catalog[type][prop],value.v)){diag('invalid_literal','Invalid value for '+type+'.'+prop,attrAt);continue;}
          props[prop]=value;
        }
        if(!ended){if(pos>=source.length)diag('unterminated_tag','Incomplete component tag.',at,true);continue;}
        let contents=[],html=null;
        if(type==='AppBlock'&&!selfClosing){const end=source.indexOf('</AppBlock>',pos);if(end<0){diag('unclosed_app','AppBlock is only available after its closing tag.',at,true);pos=source.length;continue;}html=source.slice(pos,end);pos=end+11;}
        else if(!selfClosing){const result=children(type,null,['title','text','caption','bold','italic','code','button','link','option','VB6Label'].includes(type));contents=result.nodes;if(result.stop!=='close')diag('unclosed_tag','Unclosed '+type+' component.',at,true);}
        if(!Object.hasOwn(catalog,type)){diag('unknown_component','Unknown component: '+type,at);continue;}
        const node={t:'element',key:key(at),type,props,children:contents};if(html!==null){constants[key(at)+':app']=html;node.html=key(at)+':app';}add(node);continue;
      }
      // Fenced code is literal; tags, expressions and statements inside never execute.
      if((pos===0||source[pos-1]==='\n')&&source.startsWith('```',pos)){
        const newline=source.indexOf('\n',pos+3),end=newline<0?-1:source.indexOf('\n```',newline);const start=newline<0?source.length:newline+1;
        const value=source.slice(start,end<0?source.length:end);constants[key(at)]=value;add({t:'element',key:key(at),type:'codeBlock',props:{language:{t:'literal',v:source.slice(pos+3,newline<0?source.length:newline).trim()}},children:[{t:'literalText',key:key(at)+':text',constant:key(at)}]});pos=end<0?source.length:end+4;continue;
      }
      pos++;
      while(pos<source.length&&source[pos]!=='{'&&!(source[pos]==='<'&&/[A-Za-z/]/.test(source[pos+1]||''))&&!((pos===0||source[pos-1]==='\n')&&source.startsWith('```',pos)))pos++;
      add(text(source.slice(at,pos),at,inline));
    }
    depth--;return {nodes,stop};
  }
  const result=children();
  if(!partial&&recoveryDiagnostics.length)diagnostics.push(...recoveryDiagnostics.map(d=>({...d,code:'incomplete_'+d.code})));
  const fallback=[];
  const plain=nodes=>{for(const n of nodes){if(n.constant)fallback.push(constants[n.constant]);if(n.t==='element'){if(n.type==='AppBlock')fallback.push('[Interactive app]');else{if(n.props.label?.t==='literal')fallback.push(n.props.label.v);plain(n.children);}}if(n.t==='if')for(const b of n.branches)plain(b.children);}};plain(result.nodes);
  return {version:1,program:{children:result.nodes},constants,diagnostics,recoveryDiagnostics,fallbackMarkdown:fallback.join('').slice(0,LIMITS.text),partial};
}
export function classifyUpdate(previous, next) {
  if(!previous||JSON.stringify(previous.program)!==JSON.stringify(next.program))return 'program';
  if(JSON.stringify(previous.constants)!==JSON.stringify(next.constants))return 'constants';return 'none';
}
export class StreamingCompiler {
  constructor(options={}){this.options=options;this.source='';this.document=null;this.revision=0;}
  append(chunk){if(typeof chunk!=='string')throw new UIError('source','Stream chunks must be strings.');return this.replace(this.source+chunk,true);}
  replace(source,partial=true){const next=compile(source,{...this.options,partial}),kind=classifyUpdate(this.document,next);this.source=source;this.document=next;return {kind,revision:++this.revision,document:next};}
  finish(){return this.replace(this.source,false);}
}
