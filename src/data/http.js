import {encodeCell,decodeResult} from './wire.js';
import {assertData,dataError,DATA_LIMITS,safeHttpURL,pathValue,resultFromRows,sqlValue} from './common.js';

async function boundedBody(response,limit){
  const advertised=Number(response.headers?.get('content-length')||0);
  assertData(advertised<=limit,'HTTP response exceeds the data limit',7);
  if(!response.body?.getReader){const text=await response.text();assertData(new TextEncoder().encode(text).length<=limit,'HTTP response exceeds the data limit',7);return text;}
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw dataError('HTTP response exceeds the data limit',7);}parts.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function parameterObject(parameters){return Array.isArray(parameters)?Object.fromEntries(parameters.map((v,i)=>[String(i),v])):{...parameters};}
function mappedBody(row,fields){
  const body=Object.create(null);
  for(const [key,value]of Object.entries(row)){
    const field=fields?.find(f=>f.name===key),path=String(field?.path||key).split('.');
    let node=body;
    for(let i=0;i<path.length;i++){
      const part=path[i];assertData(part&&!['__proto__','prototype','constructor'].includes(part),'Invalid JSON write field');
      if(i===path.length-1)node[part]=value==null?null:field?.type===11?Boolean(value):value instanceof Uint8Array?Array.from(value):value instanceof Date?value.toISOString():value;else node=node[part]??=Object.create(null);
    }
  }
  return body;
}
/** Browser fetch only: no hidden proxy, no cross-origin pagination or credential-forwarding redirects. */
export class HTTPProvider {
  constructor(context,config){this.context=context;this.config=config;this.requests=new Set();this.headers=Object.create(null);this.closed=false;}
  open(){this.base=safeHttpURL(this.config.url);this.closed=false;}
  sameOriginURL(value){const url=safeHttpURL(value||this.base.href,this.base);assertData(url.origin===this.base.origin,'Cross-origin data links are rejected',70);return url;}
  async request(value,{method='GET',body,headers={},limit=DATA_LIMITS.bytes,signal,closing=false}={}){
    assertData(!this.closed&&(!this.context.closed||closing),'Data connection is closed',3704);
    const url=this.sameOriginURL(value),controller=new AbortController();this.requests.add(controller);
    const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
    const timeout=Math.max(1,Math.min(600,Number(this.timeout||this.config.timeout||30)))*1000;
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const auth=this.config.credentialRef?await this.context.credential(this.config.credentialRef):{};
      assertData(!controller.signal.aborted,'Data request was cancelled or timed out',-2147467260);
      const combined=new Headers({Accept:'application/json',...this.config.headers,...this.headers,...(typeof auth==='string'?{Authorization:'Bearer '+auth}:auth?.headers),...headers});
      if(body!==undefined)combined.set('Content-Type','application/json');
      const response=await this.context.fetch(url.href,{method,headers:combined,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'});
      assertData(response.ok,'HTTP data request failed ('+response.status+')',response.status===409||response.status===412?3197:-2147217900);
      const text=await boundedBody(response,limit);
      let data=null;if(text.trim()){try{data=JSON.parse(text);}catch{throw dataError('Data source returned invalid JSON',13);}}
      return {data,etag:response.headers?.get('etag'),bytes:new TextEncoder().encode(text).length};
    }catch(error){
      if(error.number)throw error;
      if(controller.signal.aborted)throw dataError('Data request was cancelled or timed out',-2147467260);
      throw dataError('HTTP data request failed. Check the connection, CORS policy, and credentials.',-2147467259);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);this.requests.delete(controller);}
  }
  async execute(text='',parameters={}){
    const params=parameterObject(parameters),graphql=this.config.provider?.toLowerCase()==='graphql';
    let url=this.sameOriginURL(graphql?this.base.href:String(text||this.base.href).replace(/\{([A-Za-z0-9_]+)\}/g,(_,key)=>{assertData(Object.hasOwn(params,key),'Missing URL parameter: '+key);const value=encodeURIComponent(params[key]);delete params[key];return value;}));
    const method=graphql?'POST':String(this.config.method||'GET').toUpperCase();
    assertData(['GET','POST'].includes(method),'Read commands support GET or POST',3251);
    if(method==='GET')for(const [key,value]of Object.entries({...this.config.query,...params}))if(value!=null)url.searchParams.set(key,String(value));
    const body=graphql?{query:String(text||this.config.queryText||''),variables:params}:method==='POST'?{...this.config.body,...params}:undefined;
    const page=this.config.pagination||{},seen=new Set(),rows=[],etags=new WeakMap();let remaining=DATA_LIMITS.bytes;
    const pageLimit=Math.min(DATA_LIMITS.pages,Math.max(1,Number(page.maxPages||DATA_LIMITS.pages)));
    let number=Number(page.start??(page.mode==='offset'?0:1));
    const pageSize=Math.max(1,Math.min(10000,Number(page.size||100)));
    for(let index=0;;index++){
      assertData(index<pageLimit,'Pagination limit reached; narrow the query or change its paging configuration',7);
      if(['page','offset'].includes(page.mode)){
        url.searchParams.set(page.parameter||(page.mode==='offset'?'offset':'page'),String(number));
        url.searchParams.set(page.sizeParameter||'limit',String(pageSize));
      }
      assertData(!seen.has(url.href),'Cyclic pagination link',3001);seen.add(url.href);
      const response=await this.request(url.href,{method,body,limit:remaining});remaining-=response.bytes;
      if(graphql&&response.data?.errors?.length)throw dataError('GraphQL returned errors; the result was not accepted',3001);
      const extracted=pathValue(response.data,this.config.rowsPath||(this.config.provider?.toLowerCase()==='odata'?'value':''));
      const batch=Array.isArray(extracted)?extracted:extracted&&typeof extracted==='object'?[extracted]:null;
      assertData(batch,'Response does not contain records at the configured Rows Path',13);
      assertData(rows.length+batch.length<=DATA_LIMITS.rows,'Row limit exceeded',7);for(const row of batch)rows.push(row);
      // Collection ETags are not item ETags. Only explicit per-item tags are used for writeback.
      for(const row of batch)if(row&&typeof row==='object'){
        const tag=this.config.etagField?pathValue(row,this.config.etagField):this.config.provider?.toLowerCase()==='odata'?row['@odata.etag']:undefined;
        if(tag)etags.set(row,String(tag));
      }
      let next;
      if(page.mode==='next'||this.config.provider?.toLowerCase()==='odata')next=pathValue(response.data,page.nextPath||'@odata.nextLink');
      else if(['page','offset'].includes(page.mode)){
        const more=page.hasMorePath?Boolean(pathValue(response.data,page.hasMorePath)):batch.length===pageSize;
        if(more){number+=page.mode==='offset'?pageSize:1;next=url.href;}
      }
      if(!next)break;
      url=this.sameOriginURL(next);
    }
    const result=resultFromRows(rows,this.config.fields);
    if(this.config.write&&!this.config.readOnly){
      const tags=new WeakMap();
      result.onLoad=loaded=>loaded.forEach((row,i)=>tags.set(row,etags.get(rows[i])));
      result.write=async(kind,row,before)=>{
        const operation=this.config.write[kind];assertData(operation,'Data source does not support '+kind,3251);
        const key=this.config.keyField;assertData(kind==='insert'||key&&before?.[key]!=null,'A key field is required for writeback',3251);
        const endpoint=String(operation.url||this.base.href).replace(/\{([A-Za-z0-9_]+)\}/g,(_,name)=>{
          const value=(kind==='insert'?row:before)?.[name];assertData(value!=null,'Missing write URL key: '+name);return encodeURIComponent(String(value));
        });
        const tag=tags.get(row),headers=tag?{'If-Match':tag}:{};
        assertData(!this.config.requireETag||kind==='insert'||tag,'An item ETag is required for optimistic writeback',3197);
        const response=await this.request(endpoint,{method:operation.method||({insert:'POST',update:'PATCH',delete:'DELETE'})[kind],headers,body:kind==='delete'?undefined:mappedBody(row,this.config.fields?.length?this.config.fields:result.columns.map(c=>({name:c.Name,type:c.Type})))});
        if(response.etag)tags.set(row,response.etag);
        if(kind!=='delete'&&response.data){
          const data=pathValue(response.data,operation.rowsPath||'');
          if(data&&typeof data==='object'&&!Array.isArray(data)){
            const changed=resultFromRows([data],this.config.fields?.length?this.config.fields:result.columns.map(c=>({name:c.Name,type:c.Type})));
            changed.columns.forEach((c,i)=>{if(pathValue(data,c.path)!==undefined)row[c.Name]=changed.values[0][i];});
          }
        }
      };
    }
    return result;
  }
  async schema(kind=4){assertData(Number(kind)===4,'HTTP providers expose column schema, not SQL table metadata',3251);const result=await this.execute();return resultFromRows(result.columns.map(c=>({COLUMN_NAME:c.Name,DATA_TYPE:c.Type})));}
  cancel(){for(const controller of this.requests)controller.abort();}
  close(){this.closed=true;this.cancel();}
}

