"""Real input regressions with bounded, independent native-event diagnostics."""
from contextlib import contextmanager
from pathlib import Path
import json
import runpy
from playwright.sync_api import TimeoutError as BrowserTimeout
import input_designer_test_support as support

original_fixture = support.fixture


def native_probes(browser):
    for mode in ['context', 'context-prelude', 'down', 'pointer', 'capture']:
        probe = browser.new_page()
        try:
            probe.set_content('<!doctype html><div id="surface" tabindex="0" style="width:400px;height:300px">Native input probe</div>')
            probe.evaluate('''mode => {
              window.events=[];const surface=document.querySelector('#surface');
              for(const type of ['pointerdown','pointerup','pointermove','pointercancel','mousedown','mouseup','contextmenu'])
                document.addEventListener(type,e=>{const item={type,button:e.button,buttons:e.buttons,target:e.target.id||e.target.tagName};events.push(item);setTimeout(()=>item.prevented=e.defaultPrevented,0);});
              surface.addEventListener('contextmenu',e=>e.preventDefault());
              if(mode==='down')surface.addEventListener('mousedown',e=>e.preventDefault());
              if(mode==='pointer')surface.addEventListener('pointerdown',e=>e.preventDefault());
              if(mode==='capture')surface.addEventListener('pointerdown',e=>surface.setPointerCapture(e.pointerId));
              if(mode==='context-prelude')surface.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:0}));
            }''', mode)
            probe.mouse.move(50, 50)
            probe.mouse.down(button='right')
            probe.mouse.up(button='right')
            try:
                probe.wait_for_function("events.some(e=>e.type==='mouseup'||e.type==='pointerup')", timeout=1000)
            except BrowserTimeout:
                pass
            print('NATIVE_PROBE '+json.dumps({'mode': mode, 'events': probe.evaluate('events')}), flush=True)
        finally:
            probe.close()


@contextmanager
def diagnostic_fixture():
    with original_fixture() as page:
        page.evaluate('''() => {
          window.nativeInputTrace=[];
          for(const type of ['pointerdown','pointerup','pointercancel','mousedown','mouseup','contextmenu','keydown','keypress','keyup'])
            document.addEventListener(type,e=>{
              const target=e.target,item={type,button:e.button,buttons:e.buttons,key:e.key,
                x:e.clientX,y:e.clientY,pointerType:e.pointerType,cancelable:e.cancelable,
                target:target?.dataset?.control||target?.className||target?.tagName};
              nativeInputTrace.push(item);setTimeout(()=>item.defaultPrevented=e.defaultPrevented,0);
              if(nativeInputTrace.length>80)nativeInputTrace.shift();
            },true);
          document.addEventListener('contextmenu',e=>{
            nativeInputTrace.push({phase:'bubble',prevented:e.defaultPrevented,cancelable:e.cancelable,
              state:window.host?.vm?.state,props:window.form?{enabled:form.props.Enabled,visible:form.props.Visible,disposed:form.disposed}:null,
              connected:window.form?.node.isConnected,hidden:!!window.form?.node.closest('[hidden],[inert]'),
              ownerTarget:e.target===window.form?.content,
              procedures:window.form?[...form.instance.module.procedures.keys()]:[]});
          });
        }''')
        try:
            yield page
        except Exception:
            print('INPUT_DIAGNOSTICS '+json.dumps(page.evaluate('''() => ({
              native:window.nativeInputTrace,
              state:window.host?.vm?.state,
              vbTrace:typeof window.value==='function'?window.value('Trace'):null,
              focus:document.activeElement?.outerHTML?.slice(0,500)
            })''')),flush=True)
            native_probes(page.context.browser)
            raise

support.fixture = diagnostic_fixture
runpy.run_path(str(Path(__file__).with_name('browser-form-input.py')),run_name='__main__')
