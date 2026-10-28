import {MACOS26_NS,XAML_NS,XML_NS,escapeXml} from '../../packages/xaml-compiler/src/index.js';
import {effectiveProperties} from './macos26-lowering.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const identity=value=>typeof value==='string'?value:undefined;
const boolean=value=>value===0?'False':value===-1?'True':undefined;
const selected=value=>value===0?'False':value===1?'True':undefined;
const visibility=value=>value===0?'Collapsed':value===-1?'Visible':undefined;
const columnFields={Text:['Title',identity],Width:['Width',n=>Number.isFinite(n)&&n>0?n/15:undefined],Alignment:['TextAlignment',n=>['Left','Right','Center'][n]]};
const rowFields={Text:['Text',identity]};
const nodeFields={Text:['Text',identity],Expanded:['IsExpanded',boolean]};
const segmentFields={Caption:['Title',identity],Enabled:['IsEnabled',boolean],Visible:['Visibility',visibility],ToolTipText:['ToolTip',identity]};
const segmentsByStyle={0:'Momentary',1:'Multiple',2:'Single'};

/** Edit typed collection data at the consuming item. All operations are staged
 * until the entire collection is representable; a rejected collection therefore
 * cannot partly mutate the shared edit plan before the native-override fallback.
 * The caller recompiles the complete candidate and compares its full form model.
 */
