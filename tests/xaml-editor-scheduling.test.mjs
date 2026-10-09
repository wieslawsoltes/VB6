import test from 'node:test';
import assert from 'node:assert/strict';
import {XamlEditor} from '../src/editor/xaml-editor.js';

function fixture() {
  const callbacks=new Map(),canceled=[],events=[];let next=0;
  const view={
    requestAnimationFrame(callback){const id=next++;callbacks.set(id,callback);return id;},
    cancelAnimationFrame(id){canceled.push(id);callbacks.delete(id);}
  };
  const editor=Object.assign(Object.create(XamlEditor.prototype),{
    closed:false,paintFrame:null,uri:'test.xaml',
    root:{ownerDocument:{defaultView:view},remove(){events.push('remove');}},
    resize:{disconnect(){events.push('disconnect');}},
    service:{closeDocument(uri){assert.equal(uri,'test.xaml');events.push('close');}},
    disposables:[()=>events.push('unlisten')],
    scrollTop:0,paint(){events.push(['paint',this.scrollTop]);}
  });
  const flush=()=>{const pending=[...callbacks.values()];callbacks.clear();for(const callback of pending)callback();};
  return {editor,callbacks,canceled,events,flush};
}

test('XAML resize and scroll paints coalesce without synchronous layout writes',()=>{
  const f=fixture();f.editor.schedulePaint();f.editor.scrollTop=100;f.editor.schedulePaint();
  assert.equal(f.callbacks.size,1);assert.deepEqual(f.events,[]);
  // The scheduler must not use truthiness: frame zero is a valid request id.
  assert.equal(f.editor.paintFrame,0);f.flush();assert.deepEqual(f.events,[['paint',100]]);
  assert.equal(f.editor.paintFrame,null);f.editor.scrollTop=200;f.editor.schedulePaint();f.flush();
  assert.deepEqual(f.events,[['paint',100],['paint',200]]);
});

test('XAML editor disposal cancels pending paints and blocks already dequeued callbacks',()=>{
  const f=fixture();f.editor.schedulePaint();const callback=[...f.callbacks.values()][0];
  f.editor.dispose();assert.deepEqual(f.canceled,[0]);assert.equal(f.callbacks.size,0);
  assert.deepEqual(f.events,['disconnect','unlisten','close','remove']);
  callback();f.editor.schedulePaint();f.editor.dispose();
  assert.equal(f.callbacks.size,0);assert.equal(f.editor.paintFrame,null);
  assert.deepEqual(f.events,['disconnect','unlisten','close','remove']);
});

test('XAML editor paints schedule on the document that currently owns the surface',()=>{
  const f=fixture();let painted=false;
  const other={requestAnimationFrame(callback){painted=true;f.callbacks.set(10,callback);return 10;},cancelAnimationFrame(id){f.canceled.push(id);}};
  f.editor.root.ownerDocument.defaultView=other;f.editor.schedulePaint();
  assert.equal(painted,true);assert.equal(f.editor.paintWindow,other);f.editor.dispose();
  assert.deepEqual(f.canceled,[10]);
});
