import {normalizeContentBlocks,base64Bytes,contentSummary} from './content.js';

/** Bounded local previews. Never fetch links or interpret HTML, SVG or resource text. */
export function renderContentPreview(root,content){
  const blocks=normalizeContentBlocks(content),doc=root.ownerDocument,win=doc.defaultView,urls=[];
  const view=doc.createElement('div');view.className='iui-content-preview';root.append(view);
  for(const block of blocks){
    const item=doc.createElement('section'),caption=doc.createElement('pre');caption.textContent=contentSummary([block]);item.append(caption);view.append(item);
    const resource=block.type==='resource'?block.resource:null,mime=block.mimeType||resource?.mimeType,data=block.data||resource?.blob;
    const image=['image/png','image/jpeg','image/gif','image/webp'].includes(mime),audio=['audio/wav','audio/x-wav','audio/mp3','audio/mpeg','audio/ogg','audio/flac','audio/aac','audio/aiff'].includes(mime);
    if(!data||(!image&&!audio)||urls.length>=8)continue;
    const url=win.URL.createObjectURL(new win.Blob([base64Bytes(data)],{type:mime}));urls.push(url);
    const media=doc.createElement(image?'img':'audio');
    if(image){media.alt='Reviewed embedded image';media.style.maxWidth='100%';media.style.maxHeight='240px';}
    else{media.controls=true;media.preload='none';media.setAttribute('aria-label','Reviewed embedded audio');}
    media.src=url;item.append(media);
  }
  let disposed=false;return {node:view,dispose(){if(disposed)return;disposed=true;for(const media of view.querySelectorAll('audio')){media.pause();media.removeAttribute('src');media.load();}for(const url of urls)win.URL.revokeObjectURL(url);view.remove();}};
}