export function patchMacOS26CollectionSource({before,after,mapping,irByStart,byStart,plan,overrides}) {
  const handled=new Set();
  if(mapping.namespaceURI!==MACOS26_NS)return handled;
  const node=irByStart.get(mapping.start);
  if(!node)return handled;
  const properties=effectiveProperties(node);
  const pending=[];
  const textOperation=(element,value)=>{
    if(!element||typeof value!=='string'||element.children.some(c=>!['Text','Comment','CData'].includes(c.kind)))return null;
    return ()=>{
      if(element.selfClosing)plan.edits.push({start:element.openEnd-2,end:element.openEnd,text:'>'+escapeXml(value)+'</'+element.name+'>'});
      else {
        const runs=element.children.filter(c=>['Text','CData'].includes(c.kind));
        if(!runs.length)plan.insert(element.closeStart,escapeXml(value));
        else for(let i=0;i<runs.length;i++)plan.edits.push({start:runs[i].start,end:runs[i].end,text:i?'':escapeXml(value)});
      }
      // Explicit native string edits include significant whitespace. Limit the
      // preservation scope to this data value, never the enclosing collection.
      if(value.replace(/[\x20\t\r\n]+/g,' ').trim()!==value)plan.setAttribute(element,XML_NS,'space','preserve');
      return true;
    };
  };
  const propertyOperation=(item,name,value)=>{
    const element=byStart.get(item.source.start),source=effectiveProperties(item)[name];
    if(!element)return null;
    if(value===undefined)return ()=>plan.replaceProperty(element,'',source?.member.name??name,undefined);
    if(source?.implicit)return textOperation(element,String(value));
    const literalElement=source?.value.source&&byStart.get(source.value.source.start);
    if(literalElement?.namespaceURI===XAML_NS&&literalElement.localName==='String')return textOperation(literalElement,String(value));
    const attribute=source&&element.attributes.find(a=>a.start===source.source.start&&a.end===source.source.end);
    const propertyElement=source&&!attribute&&byStart.get(source.source.start);
    if(propertyElement&&propertyElement!==element&&propertyElement.children.every(c=>['Text','Comment','CData'].includes(c.kind)))return textOperation(propertyElement,String(value));
    const literal=typeof value==='string'&&value.startsWith('{')?'{}'+value:value;
    return ()=>plan.replaceProperty(element,attribute?.namespaceURI??'',source?.member.name??name,String(literal));
  };
  const collectionItems=property=>property?.value.kind==='Collection'?property.value.items:null;
  const pair=(nativeName,xamlName)=>{
    if(same(before.properties[nativeName],after.properties[nativeName])||Object.hasOwn(overrides,nativeName))return null;
    if(mapping.properties[nativeName]?.fromStyle)return null;
    const a=before.properties[nativeName],b=after.properties[nativeName],items=collectionItems(properties[xamlName]);
    if(!Array.isArray(a)||!Array.isArray(b)||!items||a.length!==b.length||a.length!==items.length||items.length>10000)return null;
    return {a,b,items};
  };
  const itemOperations=(item,a,b,fields,extra=()=>false)=>{
    if(!a||!b||!same(a.Key,b.Key)||!same(a.Parent,b.Parent))return null;
    const operations=[];
    for(const key of new Set([...Object.keys(a),...Object.keys(b)])) {
      if(same(a[key],b[key]))continue;
      if(!Object.hasOwn(b,key))return null;
      if(extra(key,operations))continue;
      const definition=fields[key],value=definition?.[1](b[key]);
      if(value===undefined)return null;
      const operation=propertyOperation(item,definition[0],value);if(!operation)return null;
      operations.push(operation);
    }
    return operations;
  };
  const stage=(name,pairs,fields,extra)=>{
    if(!pairs)return;
    const operations=[];
    for(let i=0;i<pairs.items.length;i++) {
      const next=itemOperations(pairs.items[i],pairs.a[i],pairs.b[i],fields,extra&&((key,ops)=>extra(key,ops,pairs.items[i],pairs.a[i],pairs.b[i])));
      if(!next)return;
      operations.push(...next);
    }
    pending.push(...operations);handled.add(name);
  };
  if(node.type.name==='Table') {
    stage('Columns',pair('Columns','Columns'),columnFields);
    stage('Items',pair('Items','Rows'),rowFields,(key,operations,item,a,b)=>{
      if(key!=='SubItems')return false;
      const cells=collectionItems(effectiveProperties(item).SubItems);
      if(!cells||!Array.isArray(a.SubItems)||!Array.isArray(b.SubItems)||cells.length!==a.SubItems.length||cells.length!==b.SubItems.length)return false;
      const next=[];
      for(let i=0;i<cells.length;i++)if(a.SubItems[i]!==b.SubItems[i]) {
        const element=cells[i].source&&byStart.get(cells[i].source.start);
        if(element?.namespaceURI!==XAML_NS||element.localName!=='String')return false;
        const operation=textOperation(element,b.SubItems[i]);if(!operation)return false;
        next.push(operation);
      }
      operations.push(...next);return true;
    });
  }
  if(node.type.name==='Outline'&&!Object.hasOwn(overrides,'Nodes')&&!same(before.properties.Nodes,after.properties.Nodes)) {
    const items=[];
    const visit=value=>{for(const item of collectionItems(value)??[]){items.push(item);visit(effectiveProperties(item).Children);}};
    visit(properties.Nodes);
    const a=before.properties.Nodes,b=after.properties.Nodes;
    if(!mapping.properties.Nodes?.fromStyle&&Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.length===items.length&&items.length<=10000)stage('Nodes',{a,b,items},nodeFields);
  }
  if(node.type.name==='TabView') {
    const items=collectionItems(properties.Items);
    if(items&&items.length===before.properties.Tabs&&items.length===after.properties.Tabs&&items.length<=10000) {
      const fields={Caption:['Title',identity],Enabled:['IsEnabled',boolean],Visible:['Visibility',visibility]};
      for(let i=0;i<items.length;i++)for(const [field,[name,convert]] of Object.entries(fields)) {
        const key='Tab'+field+'('+i+')';
        if(same(before.properties[key],after.properties[key])||Object.hasOwn(overrides,key)||!Object.hasOwn(after.properties,key))continue;
        const value=convert(after.properties[key]),operation=value!==undefined&&propertyOperation(items[i],name,value);
        if(operation){pending.push(operation);handled.add(key);}
      }
      if(before.properties.Tab!==after.properties.Tab&&!Object.hasOwn(overrides,'Tab')) {
        const index=after.properties.Tab,explicit=items.map(item=>effectiveProperties(item).IsSelected),anyExplicit=explicit.some(Boolean),operations=[];
        let valid=Number.isInteger(index)&&index>=0&&index<items.length;
        if(valid&&(properties.SelectedIndex||!anyExplicit)) {
          const operation=propertyOperation(node,'SelectedIndex',index);valid=!!operation;if(operation)operations.push(operation);
        }
        if(valid)for(let i=0;i<items.length;i++)if(explicit[i]||i===index&&anyExplicit) {
          const operation=propertyOperation(items[i],'IsSelected',i===index?'True':'False');
          if(!operation){valid=false;break;}operations.push(operation);
        }
        if(valid){pending.push(...operations);handled.add('Tab');}
      }
    }
  }
  if(node.type.name==='SegmentedControl') {
    const pairs=pair('Buttons','Segments');
    if(pairs&&pairs.b.length) {
      const style=pairs.b[0].Style,mode=segmentsByStyle[style],changedMode=pairs.a.some((a,i)=>a.Style!==pairs.b[i].Style);
      const selectedItems=pairs.b.map((b,i)=>b.Value===1?i:-1).filter(i=>i>=0),sourceIndex=properties.SelectedIndex;
      let valid=!!mode&&pairs.b.every(b=>b.Style===style&&[0,1].includes(b.Value))&&(style===1||selectedItems.length<=1)&&(style!==0||!selectedItems.length);
      const operations=[];
      if(valid&&changedMode) {
        const operation=propertyOperation(node,'SelectionMode',mode);valid=!!operation;if(operation)operations.push(operation);
      }
      const changedSelection=pairs.a.some((a,i)=>a.Value!==pairs.b[i].Value);
      if(valid&&sourceIndex&&(changedSelection||changedMode)) {
        const operation=propertyOperation(node,'SelectedIndex',style===1?undefined:selectedItems[0]??-1);valid=!!operation;if(operation)operations.push(operation);
      }
      if(valid)for(let i=0;i<pairs.items.length;i++) {
        const item=pairs.items[i],a=pairs.a[i],b=pairs.b[i];
        const next=itemOperations(item,a,b,segmentFields,key=>['Style','Value'].includes(key));
        if(!next){valid=false;break;}operations.push(...next);
        const explicit=effectiveProperties(item).IsSelected;
        if((changedMode||a.Value!==b.Value)&&(!sourceIndex||style===1||explicit)) {
          const operation=propertyOperation(item,'IsSelected',selected(b.Value));
          if(!operation){valid=false;break;}operations.push(operation);
        }
      }
      if(valid){pending.push(...operations);handled.add('Buttons');}
    }
  }
  for(const operation of pending)if(!operation())return null;
  return handled;
}