/** Restricted native-driver service protocol. Credentials stay in server-owned named profiles. */
export class GatewayProvider extends HTTPProvider {
  async open(){super.open();assertData(/^[A-Za-z0-9_-]{1,64}$/.test(this.config.profile||''),'A gateway profile name is required');this.session=null;}
  async call(operation,args={}){const response=await this.request(this.base.href,{method:'POST',body:{operation,profile:this.config.profile,session:this.session,...args},closing:operation==='rollback'});const result=response.data;assertData(result&&typeof result==='object','Invalid gateway response',13);return result;}
  async execute(text,parameters=[]){return decodeResult(await this.call('execute',{text,parameters:parameters.map(encodeCell)}));}
  async executePositional(text,parameters=[]){return decodeResult(await this.call('execute',{text,parameters:parameters.map(encodeCell),parameterStyle:'odbc'}));}
  async schema(kind=20){return decodeResult(await this.call('schema',{kind}));}
  async begin(){assertData(!this.session,'Nested gateway transactions are not supported',3251);const result=await this.call('begin');this.session=result.session;return 1;}
  async commit(){assertData(this.session,'No active transaction',3246);await this.call('commit');this.session=null;}
  async rollback(){assertData(this.session,'No active transaction',3246);await this.call('rollback');this.session=null;}
  async close(){this.cancel();if(this.session){try{await this.rollback();}finally{this.session=null;}}super.close();}
}
