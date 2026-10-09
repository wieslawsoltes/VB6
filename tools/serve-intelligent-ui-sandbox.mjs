import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {sandboxCsp} from '../packages/intelligent-ui/src/sandbox.js';
import {normalizeAppCsp} from '../packages/intelligent-ui/src/app-host.js';
import {safeUrl} from '../packages/intelligent-ui/src/safety.js';

/** Dedicated origin ONLY: no IDE, project files, credentials, proxying or writable endpoints. */
export function createIntelligentUISandboxServer({parentOrigin,html,host='127.0.0.1'}={}){
  const parent=new URL(safeUrl(parentOrigin));if(parent.origin!==parentOrigin)throw new Error('parentOrigin must be a bare HTTP(S) origin.');
  if(typeof html!=='string')throw new Error('Build the sandbox HTML before serving.');
  return http.createServer((req,res)=>{
    const reject=(code,text)=>{res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(text);};
    if(req.method!=='GET'&&req.method!=='HEAD')return reject(405,'Read-only sandbox service.');
    try{
      const authority=new URL('http://'+req.headers.host);if(![host,'localhost','127.0.0.1','[::1]'].includes(authority.hostname))return reject(403,'Host not allowed.');
      const url=new URL(req.url,'http://'+req.headers.host);
      if(url.pathname!=='/intelligent-ui-sandbox.html')return reject(404,'Not found.');
      if(url.searchParams.get('parentOrigin')!==parentOrigin)return reject(403,'Embedding origin is not configured.');
      const raw=url.searchParams.get('csp')||'{}';if(raw.length>16000)return reject(400,'CSP too large.');const csp=normalizeAppCsp(JSON.parse(raw));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':sandboxCsp(csp,{proxy:true,parentOrigin}),'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(), geolocation=(), clipboard-write=(), payment=()'});res.end(req.method==='HEAD'?'':html);
    }catch{return reject(400,'Invalid sandbox request.');}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
  const parentOrigin=process.env.VB6_UI_PARENT_ORIGIN;if(!parentOrigin)throw new Error('Set VB6_UI_PARENT_ORIGIN to the exact IDE origin, for example https://wieslawsoltes.github.io.');
  const port=Number(process.env.VB6_UI_SANDBOX_PORT||47231);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port.');
  const html=fs.readFileSync(path.resolve(import.meta.dirname,'../dist/intelligent-ui-sandbox.html'),'utf8'),server=createIntelligentUISandboxServer({parentOrigin,html});
  server.listen(port,'127.0.0.1',()=>console.log('Intelligent UI sandbox: http://127.0.0.1:'+port+'/intelligent-ui-sandbox.html ; allowed parent '+parentOrigin));
}
