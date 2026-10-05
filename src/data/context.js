import {DAOEngine} from './dao.js';
import {normalizeDataSources,assertData,DATA_CONSTANTS} from './common.js';
import {SQLiteProvider} from './sqlite.js';
import {HTTPProvider,GatewayProvider} from './http.js';
import {FileDataProvider} from './files.js';
import {ADOConnection,ADOCommand,DataCollection} from './connection.js';
import {ConnectedRecordset} from './connected-recordset.js';
import {VirtualFileSystem} from '../runtime/filesystem.js';

export class DataContext {
  constructor(project={},options={}){
    this.config=normalizeDataSources(project.dataSources);this.fs=options.fs||new VirtualFileSystem(project.vfs);this.persist=options.persist;
    this.fetch=options.fetch||globalThis.fetch?.bind(globalThis);this.credentialProvider=options.credentialProvider;
    this.providers=new Map([['sqlite',SQLiteProvider],['rest',HTTPProvider],['odata',HTTPProvider],['graphql',HTTPProvider],['gateway',GatewayProvider],['json',FileDataProvider],['csv',FileDataProvider]]);
    this.databases=new Map();this.connections=new Set();this.credentials=new Map();this.closed=false;
  }
  connection(){return new ADOConnection(this);}
  command(){return new ADOCommand(this);}
  async credential(name){
    if(this.credentials.has(name))return this.credentials.get(name);
    const value=await this.credentialProvider?.(name);assertData(value,'A runtime credential is required: '+name,70);this.credentials.set(name,value);return value;
  }
  isObjectType(name){return /^(?:ADODB\.(?:Connection|Command|Recordset|Parameter)|DAO\.(?:DBEngine|Workspace|Database|Recordset|QueryDef|TableDef|Index|Field|Parameter)|VB6\.Data\.(?:Connection|Command))$/i.test(String(name));}
  createObject(name){
    switch(String(name).toLowerCase()){
      case 'adodb.connection':case 'vb6.data.connection':return this.connection();
      case 'adodb.command':case 'vb6.data.command':return this.command();
      case 'adodb.recordset':return new ConnectedRecordset(this);
      case 'dao.dbengine':case 'dao.dbengine.36':case 'dao.dbengine.120':return new DAOEngine(this);
      default:return null;
    }
  }
  environment(){
    const environment={__type:'DataEnvironment',Connections:new DataCollection(),Commands:new DataCollection()};
    environment.SetCredential=(name,value)=>{assertData(typeof name==='string'&&name,'A credential reference is required');this.credentials.set(name,value);};
    environment.ClearCredentials=()=>this.credentials.clear();
    for(const definition of this.config.connections){const cn=this.connection();cn.Name=definition.name;cn.ConnectionString=definition.name;environment[definition.name]=cn;environment.Connections.items.push(cn);}
    for(const definition of this.config.commands){
      const cmd=this.command();cmd.Name=definition.name;cmd.CommandText=definition.text||'';cmd.CommandType=definition.type||1;cmd.ActiveConnection=environment.Connections.Item(definition.connection);
      for(const p of definition.parameters||[])cmd.Parameters.Append(cmd.CreateParameter(p.name,p.type||202,1,p.size||0,p.value??null));
      environment.Commands.items.push(cmd);environment['rs'+definition.name]=new ConnectedRecordset(this);
      environment[definition.name]=async(...args)=>{
        if(cmd.ActiveConnection.State===0)await cmd.ActiveConnection.Open();
        assertData(args.length<=cmd.Parameters.Count,'Too many command parameters',450);
        args.forEach((value,i)=>cmd.Parameters.Item(i).Value=value);
        const previous=environment['rs'+definition.name];if(previous.State)await previous.Close();
        return cmd.execute(undefined,undefined,cmd.CommandType,previous);
      };
    }
    return environment;
  }
  install(vm){
    for(const [name,value]of Object.entries(DATA_CONSTANTS))vm.library.set(name.toLowerCase(),value);
    const environment=this.environment();vm.library.set('dataenvironment1',environment);vm.library.set('dataenvironment',environment);
    const engine=this.daoEngine||(this.daoEngine=new DAOEngine(this));vm.library.set('dbengine',engine);vm.library.set('opendatabase',(...args)=>engine.OpenDatabase(...args));vm.library.set('createdatabase',(...args)=>engine.CreateDatabase(...args));
  }
  close(){
    if(this.closing)return this.closing;
    this.closed=true;
    const work=[...this.connections].map(cn=>cn.Close());
    return this.closing=Promise.allSettled(work).finally(()=>this.credentials.clear());
  }
}
