import {MACOS26_NS} from '../../packages/xaml-compiler/src/index.js';
import {MACOS26_COLOR_ROLES,macos26ColorFallback} from '../theme/macos26-resources.js';
import {MAX_XAML_LENGTH} from './contract.js';

export const propertyName = member => member.aliasFor ?? member.name;
export const effectiveProperties = node => Object.fromEntries((node?.properties??[]).filter(p=>!p.member.attached).map(p=>[propertyName(p.member),p]));
const themeTokens=new WeakSet();
export const macOS26ThemeColor = key => {
  if(typeof key!=='string'||!key.startsWith('macOS.'))return undefined;
  const role=key.slice(6);
  if(!Object.hasOwn(MACOS26_COLOR_ROLES,role))return undefined;
  const token=Object.freeze({kind:'MacOS26Color',role,fallback:macos26ColorFallback(role)});
  themeTokens.add(token);return token;
};
export const isMacOS26ThemeColor = value => themeTokens.has(value);

const noExtra = (node,names) => {
  if(node.properties.some(p=>p.member.attached||!names.includes(propertyName(p.member)))||Object.keys(node.directives).some(key=>key!=='Key'))
    throw new TypeError(node.type.name+' accepts only static item data; names, styles, event handlers and designer metadata cannot be flattened.');
};
const collection = (value,type) => {
  if(value?.kind!=='Collection')throw new TypeError(type+' must be a collection.');
  if(value.items.length>10000)throw new RangeError(type+' exceeds the 10,000-item limit.');
  return value.items;
};
const expectType = (node,name) => {
  if(node?.kind!=='Object'||node.type.namespaceURI!==MACOS26_NS||node.type.name!==name)
    throw new TypeError('Expected macOS '+name+' item data.');
};
const expansionBudget = label => {
  let length=2,count=0;
  const add=bytes=>{length+=bytes;if(length>MAX_XAML_LENGTH)throw new RangeError('Expanded macOS '+label+' exceeds the document limit.');};
  return {
    add,
    item(value){add(JSON.stringify(value).length+(count++?1:0));},
    field(name,value){add(JSON.stringify({[name]:value}).length-2+(count++?1:0));}
  };
};
const keyFor = (node,props,statics,scopes) => {
  const value=props.Key?statics.convert(props.Key.value,props.Key.member,scopes):node.directives.Key;
  if(value!==undefined&&typeof value!=='string')throw new TypeError('Native collection keys must be strings.');
  if(props.Key&&node.directives.Key!==undefined&&value!==node.directives.Key)throw new TypeError('Key and x:Key must agree.');
  return value??'';
};
const assignKeys = (items,prefix,budget) => {
  const seen=new Set();
  for(const item of items)if(item.Key){const key=item.Key.toLowerCase();if(seen.has(key))throw new TypeError('Duplicate native collection key '+item.Key+'.');seen.add(key);}
  let serial=0;
  for(const item of items)if(!item.Key){let key;do{key=prefix+(++serial);}while(seen.has(key.toLowerCase()));budget?.add(JSON.stringify(key).length-2);item.Key=key;seen.add(key.toLowerCase());}
};

/** Static collection lowering goes into the same properties consumed by the
 * designer, browser runtime and native compilers. Unsupported item behavior is
 * diagnosed before allocating any controls. No synthetic placeholder widgets. */
