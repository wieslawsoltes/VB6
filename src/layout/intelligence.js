import {LAYOUT_CONSTANTS,LAYOUT_CHOICES,layoutDefaults,layoutEnabled} from './contract.js';
const enumFor=name=>name==='Anchor'?'AnchorStyles':name==='Dock'?'DockStyle':name==='LayoutMode'?'LayoutMode':['LayoutGridColumns','LayoutGridRows'].includes(name)?'String':['LayoutIgnore','LayoutClipContents'].includes(name)?'Boolean':/^Layout(?:Width|Height)Mode$/.test(name)?'LayoutSizeMode':LAYOUT_CHOICES[name]?'Long':'Double';
export const layoutConstantSymbols=Object.entries(LAYOUT_CONSTANTS).map(([name,value])=>({name,value,kind:'constant',type:/^vbAnchor/.test(name)?'AnchorStyles':/^vbDock/.test(name)?'DockStyle':/^vbLayout(?:Absolute|Horizontal|Vertical|Wrap|VerticalWrap|Grid)$/.test(name)?'LayoutMode':/^vbLayoutSize/.test(name)?'LayoutSizeMode':'Long',signature:name+' = '+value}));
export function layoutMembers(project,type) {
  if(!layoutEnabled(project))return [];
  const properties=Object.keys(layoutDefaults({type})).map(name=>({name,kind:'property',type:enumFor(name),signature:name+' As '+enumFor(name),description:'Opt-in project layout extension. Geometry uses twips.'}));
  if(['Form','MDIForm','Frame','PictureBox','TabStrip','SSTab'].includes(type))for(const name of ['PerformLayout','SuspendLayout','ResumeLayout'])properties.push({name,kind:'method',type:'Void',params:name==='ResumeLayout'?['Optional Perform As Boolean = True']:[],signature:name+(name==='ResumeLayout'?'(Optional Perform As Boolean = True)':'()')});
  return properties;
}
export function layoutType(project,name) {
  if(!layoutEnabled(project))return null;
  const type=['AnchorStyles','DockStyle','LayoutMode','LayoutSizeMode'].find(t=>t.toLowerCase()===String(name).toLowerCase());
  return type?{name:type,kind:'enum',members:layoutConstantSymbols.filter(s=>s.type===type)}:null;
}
