import {WEB_BROWSER_LIMITS as limits, WebBrowserError} from './webbrowser-contract.js';
/** Independent of the host tab's history; commit only accepted navigations. */
export class WebBrowserHistory {
  constructor(){this.entries=[];this.index=-1;this.transient=false;}
  get canBack(){return this.transient?this.index>=0:this.index>0;}
  get canForward(){return !this.transient&&this.index>=0&&this.index<this.entries.length-1;}
  target(delta){const index=this.transient&&delta<0?this.index:this.index+delta;if(index<0||index>=this.entries.length||delta>0&&this.transient)throw new WebBrowserError('No history entry in that direction',5);return {index,entry:this.entries[index]};}
  commit(entry,{index=null,replace=false,noHistory=false}={}){
    if(index!==null){if(!Number.isInteger(index)||index<0||index>=this.entries.length)throw new WebBrowserError('Invalid history index',5);this.index=index;this.transient=false;return;}
    if(noHistory){this.transient=true;return;}
    // Refresh/replacement changes the current entry, not the forward list.
    // A transient no-history page must not overwrite its previous real entry.
    if(replace&&this.transient)return;
    if(replace&&this.index>=0)this.entries[this.index]={...entry};
    else{this.entries=this.entries.slice(0,this.index+1);this.entries.push({...entry});this.index++;}
    this.transient=false;
    let bytes=this.entries.reduce((n,e)=>n+(e.html?.length||0)*2+e.url.length*2,0);
    while(this.entries.length>1&&(this.entries.length>limits.history||bytes>limits.historyBytes)){
      const first=this.entries.shift();bytes-=(first.html?.length||0)*2+first.url.length*2;this.index--;
    }
  }
  clear(){this.entries=[];this.index=-1;this.transient=false;}
}
