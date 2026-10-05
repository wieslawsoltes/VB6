import {assertData} from './common.js';

export class DataCollection {
  constructor(items=[]){this.items=items;}
  get Count(){return this.items.length;}
  Item(key){const item=typeof key==='number'?this.items[key]:this.items.find(p=>String(p.Name??p.name).toLowerCase()===String(key).toLowerCase());assertData(item!==undefined,'Item cannot be found in the collection',3265);return item;}
  [Symbol.iterator](){return this.items.values();}
}
export class NamedCollection extends DataCollection {
  constructor(items=[],operations={}){super(items);this.operations=operations;}
  Append(item){assertData(item&&typeof item.Name==='string'&&item.Name.length>0,'A named object is required',3265);assertData(!this.items.some(i=>i.Name.toLowerCase()===item.Name.toLowerCase()),'An object with this name already exists',3012);const result=this.operations.append?.(item);if(result?.then)return result.then(()=>this.items.push(item));this.items.push(item);}
  Delete(key){const item=this.Item(key),remove=()=>{const i=this.items.indexOf(item);if(i>=0)this.items.splice(i,1);};const result=this.operations.delete?.(item);return result?.then?result.then(remove):remove();}
  Refresh(){return this.operations.refresh?.();}
}

// Native object parameters must not be coerced to their default values by the VB source VM.
NamedCollection.prototype.Append.vbRawArgs=true;
