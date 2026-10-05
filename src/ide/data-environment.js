import {el,clone,download} from '../core/core.js';
import {modal,tabbedPages,icon,promptDialog} from './ui.js';
import {DataContext} from '../data/context.js';
import {normalizeDataSources,assertPublicConfiguration} from '../data/common.js';
import {VirtualFileSystem} from '../runtime/filesystem.js';

const PROVIDERS=[['sqlite','SQLite — embedded database'],['rest','REST / JSON — HTTP data source'],['odata','OData — HTTP entity collection'],['graphql','GraphQL — query endpoint'],['json','JSON — project data file'],['csv','CSV — project data file'],['gateway','Native database gateway — OLE DB, ODBC, SQL Server, PostgreSQL, MySQL']];
const field=(label,value='',type='text')=>el('input',{'aria-label':label,value,type});
const select=(label,values,value)=>{const node=el('select',{'aria-label':label},...values.map(([id,text])=>el('option',{value:id},text)));node.value=String(value);return node;};
function formRows(rows){return el('div',{class:'data-dialog-grid'},...rows.flatMap(([label,input])=>[el('label',{},label+':'),input]));}
function jsonInput(label,value){return el('textarea',{'aria-label':label,spellcheck:false,wrap:'off',value:JSON.stringify(value,null,2)});}
function readJSON(input,fallback){return input.value.trim()?JSON.parse(input.value):fallback;}
async function credential(name){const input=field('Runtime credential','', 'password');const yes=await modal('Data Connection Credentials',{width:430,content:el('div',{},el('p',{},'Enter the bearer token for '+name+'. It is used only in memory for this session.'),input)});return yes?input.value:null;}

