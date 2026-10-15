/** Shared authored defaults and runtime validation; no DOM dependency. */
import {VBError} from '../language/lexer.js';
export const COLLECTION_DEFAULTS={
  Toolbar:{ImageList:'',TextAlignment:1,ButtonWidth:0,ButtonHeight:0,Wrappable:0},
  TreeView:{Style:7,CheckBoxes:0,HideSelection:-1,HotTracking:0,LabelEdit:0,ImageList:'',Indentation:240,PathSeparator:'\\',Sorted:0,FullRowSelect:0},
  ListView:{CheckBoxes:0,HideSelection:-1,HotTracking:0,LabelEdit:0,MultiSelect:0,Icons:'',SmallIcons:'',Sorted:0,SortKey:0,SortOrder:0,HideColumnHeaders:0,AllowColumnReorder:0},
};
export function validateCollectionProperty(type,key,value){
  if((type==='StatusBar'&&key==='Style')||(type==='Toolbar'&&key==='TextAlignment')){const n=Number(value);if(!Number.isInteger(n)||n<0||n>1)throw new VBError('Invalid property value: '+key,380);return n;}
  if(type==='Toolbar'&&['ButtonWidth','ButtonHeight'].includes(key)){const n=Number(value);if(!Number.isFinite(n)||n<0||n>300000)throw new VBError('Invalid button size',380);return n;}
  const common=['TreeView','ListView'].includes(type);
  const range=key==='View'&&type==='ListView'?[0,3]:key==='Style'&&type==='TreeView'?[0,7]:key==='LineStyle'&&type==='TreeView'?[0,1]:key==='LabelEdit'&&common?[0,1]:key==='SortOrder'&&type==='ListView'?[0,1]:key==='SortKey'&&type==='ListView'?[0,10000]:null;
  if(range){const n=Number(value);if(!Number.isInteger(n)||n<range[0]||n>range[1])throw new VBError('Invalid property value: '+key,380);return n;}
  if(key==='Indentation'&&type==='TreeView'){const n=Number(value);if(!Number.isFinite(n)||n<0||n>300000)throw new VBError('Invalid indentation',380);return n;}
  if(key==='PathSeparator'&&type==='TreeView')return String(value??'');
  return value;
}
