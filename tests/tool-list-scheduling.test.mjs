import test from 'node:test';
import assert from 'node:assert/strict';
import {ToolList} from '../src/ide/virtual-list.js';

function view(){
  let next=0;
  const frames=new Map(),observers=[];
  return {
    frames,observers,
    requestAnimationFrame(callback){frames.set(next,callback);return next++;},
    cancelAnimationFrame(id){frames.delete(id);},
    tick(){for(const [id,callback]of [...frames]){frames.delete(id);callback();}},
    ResizeObserver:class {
      constructor(callback){this.callback=callback;observers.push(this);}
      observe(root){this.root=root;}
      disconnect(){this.disconnected=true;}
    }
  };
}
function list(window){
  const result=Object.create(ToolList.prototype);
  Object.assign(result,{paintFrame:null,root:{ownerDocument:{defaultView:window}},paints:0,
    paint(){this.paints++;}});
  result.observeDocument();return result;
}

test('tool lists coalesce resize notifications outside observer delivery',()=>{
  const window=view(),value=list(window);
  for(let i=0;i<20;i++)window.observers[0].callback();
  assert.equal(value.paints,0);
  assert.equal(window.frames.size,1);
  window.tick();
  assert.equal(value.paints,1);
  assert.equal(window.frames.size,0,'No continuous repaint loop');
});

test('live list transfer cancels the old frame and observes its destination document',()=>{
  const first=view(),second=view(),value=list(first);
  value.schedulePaint();
  value.root.ownerDocument.defaultView=second;
  value.transferDocument();
  assert.equal(first.frames.size,0);
  assert.equal(first.observers[0].disconnected,true);
  assert.equal(second.observers[0].root,value.root);
  assert.equal(value.observerWindow,second);
  assert.equal(value.paints,1);
  second.observers[0].callback();second.tick();
  assert.equal(value.paints,2);
  value.schedulePaint();value.dispose();
  assert.equal(second.frames.size,0);
  assert.equal(second.observers[0].disconnected,true);
  value.schedulePaint();
  assert.equal(second.frames.size,0,'Disposed lists cannot schedule callbacks');
});

test('a pending list frame never paints into a different document',()=>{
  const first=view(),second=view(),value=list(first);
  value.schedulePaint();value.root.ownerDocument.defaultView=second;
  first.tick();
  assert.equal(value.paints,0);
  assert.equal(second.frames.size,1);
  second.tick();assert.equal(value.paints,1);
});
