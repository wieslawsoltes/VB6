import {renderIcon} from './icons.js';
import {UIError, LIMITS, safeUrl, display, record} from './safety.js';
import {CATALOG} from './catalog.js';

const tags={box:'div',row:'div',column:'div',grid:'div',title:'h3',text:'span',caption:'small',bold:'strong',italic:'em',code:'code',codeBlock:'pre',quote:'blockquote',divider:'hr',list:'ul',listItem:'li',badge:'span',icon:'span',button:'button',link:'button',form:'form',option:'option',select:'select',tabs:'div',tab:'section',details:'details',summary:'summary',VB6Label:'span',VB6Button:'button'};
const inputs={slider:'range',input:'text',textarea:'textarea',checkbox:'checkbox',radio:'radio',VB6TextBox:'text',VB6CheckBox:'checkbox'};
const write=(node,value)=>{value=display(value);if(node.textContent!==value)node.textContent=value;};
const dimension=value=>typeof value==='number'?value+'px':value||'';

/** Keyed, text-only host rendering. Models never choose DOM tags, attributes, HTML or CSS. */
export class DOMRenderer {
  constructor(root,{onEvent=()=>{},onAction=()=>{},factories={},allowResource=()=>false,onError=()=>{}}={}){
    if(!root?.ownerDocument)throw new UIError('root','A DOM root is required.');this.root=root;this.doc=root.ownerDocument;this.onEvent=onEvent;this.onAction=onAction;this.onError=onError;this.factories=factories;this.allowResource=allowResource;this.scopeId=++DOMRenderer.sequence;this.compositeCost=0;this.records=new Map();this.root.classList.add('iui-root');this.disposed=false;
  }
  reserve(record,cost){const available=Math.max(0,20000-this.records.size*4-this.compositeCost+(record.cost||0)),allowed=Math.min(cost,available);this.compositeCost+=allowed-(record.cost||0);record.cost=allowed;return allowed;}
  create(id,type){
    const d=this.doc,make=(tag,cls)=>{const n=d.createElement(tag);if(cls)n.className=cls;return n;};
    if(type==='#text'){const node=d.createTextNode('');return {id,type,node,host:node,props:{},children:[]};}
    if(type!=='markdown'&&!Object.hasOwn(CATALOG,type)&&!Object.hasOwn(this.factories,type))throw new UIError('component','Unsupported rendered component.');
    const custom=this.factories[type]?.({document:d,id,onAction:(action,context)=>this.action(action,context),onEvent:(event,args)=>this.event(id,event,args)});
    if(custom){custom.node.classList.add('iui-component');return {id,type,node:custom.node,host:custom.childHost||custom.node,custom,props:{},children:[]};}
    const node=make(tags[type]||'div','iui-component iui-'+type),r={id,type,node,host:node,props:{},children:[]};
    if(inputs[type]){r.label=make('span','iui-input-label');r.input=make(inputs[type]==='textarea'?'textarea':'input');if(inputs[type]!=='textarea')r.input.type=inputs[type];r.host=make('span','iui-input-content');node.append(r.label,r.input,r.host);r.input.id='iui-field-'+(++DOMRenderer.sequence);r.label.id=r.input.id+'-label';r.input.setAttribute('aria-labelledby',r.label.id);
      const event=['checkbox','radio'].includes(inputs[type])?'change':'input';r.input.addEventListener(event,()=>this.event(id,'onChange',[r.input.type==='checkbox'?r.input.checked:r.input.type==='range'||r.input.type==='number'?r.input.valueAsNumber:r.input.value]));
    }
    if(type==='select'){r.input=node;node.addEventListener('change',()=>this.event(id,'onChange',[node.value]));}
    if(['button','link','VB6Button'].includes(type)){node.type='button';node.addEventListener('click',e=>{if(r.props.disabled)return;if(type==='link'&&r.props.href&&!r.props.onClick){e.preventDefault();this.action({type:'link',args:[r.props.href]});}else this.event(id,'onClick',[]);});}
    if(type==='form')node.addEventListener('submit',e=>{e.preventDefault();const values=Object.create(null);for(const control of node.querySelectorAll('input,select,textarea')){const name=control.dataset.iuiName||control.name;if(!name||control.disabled||control.type==='radio'&&!control.checked||['__proto__','constructor','prototype'].includes(name))continue;values[name]=control.type==='checkbox'?control.checked:control.type==='number'||control.type==='range'?(Number.isFinite(control.valueAsNumber)?control.valueAsNumber:null):control.value;}this.event(id,'onSubmit',[values]);});
    if(type==='table'){r.view=make('div','iui-table-view');r.controls=make('div','iui-table-controls');r.previous=make('button');r.next=make('button');r.pageLabel=make('span');r.previous.type=r.next.type='button';r.previous.textContent='Previous';r.next.textContent='Next';r.previous.onclick=()=>{r.page=Math.max(0,(r.page||0)-1);this.table(r);};r.next.onclick=()=>{r.page=(r.page||0)+1;this.table(r);};r.controls.append(r.previous,r.pageLabel,r.next);node.append(r.view,r.controls);r.host=make('div');node.append(r.host);}
    if(type==='chart'){r.view=make('div','iui-chart-view');r.host=make('div');node.append(r.view,r.host);}
    if(['image','AsyncImage','AsyncImageGroup','Entity','Cite'].includes(type)){r.view=make('div','iui-resolved-content');r.host=make('div');node.append(r.view,r.host);}
    if(type==='AppBlock'){r.warning=make('p');r.run=make('button');r.run.type='button';r.run.textContent='Run isolated app';r.stop=make('button');r.stop.type='button';r.stop.textContent='Stop app';r.stop.hidden=true;r.warning.textContent='Arbitrary-code AppBlock requires a separately isolated host renderer. The default renderer does not execute this source.';r.run.hidden=true;node.append(r.warning,r.run,r.stop);r.host=make('div');node.append(r.host);r.run.onclick=()=>this.app(r);r.stop.onclick=()=>{r.frame?.remove();r.frame=null;r.run.hidden=false;r.stop.hidden=true;};}
    if(type==='icon'){r.iconView=make('span');r.host=make('span');node.append(r.iconView,r.host);}
    if(type==='metric'){r.value=make('strong','iui-metric-value');r.unit=make('span');r.label=make('small');r.change=make('small','iui-metric-change');r.host=make('div');node.append(r.label,r.value,r.unit,r.change,r.host);}
    if(type==='progress'){r.input=make('progress');r.label=make('span');r.host=make('div');node.append(r.label,r.input,r.host);}
    if(type==='tabs'){r.nav=make('div','iui-tab-buttons');r.nav.setAttribute('role','tablist');r.host=make('div');node.append(r.nav,r.host);}
    return r;
  }
  event(id,name,args){const r=this.records.get(id);if(r?.props.disabled||!r?.props[name]||this.disposed)return;try{Promise.resolve(this.onEvent(r.props[name],args)).catch(this.onError);}catch(error){this.onError(error);}}
  action(action,context={}) {
    let pending;
    try { pending=Promise.resolve(this.onAction(action,context)); }
    catch(error) { pending=Promise.reject(error); }
    // Observe failures for DOM events, but preserve the original promise for RPC callers.
    pending.catch(error=>{try{this.onError(error);}catch{}});
    return pending;
  }
  apply(operations){
    if(this.disposed)throw new UIError('disposed','Renderer is disposed.');if(!Array.isArray(operations)||operations.length>LIMITS.nodes*4)throw new UIError('operations','Invalid operation batch.');
    const affected=new Set();
    for(const op of operations){
      if(op.op==='remove'){const r=this.records.get(op.id);if(r){this.compositeCost-=r.cost||0;affected.add(r.parent);affected.add(op.id);r.custom?.dispose?.();r.frame?.remove();r.node.remove();this.records.delete(op.id);}continue;}
      if(op.op==='create'){if(this.records.has(op.id))throw new UIError('operations','Duplicate create operation.');this.records.set(op.id,this.create(op.id,op.type));continue;}
      const r=this.records.get(op.id);if(!r)throw new UIError('operations','Unknown node in UI operation.');
      if(op.op==='set'){const previous=r.props;r.props=op.props||{};this.set(r,op.text,previous);}
      else if(op.op==='place'){if(op.parent!=='root'&&!this.records.has(op.parent))throw new UIError('operations','Missing parent.');if(!Number.isInteger(op.index)||op.index<0)throw new UIError('operations','Invalid node index.');affected.add(r.parent);affected.add(op.parent);r.parent=op.parent;r.index=op.index;}
      else throw new UIError('operations','Unknown UI operation.');
    }
    const groups=new Map();for(const r of this.records.values())if(affected.has(r.parent)){if(!groups.has(r.parent))groups.set(r.parent,[]);groups.get(r.parent).push(r);}
    for(const [parent,children] of groups){const host=parent==='root'?this.root:this.records.get(parent)?.host;if(!host)continue;let previous=null;for(const r of children.sort((a,b)=>a.index-b.index)){const expected=previous?previous.nextSibling:host.firstChild;if(r.node!==expected)host.insertBefore(r.node,expected);previous=r.node;}}
    // Option nodes arrive after their select's SET; assign selection after placement.
    for(const r of this.records.values()){if(r.type==='select'&&r.props.value!==undefined)r.node.value=r.props.value;if(r.type==='tabs')this.tabs(r);}
  }
  set(r,text,previous){
    const p=r.props,n=r.node,d=this.doc;
    if(r.type==='#text'){if(n.data!==text)n.data=text||'';return;}
    n.hidden=p.hidden===true;n.dataset.tone=p.tone||'default';n.dataset.size=p.size||'md';
    n.style.padding=p.padding===undefined?'':p.padding*4+'px';n.style.gap=p.gap===undefined?'':p.gap*4+'px';n.style.width=dimension(p.width);n.style.height=dimension(p.height);n.style.maxWidth=dimension(p.maxWidth);n.classList.toggle('iui-bordered',p.border===true);n.classList.toggle('iui-block',p.block===true);n.title=p.title||'';
    if(r.custom){r.custom.update?.(p,previous);return;}
    if(r.type==='markdown'){this.markdown(r,text||'');return;}
    if(r.type==='icon'){n.style.display=p.inline?'inline-flex':'flex';renderIcon(d,r.iconView,p.name,p.label);return;}
    if(r.type==='grid')n.style.gridTemplateColumns='repeat('+Math.min(12,p.columns||2)+', minmax(0,1fr))';
    if(r.type==='title'){n.setAttribute('role','heading');n.setAttribute('aria-level',String(p.level||3));}
    if(['button','VB6Button','link'].includes(r.type)){n.disabled=!!p.disabled;n.type=p.submit?'submit':'button';if(p.caption!==undefined)write(n,p.caption);}
    if(r.type==='VB6Label'&&p.caption!==undefined)write(n,p.caption);
    if(r.type==='option')n.value=p.value||'';
    if(r.type==='list')n.style.listStyleType=p.ordered?'decimal':'';
    if(r.type==='details'&&p.open!==previous.open)n.open=!!p.open;
    if(r.input){const c=r.input;if('disabled'in c)c.disabled=!!p.disabled;if('required'in c)c.required=!!p.required;if('name'in c){c.dataset.iuiName=p.name||'';c.name=r.type==='radio'&&p.name?'iui-'+this.scopeId+'-'+p.name:p.name||'';}c.setAttribute('aria-label',p.label||p.name||r.type);if('placeholder'in c)c.placeholder=p.placeholder||'';
      if(r.type==='input')c.type=p.type||'text';if(r.type==='slider'){c.min=String(p.min??0);c.max=String(p.max??100);c.step=String(p.step??1);}
      if(r.type==='textarea')c.rows=p.rows||3;
      if(r.type==='radio'){c.checked=p.checked===true;c.value=p.value||'';}else if(['checkbox','VB6CheckBox'].includes(r.type))c.checked=!!(p.checked??p.value);
      else if(r.type==='progress'){c.max=p.max||100;c.value=Math.min(c.max,Math.max(0,p.value||0));}
      else if(r.type!=='select'&&p.value!==undefined&&c.value!==String(p.value))c.value=String(p.value);
      if(r.label)write(r.label,p.label||p.caption||p.name||(['checkbox','VB6CheckBox'].includes(r.type)?'Select option':r.type==='slider'?'Value':''));
    }
    if(r.type==='metric'){write(r.label,p.label||'');write(r.value,p.value);write(r.unit,p.unit||'');r.change.hidden=p.change===undefined;write(r.change,p.change??'');}
    if(r.type==='table')this.table(r);
    if(r.type==='chart')this.chart(r);
    if(['image','AsyncImage','AsyncImageGroup','Entity','Cite'].includes(r.type))this.resolved(r);
    if(r.type==='AppBlock'&&p.html!==previous.html){r.run.hidden=true;r.stop.hidden=true;}
  }
  markdown(record,text){
    const root=record.node,estimate=Math.min(2000,text.length);if(this.reserve(record,estimate)<estimate){root.textContent=text;return;}
    // Markdown is intentionally presentation-only. HTML is never parsed as markup.
    root.replaceChildren();const d=this.doc;
    let tokens=500;const inline=(parent,value)=>{let at=0;const pattern=/(\*\*([^*\n]+)\*\*|`([^`\n]+)`)/g;for(const m of value.matchAll(pattern)){if(--tokens<0)break;parent.append(value.slice(at,m.index));const n=d.createElement(m[2]?'strong':'code');n.textContent=m[2]||m[3];parent.append(n);at=m.index+m[0].length;}parent.append(value.slice(at));};
    let count=0;for(const line of text.split('\n')){if(++count>300){const pre=d.createElement('pre');pre.textContent=text.split('\n').slice(count-1).join('\n');root.append(pre);break;}if(!line.trim())continue;const heading=/^(#{1,6})\s+(.*)/.exec(line),n=d.createElement(heading?'h'+Math.min(6,heading[1].length+1):'p');inline(n,heading?heading[2]:line);root.append(n);}
  }
  table(r){
    const p=r.props,d=this.doc;let rows=Array.isArray(p.rows)?p.rows:[];const columns=(Array.isArray(p.columns)?p.columns:Object.keys(rows[0]||{})).slice(0,30).map(c=>typeof c==='string'?{key:c,label:c}:record(c)?{key:display(c.key),label:display(c.label??c.key)}:{key:'',label:''});
    if(r.sort){const {key,descending}=r.sort;rows=rows.map((row,i)=>({row,i})).sort((a,b)=>{const x=a.row?.[key],y=b.row?.[key];return (typeof x==='number'&&typeof y==='number'?x-y:display(x).localeCompare(display(y)))*(descending?-1:1)||a.i-b.i;}).map(x=>x.row);}
    const requested=Math.min(p.pageSize||25,Math.max(1,Math.floor(1000/Math.max(1,columns.length)))),baseCost=20+columns.length*3,allowance=this.reserve(r,baseCost+requested*(2+columns.length*2));if(allowance<baseCost+2+columns.length*2){r.view.textContent='Display limit reached. Use the source or text fallback to inspect this table.';r.controls.hidden=true;return;}const size=Math.min(requested,Math.floor((allowance-baseCost)/(2+columns.length*2))),pages=Math.max(1,Math.ceil(rows.length/size));r.page=Math.min(r.page||0,pages-1);const table=d.createElement('table'),caption=d.createElement('caption'),thead=d.createElement('thead'),tr=d.createElement('tr');caption.textContent=p.label||'Data';table.append(caption,thead);thead.append(tr);
    for(const col of columns){const th=d.createElement('th'),button=d.createElement('button');button.type='button';button.textContent=col.label;th.scope='col';th.setAttribute('aria-sort',r.sort?.key===col.key?(r.sort.descending?'descending':'ascending'):'none');button.onclick=()=>{r.sort={key:col.key,descending:r.sort?.key===col.key&&!r.sort.descending};this.table(r);};th.append(button);tr.append(th);}
    const body=d.createElement('tbody');for(const row of rows.slice(r.page*size,(r.page+1)*size)){const tr=d.createElement('tr');for(const col of columns){const cell=d.createElement('td');cell.textContent=display(row?.[col.key]);tr.append(cell);}body.append(tr);}table.append(body);r.view.replaceChildren(table);r.previous.disabled=!r.page;r.next.disabled=r.page>=pages-1;r.controls.hidden=pages===1;r.pageLabel.textContent='Page '+(r.page+1)+' of '+pages+' · '+rows.length+' rows';
  }
  chart(r){
    const p=r.props,d=this.doc,svg=(tag,attrs)=>{const n=d.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
    const requested=(Array.isArray(p.data)?p.data:[]).slice(0,500),allowance=this.reserve(r,20+requested.length*4);if(allowance<20+(requested.length?4:0)){r.view.textContent='Display limit reached for this chart.';return;}const data=requested.slice(0,Math.floor((allowance-20)/4)),values=data.map(v=>v?.[p.y||'value']??v).map(v=>typeof v==='number'||typeof v==='string'?Number(v):0).map(v=>Number.isFinite(v)?v:0),low=Math.min(0,...values),high=Math.max(1,...values),scale=Math.max(1,Math.abs(low),Math.abs(high)),range=high/scale-low/scale;
    const root=svg('svg',{viewBox:'0 0 640 240',role:'img','aria-label':p.label||'Chart'}),title=svg('title',{});title.textContent=p.label||'Chart';root.append(title);const y=v=>210-180*(v/scale-low/scale)/range,x=i=>30+(i+.5)*580/Math.max(1,values.length),zero=y(0);
    root.append(svg('line',{x1:30,y1:zero,x2:620,y2:zero,stroke:'currentColor'}));
    if(p.kind==='line')root.append(svg('polyline',{points:values.map((v,i)=>x(i)+','+y(v)).join(' '),fill:'none',stroke:'currentColor','stroke-width':2}));
    else values.forEach((v,i)=>{const rect=svg('rect',{x:x(i)-230/Math.max(1,values.length),y:Math.min(y(v),zero),width:460/Math.max(1,values.length),height:Math.max(1,Math.abs(y(v)-zero)),fill:'currentColor'}),label=svg('title',{});label.textContent=display(data[i]?.[p.x||'label'])+': '+v+(p.unit||'');rect.append(label);root.append(rect);});
    const summary=d.createElement('p');summary.className='iui-chart-summary';summary.textContent=values.length+' values · min '+(values.length?Math.min(...values):0)+' · max '+(values.length?Math.max(...values):0)+(p.unit||'');r.view.replaceChildren(root,summary);
  }
  resolved(r){
    const p=r.props,d=this.doc;r.view.replaceChildren();
    if(['Entity','Cite'].includes(r.type)){const button=d.createElement('button');button.type='button';button.textContent=p.label||p.ref||r.type;button.onclick=()=>this.action({type:'entity',args:[p.ref]});r.view.append(button);return;}
    if(p.src){try{const url=safeUrl(p.src);if(this.allowResource(url)!==true)throw new UIError('resource_denied','External image requires host permission.');const img=d.createElement('img');img.alt=p.alt||p.label||'';img.referrerPolicy='no-referrer';img.loading='lazy';img.style.aspectRatio=String(p.aspectRatio||'auto').replace(':','/');img.style.objectFit=p.objectFit||'contain';img.src=url;r.view.append(img);return;}catch(error){r.view.textContent=error.message;return;}}
    r.view.textContent=p.alt||p.label||'Waiting for host-resolved image data.';
  }
  tabs(r){
    const tabs=[...this.records.values()].filter(n=>n.parent===r.id&&n.type==='tab'&&!n.props.hidden).sort((a,b)=>a.index-b.index),key=tab=>tab.props.value??tab.id;
    let value=r.props.value??r.selected??(tabs[0]?key(tabs[0]):null);if(!tabs.some(tab=>key(tab)===value))value=tabs[0]?key(tabs[0]):null;
    for(const tab of this.records.values())if(tab.parent===r.id&&tab.type==='tab')tab.node.hidden=!!tab.props.hidden||key(tab)!==value;
    const stamp=JSON.stringify(tabs.map(n=>[n.id,n.props.label,key(n)]))+':'+value;if(r.tabStamp===stamp)return;r.tabStamp=stamp;r.nav.replaceChildren();
    for(const [i,tab] of tabs.entries()){
      const selected=key(tab)===value,button=this.doc.createElement('button');tab.node.setAttribute('role','tabpanel');tab.node.tabIndex=0;tab.node.id='iui-panel-'+this.scopeId+'-'+encodeURIComponent(tab.id);button.id=tab.node.id+'-tab';button.setAttribute('aria-controls',tab.node.id);tab.node.setAttribute('aria-labelledby',button.id);button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;button.textContent=tab.props.label||tab.props.value||'Tab '+(i+1);
      button.onclick=()=>{r.selected=key(tab);if(r.props.onChange)this.event(r.id,'onChange',[key(tab)]);else this.tabs(r);};
      button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;r.nav.children[next]?.click();r.nav.children[next]?.focus();};r.nav.append(button);
    }
  }
  app(){throw new UIError('app_host','Install an explicitly isolated AppBlock renderer; generated JavaScript is disabled by default.');}
  dispose(){if(this.disposed)return;this.disposed=true;for(const r of this.records.values()){r.custom?.dispose?.();r.frame?.remove();}this.records.clear();this.root.replaceChildren();}
}
DOMRenderer.sequence=0;