/** Classic modeless Data Environment / Data View; uses the same providers as Make Application. */
export class DataEnvironmentDesigner {
  constructor(ide){
    this.ide=ide;this.key='tool:dataEnvironment';this.title='Data Environment — DataEnvironment1';this.glyph='grid';this.width=870;this.height=560;this.disposed=false;this.generation=0;
    this.root=el('div',{class:'data-environment'});this.status=el('div',{class:'tool-status',role:'status'});
    const button=(label,fn,glyph)=>el('button',{type:'button',onclick:()=>this.guard(fn),'aria-label':label},icon(glyph||'properties',14),label);
    this.tree=el('div',{class:'data-tree',role:'tree','aria-label':'Data Environment connections and commands',tabindex:0});
    this.query=el('textarea',{'aria-label':'SQL statement or REST resource',spellcheck:false,placeholder:'SELECT * FROM Customers   — or a REST resource path'});
    this.results=el('div',{class:'data-results',tabindex:0,'aria-label':'Data preview'});
    this.commandBar=el('div',{class:'object-toolbar'},button('Add Connection',()=>this.connectionDialog(),'new'),button('Add Command',()=>this.commandDialog(),'new'),button('Properties',()=>this.properties(),'properties'),button('Delete',()=>this.remove(),'delete'));
    const queryBar=el('div',{class:'object-toolbar'},button('Test Connection',()=>this.test(),'run'),button('Execute',()=>this.execute(),'run'),button('Cancel',()=>this.context?.close(),'stop'),button('Schema',()=>this.execute(true),'properties'),button('Import Data File…',()=>this.importInput.click(),'open'),button('Export Database…',()=>this.exportDatabase(),'save'));
    this.importInput=el('input',{type:'file',accept:'.sqlite,.sqlite3,.db,.json,.csv',hidden:true});
    this.importInput.addEventListener('change',()=>this.guard(()=>this.importFile()));
    this.page=0;this.pageInfo=el('span',{});this.pager=el('div',{class:'data-preview-pager'},button('Previous',()=>{this.page=Math.max(0,this.page-1);this.paintResults();}),button('Next',()=>{this.page=Math.min(Math.max(0,Math.ceil((this.result?.values.length||0)/100)-1),this.page+1);this.paintResults();}),this.pageInfo);
    this.root.append(this.commandBar,el('div',{class:'data-workspace'},this.tree,el('section',{class:'data-query-pane'},queryBar,this.query,this.results,this.pager)),this.status,this.importInput);
    this.tree.addEventListener('keydown',event=>{const items=[...this.tree.querySelectorAll('[role=treeitem]')];const index=items.indexOf(this.tree.ownerDocument.activeElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();items[Math.max(0,Math.min(items.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();}else if(event.key==='Enter'){event.preventDefault();this.guard(()=>this.properties());}});
    this.root.addEventListener('keydown',event=>{if(event.key==='F5'){event.preventDefault();event.stopPropagation();this.guard(()=>this.execute());}});
  }
  model(){return normalizeDataSources(this.ide.project.dataSources);}
  token(){return this.ide.project.id+'|'+JSON.stringify(this.ide.project.dataSources||null);}
  guard(action){try{const result=action();result?.catch?.(e=>this.error(e));return result;}catch(error){this.error(error);}}
  error(error){if(!this.disposed)this.status.textContent=error.message||String(error);}
  editable(){if(this.ide.runState!=='design')throw new Error('End the running application before changing its data environment.');}
  commit(model,label){this.editable();const validated=normalizeDataSources(model),before=clone(this.ide.project);this.ide.project.dataSources=validated;this.ide.record(before,label);this.refresh();}
  refresh(){
    if(this.disposed)return;const model=this.model();this.tree.replaceChildren(el('div',{class:'tool-section-label'},'DataEnvironment1'));
    const row=(entry,kind,level)=>{
      const node=el('button',{role:'treeitem','aria-level':level,'aria-selected':this.selected===entry.name,class:'data-tree-item',style:{paddingLeft:(level-1)*17+4+'px'},onclick:()=>{this.selected=entry.name;this.kind=kind;if(kind==='command')this.query.value=entry.text||'';this.refresh();},ondblclick:()=>this.guard(()=>this.properties())},icon(kind==='connection'?'grid':'code',16),entry.name);
      this.tree.append(node);
    };
    for(const connection of model.connections){row(connection,'connection',1);for(const command of model.commands.filter(c=>c.connection.toLowerCase()===connection.name.toLowerCase()))row(command,'command',2);}
    if(!model.connections.length)this.tree.append(el('p',{class:'tool-note'},'Add a Connection to begin. Data definitions are saved with the project and included in exported applications.'));
    for(const button of this.commandBar.querySelectorAll('button'))button.disabled=this.ide.runState!=='design';
  }
  connection(){const model=this.model(),command=model.commands.find(c=>c.name===this.selected);return model.connections.find(c=>c.name===(command?.connection||this.selected))||model.connections[0];}
  async connectionDialog(existing){
    this.editable();const token=this.token(),model=this.model();let i=1;while(model.connections.some(c=>c.name==='Connection'+i))i++;
    const original=existing||{name:'Connection'+i,provider:'sqlite',database:'/data.sqlite'},name=field('Connection name',original.name),provider=select('Provider',PROVIDERS,original.provider||'sqlite');
    provider.size=7;provider.style.width='100%';
    const source=field('Data source',original.url||original.database||''),reference=field('Credential reference',original.credentialRef||''),profile=field('Gateway profile',original.profile||''),rowsPath=field('Rows path',original.rowsPath||''),key=field('Key field',original.keyField||''),timeout=field('Command timeout (seconds)',original.timeout||30,'number');
    const readOnly=el('input',{type:'checkbox','aria-label':'Read-only connection',checked:!!original.readOnly});
    const fields=jsonInput('Field mappings',original.fields||[]),paging=jsonInput('Pagination',original.pagination||{}),writes=jsonInput('REST write operations',original.write||{}),headers=jsonInput('Public HTTP headers',original.headers||{});
    const all=jsonInput('All connection properties',{});all.readOnly=true;
    const gather=()=>{
      const config={...original,name:name.value.trim(),provider:provider.value,readOnly:readOnly.checked};
      delete config.url;delete config.database;
      config[['sqlite','json','csv'].includes(provider.value)?'database':'url']=source.value.trim();
      for(const [name,input]of [['credentialRef',reference],['profile',profile],['rowsPath',rowsPath],['keyField',key]]){if(input.value.trim())config[name]=input.value.trim();else delete config[name];}
      config.timeout=Number(timeout.value);if(!Number.isFinite(config.timeout)||config.timeout<1||config.timeout>600)throw new Error('Command timeout must be 1–600 seconds.');
      for(const [key,input,fallback]of [['fields',fields,[]],['pagination',paging,{}],['write',writes,{}],['headers',headers,{}]]){const value=readJSON(input,fallback);if(Object.keys(value).length)config[key]=value;else delete config[key];}
      assertPublicConfiguration(config);return config;
    };
    const providerPage=el('div',{},el('p',{},'Select the provider to connect to the data source:'),provider,el('p',{class:'tool-note'},'SQLite is embedded in the application. Native database drivers run in a configured gateway, not in the browser.'));
    const connectionPage=formRows([['Name',name],['Data source',source],['Rows path',rowsPath],['Key field',key],['Credential reference',reference],['Gateway profile',profile],['Read-only',readOnly]]);
    const advanced=el('div',{class:'data-advanced'},formRows([['Timeout (seconds)',timeout]]),...[[fields,'Field mappings'],[paging,'Pagination'],[writes,'REST write operations'],[headers,'Public HTTP headers']].map(([input,label])=>el('label',{},label,input)),el('p',{class:'tool-note'},'Passwords and authorization headers are rejected in saved definitions. Use a credential reference; credentials are requested at runtime.'));
    const tabs=tabbedPages([{id:'provider',label:'Provider',node:providerPage},{id:'connection',label:'Connection',node:connectionPage},{id:'advanced',label:'Advanced',node:advanced},{id:'all',label:'All',node:all}],{selected:existing?'connection':'provider',label:'Data Link Properties',onSelect:id=>{if(id==='all'){try{all.value=JSON.stringify(gather(),null,2);}catch(e){all.value=e.message;}}}});
    provider.addEventListener('change',()=>{source.value=provider.value==='sqlite'?'/data.sqlite':provider.value==='json'?'/data.json':provider.value==='csv'?'/data.csv':provider.value==='gateway'?'http://127.0.0.1:4287/data':'https://jsonplaceholder.typicode.com/users';});
    await modal('Data Link Properties',{width:610,content:tabs,buttons:[{label:'Test Connection',value:false,action:async()=>{await this.testConfiguration(gather());return false;}},{label:'OK',value:true,primary:true,action:()=>{
      if(token!==this.token())throw new Error('The project changed while Data Link Properties was open.');
      const config=gather();if(existing){const index=model.connections.findIndex(c=>c.name===existing.name);model.connections[index]=config;for(const cmd of model.commands)if(cmd.connection===existing.name)cmd.connection=config.name;}else model.connections.push(config);
      this.selected=config.name;this.kind='connection';this.commit(model,existing?'Edit data connection':'Add data connection');return true;
    }},{label:'Cancel',value:false}]});
  }
  async commandDialog(existing){
    this.editable();const token=this.token(),model=this.model();if(!model.connections.length)throw new Error('Add a connection first.');
    let i=1;while(model.commands.some(c=>c.name==='Command'+i))i++;
    const original=existing||{name:'Command'+i,connection:this.connection().name,text:'',type:1,parameters:[]};
    const name=field('Command name',original.name),connection=select('Command connection',model.connections.map(c=>[c.name,c.name]),original.connection),type=select('Command type',[[1,'SQL statement / REST resource'],[2,'Table']],original.type),text=el('textarea',{'aria-label':'Command text',spellcheck:false,value:original.text||''}),parameters=jsonInput('Command parameters',original.parameters||[]);
    await modal('Command Properties',{width:570,content:tabbedPages([{id:'general',label:'General',node:el('div',{},formRows([['Command name',name],['Connection',connection],['Command type',type]]),el('label',{},'SQL statement or resource:',text))},{id:'parameters',label:'Parameters',node:el('div',{},el('p',{},'Ordered parameters: name, type (ADO type number), size, and optional value.'),parameters)}],{label:'Command Properties'}),buttons:[{label:'OK',value:true,primary:true,action:()=>{
      if(token!==this.token())throw new Error('Project changed while Command Properties was open.');
      const value={...original,name:name.value.trim(),connection:connection.value,type:Number(type.value),text:text.value,parameters:readJSON(parameters,[])};
      if(existing)model.commands[model.commands.findIndex(c=>c.name===existing.name)]=value;else model.commands.push(value);
      this.selected=value.name;this.kind='command';this.query.value=value.text;this.commit(model,existing?'Edit data command':'Add data command');return true;
    }},{label:'Cancel',value:false}]});
  }
  properties(){const model=this.model();if(this.kind==='command')return this.commandDialog(model.commands.find(c=>c.name===this.selected));return this.connectionDialog(this.connection());}
  async remove(){
    this.editable();const token=this.token(),model=this.model();if(!this.selected)return;
    const yes=await modal('Remove Data Object',{width:400,content:el('p',{},'Remove '+this.selected+'? Removing a connection also removes its commands.')});
    if(!yes)return;if(token!==this.token())throw new Error('Project changed.');
    model.connections=model.connections.filter(c=>c.name!==this.selected);model.commands=model.commands.filter(c=>c.name!==this.selected&&c.connection!==this.selected);this.selected=null;this.commit(model,'Remove data object');
  }
  async testConfiguration(config){
    const context=new DataContext({dataSources:{version:1,connections:[config],commands:[]}},{fs:new VirtualFileSystem(this.ide.project.vfs),credentialProvider:credential});
    try{
      const cn=context.connection();await cn.Open(config.name);
      if(['rest','odata','gateway'].includes(config.provider)){
        if(config.provider==='gateway')await cn.OpenSchema(20);else await cn.adapter.request(config.url,{method:'GET'});
      }else if(config.provider==='graphql')await cn.adapter.request(config.url,{method:'POST',body:{query:'{ __typename }'}});
      else if(config.provider==='sqlite')await cn.Execute('SELECT sqlite_version() AS SQLiteVersion');else await cn.Execute('');
      this.status.textContent='Test connection succeeded.';
      await modal('Data Link Properties',{width:340,content:el('p',{},'Test connection succeeded.'),buttons:[{label:'OK',value:true,primary:true}]});
    }finally{await context.close();}
  }
  test(){const config=this.connection();if(!config)throw new Error('Select a connection.');return this.testConfiguration(config);}
  async execute(schema=false){
    this.editable();const config=this.connection();if(!config)throw new Error('Select a connection.');
    const token=this.token(),generation=++this.generation;await this.context?.close();
    const context=this.context=new DataContext(this.ide.project,{credentialProvider:credential});
    this.status.textContent='Executing…';this.results.replaceChildren();
    try{
      const cn=context.connection();await cn.Open(config.name);
      let rs;
      if(schema)rs=await cn.OpenSchema(['rest','odata','graphql'].includes(config.provider)?4:20);
      else{
        const definition=this.model().commands.find(c=>c.name===this.selected),cmd=context.command();cmd.ActiveConnection=cn;cmd.CommandText=this.query.value;cmd.CommandType=definition?.type||1;
        for(const p of definition?.parameters||[]){const value=await promptDialog('Command Parameter',p.name,String(p.value??''));if(value===null)throw new Error('Command cancelled.');cmd.Parameters.Append(cmd.CreateParameter(p.name,p.type||202,1,p.size||0,value));}
        rs=await cmd.Execute();
      }
      if(this.disposed||generation!==this.generation||token!==this.token())throw new Error('Project changed; the preview result was discarded.');
      this.result={columns:rs.columns,values:rs.State?rs.view().map(row=>rs.columns.map(c=>row[c.Name])):[],rowsAffected:rs.RowsAffected||0};this.page=0;this.paintResults();
      if(context.fs.dirty){const before=clone(this.ide.project);this.ide.project.vfs=context.fs.snapshot();this.ide.record(before,'Execute data command');}
      this.status.textContent=this.result.values.length+' records; '+this.result.rowsAffected+' affected.';
    }finally{await context.close();if(this.context===context)this.context=null;}
  }
  paintResults(){
    const result=this.result;if(!result)return;
    const table=el('table',{},el('thead',{},el('tr',{},...result.columns.map(c=>el('th',{},c.Name)))));
    const rows=result.values.slice(this.page*100,(this.page+1)*100);
    table.append(el('tbody',{},...rows.map(row=>el('tr',{},...row.map(value=>el('td',{},value===null?'(Null)':value instanceof Uint8Array?'('+value.length+' bytes)':typeof value==='object'?JSON.stringify(value):String(value)))))));
    this.results.replaceChildren(table);this.pageInfo.textContent=result.values.length?`${this.page*100+1}–${Math.min(result.values.length,(this.page+1)*100)} of ${result.values.length}`:'No records';
  }
  async importFile(){
    this.editable();const file=this.importInput.files[0];this.importInput.value='';if(!file)return;const token=this.token();
    if(file.size>20*1024*1024)throw new Error('Project data files are limited to 20 MiB.');
    const bytes=new Uint8Array(await file.arrayBuffer());if(token!==this.token())throw new Error('Project changed during import.');
    const config=this.connection(),path=config&&['sqlite','csv','json'].includes(config.provider)?config.database:'/'+file.name;
    if(!path)throw new Error('Set a database path in Connection Properties first.');
    const fs=new VirtualFileSystem(this.ide.project.vfs);if(/\.json$|\.csv$/i.test(path))fs.write(path,new TextDecoder('utf-8',{fatal:true}).decode(bytes));else{
      if(new TextDecoder().decode(bytes.subarray(0,16))!=='SQLite format 3\0')throw new Error('This file is not an SQLite 3 database.');fs.writeBytes(path,bytes);
    }
    if(fs.exists(path)&&new VirtualFileSystem(this.ide.project.vfs).exists(path)){
      const yes=await modal('Replace Data File',{width:360,content:el('p',{},'Replace the project data file '+path+'?')});if(!yes)return;if(token!==this.token())throw new Error('Project changed.');
    }
    const before=clone(this.ide.project);this.ide.project.vfs=fs.snapshot();this.ide.record(before,'Import data file');this.status.textContent='Imported '+path+'. This file will be included in shipped apps.';
  }
  exportDatabase(){const config=this.connection();if(!config?.database)throw new Error('Select a project-file connection.');const fs=new VirtualFileSystem(this.ide.project.vfs);download(config.database.split('/').at(-1),fs.readBytes(config.database));}
  dispose(){this.disposed=true;this.generation++;this.context?.close();}
}
export function installDataEnvironment(ide){
  const menu=ide.menu.bind(ide),command=ide.command.bind(ide);
  ide.openDataEnvironment=()=>{let tool=ide.documents.tools.get('tool:dataEnvironment');if(!tool)tool=new DataEnvironmentDesigner(ide);return ide.documents.openTool(tool);};
  ide.menu=name=>{const items=menu(name);if(name==='Project')items.splice(4,0,{id:'dataEnvironment',label:'Add Data Environment…',icon:'data',enabled:ide.runState==='design'});if(name==='View')items.push(null,{id:'dataEnvironment',label:'Data View',icon:'data'});if(name==='Tools')items.push(null,{id:'dataEnvironment',label:'Data Environment Designer…',icon:'data'});return items;};
  ide.command=(id,...args)=>id==='dataEnvironment'?ide.openDataEnvironment():command(id,...args);
}
