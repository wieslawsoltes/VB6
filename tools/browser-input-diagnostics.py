"""Re-run the real input regressions with bounded native-event diagnostics on failure."""
from contextlib import contextmanager
from pathlib import Path
import json
import runpy
import input_designer_test_support as support

original_fixture = support.fixture

@contextmanager
def diagnostic_fixture():
    with original_fixture() as page:
        page.evaluate('''() => {
          window.nativeInputTrace=[];
          for(const type of ['pointerdown','pointerup','pointercancel','mousedown','mouseup','contextmenu','keydown','keypress','keyup'])
            document.addEventListener(type,e=>{
              const target=e.target;
              nativeInputTrace.push({type,button:e.button,buttons:e.buttons,key:e.key,
                pointerType:e.pointerType,defaultPrevented:e.defaultPrevented,
                target:target?.dataset?.control||target?.className||target?.tagName});
              if(nativeInputTrace.length>80)nativeInputTrace.shift();
            },true);
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
            raise

support.fixture = diagnostic_fixture
runpy.run_path(str(Path(__file__).with_name('browser-form-input.py')),run_name='__main__')
