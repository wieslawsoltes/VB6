import {normalizeBrowserWindows} from './browser-window-state.js';
import {DockLayout} from './dock-layout.js';
import {CommandBarLayout} from './command-bar-model.js';
import {normalizeEditorView} from '../editor/view-state.js';
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
export const MODELESS_TOOLS=Object.freeze(['tool:object-browser','tool:project-search','tool:resources']);
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=160;
/** Validate all components on isolated models before changing any live window. */
export function normalizeWindowProfile(value,registered) {
  if(!plain(value)||![1,2].includes(value.version))throw new Error('Unsupported window layout version.');
  const dock=new DockLayout();for(const id of registered)dock.register(id);dock.restore(value.version===1?value:value.docking);
  if(value.version===1)return dock.snapshot();
  const bars=new CommandBarLayout();bars.restore(value.commandBars);
  const docs=[];if(!Array.isArray(value.docs)||value.docs.length>256)throw new Error('Invalid document layout.');
  const seen=new Set();for(const item of value.docs){if(!plain(item)||!identifier(item.id)||!['code','form'].includes(item.view))throw new Error('Invalid document layout entry.');const key=item.id+':'+item.view;if(seen.has(key))throw new Error('Duplicate document layout entry.');seen.add(key);docs.push({id:item.id,view:item.view,key});}
  if(!Array.isArray(value.windows)||value.windows.length>256)throw new Error('Invalid document window list.');
  const windows=[];for(const item of value.windows){if(!plain(item)||!identifier(item.key)||!plain(item.rect)||!['x','y','width','height'].every(k=>Number.isFinite(item.rect[k])))throw new Error('Invalid document window bounds.');windows.push({key:item.key,rect:Object.fromEntries(['x','y','width','height'].map(k=>[k,Math.max(0,Math.min(100000,item.rect[k]))])),minimized:item.minimized===true,maximized:item.maximized===true,tiled:item.tiled===true});}
  if(!plain(value.editorViews)||Object.keys(value.editorViews).length>256)throw new Error('Invalid editor view metadata.');
  const editorViews=Object.create(null);for(const [id,view]of Object.entries(value.editorViews)){if(!identifier(id)||!plain(view))throw new Error('Invalid editor view.');Object.defineProperty(editorViews,id,{value:normalizeEditorView(view),enumerable:true});}
  const tools=value.tools??[];if(!Array.isArray(tools)||tools.length>MODELESS_TOOLS.length||new Set(tools).size!==tools.length||tools.some(key=>!MODELESS_TOOLS.includes(key)))throw new Error('Invalid modeless tool list.');
  return {version:2,browserWindows:normalizeBrowserWindows(value.browserWindows),tools:[...tools],activeWindow:identifier(value.activeWindow)?value.activeWindow:null,projectId:identifier(value.projectId)?value.projectId:null,docking:dock.snapshot(),commandBars:bars.snapshot(),docs,activeDoc:identifier(value.activeDoc)?value.activeDoc:null,windows,editorViews};
}
export function parseWindowProfiles(text,registered) {
  registered=[...registered];
  if(typeof text!=='string'||text.length>2*1024*1024)throw new Error('Layout file exceeds 2 MiB.');
  const data=JSON.parse(text);if(!plain(data)||![1,2].includes(data.version)||!plain(data.layouts)||Object.keys(data.layouts).length>20)throw new Error('Invalid saved layout collection.');
  const result=Object.create(null);for(const [name,profile]of Object.entries(data.layouts)){if(!name.trim()||name.length>64)throw new Error('Layout names must contain 1–64 characters.');Object.defineProperty(result,name,{value:normalizeWindowProfile(profile,registered),enumerable:true,writable:true,configurable:true});}return result;
}
