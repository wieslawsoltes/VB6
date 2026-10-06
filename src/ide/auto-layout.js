import {el} from '../core/core.js';
import {alertDialog} from './ui.js';
import {layoutEnabled,layoutEligible,layoutContainer,layoutDefaults,LAYOUT_DEFAULTS,LAYOUT_CHOICES,layoutKey} from '../layout/contract.js';
import {layoutEdit,editLayoutProperties,addAutoLayout,removeAutoLayout,reorderControls,reparentControls,layoutTargets,descendantIds} from '../layout/authoring.js';
import {parentIds,arrangeFormEdit} from '../layout/model.js';
import {installDesignerLayout} from '../layout/canvas-tools.js';
const PANEL='auto-layout';
const groups=[
  ['Flow and sizing',[
    ['LayoutMode','Flow'],['LayoutWidthMode','Width'],['LayoutHeightMode','Height'],['MinimumWidth','Min width'],['MaximumWidth','Max width'],['MinimumHeight','Min height'],['MaximumHeight','Max height']]],
  ['Container spacing',[
    ['LayoutJustify','Distribute'],['LayoutAlignItems','Align items'],['LayoutAlignContent','Align lines'],['LayoutGap','Gap'],['LayoutCrossGap','Line / row gap'],['LayoutPadding','Linked padding'],...['Top','Right','Bottom','Left'].map(s=>['LayoutPadding'+s,s+' padding'])]],
  ['Grid tracks and placement',[
    ['LayoutGridColumns','Columns'],['LayoutGridRows','Rows'],['LayoutColumn','Column (0-based)'],['LayoutRow','Row (0-based)'],['LayoutColumnSpan','Column span'],['LayoutRowSpan','Row span'],['LayoutJustifySelf','Cell alignment']]],
  ['Child and constraints',[
    ['LayoutIgnore','Ignore auto layout'],['LayoutAlign','Align self'],['LayoutBasis','Flex basis'],['LayoutGrow','Grow'],['LayoutShrink','Shrink'],['LayoutMargin','Linked margin'],...['Top','Right','Bottom','Left'].map(s=>['LayoutMargin'+s,s+' margin']),['Anchor','Anchor edges'],['Dock','Dock']]],
  ['Contents and order', [['LayoutClipContents','Clip contents'],['LayoutStacking','Canvas stacking']]]
];
const booleanKeys=new Set(['LayoutIgnore','LayoutClipContents']);
const containerKeys=new Set(['LayoutMode','LayoutJustify','LayoutAlignItems','LayoutAlignContent','LayoutGap','LayoutCrossGap','LayoutPadding','LayoutGridColumns','LayoutGridRows','LayoutClipContents','LayoutStacking',...['Top','Right','Bottom','Left'].map(s=>'LayoutPadding'+s)]);
const hints={LayoutCrossGap:'-1 inherits Gap. Other values set independent wrapped-line/grid-row spacing.',LayoutBasis:'-1 uses the preferred size. A nonnegative value sets the initial flex size.',LayoutGridColumns:'Tracks in twips: 1200 hug 1fr 2fr, or JSON [{"size":"1fr","min":600,"max":1800}]. At most 1024 tracks.',LayoutGridRows:'Empty creates implicit Hug rows. Otherwise: 450 hug 1fr. Values use twips.',LayoutColumn:'-1 automatically places the child; explicit values are zero-based.',LayoutRow:'-1 automatically places the child; explicit values are zero-based.',MaximumWidth:'0 means unlimited.',MaximumHeight:'0 means unlimited.'};
function choices(key){if(key==='Anchor')return Array.from({length:16},(_,value)=>({value,label:value===0?'None':[['Top',1],['Bottom',2],['Left',4],['Right',8]].filter(([,mask])=>value&mask).map(([s])=>s).join(', ')}));if(booleanKeys.has(key))return [{value:0,label:'No'},{value:-1,label:'Yes'}];return LAYOUT_CHOICES[key]?.map((label,value)=>({label,value}));}

/** Optional classic IDE tool. Uses the existing docking/window services and
 * property transaction paths; no additional persistence or permission system. */
