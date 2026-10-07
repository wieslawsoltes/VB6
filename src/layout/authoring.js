import {createControl} from '../project/model.js';
import {layoutContainer,layoutDefaults,layoutEligible,layoutProperty} from './contract.js';
import {arrangeFormEdit,parentIds} from './model.js';

/** Pure authoring operations. Each transaction is evaluated on a detached form;
 * no partial graph or geometry is published when validation/measurement fails. */
export function layoutEdit(form,operation){
  const draft=structuredClone(form),selection=operation(draft)||[],old=new Map(form.controls.map(c=>[c.id,c]));
  if(!Array.isArray(selection)||selection.some(id=>!draft.controls.some(c=>c.id===id)))throw new TypeError('A layout operation must return existing selected control IDs');
  if(draft.controls.length>10000)throw new RangeError('A form supports at most 10,000 controls');
  const changed=draft.controls.filter(c=>{const b=old.get(c.id);return !b||c.parent!==b.parent||c.nativeParentId!==b.nativeParentId||['Left','Top','Width','Height','Anchor','Dock'].some(k=>b.properties[k]!==c.properties[k]);}).map(c=>c.id);
  arrangeFormEdit(form,draft,changed);
  for(const c of [draft,...draft.controls])for(const k of ['Left','Top','Width','Height','ClientWidth','ClientHeight'])if(c.properties[k]!==undefined){const n=c.properties[k];if(!Number.isFinite(n)||Math.abs(n)>300000||/Width|Height/.test(k)&&n<0)throw new RangeError(c.name+'.'+k+' exceeds the supported geometry range');}
  return {form:draft,selection};
}
/** Linear hierarchy selection, including deeply nested frames. */
export function descendantIds(form,ids,includeRoots=true){
  const children=new Map(),parents=parentIds(form.controls),result=new Set(includeRoots?ids:[]),queue=[...ids];
  for(const [id,parent]of parents){if(!children.has(parent))children.set(parent,[]);children.get(parent).push(id);}
  for(let q=0;q<queue.length;q++)for(const id of children.get(queue[q])||[])if(!result.has(id)){result.add(id);queue.push(id);}
  return result;
}
export function selectedRoots(form,ids){
  const selected=new Set(ids),parents=parentIds(form.controls),models=new Map(form.controls.map(c=>[c.id,c]));
  for(const id of selected)if(!models.has(id))throw new Error('Selected control no longer exists');
  // worldBounds validates the full graph before any mutation, without recursion.
  worldBounds(form);const below=descendantIds(form,ids,false);
  return form.controls.filter(c=>selected.has(c.id)&&!below.has(c.id));
}
export function layoutTargets(form,ids){
  const selected=new Set(ids),targets=form.controls.filter(c=>selected.has(c.id));
  if(targets.length!==selected.size)throw new Error('Selected control no longer exists');
  return ids.length?targets:[form];
}
export function editLayoutProperties(form,ids,changes){
  const targets=layoutTargets(form,ids);if(!targets.length)throw new Error('No layout target');
  for(const c of targets){const defaults=layoutDefaults(c);for(const [key,value]of Object.entries(changes)){if(!Object.hasOwn(defaults,key))throw new Error(key+' is not available on '+c.name);layoutProperty(key,value,{...defaults,...c.properties,...changes});}}
  for(const c of targets){const normalized=Object.fromEntries(Object.entries(changes).map(([key,value])=>[key,layoutProperty(key,value,{...c.properties,...changes})]));for(const [key,value]of Object.entries(normalized)){c.properties[key]=value;if(key==='Anchor')c.properties.Dock=0;if(key==='Dock')c.properties.Anchor=5;}}
  return targets.filter(c=>c!==form).map(c=>c.id);
}
export function inferFlow(controls){
  if(controls.length<2)return 2;const p=controls.map(c=>c.properties),x=p.map(v=>v.Left+v.Width/2),y=p.map(v=>v.Top+v.Height/2);
  return Math.max(...x)-Math.min(...x)>=Math.max(...y)-Math.min(...y)?1:2;
}
export function addAutoLayout(form,ids,mode){
  const items=selectedRoots(form,ids);
  if(!items.length||items.length===1&&layoutContainer(items[0])){const target=items[0]||form,parents=parentIds(form.controls),children=form.controls.filter(c=>parents.get(c.id)===(target===form?null:target.id)&&layoutEligible(c));target.properties.LayoutMode=mode??inferFlow(children);return items.map(c=>c.id);}
  if(items.some(c=>!layoutEligible(c)))throw new Error('Nonvisual components cannot participate in auto layout');
  const parents=parentIds(form.controls),parent=parents.get(items[0].id);if(items.some(c=>parents.get(c.id)!==parent))throw new Error('Wrap controls from one container at a time');
  const direction=mode??inferFlow(items),horizontal=direction!==2&&direction!==4,sorted=[...items].sort((a,b)=>a.properties[horizontal?'Left':'Top']-b.properties[horizontal?'Left':'Top']);
  const minX=Math.min(...items.map(c=>c.properties.Left)),minY=Math.min(...items.map(c=>c.properties.Top)),maxX=Math.max(...items.map(c=>c.properties.Left+c.properties.Width)),maxY=Math.max(...items.map(c=>c.properties.Top+c.properties.Height));
  let index=1;while(form.controls.some(c=>c.name.toLowerCase()==='layoutframe'+index))index++;
  const frame=createControl('Frame','LayoutFrame'+index,minX,minY),gaps=sorted.slice(1).map((c,i)=>c.properties[horizontal?'Left':'Top']-(sorted[i].properties[horizontal?'Left':'Top']+sorted[i].properties[horizontal?'Width':'Height'])).sort((a,b)=>a-b);
  Object.assign(frame.properties,{Caption:'',BorderStyle:0,Width:maxX-minX,Height:maxY-minY,LayoutMode:direction,LayoutWidthMode:1,LayoutHeightMode:1,LayoutGap:gaps.length?gaps[Math.floor(gaps.length/2)]:120});
  const parentModel=form.controls.find(c=>c.id===parent);frame.parent=parentModel?.name??null;frame.nativeParentId=parent;
  const selected=new Set(items.map(c=>c.id)),at=form.controls.findIndex(c=>selected.has(c.id));
  for(const c of sorted){c.parent=frame.name;c.nativeParentId=frame.id;c.properties.Left-=minX;c.properties.Top-=minY;}
  const rest=form.controls.filter(c=>!selected.has(c.id));rest.splice(at,0,frame,...sorted);form.controls=rest;return [frame.id];
}
export function removeAutoLayout(form,ids){const targets=layoutTargets(form,ids);for(const c of targets){if(!layoutContainer(c))continue;c.properties.LayoutMode=0;c.properties.LayoutWidthMode=0;c.properties.LayoutHeightMode=0;}return ids;}
export function reorderControls(form,ids,step){
  const items=selectedRoots(form,ids),selected=new Set(items.map(c=>c.id)),parents=parentIds(form.controls);if(!items.length)return ids;
  const parent=parents.get(items[0].id);if(items.some(c=>parents.get(c.id)!==parent))throw new Error('Reorder controls in one container at a time');
  const siblings=form.controls.filter(c=>parents.get(c.id)===parent),positions=form.controls.map((c,i)=>parents.get(c.id)===parent?i:-1).filter(i=>i>=0);
  if(step<0){for(let i=1;i<siblings.length;i++)if(selected.has(siblings[i].id)&&!selected.has(siblings[i-1].id))[siblings[i-1],siblings[i]]=[siblings[i],siblings[i-1]];}
  else{for(let i=siblings.length-2;i>=0;i--)if(selected.has(siblings[i].id)&&!selected.has(siblings[i+1].id))[siblings[i+1],siblings[i]]=[siblings[i],siblings[i+1]];}
  positions.forEach((p,i)=>form.controls[p]=siblings[i]);return items.map(c=>c.id);
}
/** Parent-local rectangles in form coordinates. Iterative O(n), arbitrary depth. */
export function worldBounds(form){
  const parents=parentIds(form.controls),children=new Map([[null,[]]]),models=new Map(form.controls.map(c=>[c.id,c])),bounds=new Map([[null,{x:0,y:0,width:form.properties.ClientWidth,height:form.properties.ClientHeight}]]);
  for(const [id,parent]of parents){if(!children.has(parent))children.set(parent,[]);children.get(parent).push(id);}
  const order=[...(children.get(null)||[])];for(let q=0;q<order.length;q++){const id=order[q],p=models.get(id).properties,b=bounds.get(parents.get(id));if(!b)throw new Error('Cyclic layout hierarchy');bounds.set(id,{x:b.x+p.Left,y:b.y+p.Top,width:p.Width,height:p.Height});order.push(...children.get(id)||[]);}
  if(order.length!==form.controls.length)throw new Error('Cyclic layout hierarchy');return bounds;
}
export function reparentControls(form,ids,parentId=null,index=Infinity,{ignore=false}={}){
  if(index!==Infinity&&(!Number.isInteger(index)||index<0))throw new RangeError('Insertion index must be nonnegative');
  const items=selectedRoots(form,ids),selected=new Set(items.map(c=>c.id)),parents=parentIds(form.controls),parent=parentId===null?form:form.controls.find(c=>c.id===parentId);
  if(!parent||!layoutContainer(parent))throw new Error('The target is not a layout container');
  for(let p=parentId;p!==null;p=parents.get(p))if(selected.has(p))throw new Error('A control cannot contain itself or its ancestor');
  if(!items.length)return [];
  const bounds=worldBounds(form),pb=bounds.get(parentId),positions=new Map(form.controls.map((c,i)=>[c.id,i]));
  for(const c of items){const b=bounds.get(c.id);c.parent=parent===form?null:parent.name;c.nativeParentId=parentId;c.properties.Left=b.x-pb.x;c.properties.Top=b.y-pb.y;if(ignore)c.properties.LayoutIgnore=-1;else if(parent.properties.LayoutMode)c.properties.LayoutIgnore=0;c.properties.LayoutColumn=-1;c.properties.LayoutRow=-1;}
  const siblings=form.controls.filter(c=>!selected.has(c.id)&&parents.get(c.id)===parentId);index=Math.max(0,Math.min(siblings.length,index));
  const before=siblings[index],last=siblings.at(-1),rest=form.controls.filter(c=>!selected.has(c.id));let at=before?rest.indexOf(before):last?rest.indexOf(last)+1:parent===form?rest.length:rest.indexOf(parent)+1;
  rest.splice(at,0,...items.sort((a,b)=>positions.get(a.id)-positions.get(b.id)));form.controls=rest;return items.map(c=>c.id);
}
