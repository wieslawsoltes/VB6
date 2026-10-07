import {LayoutEngine} from '../../packages/auto-layout/src/index.js';
import {formNodes,layoutOptions,formSize} from '../layout/model.js';
import {LAYOUT_DEFAULTS,LAYOUT_KEYS} from '../layout/contract.js';
import {NATIVE_LAYOUT_COLUMNS} from './layout-core.js';
/** Immutable design baselines in parent-before-child order, with linked siblings. */
export function nativeLayoutSeed(project) {
  const rows=[new Array(NATIVE_LAYOUT_COLUMNS).fill(0)],forms=new Map();
  for(const module of project.modules)if(module.form){
    const form=module.form;
    const classic=new Set(['Anchor','Dock','MinimumWidth','MinimumHeight','MaximumWidth','MaximumHeight','LayoutMode','LayoutPadding','LayoutMargin','LayoutGap','LayoutGrow','LayoutShrink','LayoutAlign','LayoutJustify']);
    for(const node of [form,...form.controls])for(const key of LAYOUT_KEYS){const value=node.properties[key];if(value===undefined)continue;if(!classic.has(key)&&value!==LAYOUT_DEFAULTS[key]||key==='LayoutMode'&&value>3||key==='LayoutGap'&&value<0||key==='LayoutAlign'&&value===4)throw new Error(node.name+'.'+key+': advanced auto layout requires the HTML/Electron target; the freestanding Win32 layout kernel supports classic anchoring, docking and stack/wrap only');}
    const engine=new LayoutEngine(formNodes(form),layoutOptions(form)),d=engine.data,root=rows.length,map=new Map(),size=formSize(form),p=form.properties;
    const row=new Array(NATIVE_LAYOUT_COLUMNS).fill(0);row[2]=row[8]=size.width;row[3]=row[9]=size.height;row[12]=d.mode[engine.count];row[17]=d.pl[engine.count];row[19]=d.gap[engine.count];row[23]=d.justify[engine.count];row[24]=-1;row[26]=root;rows.push(row);
    for(const i of engine.order){map.set(engine.nodes[i].id,rows.length);rows.push(new Array(NATIVE_LAYOUT_COLUMNS).fill(0));}
    const id=index=>index===engine.count?root:map.get(engine.nodes[index].id);
    for(const i of engine.order){const r=rows[id(i)],node=engine.nodes[i],model=form.controls[i],parent=engine.parents[i];
      [r[0],r[1],r[2],r[3],r[4],r[5]]=[d.x[i],d.y[i],d.w[i],d.h[i],d.bw[i],d.bh[i]];
      for(let k=0;k<4;k++)r[6+k]=r[k];
      for(const [k,col]of [[10,'anchor'],[11,'dock'],[12,'mode'],[13,'minW'],[14,'minH'],[15,'maxW'],[16,'maxH'],[17,'pl'],[18,'ml'],[19,'gap'],[20,'grow'],[21,'shrink'],[22,'align'],[23,'justify']])r[k]=Number.isFinite(d[col][i])?d[col][i]:0;
      if(r[22]<0)r[22]=5;
      r[24]=engine.visible[i]?-1:0;r[25]=id(parent);r[26]=root;r[29]=engine.participant[i]?(model.type==='ComboBox'&&model.properties.Style!==1?2:1):-1;
    }
    for(const parent of [engine.count,...engine.order]){const siblings=engine.children[parent];rows[id(parent)][27]=siblings.length?id(siblings[0]):0;for(let j=0;j<siblings.length;j++)rows[id(siblings[j])][28]=j+1<siblings.length?id(siblings[j+1]):0;}
    forms.set(module.name.toLowerCase(),{root,last:rows.length-1,controls:map});
  }
  return {rows,forms,count:rows.length-1};
}