export function installAutoLayout(ide){
  if(ide.autoLayout)return ide.autoLayout;
  const controller={ide,panel:null,fields:new Map(),sections:[],syncing:false,selectionKey:'',report:error=>{ide.status(error.message);alertDialog(error.message,'Auto Layout');}};
  ide.autoLayout=controller;
  const current=()=>{const d=ide.designer;return ide.activeModule?.form&&d?.module===ide.activeModule?d:null;};
  const writable=()=>layoutEnabled(ide.project)&&ide.runState==='design'&&current()&&!current().locked;
  controller.commit=(label,operation)=>{
    if(!writable())return false;
    const d=current(),before=d.module.form,revision=ide.visualRevision;
    const edited=layoutEdit(before,operation);
    if(d!==current()||d.module.form!==before||ide.visualRevision!==revision||!writable())throw new Error('The form changed during the layout edit');
    if(JSON.stringify(before)===JSON.stringify(edited.form))return false;
    d.module.form=edited.form;d.selection=new Set(edited.selection);d.primaryId=edited.selection.at(-1)||null;
    d.render();d.emit('change',{label,before,after:structuredClone(edited.form)});d.emit('selection',{controls:d.selected(),form:d.module.form});ide.renderProjectTree();ide.updateLayoutMini();controller.sync();return true;
  };
  controller.apply=changes=>controller.commit('Set auto layout',form=>{
    for(const target of layoutTargets(form,[...current().selection]))ide.controlRegistry?.validateProperties?.(target.type,changes);
    return editLayoutProperties(form,[...current().selection],changes);
  });
  const safe=fn=>(...args)=>{try{return fn(...args);}catch(error){controller.report(error);controller.sync();}};
  function createPanel(){
    const panel=el('section',{class:'dock-panel auto-layout-panel','aria-label':'Auto Layout'}),caption=ide.caption('Auto Layout',()=>ide.docking.show(PANEL,false)),body=el('div',{class:'auto-layout-body'});
    controller.heading=el('strong',{class:'auto-layout-target'});controller.note=el('div',{class:'auto-layout-note',role:'status','aria-live':'polite'});
    const toolbar=el('div',{class:'auto-layout-toolbar',role:'toolbar','aria-label':'Auto layout actions'});
    for(const [id,label,title]of [['autoLayoutAdd','+ Layout','Add or wrap auto layout (Shift+A)'],['autoLayoutRemove','− Layout','Remove auto layout (Alt+Shift+A)'],['autoLayoutPrevious','↑','Move earlier'],['autoLayoutNext','↓','Move later'],['autoLayoutParent','↰','Select parent container']])toolbar.append(el('button',{'data-auto-command':id,title,'aria-label':title,onclick:()=>controller.command(id)},label));
    controller.alignment=el('div',{class:'auto-alignment',role:'group','aria-label':'Container alignment'});
    for(let row=0;row<3;row++)for(let col=0;col<3;col++)controller.alignment.append(el('button',{'data-align-row':row,'data-align-col':col,'aria-label':['Top','Middle','Bottom'][row]+' '+['left','center','right'][col],'aria-pressed':false,title:['Top','Middle','Bottom'][row]+' '+['left','center','right'][col],onclick:safe(()=>{const mode=controller.targets?.[0]?.properties.LayoutMode||0,vertical=mode===2||mode===4;controller.apply({LayoutJustify:vertical?row:col,LayoutAlignItems:vertical?col:row});})},'▪'));
    body.append(controller.heading,toolbar,controller.note,controller.alignment);
    for(const [title,properties]of groups){
      const section=el('details',{class:'auto-layout-section',open:title==='Flow and sizing'||title==='Container spacing'}),summary=el('summary',{},title),grid=el('div',{class:'auto-layout-fields'});section.append(summary,grid);controller.sections.push({section,keys:properties.map(([key])=>key)});
      for(const [key,label]of properties){const option=choices(key),input=option?el('select',{'aria-label':'Auto Layout '+label}):el('input',{type:'text',inputmode:typeof LAYOUT_DEFAULTS[key]==='number'?'decimal':null,spellcheck:false,'aria-label':'Auto Layout '+label});
        if(option){input.append(el('option',{value:'',hidden:true},'Mixed'));for(const choice of option)input.append(el('option',{value:choice.value},choice.label));}
        input.dataset.autoProperty=key;input.title=hints[key]||(/^Layout(?:Padding|Margin)(?:Top|Right|Bottom|Left)$/.test(key)?'-1 inherits the linked value. All geometry is in twips.':key+' — geometry in twips.');
        const row=el('label',{class:'auto-layout-field'},el('span',{},label),input);grid.append(row);
        input.addEventListener('change',safe(()=>{if(input.dataset.cancel||input.disabled||(typeof LAYOUT_DEFAULTS[key]==='number'&&!input.value.trim()))return;const value=typeof LAYOUT_DEFAULTS[key]==='number'?Number(input.value):input.value;
          const changes={[key]:value};if(key==='LayoutPadding'||key==='LayoutMargin')for(const side of ['Top','Right','Bottom','Left'])changes[key+side]=-1;
          controller.apply(changes);
        }));
        input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();input.dataset.cancel='true';controller.sync(true);input.blur();delete input.dataset.cancel;}if(e.key==='Enter'){e.preventDefault();input.dispatchEvent(new Event('change'));}});
        controller.fields.set(key,{input,row});
      }
      body.append(section);
    }
    controller.parentSelect=el('select',{'aria-label':'Move selection to container',onchange:safe(()=>{const value=controller.parentSelect.value;if(value==='')return;controller.commit('Move controls to container',form=>reparentControls(form,[...current().selection],value==='@form'?null:value));})});
    controller.children=el('div',{class:'auto-layout-children',role:'listbox','aria-label':'Layout child order'});
    controller.guideToggle=el('input',{type:'checkbox','aria-label':'Show layout guides',onchange:()=>{if(!layoutEnabled(ide.project))return;ide.project.settings.autoLayoutGuides=controller.guideToggle.checked;for(const d of ide.documents.designers.values())d.renderSelection();ide.autosave();}});
    body.append(el('label',{class:'auto-layout-field'},'Move selection to',controller.parentSelect),el('div',{class:'auto-layout-child-caption'},'Child order — select a child to reorder'),controller.children,el('label',{class:'auto-layout-guide-toggle'},controller.guideToggle,'Show layout guides'),el('p',{class:'auto-layout-help'},'Shift+A adds layout. Arrow keys reorder flow children. Drag children to insert or reparent. Alt measures distances or bypasses snapping. All dimensions are twips.'));
    panel.append(caption,body);controller.panel=panel;controller.body=body;ide.docking.register(PANEL,panel,{edge:'right',title:'Auto Layout',group:'auto-layout',weight:2.3});
  }
  controller.sync=(force=false)=>{
    if(controller.syncing)return;controller.syncing=true;
    try{
      if(!layoutEnabled(ide.project)){
        for(const d of ide.documents?.designers.values()||[])d.autoLayoutTools?.cancel();
        if(controller.panel){ide.docking.unregister(PANEL);controller.panel=null;controller.fields.clear();controller.sections=[];}return;
      }
      if(!controller.panel)createPanel();
      const d=current(),form=d?.module.form,targets=form?layoutTargets(form,[...d.selection]):[];controller.targets=targets;
      const supported=targets.length&&targets.every(layoutEligible),container=supported&&targets.every(layoutContainer),readonly=!writable();
      controller.heading.textContent=targets.length>1?targets.length+' controls':targets[0]?.name||'No form selected';controller.note.textContent=!supported?'Select a visual control or a form.':readonly?'End the program and unlock the form to edit layout.':'Project layout extension enabled';
      const selectionKey=(d?.module.id||'')+':'+[...d?.selection||[]].join(',');const changed=controller.selectionKey!==selectionKey;controller.selectionKey=selectionKey;
      for(const [key,{input,row}]of controller.fields){const available=supported&&targets.every(t=>Object.hasOwn(layoutDefaults(t),key))&&(!containerKeys.has(key)||container);row.hidden=!available;input.disabled=readonly||!available;if(!available)continue;
        const values=targets.map(t=>t.properties[key]??LAYOUT_DEFAULTS[key]),mixed=values.some(v=>v!==values[0]);if(force||changed||input.ownerDocument.activeElement!==input){input.value=mixed?'':String(values[0]);input.placeholder=mixed?'Mixed':'';input.dataset.mixed=String(mixed);}}
      for(const {section,keys}of controller.sections)section.hidden=keys.every(key=>controller.fields.get(key).row.hidden);
      controller.alignment.hidden=!container;const p=targets[0]?.properties||{},vertical=p.LayoutMode===2||p.LayoutMode===4;
      for(const button of controller.alignment.children){button.disabled=readonly||!container;const row=Number(button.dataset.alignRow),col=Number(button.dataset.alignCol);button.setAttribute('aria-pressed',String((p.LayoutJustify||0)===(vertical?row:col)&&(p.LayoutAlignItems||0)===(vertical?col:row)));}
      controller.panel.querySelectorAll('[data-auto-command]').forEach(button=>button.disabled=readonly||!supported);
      controller.guideToggle.checked=ide.project.settings.autoLayoutGuides!==false;controller.guideToggle.disabled=readonly;
      if(form){
        const parents=parentIds(form.controls),selected=new Set(d.selection),illegal=descendantIds(form,[...selected]);
        controller.parentSelect.replaceChildren(el('option',{value:''},'Choose container…'),el('option',{value:'@form'},form.name),...form.controls.filter(c=>layoutContainer(c)&&!illegal.has(c.id)).map(c=>el('option',{value:c.id},c.name)));controller.parentSelect.disabled=readonly||!d.selection.size;
        const parent=targets.length===1&&layoutContainer(targets[0])?targets[0]:targets[0]&&targets[0]!==form?form.controls.find(c=>c.id===parents.get(targets[0].id))||form:form,pid=parent===form?null:parent.id;
        controller.children.replaceChildren(...form.controls.filter(c=>parents.get(c.id)===pid).map(c=>el('button',{role:'option','aria-selected':selected.has(c.id),disabled:readonly,onclick:()=>d.select([c.id]),'data-layout-child':c.id},c.name+(c.properties.LayoutIgnore?' · absolute':''))));
      }else{controller.children.replaceChildren();controller.parentSelect.replaceChildren();controller.parentSelect.disabled=true;}
    }finally{controller.syncing=false;}
  };
  controller.command=safe(id=>{
    if(!layoutEnabled(ide.project))return;
    if(id==='autoLayoutPanel'){controller.sync();ide.docking.show(PANEL,true,true);return;}
    if(!writable())return;const d=current(),ids=[...d.selection];
    if(id==='autoLayoutAdd')return controller.commit('Add auto layout',form=>addAutoLayout(form,ids));
    if(id==='autoLayoutRemove')return controller.commit('Remove auto layout',form=>removeAutoLayout(form,ids));
    if(id==='autoLayoutPrevious'||id==='autoLayoutNext')return controller.commit('Reorder controls',form=>reorderControls(form,ids,id==='autoLayoutPrevious'?-1:1));
    if(id==='autoLayoutParent'){const pid=parentIds(d.module.form.controls).get(ids[0]);d.select(pid?[pid]:[]);return;}
  });
  const menu=ide.menu.bind(ide),designerMenu=ide.designerMenu.bind(ide),command=ide.command.bind(ide),render=ide.inspector.render.bind(ide.inspector),update=ide.updateCommandState.bind(ide),factory=ide.documents.designer.bind(ide.documents);
  const items=()=>[{id:'autoLayoutPanel',label:'Auto Layout Window'},{id:'autoLayoutAdd',label:'Add Auto Layout',shortcut:'Shift+A',enabled:!!writable()},{id:'autoLayoutRemove',label:'Remove Auto Layout',shortcut:'Alt+Shift+A',enabled:!!writable()},{id:'autoLayoutPrevious',label:'Move Earlier',enabled:!!writable()},{id:'autoLayoutNext',label:'Move Later',enabled:!!writable()}];
  ide.menu=name=>{const out=menu(name);if(layoutEnabled(ide.project)){if(name==='View')out.push({id:'autoLayoutPanel',label:'Auto Layout',checked:!!controller.panel&&!ide.docking.model.windows.get(PANEL)?.hidden});if(name==='Format')out.push(null,{label:'Auto Layout',items:items()});}return out;};
  ide.designerMenu=()=>{const out=designerMenu();if(layoutEnabled(ide.project))out.push(null,{label:'Auto Layout',items:items()});return out;};
  ide.command=(id,...args)=>id?.startsWith('autoLayout')?controller.command(id):command(id,...args);
  ide.inspector.render=(...args)=>{const out=render(...args);controller.sync();return out;};
  ide.updateCommandState=(...args)=>{const out=update(...args);controller.sync();return out;};
  ide.documents.designer=module=>{const d=factory(module);installDesignerLayout(d,controller);return d;};
  // Property-grid and agent/MCP layout edits use the same atomic transaction as
  // the panel. Ordinary classic properties still use the unmodified IDE path.
  const setProperty=ide.setProperty.bind(ide),setProperties=ide.setProperties.bind(ide);
  ide.setProperty=(key,value)=>layoutKey(key)&&layoutEnabled(ide.project)?controller.apply({[layoutKey(key)]:value}):setProperty(key,value);
  ide.setProperties=changes=>Object.keys(changes).length&&Object.keys(changes).every(layoutKey)&&layoutEnabled(ide.project)?controller.apply(Object.fromEntries(Object.entries(changes).map(([k,v])=>[layoutKey(k),v]))):setProperties(changes);
  const record=ide.record.bind(ide),load=ide.loadProject.bind(ide);
  ide.record=(before,label,...args)=>{
    if(layoutEnabled(ide.project)&&ide.runState==='design')for(const module of ide.project.modules){
      const old=before.modules.find(m=>m.id===module.id)?.form;if(!old||!module.form)continue;
      const previousIds=new Set(old.controls.map(c=>[c.id,c])),added=module.form.controls.filter(c=>!previousIds.has(c.id)).map(c=>c.id);
      if(!layoutEnabled(before)||added.length&&/^Add (?!auto layout)/i.test(label))arrangeFormEdit(old,module.form,added);
    }
    return record(before,label,...args);
  };
  ide.loadProject=(project,...args)=>{
    if(layoutEnabled(project)){project=structuredClone(project);for(const module of project.modules||[])if(module.form)arrangeFormEdit(structuredClone(module.form),module.form);}
    return load(project,...args);
  };
  for(const d of ide.documents.designers.values())installDesignerLayout(d,controller);controller.sync();return controller;
}
