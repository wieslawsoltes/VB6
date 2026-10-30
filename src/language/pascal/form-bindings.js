/** Compile form declarations into Pascal types. Form instances and asset values
 * never enter the type graph; the shared host owns all control storage. */
export function pascalFormControlTypes(form,foreignType,fail) {
  const groups=new Map(),ancestors=new WeakSet();let count=0;
  const visit=(node,menu=false,depth=0)=>{
    if(!node||typeof node!=='object')return;
    if(++count>100000||depth>256||ancestors.has(node))fail('Form declarations must be acyclic, at most 256 levels deep and contain at most 100,000 components');
    ancestors.add(node);
    const name=node.name||node.properties?.Name,type=node.type||(menu?'Menu':'Control');
    if(name){
      const key=String(name).toLowerCase(),raw=node.properties?.Index,index=raw===undefined?undefined:Number(raw);
      if(index!==undefined&&(!Number.isInteger(index)||index<0||index>32767))fail('Invalid control array index: '+name);
      let group=groups.get(key);
      if(!group){group={name:String(name),type,indices:[]};groups.set(key,group);}
      else if(String(group.type).toLowerCase()!==String(type).toLowerCase()||index===undefined||group.indices.includes(undefined)||group.indices.includes(index))
        fail('Duplicate or incompatible control array declaration: '+name);
      group.indices.push(index);
    }
    for(const collection of ['controls','menus','items','children'])if(Array.isArray(node[collection]))
      for(const child of node[collection])visit(child,menu||collection==='menus',depth+1);
    ancestors.delete(node);
  };
  visit(form);
  return new Map([...groups].map(([key,group])=>{
    const element=foreignType(group.type);
    return [key,group.indices[0]===undefined?element:{
      kind:'array',name:group.type+' control array',vb:'Object',controlArray:true,
      identity:'form:'+String(form?.name||'').toLowerCase()+':'+key,element,
      dimensions:[{low:Math.min(...group.indices),high:Math.max(...group.indices)}],
    }];
  }));
}

/** VB-style host indexing is an optional spelling for the same Pascal lvalue. */
export function pascalControlArrayIndex(node,type) {
  return node?.kind==='call'&&type?.controlArray
    ?{...node,kind:'index',object:node.callee,indices:node.args}:null;
}
