/** Lazy, same-origin loader. Merely importing this file reads no assets, starts
 * no workers and makes no requests. The offline payload is parsed only on opt-in. */
const loaded = new WeakMap();
export function loadAdvancedEditorAssets(document, baseUrl) {
  const view = document.defaultView;
  if (loaded.has(view)) return loaded.get(view);
  const promise = (async () => {
    const payload = document.getElementById('vb6-advanced-editor-assets');
    const embedded = payload ? JSON.parse(payload.textContent) : null;
    const base = new URL(baseUrl, document.baseURI);
    if (!embedded && (base.origin !== view.location.origin || !['http:', 'https:', 'file:'].includes(base.protocol))) {
      throw new Error('Advanced editor assets must be hosted beside this IDE.');
    }
    const urls = new Map(), nodes = [], previousEnvironment=view.MonacoEnvironment;
    const url = name => {
      if (!embedded) return new URL(name, base).href;
      if (typeof embedded[name] !== 'string') throw new Error('The offline editor package is missing '+name);
      if (!urls.has(name)) urls.set(name, view.URL.createObjectURL(new view.Blob([embedded[name]], {type:name.endsWith('.css')?'text/css':'text/javascript'})));
      return urls.get(name);
    };
    const add = (tag, name) => new Promise((resolve, reject) => {
      const node=document.createElement(tag);nodes.push(node);
      node.onload=()=>resolve();node.onerror=()=>reject(new Error('Could not load '+name+'. Build the optional editor package or open VB6-Studio-Web-Advanced.html.'));
      if(tag==='link'){node.rel='stylesheet';node.href=url(name);}else {node.src=url(name);node.async=false;}
      document.head.append(node);
    });
    try {
      view.MonacoEnvironment={...(view.MonacoEnvironment||{}),getWorker:()=>new view.Worker(url('editor.worker.js'),{name:'vb6-editor-core'})};
      await Promise.all([add('link','monaco.css'),add('link','entry.css')]);
      if(!view.VB6AdvancedMonaco)await add('script','monaco.js');
      if(!view.VB6AdvancedEditorRuntime)await add('script','entry.js');
      if(!view.VB6AdvancedMonaco?.monaco||!view.VB6AdvancedEditorRuntime?.createAdvancedEditorRuntime)throw new Error('The optional editor package is incomplete.');
      view.addEventListener('pagehide',()=>{for(const value of urls.values())view.URL.revokeObjectURL(value);},{once:true});
      return {monaco:view.VB6AdvancedMonaco.monaco,create:view.VB6AdvancedEditorRuntime.createAdvancedEditorRuntime,
        worker:()=>new view.Worker(url('language.worker.js'),{name:'vb6-language-server'}),baseUrl:base.href};
    }catch(error){view.MonacoEnvironment=previousEnvironment;for(const node of nodes)node.remove();for(const value of urls.values())view.URL.revokeObjectURL(value);throw error;}
  })();
  loaded.set(view,promise);promise.catch(()=>loaded.delete(view));return promise;
}
