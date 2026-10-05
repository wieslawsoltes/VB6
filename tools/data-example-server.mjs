/** Local, disposable REST/OData/GraphQL teaching fixture. Never use for production data. */
import http from 'node:http';
import {pathToFileURL} from 'node:url';
export function createExampleServer({origins=['null','http://127.0.0.1:4173','http://localhost:4173'],delay=0}={}){
  const records=new Map([[1,{id:1,name:'Ada Lovelace',email:'ada@example.test',active:true,revision:1}],[2,{id:2,name:'Grace Hopper',email:'grace@example.test',active:true,revision:1}],[3,{id:3,name:'Edsger Dijkstra',email:'edsger@example.test',active:false,revision:1}]]);let nextId=4;
  const publicRow=row=>({...row,etag:'"'+row.revision+'"'});
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin;
    if(origin&&!origins.includes(origin)){res.writeHead(403);res.end();return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,If-Match');res.setHeader('Access-Control-Expose-Headers','ETag');res.setHeader('Cache-Control','no-store');
    const send=(status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(value==null?'':JSON.stringify(value));};
    if(req.method==='OPTIONS'){send(204);return;}
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536){send(413,{error:'body too large'});return;}chunks.push(chunk);}
      const text=Buffer.concat(chunks).toString('utf8'),body=text?JSON.parse(text):{},url=new URL(req.url,'http://example.invalid'),path=url.pathname;
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      if(path==='/health'){send(200,{status:'ok',fixture:true});return;}
      if(path==='/graphql'&&req.method==='POST'){
        if(!String(body.query).includes('customers')){send(200,{errors:[{message:'This fixture exposes only customers'}]});return;}
        const rows=[...records.values()].filter(r=>body.variables?.active==null||r.active===body.variables.active);send(200,{data:{customers:rows.map(publicRow)}});return;
      }
      if(path==='/odata/Customers'&&req.method==='GET'){
        const offset=Number(url.searchParams.get('$skip')||0),values=[...records.values()],more=offset+2<values.length;
        send(200,{value:values.slice(offset,offset+2).map(r=>({...publicRow(r),'@odata.etag':'"'+r.revision+'"'})),...(more?{'@odata.nextLink':'/odata/Customers?$skip='+(offset+2)}:{})});return;
      }
      if(path==='/customers'&&req.method==='GET'){
        const page=Number(url.searchParams.get('page')||1),limit=Math.max(1,Math.min(100,Number(url.searchParams.get('limit')||2)));
        if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)){send(400,{error:'Invalid paging'});return;}
        const values=[...records.values()],start=(page-1)*limit;
        send(200,{items:values.slice(start,start+limit).map(publicRow),hasMore:start+limit<values.length,total:values.length});return;
      }
      if(path==='/customers'&&req.method==='POST'){
        if(typeof body.name!=='string'||!body.name){send(422,{error:'name is required'});return;}
        const row={id:nextId++,name:body.name,email:body.email??null,active:Boolean(body.active),revision:1};records.set(row.id,row);send(201,publicRow(row),{ETag:'"1"'});return;
      }
      const match=path.match(/^\/customers\/(\d+)$/),row=match&&records.get(Number(match[1]));
      if(row){
        if(req.method==='GET'){send(200,publicRow(row),{ETag:'"'+row.revision+'"'});return;}
        if(!['PATCH','DELETE'].includes(req.method)){send(405,{error:'method'});return;}
        if(req.headers['if-match']!=='"'+row.revision+'"'){send(412,{error:'The customer was modified; reload and retry'});return;}
        if(req.method==='DELETE'){records.delete(row.id);send(204);return;}
        for(const key of ['name','email','active'])if(Object.hasOwn(body,key))row[key]=body[key];row.revision++;
        send(200,publicRow(row),{ETag:'"'+row.revision+'"'});return;
      }
      send(404,{error:'Not found'});
    }catch{send(400,{error:'Invalid request'});}
  });
  return {server,records};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||4286),origins=(process.env.VB6_EXAMPLE_ORIGINS||'null,http://127.0.0.1:4173,http://localhost:4173').split(',');
  const {server}=createExampleServer({origins});server.listen(port,'127.0.0.1',()=>console.log(`Disposable VB6 data examples: http://127.0.0.1:${port}/customers (loopback only)`));
}
