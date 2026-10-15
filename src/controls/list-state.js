/** Zero-based intrinsic list state. Every reorder carries the associated data,
 * caret, selection and most-recent-insertion identity together. */
import {controlInteger} from './collections.js';
import {VBError} from '../language/lexer.js';
import {coerce, truth} from '../runtime/values.js';

export const LIST_TYPES = new Set(['ListBox','ComboBox','FileListBox','DirListBox','DriveListBox']);
const compare = (a,b) => a.text.localeCompare(b.text, undefined, {sensitivity:'base'});
const changed = c => {c.itemsRevision=(c.itemsRevision||0)+1;c.invalidate();};
export const listIndex = (c,index) => controlInteger(index,0,c.items.length-1,381);
function records(c) {
  return c.items.map((text,index)=>({text:String(text),data:c.itemData[index]??0,
    selected:c.selectedIndices.has(index),current:Number(c.props.ListIndex)===index,
    added:c._newIndex===index}));
}
function apply(c,rows) {
  c.items=rows.map(row=>row.text);c.itemData=rows.map(row=>row.data);
  c.selectedIndices=new Set();c.props.ListIndex=-1;c._newIndex=-1;
  for(let i=0;i<rows.length;i++) {
    if(rows[i].selected)c.selectedIndices.add(i);
    if(rows[i].current)c.props.ListIndex=i;
    if(rows[i].added)c._newIndex=i;
  }
  if(c.type==='ComboBox'&&c.props.ListIndex>=0)c.props.Text=c.items[c.props.ListIndex];
  changed(c);
}
export function initializeList(c) {
  if(!LIST_TYPES.has(c.type))return;
  c.items=c.items.map(String);c.itemData=c.items.map((_,i)=>coerce(c.props.ItemData?.[i]??0,'Long'));
  c._newIndex=-1;
  const index=Number(c.props.ListIndex??-1);
  c.props.ListIndex=Number.isInteger(index)&&index>=0&&index<c.items.length?index:-1;
  if(c.props.ListIndex>=0)c.selectedIndices.add(c.props.ListIndex);
  if(c.props.Sorted)sortList(c);
}
export function sortList(c) {const rows=records(c);rows.sort(compare);apply(c,rows);}
export function addListItem(c,text,index) {
  const at=index===undefined?c.items.length:controlInteger(index,0,c.items.length,380),rows=records(c);
  for(const row of rows)row.added=false;
  rows.splice(at,0,{text:String(text),data:0,selected:false,current:false,added:true});
  if(c.props.Sorted)rows.sort(compare);
  apply(c,rows);
}
export function removeListItem(c,index) {const at=listIndex(c,index),rows=records(c);rows.splice(at,1);apply(c,rows);}
export function clearList(c) {c.items=[];c.itemData=[];c.selectedIndices.clear();c.props.ListIndex=-1;c._newIndex=-1;changed(c);}
export function setListIndex(c,value) {
  const index=controlInteger(value,-1,c.items.length-1,380);
  c.props.ListIndex=index;
  if(!c.props.MultiSelect){c.selectedIndices.clear();if(index>=0)c.selectedIndices.add(index);}
  else if(index>=0)c.selectedIndices.add(index);
  if(c.type==='ComboBox'&&index>=0)c.props.Text=c.items[index];
  return index;
}
export function setListIndexed(c,key,args,value) {
  if(!['list','itemdata','selected'].includes(key))return false;
  if(args.length!==1)throw new VBError('Wrong number of arguments',450);
  const index=listIndex(c,args[0]);
  if(key==='itemdata'){c.itemData[index]=coerce(value,'Long');return true;}
  if(key==='list'){
    const rows=records(c);rows[index].text=String(value);if(c.props.Sorted)rows.sort(compare);apply(c,rows);return true;
  }
  if(truth(value)){
    if(!c.props.MultiSelect)c.selectedIndices.clear();c.selectedIndices.add(index);c.props.ListIndex=index;
  }else{
    c.selectedIndices.delete(index);if(!c.props.MultiSelect&&c.props.ListIndex===index)c.props.ListIndex=-1;
  }
  c.invalidate();return true;
}
