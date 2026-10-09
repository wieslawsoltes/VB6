import {UIError, safeUrl} from './safety.js';
import {validateReference} from './references.js';

/** Trusted resolver results, never model data, supply reference details and image URLs. */
export function createReferenceFactories({resolveReference=async()=>null,allowResource=()=>false,approveResource=async()=>false,onAction=()=>{},subscribe}={}) {
  return Object.fromEntries(['image','AsyncImage','AsyncImageGroup','Entity','Cite'].map(type=>[type,({document,onAction:dispatchAction=onAction})=>{
    const node=document.createElement('div'),childHost=document.createElement('span'),view=document.createElement('div');node.className='iui-reference';node.append(view,childHost);
    let props={},stamp='',generation=0,controller=null,disposed=false;
    const action=value=>Promise.resolve().then(()=>dispatchAction(value,{signal:controller?.signal})).catch(error=>{if(!disposed)status(error.message);});
    const status=text=>{view.textContent=String(text).slice(0,2000);};
    const image=(record,token)=>{
      const figure=document.createElement('figure'),caption=document.createElement('figcaption'),button=document.createElement('button');button.type='button';button.textContent='Load external image';caption.textContent=record.title||record.alt||props.alt||'';figure.append(button,caption);view.append(figure);
      const url=safeUrl(record.src);
      const load=()=>{if(disposed||generation!==token)return;const img=document.createElement('img');img.alt=record.alt||props.alt||record.title||'';img.referrerPolicy='no-referrer';img.loading='lazy';img.style.maxWidth='100%';img.style.aspectRatio=String(props.aspectRatio||'auto').replace(':','/');img.style.objectFit=props.objectFit||'contain';img.onerror=()=>{if(generation===token)caption.textContent='Image unavailable: '+caption.textContent;};img.src=url;button.replaceWith(img);};
      if(allowResource(url)===true)load();
      else button.onclick=async()=>{button.disabled=true;try{if(await approveResource(url)!==true)throw new UIError('resource_denied','Image loading was declined.');load();}catch(error){if(generation===token){button.disabled=false;caption.textContent=error.message;}}};
      if(record.url){const link=document.createElement('button');link.type='button';link.textContent='Open source';link.onclick=()=>action({type:'link',args:[safeUrl(record.url)]});figure.append(link);}
    };
    const render=async()=>{
      const token=++generation;controller?.abort();controller=new AbortController();status('Resolving reference…');
      try{
        const raw=props.src&&type==='image'?{kind:'image',src:props.src,title:props.alt||'',provenance:{source:'Model-supplied URL; not an inspected source.'}}:await resolveReference(props.ref||null,{type,query:props.query||'',signal:controller.signal});
        if(disposed||generation!==token)return;
        if(!raw){status('No inspected host result for '+(props.ref||props.query||type)+'.');return;}
        const record=validateReference(raw);view.replaceChildren();
        if(['image','images'].includes(record.kind)){
          if(['Entity','Cite'].includes(type))throw new UIError('reference_kind','Expected an entity or citation, not image data.');
          for(const item of record.kind==='image'?[record]:record.items.slice(0,32))image(item,token);
        } else {
          if(['image','AsyncImage','AsyncImageGroup'].includes(type))throw new UIError('reference_kind','Expected image data for this component.');
          const details=document.createElement('details'),title=document.createElement('summary'),body=document.createElement('pre');title.textContent=record.title||props.ref||'Inspected reference';body.textContent=typeof record.details==='string'?record.details:JSON.stringify(record.details??{},null,2);details.append(title,body);view.append(details);
          if(record.url){const link=document.createElement('button');link.type='button';link.textContent='Open cited source';link.onclick=()=>action({type:'link',args:[record.url]});view.append(link);}
        }
        const provenance=document.createElement('small');provenance.className='iui-reference-provenance';provenance.textContent='Source: '+record.provenance.source+(record.provenance.capturedAt?' · '+record.provenance.capturedAt:'');view.append(provenance);
      }catch(error){if(!disposed&&token===generation)status(error.message||'Reference resolution failed.');}
    };
    const off=subscribe?.(event=>{if(!event.id||event.id===props.ref)void render();});
    return {node,childHost,update(next){props=next;const nextStamp=JSON.stringify([props.ref,props.query,props.src,props.alt,props.aspectRatio,props.objectFit]);if(stamp!==nextStamp){stamp=nextStamp;void render();}},dispose(){disposed=true;generation++;controller?.abort();off?.();view.replaceChildren();}};
  }]));
}
