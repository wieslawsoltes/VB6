// Benchmark reference: ToolList.paint from VB6 commit
// 16c8ef706c525de141e1d5d547b3cf14b45beeea (the repository's MIT license).
// Intentionally retains its original replaceChildren and icon work. Never used
// by the shipped application. Compare in the same browser with the same data.
import {el} from '../../src/core/core.js';
import {icon} from '../../src/theme/icons.js';
import {ToolList} from '../../src/ide/virtual-list.js';
const GLYPHS={'◇':'method','▣':'property','•':'constant','◆':'class','ϟ':'event','▤':'module'};
export function legacyPaint(){
  if(this.disposed)return;this.cancelPaint();
  const start=Math.max(0,Math.floor(this.root.scrollTop/this.rowHeight)-2),end=Math.min(this.items.length,start+Math.ceil((this.root.clientHeight||190)/this.rowHeight)+5),nodes=[];
  for(let i=start;i<end;i++){const item=this.items[i];nodes.push(el('div',{class:'tool-list-row'+(i===this.selected?' selected':''),id:this.id+'-'+i,role:'option','aria-selected':i===this.selected,'aria-posinset':i+1,'aria-setsize':this.items.length,'data-index':i,style:{top:i*this.rowHeight+'px'},title:item.label},el('span',{class:'member-kind','aria-hidden':'true'},icon(GLYPHS[item.glyph]||'property',16)),el('span',{class:'tool-list-label'},item.label)));}
  this.layer.replaceChildren(...nodes);if(this.selected>=start&&this.selected<end)this.root.setAttribute('aria-activedescendant',this.id+'-'+this.selected);else this.root.removeAttribute('aria-activedescendant');this.root.setAttribute('aria-label',this.root.getAttribute('aria-label')||'Items');
}

export {ToolList};
