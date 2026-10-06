import {el} from '../core/core.js';
import {modal} from '../ide/ui.js';
import {formatAnchor,parseAnchor} from '../../packages/auto-layout/src/index.js';
import {layoutEnabled,layoutEligible} from './contract.js';
export async function anchorDialog(value=5,title='Anchoring') {
  let mask=parseAnchor(value);const buttons=new Map();
  const diagram=el('div',{class:'anchor-diagram',role:'group','aria-label':'Anchor edges'});
  const update=()=>{for(const [bit,button]of buttons){button.setAttribute('aria-pressed',String(!!(mask&bit)));button.classList.toggle('selected',!!(mask&bit));}summary.textContent=formatAnchor(mask);};
  for(const [edge,bit]of [['Top',1],['Bottom',2],['Left',4],['Right',8]]) {
    const button=el('button',{type:'button',class:'anchor-edge anchor-'+edge.toLowerCase(),'aria-label':'Anchor '+edge,'aria-pressed':String(!!(mask&bit)),onclick:()=>{mask^=bit;update();}},edge);buttons.set(bit,button);diagram.append(button);
  }
  diagram.append(el('span',{class:'anchor-control'},'Control'));
  const summary=el('output',{'aria-live':'polite',class:'anchor-summary'});
  const presets=el('div',{class:'anchor-presets'},...[[5,'Top, Left'],[10,'Bottom, Right'],[15,'All edges'],[0,'None']].map(([value,label])=>el('button',{type:'button',onclick:()=>{mask=value;update();}},label)));
  update();const accepted=await modal(title,{width:420,content:el('div',{},diagram,summary,presets,el('p',{},'Opposite edges stretch the control. An unanchored axis preserves the offset from its container center.'))});
  return accepted?mask:null;
}
export function renderAnchorGuides(designer) {
  if(!layoutEnabled(designer.project))return;
  const form=designer.module.form,views=new Map(designer.formView.controls.map(v=>[v.model.id,v]));
  for(const c of designer.selected()) {
    if(!layoutEligible(c)||Number(c.properties.Dock||0))continue;
    const r=designer.controlRect(c),view=views.get(c.id);if(!r||!view)continue;
    const root=designer.formView.content.getBoundingClientRect(),parent=view.node.parentElement.getBoundingClientRect(),z=designer.zoom;
    const p={x:(parent.left-root.left)/z,y:(parent.top-root.top)/z,width:parent.width/z,height:parent.height/z},a=parseAnchor(c.properties.Anchor??5);
    for(const [edge,bit,x1,y1,x2,y2]of [['Top',1,r.x+r.width/2,p.y,r.x+r.width/2,r.y],['Bottom',2,r.x+r.width/2,r.y+r.height,r.x+r.width/2,p.y+p.height],['Left',4,p.x,r.y+r.height/2,r.x,r.y+r.height/2],['Right',8,r.x+r.width,r.y+r.height/2,p.x+p.width,r.y+r.height/2]])if(a&bit)designer.overlay.append(el('i',{class:'designer-anchor-guide','data-anchor-edge':edge,'data-anchor-control':c.id,style:{left:Math.min(x1,x2)+'px',top:Math.min(y1,y2)+'px',width:Math.abs(x2-x1)+'px',height:Math.abs(y2-y1)+'px'}}));
  }
}
