import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeChromeInsets} from '../src/runtime/native-caption.js';
function form(border=2,menu=false){
  const node={ownerDocument:{defaultView:{getComputedStyle:e=>e.style}}},titleBar={style:{height:'20px'}},menuBar={hidden:!menu,style:{height:'19px'}};
  node.style={borderTopWidth:'4px',borderBottomWidth:'4px',borderLeftWidth:'4px',borderRightWidth:'4px'};
  return{node,titleBar,menuBar,props:{BorderStyle:border}};
}
test('native ClientWidth/ClientHeight exclude application-drawn frame and caption exactly once',()=>{
  const f=form();assert.deepEqual(nativeChromeInsets(f,'application'),{width:8,height:28});
  assert.deepEqual(nativeChromeInsets(f,'system'),{width:0,height:0});
  Object.assign(f.node.style,{paddingLeft:'1px',paddingRight:'1px',paddingTop:'2px',paddingBottom:'2px'});
  assert.deepEqual(nativeChromeInsets(f,'application'),{width:10,height:32});
  for(const key of ['paddingLeft','paddingRight','paddingTop','paddingBottom'])f.node.style[key]='0px';
  f.menuBar.hidden=false;assert.deepEqual(nativeChromeInsets(f,'application'),{width:8,height:47});
  assert.deepEqual(nativeChromeInsets(f,'system'),{width:0,height:19});
  f.props.BorderStyle=4;f.titleBar.style.height='15px';assert.deepEqual(nativeChromeInsets(f,'application'),{width:8,height:42});
  f.props.BorderStyle=0;for(const key in f.node.style)f.node.style[key]='0px';assert.deepEqual(nativeChromeInsets(f,'application'),{width:0,height:19});
});
