import {el,clone} from '../core/core.js';
import {EditorIntelligence} from './intelligence.js';
import {modal} from '../ide/ui.js';

/** Classic References dialog with explicitly supplied portable type metadata.
 * JSON is parsed as data. Import never loads a DLL/OCX, fetches a URL or changes
 * the retained native Reference=/Object= identity used by .vbp round trips. */
export function installReferenceIntelliSense(ide){
  ide.referencesDialog=async()=>{
    const project=ide.project,initial=JSON.stringify(project.typeLibraries||[]),references=clone(project.typeLibraries||[]);
    const list=el('select',{size:7,'aria-label':'IntelliSense type libraries',style:{width:'100%'}}),status=el('p',{role:'status'}),native=el('div',{class:'dialog-list'});
    const file=el('input',{type:'file',accept:'.json,application/json',hidden:true,'aria-label':'Import type-library metadata'});
    const body=el('div',{},el('p',{},'Available browser libraries'),el('div',{class:'dialog-list'},...['Visual Basic runtime and controls','Scripting.Dictionary and project-private FileSystemObject','ADODB and DAO browser data adapters'].map(label=>el('label',{},el('input',{type:'checkbox',checked:true,disabled:true}),label))),el('p',{},'IntelliSense type libraries:'),list,el('div',{},el('button',{type:'button',onclick:()=>file.click()},'Browse…'),el('button',{type:'button',onclick:()=>{if(list.selectedIndex>=0){references.splice(list.selectedIndex,1);render();}}},'Remove')),file,status);
    if(project.references?.length){body.append(el('p',{},'Retained native project references:'),native);for(const r of project.references)native.append(el('p',{style:{overflowWrap:'anywhere'}},String(r.value||r)));}
    body.append(el('p',{},'Browse imports a JSON type-library descriptor for code assistance and the Object Browser. It does not load a COM server, DLL, OCX, native database driver or Windows registry entry. Descriptors are saved in the browser project format.'));
    const render=()=>{list.replaceChildren(...references.map((r,i)=>el('option',{value:i},r.name+' ('+r.types.length+' types)')));if(references.length)list.selectedIndex=references.length-1;status.textContent=references.length+' portable type libraries';};render();
    let disposed=false,generation=0;
    file.addEventListener('change',async()=>{
      const selected=file.files?.[0],serial=++generation;file.value='';if(!selected)return;
      try{
        if(selected.size>4*1024*1024)throw new Error('Type-library metadata must not exceed 4 MiB.');
        const descriptor=JSON.parse(await selected.text());
        if(disposed||serial!==generation||ide.project!==project)return;
        const service=new EditorIntelligence();service.registerTypeLibrary(descriptor.name,descriptor.types);
        const entry={name:descriptor.name,types:clone(descriptor.types)},index=references.findIndex(r=>r.name.toLowerCase()===entry.name.toLowerCase());
        if(index>=0)references[index]=entry;else references.push(entry);render();status.textContent='Loaded '+entry.name+' — apply with OK.';
      }catch(error){if(!disposed&&serial===generation)status.textContent=error.message;}
    });
    try{await modal('References — '+project.name,{width:630,content:body,buttons:[{label:'OK',value:true,primary:true,action:()=>{
      if(ide.project!==project||JSON.stringify(project.typeLibraries||[])!==initial)throw new Error('The project references changed while this dialog was open. Reopen References.');
      if(JSON.stringify(references)!==initial){const before=clone(project);project.typeLibraries=references;ide.record(before,'Edit IntelliSense references');}
    }},{label:'Cancel',value:false}]});}finally{disposed=true;generation++;}
  };
}
