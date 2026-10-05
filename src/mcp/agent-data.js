import {clone} from '../core/core.js';
import {normalizeDataSources} from '../data/common.js';
import {McpError, checkAbort, utf8Length} from './protocol.js';
import {S, B, N, E, OBJ, REV} from './agent-schema.js';

const PROVIDERS = Object.freeze([
  {id:'sqlite',storage:'project virtual file',network:false},
  {id:'json',storage:'project virtual file',network:false},
  {id:'csv',storage:'project virtual file',network:false},
  {id:'rest',storage:'HTTP service',network:true},
  {id:'odata',storage:'HTTP service',network:true},
  {id:'graphql',storage:'HTTP service',network:true},
  {id:'gateway',storage:'operator-configured database gateway',network:true}
]);
const MAX_DEFINITION_BYTES = 512 * 1024;
const equal = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
const invalid = message => { throw new McpError(-32602, message); };
function model(value) {
  try { return normalizeDataSources(value); }
  catch (error) { throw new McpError(-32602, error.message || 'Invalid data environment.'); }
}
function definition(value) {
  if (utf8Length(JSON.stringify(value)) > MAX_DEFINITION_BYTES) invalid('A data definition may not exceed 512 KiB.');
  return clone(value);
}
function find(data, kind, name) {
  return data[kind].find(item => equal(item.name,name)) || invalid('Unknown data object: ' + name);
}
/** Design-time data definitions only. Never creates a DataContext, requests a
 * credential, opens a database, fetches a URL or executes SQL/project code. */
export function installDataTools(ide, adapter, {add, output, consent, commit, checkRevision, page, resource}) {
  const read = () => model(ide.project.dataSources);
  const refresh = () => {
    // The designer is a projection of the committed model, not a second source.
    try { ide.documents?.tools?.get('tool:dataEnvironment')?.refresh?.(); } catch {}
  };
  const mutate = (name, description, properties, required, edit, destructive=false) => add(name, description,
    {...properties,expectedRevision:REV}, [...required,'expectedRevision'], async (args,ctx) => {
      checkRevision(args.expectedRevision);
      const next=clone(ide.project), data=model(next.dataSources), detail=edit(data,args);
      next.dataSources=model(data); // Validate a complete candidate before consent.
      await consent('vb6.'+name,args,ctx);
      checkAbort(ctx.signal); checkRevision(args.expectedRevision);
      const result=commit(next,'MCP: '+name); refresh(); return {...result,...detail};
    }, {write:true,destructive});
  add('data.providers','Describe the built-in data providers and the design-only MCP boundary. Does not connect to any service.',{},[],()=>output({
    providers:PROVIDERS.map(p=>({...p})),maxDefinitionBytes:MAX_DEFINITION_BYTES,
    execution:'These tools edit public project definitions only. Execute through the normal IDE/runtime with its separate execution permission.',
    credentials:'Use credentialRef. Stored passwords, bearer tokens, authorization headers and secret URL parameters are rejected. No runtime credential APIs are exposed.'
  }));
  const inventory = args => {
    const data=read();
    const items=[...data.connections.map(c=>({kind:'connection',name:c.name,provider:c.provider,commands:data.commands.filter(d=>equal(d.connection,c.name)).length})),
      ...data.commands.map(c=>({kind:'command',name:c.name,connection:c.connection,type:c.type||1,parameters:(c.parameters||[]).length,textLength:String(c.text||'').length}))]
      .filter(item=>!args.kind||item.kind===args.kind).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    return output({...page(items,args),version:data.version,connections:data.connections.length,commands:data.commands.length});
  };
  add('data.list','List data connections and commands without SQL text, file payloads, results or runtime credentials.',{kind:E(['connection','command']),offset:N(),limit:N(1,1000)},[],inventory);
  for (const [kind,list] of [['connection','connections'],['command','commands']]) {
    add('data.'+kind+'.get','Read one public data '+kind+' definition. Does not read a live connection, result set or credential cache.',{name:S},['name'],args=>output({definition:definition(find(read(),list,args.name))}));
    mutate('data.'+kind+'.set','Create or replace one complete public data '+kind+' definition. Explicit mode prevents accidental replacement; names are case-insensitive. Use data.rename for identity changes.',
      {definition:OBJ,mode:E(['create','replace'])},['definition','mode'],(data,args)=>{
        const item=definition(args.definition),index=data[list].findIndex(c=>equal(c.name,item.name));
        if (args.mode==='create'&&index!==-1) invalid('Data object already exists; use replace explicitly.');
        if (args.mode==='replace'&&index===-1) invalid('Data object does not exist; use create explicitly.');
        if (kind==='connection'&&!PROVIDERS.some(p=>p.id===item.provider)) invalid('Unknown data provider. Read data.providers.');
        if (kind==='command'&&item.type!==undefined&&![1,2,4].includes(item.type)) invalid('Command type must be 1 (text), 2 (table) or 4 (stored procedure).');
        if (kind==='command'&&item.text!==undefined&&typeof item.text!=='string') invalid('Command text must be a string.');
        if (index===-1) data[list].push(item); else {
          // Preserve spelling used by dependent definitions. Rename is explicit.
          if (item.name!==data[list][index].name) invalid('Use data.rename to change the name or its casing.');
          data[list][index]=item;
        }
        return {name:item.name,mode:args.mode};
      });
    mutate('data.'+kind+'.remove','Remove a data '+kind+' definition. Connection deletion with dependent commands requires cascade:true. Does not delete virtual database files or rewrite source/control references.',
      {name:S,...(kind==='connection'?{cascade:B}:{})},['name'],(data,args)=>{
        const item=find(data,list,args.name),dependents=kind==='connection'?data.commands.filter(c=>equal(c.connection,item.name)):[];
        if (dependents.length&&!args.cascade) invalid('Connection has dependent commands; explicitly set cascade:true.');
        data[list]=data[list].filter(c=>c!==item);
        if (dependents.length) data.commands=data.commands.filter(c=>!dependents.includes(c));
        return {removed:[item.name,...dependents.map(c=>c.name)],sourceAndBindingsUpdated:false};
      },true);
  }
  mutate('data.rename','Rename a data connection or command. Updates command-to-connection references atomically. Does not perform semantic source renaming or rewrite designer bindings; update those explicitly with code.edit/control.edit.',
    {kind:E(['connection','command']),name:S,newName:S},['kind','name','newName'],(data,args)=>{
      const item=find(data,args.kind==='connection'?'connections':'commands',args.name),oldName=item.name;
      item.name=args.newName;
      const affected=args.kind==='connection'?data.commands.filter(c=>equal(c.connection,oldName)):[];
      for (const command of affected) command.connection=args.newName;
      return {name:args.newName,previousName:oldName,updatedCommands:affected.map(c=>c.name),sourceAndBindingsUpdated:false};
    });
  add('data.validate','Validate saved data definitions and report unsupported providers without network, credential prompts or SQL execution. This is not a live connection test.',{},[],()=>{
    let data;
    try { data=read(); } catch(error) { return output({valid:false,diagnostics:[{severity:'error',message:error.message}],liveConnectionTest:false}); }
    const diagnostics=data.connections.filter(c=>!PROVIDERS.some(p=>p.id===c.provider)).map(c=>({severity:'error',name:c.name,message:'Unknown built-in provider.'}));
    return output({valid:!diagnostics.length,connections:data.connections.length,commands:data.commands.length,diagnostics,liveConnectionTest:false});
  });
  resource('vb6://data','Data Environment inventory',()=>inventory({}));
}