export function lowerMacOS26Collection({node,p,values,scopes,statics,constant,set,children}) {
  if(node.type.namespaceURI!==MACOS26_NS)return false;
  const key=propertyName(p.member),read=(props,name,fallback)=>props[name]?statics.convert(props[name].value,props[name].member,scopes):fallback;
  if(node.type.name==='Table'&&key==='Columns') {
    const budget=expansionBudget('Table.Columns');
    const columns=collection(p.value,'Table.Columns').map(item=>{
      expectType(item,'TableColumn');noExtra(item,['Key','Title','Width','TextAlignment']);const props=effectiveProperties(item);
      const width=read(props,'Width',160),align=props.TextAlignment?statics.convert(props.TextAlignment.value,props.TextAlignment.member,scopes):'Left';
      if(typeof width!=='number'||!Number.isFinite(width)||width<=0||width>20000)throw new TypeError('Table column widths must be positive finite DIPs within native geometry limits.');
      if(!['Left','Center','Right'].includes(align))throw new TypeError('Unsupported table column alignment.');
      const column={Key:keyFor(item,props,statics,scopes),Text:String(read(props,'Title','')),Width:width*15,Alignment:['Left','Right','Center'].indexOf(align)};
      budget.item(column);return column;
    });
    assignKeys(columns,'column',budget);set('Columns',columns,p);return true;
  }
  if(node.type.name==='Table'&&key==='Rows') {
    const budget=expansionBudget('Table.Rows');
    const columnCount=values.Columns?collection(values.Columns.value,'Table.Columns').length:1;
    const items=collection(p.value,'Table.Rows').map(item=>{
      expectType(item,'TableRow');noExtra(item,['Key','Text','SubItems']);const props=effectiveProperties(item);
      const cells=expansionBudget('TableRow.SubItems');
      const subItems=props.SubItems?collection(props.SubItems.value,'TableRow.SubItems').map(value=>{
        const text=constant(value,scopes);if(typeof text!=='string')throw new TypeError('Table cells must be strings.');cells.item(text);return text;
      }):[];
      if(subItems.length>Math.max(0,columnCount-1))throw new TypeError('Table row cells exceed the declared column count.');
      const row={Key:keyFor(item,props,statics,scopes),Text:String(read(props,'Text','')),SubItems:subItems};
      budget.item(row);return row;
    });
    assignKeys(items,'row',budget);set('Items',items,p);return true;
  }
  if(node.type.name==='Outline'&&key==='Nodes') {
    const nodes=[],parents=[],budget=expansionBudget('Outline.Nodes');
    const visit=(items,parent=-1,depth=0)=>{
      if(depth>128)throw new RangeError('Outline hierarchy exceeds 128 levels.');
      for(const item of items) {
        expectType(item,'OutlineNode');noExtra(item,['Key','Text','IsExpanded','Children']);const props=effectiveProperties(item);
        const index=nodes.length;
        if(index>=10000)throw new RangeError('Outline exceeds the 10,000-node limit.');
        const expanded=props.IsExpanded?statics.convert(props.IsExpanded.value,props.IsExpanded.member,scopes):false;
        const entry={Key:keyFor(item,props,statics,scopes),Text:String(read(props,'Text','')),Expanded:expanded?-1:0};
        budget.item(entry);nodes.push(entry);parents.push(parent);
        if(props.Children)visit(collection(props.Children.value,'OutlineNode.Children'),index,depth+1);
      }
    };
    visit(collection(p.value,'Outline.Nodes'));assignKeys(nodes,'node',budget);
    for(let i=0;i<nodes.length;i++)if(parents[i]>=0){const key=nodes[parents[i]].Key;budget.add(JSON.stringify({Parent:key}).length-1);nodes[i].Parent=key;}
    set('Nodes',nodes,p);return true;
  }
  if(node.type.name==='TabView'&&key==='Items') {
    const budget=expansionBudget('TabView.Items');
    const items=collection(p.value,'TabView.Items');
    if(!items.length)throw new TypeError('TabView requires at least one TabItem.');
    const field=(name,value,source)=>{budget.field(name,value);set(name,value,source);};
    field('Tabs',items.length,p);field('TabsPerRow',items.length);
    for(const [index,item] of items.entries()) {
      expectType(item,'TabItem');
      if(Object.keys(item.directives).length)throw new TypeError('TabItem pages do not accept x:Name or resource keys; name their content control instead.');
      noExtra(item,['Title','IsEnabled','Visibility','Content']);const props=effectiveProperties(item);
      field('TabCaption('+index+')',String(read(props,'Title','')),p);
      if(props.IsEnabled)field('TabEnabled('+index+')',statics.convert(props.IsEnabled.value,props.IsEnabled.member,scopes)?-1:0,p);
      if(props.Visibility)field('TabVisible('+index+')',statics.convert(props.Visibility.value,props.Visibility.member,scopes)==='Visible'?-1:0,p);
      if(props.Content) {
        if(props.Content.value.kind!=='Object')throw new TypeError('TabItem.Content must be one supported control or layout container.');
        children.push({child:props.Content.value,menu:false,tabPage:index});
      }
    }
    return true;
  }
  return false;
}

export function macOS26Event(node,name) {
  if(node.type.namespaceURI!==MACOS26_NS)return null;
  if(name==='SelectionChanged'&&node.type.name==='Outline')return 'NodeClick';
  if(name==='SelectionChanged'&&node.type.name==='Table')return 'ItemClick';
  if(name==='ColumnClick'&&node.type.name==='Table')return 'ColumnClick';
  return null;
}

export function macOS26Date(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new TypeError('DatePicker.Date requires an ISO calendar date (YYYY-MM-DD).');
  const [year,month,day]=value.split('-').map(Number),days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<100||month<1||month>12||day<1||day>days[month-1])throw new TypeError('DatePicker.Date is not a supported valid calendar date.');
  return value;
}
