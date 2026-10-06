import {VBError} from '../language/lexer.js';
/** IID-scoped, typed outgoing control events. Also usable by source controls.
 * Connection cookies are local identities, never native pointers or authority.
 */
import {Cell,VBArray,readScalar,unbox} from '../runtime/values.js';
const identifier=n=>typeof n==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(n)&&!['constructor','prototype','__proto__'].includes(n.toLowerCase());
const types=new Set(['Variant','Byte','Integer','Long','Single','Double','Currency','Decimal','Date','String','Boolean','Object']);
export function ocxInterfaceId(value){if(typeof value!=='string'||!/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(value)||value.startsWith('{')!==value.endsWith('}'))throw new TypeError('Invalid OCX event interface IID');return value.replace(/[{}]/g,'').toLowerCase();}
/** Allocate declared event storage, preserving typed array bounds and tags. */
export function ocxEventCell(param,value){
  const array=param.array===true||Array.isArray(param.bounds),type=param.storageType||param.type||'Variant';
  if(!array)return new Cell(type,value);
  const input=unbox(value);
  if(!param.byRef)throw new VBError('Array events require ByRef parameters',13);
  if(!(input instanceof VBArray)||input.type.toLowerCase()!==type.toLowerCase())throw new VBError('ByRef array type mismatch',13);
  const cell=new Cell('Variant',input);cell.isArray=true;cell.elementType=type;return cell;
}
export class OcxEventHub {
  #interfaces=new Map();#connections=new Map();#next=0;#depth=0;#freeze=0;#closed=false;
  constructor(interfaces){
    if(!Array.isArray(interfaces)||interfaces.length>32)throw new RangeError('OCX event interface limit');
    for(const source of interfaces){
      const iid=ocxInterfaceId(source.iid);if(this.#interfaces.has(iid)||!Array.isArray(source.events)||source.events.length>256)throw new TypeError('Invalid or duplicate outgoing interface');
      const events=new Map();
      for(const event of source.events){
        if(!identifier(event.name)||events.has(event.name.toLowerCase())||!Array.isArray(event.params)||event.params.length>64)throw new TypeError('Invalid outgoing OCX event');
        const seen=new Set(),params=event.params.map(p=>{if(!identifier(p.name)||seen.has(p.name.toLowerCase())||!types.has(p.type||'Variant'))throw new TypeError('Invalid outgoing OCX parameter');seen.add(p.name.toLowerCase());if(p.array!==undefined&&typeof p.array!=='boolean'||p.array&&!p.byRef)throw new TypeError('Array events require ByRef parameters');return {name:p.name,type:p.type||'Variant',byRef:!!p.byRef,...(p.array?{array:true}:{})};});
        events.set(event.name.toLowerCase(),{name:event.name,params});
      }
      this.#interfaces.set(iid,{events,isDefault:!!source.isDefault});
    }
  }
  advise(iid,handler){
    this.#assertOpen();iid=ocxInterfaceId(iid);if(!this.#interfaces.has(iid)||typeof handler!=='function')throw new TypeError('Unknown interface or invalid event handler');
    if(this.#connections.size>=256)throw new RangeError('OCX event connection limit');const cookie=++this.#next;this.#connections.set(cookie,{iid,handler});return cookie;
  }
  unadvise(cookie){return this.#connections.delete(cookie);}
  count(iid){iid=ocxInterfaceId(iid);return [...this.#connections.values()].filter(c=>c.iid===iid).length;}
  freeze(value){this.#assertOpen();if(typeof value!=='boolean')throw new TypeError('Expected Boolean freeze state');if(value){if(this.#freeze>=256)throw new RangeError('OCX event freeze limit');this.#freeze++;}else if(this.#freeze)this.#freeze--;else throw new Error('Unbalanced OCX event thaw');}
  async dispatch(iid,name,values,context={}){
    this.#assertOpen();iid=ocxInterfaceId(iid);const event=this.#interfaces.get(iid)?.events.get(String(name).toLowerCase());
    if(!event||!Array.isArray(values)||values.length!==event.params.length)throw new TypeError('Invalid outgoing OCX event payload');
    if(this.#depth>=32)throw new RangeError('OCX event recursion limit');
    // A cell validates declared storage types before any subscriber runs. Typed
    // copyback never infers a declaration from a Variant's current numeric value.
    const cells=event.params.map((p,i)=>ocxEventCell(p,values[i]));
    if(this.#freeze)return {args:[...values]};this.#depth++;
    try{
      for(const [cookie,connection]of [...this.#connections]){
        if(connection.iid!==iid||!this.#connections.has(cookie))continue;if(this.#closed)throw new Error('OCX event hub is closed');
        const args=cells.map((cell,i)=>event.params[i].byRef?{ref:cell}:readScalar(cell));
        await connection.handler(event.name,args,{...context,iid});
      }
      this.#assertOpen();return {args:cells.map((cell,i)=>event.params[i].byRef?readScalar(cell):values[i])};
    }finally{this.#depth--;}
  }
  close(){this.#closed=true;this.#connections.clear();}
  #assertOpen(){if(this.#closed)throw new Error('OCX event hub is closed');}
}
