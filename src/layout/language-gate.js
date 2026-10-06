import {layoutEnabled,layoutDefaults,layoutKey} from './contract.js';
const lower=s=>String(s).toLowerCase();
const methods=new Set(['performlayout','suspendlayout','resumelayout']);
const containers=new Set(['form','mdiform','frame','picturebox','tabstrip','sstab']);
/** Just declaration identities for the diagnostics worker, never form assets. */
export function layoutBindingSnapshot(module) {
  if(!module.form)return null;
  return {name:module.name,type:module.form.type,controls:(module.form.controls||[]).map(c=>({name:c.name,type:c.type}))};
}
export function validateLayoutMembers(modules,settings={}) {
  const enabled=layoutEnabled({settings}),diagnostics=[],forms=new Map();
  for(const module of modules.values())if(module.layoutBindings)forms.set(lower(module.name),module.layoutBindings);
  for(const module of modules.values())for(const proc of module.procedures.values()){
    const self=forms.get(lower(module.name)),decls=new Map([...module.declarations,...proc.params,...proc.code.filter(i=>i.op==='dim').flatMap(i=>i.decls)].map(d=>[lower(d.name),d]));
    const withs=[],controls=new Map(self?.controls.map(c=>[lower(c.name),c])||[]);
    const declared=name=>{const d=decls.get(lower(name));if(!d)return null;const type=String(d.type).replace(/^VB\./i,'');if(forms.has(lower(type)))return forms.get(lower(type));if(modules.has(lower(type)))return null;return /^(?:CommandButton|TextBox|Label|Frame|PictureBox|Image|Shape|Line|Timer|ListBox|ComboBox|CheckBox|OptionButton|HScrollBar|VScrollBar|Form|MDIForm|SSTab|TabStrip)$/i.test(type)?{type}:null;};
    const resolve=node=>{
      if(!node)return null;
      if(node.kind==='group')return resolve(node.expr);
      if(node.kind==='with')return withs.at(-1)||null;
      if(node.kind==='call')return resolve(node.callee);
      if(node.kind==='id'){
        const name=lower(node.name);if(decls.has(name))return declared(name);
        if(name==='me')return self;if(module.procedures.has(name))return null;
        return controls.get(name)||forms.get(name)||null;
      }
      if(node.kind==='member'){const owner=resolve(node.object);return owner?.controls?.find(c=>lower(c.name)===lower(node.name))||null;}
      return null;
    };
    for(const ins of proc.code){
      const seen=new Set();
      const check=(receiver,name)=>{
        const property=layoutKey(name),method=methods.has(lower(name));if(!receiver||!property&&!method||seen.has(lower(name)))return;seen.add(lower(name));
        if(enabled&&(property?Object.hasOwn(layoutDefaults(receiver),property):containers.has(lower(receiver.type))))return;
        diagnostics.push({severity:'error',number:438,source:module.name,line:ins.line,column:ins.column||1,message:!enabled?'Enable anchoring in Tools > Options > General before using '+name+'.':receiver.type+' does not support the layout member '+name+'.'});
      };
      const walk=node=>{if(!node||typeof node!=='object')return;if(node.kind==='member')check(resolve(node.object),node.name);if(node.kind==='id'&&self&&!decls.has(lower(node.name))&&!module.procedures.has(lower(node.name))&&!controls.has(lower(node.name)))check(self,node.name);for(const value of Object.values(node)){if(Array.isArray(value)){for(const item of value)walk(item);}else if(value&&typeof value==='object')walk(value);}};
      walk(ins);
      if(ins.op==='withPush')withs.push(resolve(ins.expr));else if(ins.op==='withPop')withs.pop();
    }
  }
  return diagnostics;
}
