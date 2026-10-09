import {BrowserControl} from '../controls/controls.js';
/** Trusted renderer adapters use the existing VB6 controls, without attaching a VM. */
export function vb6UIFactories(){
  const result={};let sequence=0;
  for(const [component,type] of Object.entries({VB6Button:'CommandButton',VB6TextBox:'TextBox',VB6CheckBox:'CheckBox',VB6Label:'Label'}))result[component]=({document,id,onEvent})=>{
    // The VB6 core creates elements in its current document; adoption also supports detached IDE windows.
    const control=new BrowserControl({id,name:'IntelligentControl'+(++sequence),type,properties:{Caption:'',Text:'',Width:3600,Height:420}});
    document.adoptNode(control.node);let updating=false;
    control.event=(name)=>{if(updating||control.disposed||!control.props.Enabled)return Promise.resolve();if(type==='CommandButton'&&name==='Click')onEvent('onClick',[]);else if(type==='TextBox'&&name==='Change')onEvent('onChange',[String(control.get('Text'))]);return Promise.resolve();};
    // Native checkbox state changes after Click; consume Change rather than its stale Click value.
    if(type==='CheckBox')control.input.addEventListener('change',()=>{if(!updating)onEvent('onChange',[control.input.checked]);});
    const content=document.createElement('span'),wrapper=document.createElement('div');wrapper.className='iui-vb6-control';wrapper.append(control.node,content);
    return {node:wrapper,childHost:content,update(props){updating=true;try{
      const map={Caption:props.caption??props.label??'',Text:String(props.value??''),Value:props.checked?1:0,Enabled:props.disabled?0:-1,Visible:props.hidden?0:-1,ToolTipText:props.title||''};
      for(const [key,value] of Object.entries(map))if(control.props[key]!==value)control.set(key,value);
      control.refresh();control.node.style.position='relative';control.node.style.left='';control.node.style.top='';control.node.style.width=typeof props.width==='number'?props.width+'px':props.width||'100%';control.node.style.height=typeof props.height==='number'?props.height+'px':props.height||'28px';
      control.input?.setAttribute('aria-label',props.label||props.caption||props.name||component);
    }finally{updating=false;}},dispose(){control.dispose();}};
  }
  return result;
}
