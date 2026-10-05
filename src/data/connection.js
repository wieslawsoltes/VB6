import {dataDefault} from './defaults.js';
import {assertData,dataError,connectionConfiguration,dataList,after} from './common.js';
import {ConnectedRecordset} from './connected-recordset.js';
import {fieldValue,fieldScalarType} from './recordset.js';

import {DataCollection} from './collection.js';
export {DataCollection};

export class ADOConnection {
  constructor(context){
    this.context=context;this.__type='ADODB.Connection';this.ConnectionString='';this.Provider='';this._commandTimeout=30;this._timeoutExplicit=false;this.ConnectionTimeout=15;this.Mode=3;this._state=0;this.recordsets=new Set();
    this.Errors=new DataCollection();this.Errors.Clear=()=>this.Errors.items.splice(0);
    // Native ByRef signature is consumed by the source VM; direct JS callers may omit it.
    this.Execute=(text,affected,options=1)=>this.execute(text,affected,options);
    this.Execute.vbParams=[{name:'CommandText'},{name:'RecordsAffected',byRef:true,optional:true},{name:'Options',optional:true}];
  }
  get State(){return this._state;}
  get CommandTimeout(){return this._commandTimeout;}
  set CommandTimeout(value){value=Number(value);assertData(Number.isFinite(value)&&value>=1&&value<=600,'CommandTimeout must be 1–600 seconds',5);this._commandTimeout=value;this._timeoutExplicit=true;}
  capture(error){
    const e=error.number?error:dataError(error.message||'Provider operation failed',3001);
    this.Errors.items.splice(0,this.Errors.Count,{Number:e.number,Description:e.message,Source:e.source||'VB6.Data',SQLState:'',NativeError:e.number});return e;
  }
  async guard(action){this.Errors.Clear();try{return await action();}catch(error){throw this.capture(error);}}
  async Open(connectionString=this.ConnectionString,user='',password='',options=0){
    return this.guard(async()=>{
      assertData(!this._state,'Connection is already open',3705);assertData(Number(options)===0,'Asynchronous ADO flags are not supported; VB calls await I/O',3251);
      assertData(!this.context.closed,'Data context is closed',3704);this._state=2;
      try{
        this.ConnectionString=connectionString;
        const config=connectionConfiguration(connectionString,this.context.config.connections);
        if(this.Provider&&!String(connectionString).match(/provider\s*=/i)&&!config.name)config.provider=this.Provider;
        config.provider=String(config.provider||'sqlite').toLowerCase();config.readOnly=!!config.readOnly||Number(this.Mode)===1;
        const Factory=this.context.providers.get(config.provider);assertData(Factory,'Provider is unavailable. Configure a named gateway profile for native OLE DB/ODBC databases.',3706);
        if(user||password){const bytes=new TextEncoder().encode(String(user)+':'+String(password));config.headers={...config.headers,Authorization:'Basic '+btoa(String.fromCharCode(...bytes))};}
        if(!this._timeoutExplicit)this._commandTimeout=Number(config.timeout||30);
        this.adapter=new Factory(this.context,config);this.adapter.timeout=this.CommandTimeout;this._config=config;
        await this.adapter.open();assertData(!this.context.closed&&this._state===2,'Connection opening was cancelled',-2147467260);
        this.Provider=config.provider;this._state=1;this.context.connections.add(this);
      }catch(error){await this.adapter?.close?.();this.adapter=null;this._state=0;throw error;}
    });
  }
  async query(text,parameters=[],options=1,timeout=this.CommandTimeout){
    return this.guard(async()=>{
      assertData(this.State===1,'Connection is closed',3709);assertData(Number.isFinite(timeout)&&timeout>=1&&timeout<=600,'Invalid command timeout',5);this.adapter.timeout=timeout;
      if(Number(options)===2){assertData(this.adapter.table,'This provider does not support table commands',3251);return this.adapter.table(String(text));}
      assertData([1,128,129].includes(Number(options)),'Only text/table commands are supported by this provider',3251);
      return this.adapter.execute(String(text??''),parameters);
    });
  }
  async execute(text,affected,options=1){
    const result=await this.query(text,[],options);affected?.ref?.set(Number(result.rowsAffected||0));
    const rs=new ConnectedRecordset(this.context);rs.ActiveConnection=this;rs.Source=text;rs._options=Number(options);rs.RowsAffected=Number(result.rowsAffected||0);
    // ADO action queries produce a closed recordset; schema-bearing empty SELECTs remain open.
    if(result.columns?.length){rs.load(result,1);this.recordsets.add(rs);}return rs;
  }
  async OpenSchema(kind=20){const result=await this.guard(()=>{assertData(this.State===1,'Connection is closed',3709);return this.adapter.schema(Number(kind));});const rs=new ConnectedRecordset(this.context);rs.ActiveConnection=this;rs.load(result,1);this.recordsets.add(rs);return rs;}
  BeginTrans(){return this.guard(()=>{assertData(this.State===1,'Connection is closed',3709);assertData(this.adapter.begin,'Provider does not support transactions',3251);return this.adapter.begin();});}
  CommitTrans(){return this.guard(()=>{assertData(this.State===1,'Connection is closed',3709);assertData(this.adapter.commit,'Provider does not support transactions',3251);return this.adapter.commit();});}
  RollbackTrans(){return this.guard(()=>{assertData(this.State===1,'Connection is closed',3709);assertData(this.adapter.rollback,'Provider does not support transactions',3251);return this.adapter.rollback();});}
  Cancel(){this.adapter?.cancel?.();if(this._state===2)this._state=0;}
  async Close(){
    this.Cancel();for(const rs of [...this.recordsets])rs.dispose();
    try{await this.adapter?.close?.();}finally{this.adapter=null;this._state=0;this.context.connections.delete(this);}
  }
  SetHeader(name,value){assertData(this.State===1&&this.adapter.headers,'Headers are available on HTTP connections only',3251);assertData(!/[\r\n]/.test(String(name)+String(value)),'Invalid HTTP header');this.adapter.headers[String(name)]=String(value);}
}
export class ADOCommand {
  constructor(context){
    this.context=context;this.__type='ADODB.Command';this.CommandText='';this.CommandType=1;this._commandTimeout=30;this._timeoutExplicit=false;this.ActiveConnection=null;this.Prepared=0;
    this.Parameters=new DataCollection();
    this.Parameters.Append=parameter=>{assertData(parameter&&typeof parameter.Name==='string','Expected an ADO Parameter');assertData(!this.Parameters.items.some(p=>p.Name.toLowerCase()===parameter.Name.toLowerCase()),'Duplicate parameter');this.Parameters.items.push(parameter);};
    this.Parameters.Append.vbRawArgs=true;
    this.Parameters.setItem=(key,value)=>{this.Parameters.Item(key).Value=value;};
    this.Parameters.Delete=key=>{this.Parameters.items.splice(this.Parameters.items.indexOf(this.Parameters.Item(key)),1);};
    this.Execute=(affected,parameters,options)=>this.execute(affected,parameters,options);
    this.Execute.vbParams=[{name:'RecordsAffected',byRef:true,optional:true},{name:'Parameters',optional:true},{name:'Options',optional:true}];
  }
  get CommandTimeout(){return this._commandTimeout;}
  set CommandTimeout(value){value=Number(value);assertData(Number.isFinite(value)&&value>=1&&value<=600,'CommandTimeout must be 1–600 seconds',5);this._commandTimeout=value;this._timeoutExplicit=true;}
  CreateParameter(name='',type=202,direction=1,size=0,value=null){const parameter={Name:String(name),Type:Number(type),Direction:Number(direction),Size:Number(size),Value:value};return dataDefault(parameter,()=>fieldScalarType(parameter.Type));}
  async execute(affected,parameters,options=this.CommandType,target){
    let cn=this.ActiveConnection,owned=false;
    if(typeof cn==='string'){const text=cn;cn=this.context.connection();await cn.Open(text);owned=true;}
    assertData(cn?.query,'Command requires an ActiveConnection',3709);
    assertData(this.Parameters.items.every(p=>p.Direction===1),'Output parameters require a provider-specific native interface',3251);
    const supplied=parameters===undefined?this.Parameters.items.map(p=>p.Value):dataList(parameters);
    assertData(!this.Parameters.Count||supplied.length===this.Parameters.Count,'Parameter count does not match the command',3001);
    const typed=supplied.map((value,i)=>{const p=this.Parameters.items[i];return p?fieldValue({Name:p.Name,Type:p.Type,DefinedSize:p.Size},value):value;});
    const http=['rest','graphql','odata'].includes(cn.Provider);
    const values=http?Object.fromEntries(typed.map((value,i)=>[this.Parameters.items[i]?.Name||String(i),this.Parameters.items[i]?.Type===11&&value!=null?Boolean(value):value])):typed;
    const timeout=this._timeoutExplicit?this.CommandTimeout:cn.CommandTimeout;
    try{
      const result=await cn.query(this.CommandText,values,options,timeout);affected?.ref?.set(Number(result.rowsAffected||0));
      const rs=target||new ConnectedRecordset(this.context);rs.ActiveConnection=cn;rs.Source=this.CommandText;rs._options=Number(options);rs._parameters=values;rs._ownedConnection=owned;rs.RowsAffected=Number(result.rowsAffected||0);
      if(result.columns?.length){rs.load(result,1);cn.recordsets.add(rs);}else if(owned)await cn.Close();
      return rs;
    }catch(error){if(owned)await cn.Close();throw error;}
  }
  Cancel(){this.ActiveConnection?.Cancel?.();}
}

import {DAOEngine,DAODatabase} from './dao.js';
export {DAOEngine,DAODatabase};
