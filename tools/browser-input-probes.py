"""Independent native-event probes for focus/context-menu delivery regressions.

Diagnostic only: production behavior is still asserted by browser-form-input.py.
Every mode uses a fresh page and the same compiled VB fixture.
"""
from pathlib import Path
import ast
from input_designer_test_support import fixture
import json

source = Path(__file__).with_name('browser-form-input.py').read_text()
setup = next(node for node in ast.parse(source).body if isinstance(node, ast.With)).body[0].value.args[0].value
for mode in ['baseline', 'prelude', 'no-activation', 'focus-first', 'capture', 'cancel-down']:
    with fixture() as page:
        page.evaluate(setup)
        page.evaluate('''mode => {
          window.nativeEvents=[];
          for(const type of ['pointerdown','pointerup','pointermove','pointercancel','mousedown','mouseup','contextmenu','focusin','focusout'])
            document.addEventListener(type,e=>{const item={type,button:e.button,buttons:e.buttons,target:e.target.className};nativeEvents.push(item);setTimeout(()=>item.prevented=e.defaultPrevented,0);},true);
          if(mode==='no-activation')form.activateChrome=()=>{};
          if(mode==='focus-first')form.SetFocus();
          if(mode==='capture')form.content.addEventListener('pointerdown',e=>form.content.setPointerCapture(e.pointerId));
          if(mode==='cancel-down')form.content.addEventListener('mousedown',e=>e.preventDefault());
        }''', mode)
        box = page.locator('.vb-form-content').bounding_box()
        page.mouse.move(box['x']+25, box['y']+35)
        if mode == 'prelude':
            page.evaluate("form.content.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));form.content.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:0}));")
        page.mouse.down(button='right')
        page.mouse.up(button='right')
        page.wait_for_timeout(150)
        print('RUNTIME_PROBE '+json.dumps({'mode':mode, 'native':page.evaluate('nativeEvents'), 'trace':page.evaluate("value('Trace')")}), flush=True)
        page.evaluate('host.dispose()')
