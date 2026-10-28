import {activeTab,materializeTabPages} from '../../../src/controls/tab-model.js';
import {MacOSCompileError} from './target.js';

const nativeItemScalars=new Set(['key','caption','text','style','value','enabled','visible','tooltiptext','tag','width','image','picture']);
const nativeItemNames=new Map(['Key','Caption','Text','Style','Value','Enabled','Visible','ToolTipText','Tag','Width','Image','Picture'].map(name=>[name.toLowerCase(),name]));
function validateItems(items,owner,module) {
  if(!Array.isArray(items)||items.length>32767)throw new MacOSCompileError(owner.name+': native collections require at most 32767 records.',module.name,1,'MAC265');
  for(const item of items) {
    if(!item||typeof item!=='object'||Array.isArray(item))throw new MacOSCompileError(owner.name+': native collection entries must be records.',module.name,1,'MAC265');
    if(JSON.stringify(item).length>1048576)throw new MacOSCompileError(owner.name+': a native item record exceeds 1048576 UTF-16 code units.',module.name,1,'MAC265');
    const normalized=new Map();
    for(const [key,value] of Object.entries(item))if(nativeItemScalars.has(key.toLowerCase())) {
      if(key!==nativeItemNames.get(key.toLowerCase()))throw new MacOSCompileError(owner.name+'.'+key+': authored native collection records require the canonical member name '+nativeItemNames.get(key.toLowerCase())+'.',module.name,1,'MAC265');
      const name=key.toLowerCase()==='caption'?'text':key.toLowerCase();
      if(normalized.has(name))throw new MacOSCompileError(owner.name+'.'+key+': native item members must be unique, including case and Caption/Text aliases.',module.name,1,'MAC265');
      if(value!=null&&(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)))
        throw new MacOSCompileError(owner.name+'.'+key+': native item fields must be finite scalar values.',module.name,1,'MAC265');
      normalized.set(name,value);
    }
    if(owner.type==='Toolbar') {
      const style=Number(normalized.get('style')??0),value=Number(normalized.get('value')??0);
      if(!Number.isInteger(style)||style<0||style>5||value!==0&&value!==1)
        throw new MacOSCompileError(owner.name+': native toolbar buttons require integer Style 0..5 and Value 0 or 1.',module.name,1,'MAC265');
    }
    if(owner.properties.MacOSControlStyle==='segmented'&&[normalized.get('image'),normalized.get('picture')].some(value=>value!=null&&![0,false,'','0'].includes(value)))
      throw new MacOSCompileError(owner.name+': native segmented items currently support text; image-bearing segments require another control presentation.',module.name,1,'MAC261');
  }
}

/** Resolve the shared tab model before native scalar/array ABI lowering. This
 * operates on the compiler's normalized copy, never the authored document.
 * The existing array ABI carries item dictionaries as bounded JSON strings. */
export function prepareMacOSCollections(project) {
  for (const module of project.modules) if (module.form) {
    module.form=structuredClone(module.form);
    for(const control of module.form.controls||[]) {
      if(['TabStrip','SSTab'].includes(control.type)&&Array.isArray(control.properties.Tabs))validateItems(control.properties.Tabs,control,module);
      if(control.type==='Toolbar'&&control.properties.Buttons!==undefined)validateItems(control.properties.Buttons,control,module);
    }
    let plan;
    try { plan=materializeTabPages(module.form); }
    catch (error) { throw new MacOSCompileError(error.message,module.name,1,'MAC265'); }
    for (const {owner,entries} of plan.owners.values()) {
      if(owner.properties.MacOSControlStyle!=='segmented'&&entries.some(entry=>!entry.Visible))
        throw new MacOSCompileError(owner.name+': hidden native tabs require MacOSControlStyle="segmented".',module.name,1,'MAC261');
      const selected=activeTab(owner);
      owner.properties.Tabs=entries.map(entry=>({
        ...entry,Key:String(entry.Key??''),Caption:String(entry.Caption??''),
        Enabled:entry.Enabled?-1:0,Visible:entry.Visible?-1:0
      }));
      validateItems(owner.properties.Tabs,owner,module);
      owner.properties.Tab=selected;
    }
  }
  return project;
}
