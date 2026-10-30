"""Worker/DOM ordering regression. Only response delivery is delayed: the real
UIClient, Worker interpreter, renderer and trusted button input remain active.
"""

def run_surface_ordering_cases(browser, mode, load, check, passed, report):
    page = load(browser, mode)
    try:
        page.evaluate('()=>{window.workbenchPanel=vb6Studio.intelligentUI.open();}')
        editor = page.get_by_label('Intelligent UI editor', exact=True)
        preview = page.locator('.iui-playground-preview')
        def rendered():
            page.wait_for_function('workbenchPanel.renderedRevision===workbenchPanel.model.active?.revision && !!workbenchPanel.surface?.result')
        rendered()
        source = '{@body const [n,setN]=DIL.useState(0)}<button onClick={()=>setN(n+1)}>Increase queued counter</button><metric label="Count" value={n}/>'
        editor.fill(source)
        rendered()
        page.evaluate('''()=>{
          const surface=workbenchPanel.surface,client=surface.client,request=client.request.bind(client),enqueue=surface.enqueue.bind(surface);
          if(client.backend!=='worker')throw new Error('This regression requires the real Worker backend.');
          window.orderingProbe={held:false,eventRequests:0,release:null,restore:()=>{client.request=request;surface.enqueue=enqueue;}};
          surface.enqueue=(...args)=>{
            if(orderingProbe.release){
              const release=orderingProbe.release;orderingProbe.release=null;release();
            }
            return enqueue(...args);
          };
          client.request=(method,payload)=>{
            const result=request(method,payload);
            if(method!=='event')return result;
            orderingProbe.eventRequests++;
            return result.then(value=>new Promise(resolve=>{
              orderingProbe.release=()=>resolve(value);orderingProbe.held=true;
            }));
          };
        }''')
        preview.get_by_role('button', name='Increase queued counter', exact=True).click()
        page.wait_for_function('orderingProbe.held')
        check(preview.locator('.iui-metric-value').inner_text() == '0', 'The response was not delayed')
        editor.fill(source + '<caption>Source changed during interaction</caption>')
        page.locator('.iui-workbench').get_by_role('button', name='Render', exact=True).click()
        rendered()
        check(preview.locator('.iui-metric-value').inner_text() == '1', 'Source replacement dropped an already committed Worker delta')
        check(page.evaluate('orderingProbe.eventRequests') == 1, 'The test replayed the event instead of consuming its original result')
        check(page.evaluate('workbenchPanel.surface.version===workbenchPanel.surface.result.version'), 'Surface/result versions diverged')
        check(not page._errors, 'Uncaught ordering errors: ' + repr(page._errors))
        check(page.evaluate('vb6Studio.codingAgents.agent.usage.requests') == 0, 'Ordering test contacted a provider')
        page.screenshot(path=str(report / (mode + '-worker-ordering.png')))
        passed(mode + ': workbench real Worker delta survives an interleaved source edit')
        page.evaluate('''()=>{
          orderingProbe.restore();
          const surface=workbenchPanel.surface,client=surface.client,request=client.request.bind(client);
          window.orderingProbe={held:false,eventRequests:0,release:null,holdNextResize:true,restore:()=>client.request=request};
          client.request=(method,payload)=>{
            if(method==='event')orderingProbe.eventRequests++;
            const result=request(method,payload);
            if(method!=='resize'||!orderingProbe.holdNextResize)return result;
            orderingProbe.holdNextResize=false;
            return result.then(value=>new Promise(resolve=>{
              orderingProbe.release=()=>resolve(value);orderingProbe.held=true;
            }));
          };
          surface.setViewport({width:375,height:768});clearTimeout(surface.resizeTimer);void surface.flushResize();
        }''')
        page.wait_for_function('orderingProbe.held')
        preview.get_by_role('button', name='Increase queued counter', exact=True).click()
        check(page.evaluate('orderingProbe.eventRequests') == 0, 'Input used the old version before the pending resize reached the renderer')
        page.evaluate('orderingProbe.release();orderingProbe.release=null;')
        page.wait_for_function('document.querySelector(".iui-playground-preview .iui-metric-value")?.textContent==="2"')
        check(page.evaluate('orderingProbe.eventRequests') == 1, 'Resize recovery replayed the input')
        check(not page._errors, 'Uncaught resize ordering errors: ' + repr(page._errors))
        check(page.evaluate('vb6Studio.codingAgents.agent.usage.requests') == 0, 'Resize ordering test contacted a provider')
        passed(mode + ': workbench real input waits for an in-flight Worker resize and executes once')
    finally:
        page.evaluate('()=>{window.orderingProbe?.release?.();window.orderingProbe?.restore?.();}')
        page.close()
