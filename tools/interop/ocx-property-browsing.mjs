/** Native editor metadata only; never executes a property setter or activates a page. */
import {decodeAutomationValue} from '../../src/runtime/automation-wire.js';

function dataValue(value, depth=0) {
  if(depth>16||!value||typeof value!=='object'||Array.isArray(value)||value.t==='object')throw TypeError('Invalid native predefined value');
  if(value.t==='array')for(const item of value.v??[])dataValue(item,depth+1);
  decodeAutomationValue(value,{preserveScalars:true});
}
function freeze(value) {
  if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}
/** Return a detached, immutable wire snapshot. Use normal Automation to apply values. */
export async function browseNativeControlProperty(client,handle,member) {
  if(!client||typeof client.request!=='function'||!Number.isInteger(client.lcid)||client.lcid<0||client.lcid>0xfffff)throw TypeError('Expected a native Automation client');
  if(typeof handle!=='string'||!/^o[1-9][0-9]*$/.test(handle)||handle.length>32)throw TypeError('Invalid native object handle');
  if(typeof member!=='string'||!/^[A-Za-z][A-Za-z0-9_.]{0,254}$/.test(member)||['constructor','prototype','caller','callee','arguments'].includes(member.toLowerCase()))throw TypeError('Invalid native property name');
  const reply=await client.request({op:'controlBrowseProperty',handle,member,lcid:client.lcid});
  if(!reply||typeof reply!=='object'||typeof reply.supported!=='boolean')throw TypeError('Invalid native property browsing response');
  if(!reply.supported)return Object.freeze({supported:false});
  if(['displaySupported','pageSupported','predefinedSupported'].some(k=>typeof reply[k]!=='boolean')||
    (reply.displaySupported?typeof reply.display!=='string'||reply.display.length>4096:reply.display!==null)||
    (reply.page!==null&&(!reply.pageSupported||typeof reply.page!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(reply.page)))||
    !Array.isArray(reply.predefined)||reply.predefined.length>256||!reply.predefinedSupported&&reply.predefined.length)throw TypeError('Invalid native property browsing metadata');
  const choices=reply.predefined.map(item=>{
    if(!item||typeof item.label!=='string'||item.label.length>4096||!Number.isInteger(item.cookie)||item.cookie<0||item.cookie>0xffffffff)throw TypeError('Invalid native predefined choice');
    dataValue(item.value);return {label:item.label,cookie:item.cookie,value:item.value};
  });
  const result={supported:true,displaySupported:reply.displaySupported,display:reply.display,pageSupported:reply.pageSupported,page:reply.page,predefinedSupported:reply.predefinedSupported,predefined:choices};
  const json=JSON.stringify(result);if(Buffer.byteLength(json)>300*1024)throw RangeError('Native property metadata exceeds 300 KiB');
  return freeze(JSON.parse(json));
}
