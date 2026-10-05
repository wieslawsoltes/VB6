// Exact one-use application of the locally validated input changes.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
function edit(path,before,after,update){let s=readFileSync(path,'utf8');if(hash(s)===after)return;if(hash(s)!==before)throw Error('Source changed: '+path);s=update(s);if(hash(s)!==after)throw Error('Output mismatch: '+path);writeFileSync(path,s);}
edit('src/controls/input.js','9adb226cd5d5b90f5b16e60d7e8380e4c2808f6e30fff6a945650b9a3390f4d7','733cc7e395313ad6fb71c6f200ce2cbcc645fa7bad90ce7398f2d9366e9c07bf',s=>{
  s=s.replace('const namedKeys=',`// A chorded press/release is a pointermove, not another pointerdown/up.
export function pointerMouseEvent(event){
  if(event.type==='pointerdown')return 'MouseDown';
  if(event.type==='pointerup')return 'MouseUp';
  const button=[1,4,2][event.button]||0;
  return button?(event.buttons&button?'MouseDown':'MouseUp'):'MouseMove';
}
const namedKeys=`);
  s=s.replace("  const root=control.content||control.node,moveKey={};\n",`  const root=control.content||control.node,moveKey={};
  root.addEventListener('contextmenu',e=>{
    // WebKit's native context menu consumes the subsequent pointerup. When VB
    // handles the right button, keep its complete down/up stream in the app.
    // Unhandled targets and keyboard-invoked native menus remain unchanged.
    if(e.button===2&&ownerOf(e.target)===control&&acceptsInput(control)&&
      (procedure(control,'MouseDown')||procedure(control,'MouseUp')))e.preventDefault();
  });
`);
  return s.replace("for(const [dom,event]of [['pointerdown','MouseDown'],['pointermove','MouseMove'],['pointerup','MouseUp']])root.addEventListener(dom,e=>{","for(const dom of ['pointerdown','pointermove','pointerup'])root.addEventListener(dom,e=>{").replace("    if(event==='MouseDown'","    const event=pointerMouseEvent(e);\n    if(event==='MouseDown'");
});
edit('tools/browser-form-input.py','b9c8765ee14dfeb71d2cfe71fbc8480ce7a2280d4bb803ed030514191f2a6ac8','9a9f81d5d62790911fc3dca195c6a3ba60bd17e9cf57da696c3f56a3e1502b0b',s=>{
  s=s.replace(`    assert page.evaluate("value('Trace')") == 'D2U2'
    page.evaluate('clearTrace()')
`,`    assert page.evaluate("value('Trace')") == 'D2U2', page.evaluate("value('Trace')")
    page.evaluate('clearTrace()')
    # Additional pressed/released buttons arrive as pointermove, not down/up.
    page.mouse.down(button='left')
    page.mouse.down(button='middle')
    page.mouse.up(button='left')
    page.mouse.up(button='middle')
    page.evaluate('drain()')
    assert page.evaluate("value('Trace')") == 'D1D4U1U4', page.evaluate("value('Trace')")
    page.evaluate('clearTrace()')
`);
  s=s.replace("    page.mouse.down(button='right')",`    assert page.evaluate("form.content.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))") is False
    assert page.evaluate("form.content.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:0}))") is True
    page.mouse.down(button='right')`);
  return s.replace("    page.keyboard.press('q')",`    assert page.evaluate("host.forms.find(f=>f.type==='Form').controls[0].node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))") is True
    page.keyboard.press('q')`);
});
