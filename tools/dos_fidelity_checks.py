"""Display-scale/state regressions against the production IDE.

These are implementation regressions, not a native-vendor screenshot oracle.
Every input action below targets the original DOM control beneath inert paint.
"""
import json
from playwright.sync_api import expect


def run_fidelity_checks(browser, root, report):
    results = []
    html = (root / 'dist/VB6-Studio-Web.html').read_text()
    for profile in ['turbo', 'commander', 'win31', 'monochrome']:
        for dpr in [1, 1.25, 2]:
            label = profile + '-' + str(dpr).replace('.', '_')
            page = browser.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=dpr)
            errors = []
            page.on('pageerror', lambda error, sink=errors: sink.append(str(error)))
            try:
                page.set_content(html, wait_until='load')
                page.wait_for_function('window.vb6Studio?.dosMode')
                page.evaluate('''async ({profile,dpr})=>{
                  vb6Studio.setRenderingPolicy({backend:'html'});
                  window.modelBefore=JSON.stringify(vb6Studio.project);
                  window.canonicalInput=document.querySelector('.property-object');
                  window.classicTracks=document.querySelector('.dock-workspace').style.cssText;
                  await vb6Studio.dosMode.configure({mode:'dos',profile,cellWidth:dpr===1.25?9:8,cellHeight:dpr===1.25?18:16});
                  window.presenter=vb6Studio.dosMode.sessions.get(document);
                  window.assertTUI=(condition,message)=>{if(!condition)throw Error(message);};
                }''', {'profile': profile, 'dpr': dpr})
                page.wait_for_function('presenter.frame===0&&presenter.chrome.entries.size>20')
                metrics = page.evaluate('''()=>{
                  assertTUI(JSON.stringify(vb6Studio.project)===modelBefore,'palette mutated the model');
                  const toolbox=document.querySelector('.toolbox-grid'),c=presenter.settings.cellWidth;
                  assertTUI(toolbox.clientWidth>=16*c,'toolbox cannot fit CommandButton');
                  assertTUI(document.querySelector('.property-object')===canonicalInput,'property selector was replaced');
                  const field=presenter.chrome.entries.get(canonicalInput);
                  assertTUI(field?.field&&field.canvas.parentElement===canonicalInput.offsetParent,'void field projection missing');
                  const title=[...presenter.chrome.entries].find(([n])=>n.matches('.properties-panel .tool-caption'))?.[1];
                  assertTUI(title?.buffer?.toText().includes('Properties'),'dock title was truncated');
                  const frames=[...presenter.chrome.entries.values()].filter(e=>e.frame&&e.visible&&e.painter);
                  let pixels=0;
                  for(const entry of frames){
                    const actual=entry.painter.strips.reduce((n,c)=>n+c.width*c.height,0);
                    assertTUI(entry.pixels===actual,'sparse frame accounting differs');pixels+=actual;
                    assertTUI(entry.painter.strips.every(c=>getComputedStyle(c).pointerEvents==='none'),'frame consumes input');
                  }
                  assertTUI(!presenter.metrics.failures&&!presenter.metrics.budgetFallbacks&&!presenter.chrome.metrics.fallbacks,'visible paint fell back');
                  return {frames:frames.length,framePixels:pixels,totalPixels:presenter.surfacePixels};
                }''')
                page.screenshot(path=str(report / ('fidelity-' + label + '.png')))
                page.locator('.menubar > button').filter(has_text='Tools').click()
                menu = page.locator('.classic-menu').last
                expect(menu).to_be_visible()
                page.wait_for_function("[...presenter.chrome.entries].some(([n,e])=>n.matches('.classic-menu')&&e.buffer?.toText().includes('Options'))")
                if dpr == 1:
                    page.screenshot(path=str(report / ('menu-' + profile + '.png')))
                page.keyboard.press('Escape')

                page.evaluate("void vb6Studio.command('options')")
                page.get_by_role('tab', name='General', exact=True).click()
                page.wait_for_function("presenter.chrome.entries.get(document.querySelector('.ide-dialog-body'))?.content")
                page.locator('.ide-dialog-body input[type=checkbox]:visible').first.click()
                # Scroll the actual dialog; the painter must remain fixed to its
                # client viewport, not scroll twice with the source content.
                page.locator('.ide-dialog-body').hover()
                page.mouse.wheel(0, 640)
                page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                dialog = page.evaluate('''()=>{
                  const n=document.querySelector('.ide-dialog-body'),e=presenter.chrome.entries.get(n);
                  assertTUI(e?.content&&e.buffer,'dialog body not character painted');
                  assertTUI(!e.fallback,'dialog paint fell back: '+e.fallback);
                  for(const label of n.querySelectorAll('.option-check')){
                    const checkbox=label.querySelector('input[type=checkbox]');if(!checkbox||!label.getClientRects().length)continue;
                    const bounds=checkbox.getBoundingClientRect(),base=n.getBoundingClientRect();
                    const y=Math.floor((bounds.top+bounds.height/2-base.top-n.clientTop)/presenter.settings.cellHeight);
                    if(y>=0&&y<e.buffer.rows)assertTUI(e.state.items.some(item=>item.kind==='text'&&item.y===y&&item.text.trim()),'checkbox caption moved to another row');
                  }

                  assertTUI(Math.abs(e.canvas.getBoundingClientRect().top-n.getBoundingClientRect().top-n.clientTop)<1,'dialog overlay scrolled twice');
                  assertTUI(e.state.items.some(i=>i.kind==='text'),'wrapped dialog text is absent');
                  assertTUI(e.state.items.some(i=>i.kind==='field'),'dialog controls are absent');
                  assertTUI(!presenter.metrics.failures&&!presenter.metrics.budgetFallbacks&&!presenter.chrome.metrics.fallbacks,'dialog exceeds presentation budget');
                  return {scrollTop:n.scrollTop,rows:e.buffer.rows,items:e.state.items.length,pixels:presenter.surfacePixels};
                }''')
                if dpr == 1:
                    page.screenshot(path=str(report / ('dialog-' + profile + '.png')))
                page.get_by_role('button', name='Cancel', exact=True).click()
                expect(page.locator('.ide-dialog-body')).to_have_count(0)
                page.evaluate('''()=>{
                  window.objects=vb6Studio.objectBrowser();
                  objects.classList.root.focus();
                }''')
                page.keyboard.press('End')
                page.wait_for_function("objects.classList.root.querySelector('.tool-list-row.selected[data-tui-chrome-target]')")
                page.evaluate('''()=>{
                  const list=objects.classList,row=list.root.querySelector('.tool-list-row.selected');
                  assertTUI(list.rowHeight===presenter.settings.cellHeight,'object list kept native row pitch');
                  assertTUI(parseFloat(row.style.top)===list.selected*list.rowHeight,'object row position differs');
                  const entry=presenter.chrome.entries.get(row);
                  assertTUI(entry.buffer.toText().includes(list.items[list.selected].label.slice(0,6)),'object row not painted');
                  assertTUI(presenter.chrome.entries.get(objects.definition)?.state.transcript,'definition text not projected');
                  objects.query.value='Text';objects.search();
                  assertTUI(objects.resultList.items.length>0,'canonical catalog search stopped working');
                }''')
                if dpr == 1:
                    page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                    page.screenshot(path=str(report / ('objects-' + profile + '.png')))
                page.evaluate("vb6Studio.documents.closeTool('tool:object-browser')")
                page.evaluate('''()=>{
                  vb6Studio.showDebug('immediate');
                  vb6Studio.immediateOutput=['FIRST OUTPUT',...Array.from({length:80},(_,i)=>'transcript line '+i)];
                  vb6Studio.renderDebug();
                  window.output=document.querySelector('.immediate-output');output.scrollTop=output.scrollHeight;
                }''')
                # Entry discovery precedes first paint; await a non-null buffer
                # rather than throwing inside the readiness predicate.
                page.wait_for_function("presenter.chrome.entries.get(output)?.buffer?.toText().includes('transcript line 79')")
                page.evaluate('''()=>{
                  const entry=presenter.chrome.entries.get(output);
                  assertTUI(entry.state.transcript&&!entry.fallback,'Immediate output not projected');
                  // An inert paint layer must not create native scrollbars or
                  // enlarge scroll extent. Compare with its paint hidden while
                  // retaining the exact same DOM text and DOS font metrics.
                  const geometry=()=>[output.clientWidth,output.clientHeight,output.scrollWidth,output.scrollHeight];
                  const painted=JSON.stringify(geometry());entry.canvas.style.display='none';
                  const native=JSON.stringify(geometry());entry.canvas.style.removeProperty('display');
                  assertTUI(painted===native,'transcript canvas changed native scroll extent: '+painted+' != '+native);
                  const selection=document.getSelection(),range=document.createRange();
                  range.setStart(output.firstChild,output.textContent.lastIndexOf('transcript line 79'));
                  range.setEnd(output.firstChild,output.firstChild.length);selection.removeAllRanges();selection.addRange(range);
                }''')
                page.wait_for_function("presenter.chrome.entries.get(output)?.state.items.some(item=>item.selected)")
                page.get_by_label('Immediate expression', exact=True).fill('? 2 + 3')
                page.wait_for_function("presenter.chrome.entries.get(document.querySelector('.immediate-input-row'))?.buffer?.toText().includes('? 2 + 3')")
                page.evaluate("document.getSelection().removeAllRanges();vb6Studio.debuggerWindows.hide('immediate')")
                page.evaluate('''()=>{
                  assertTUI(JSON.stringify(vb6Studio.project)===modelBefore,'cancel mutated project');
                  vb6Studio.showDebug('locals');
                  window.tree=vb6Studio.debuggerWindows.localsTree;
                  tree.set(Array.from({length:200},(_,i)=>({name:'value'+i,expression:'value'+i,value:String(i),type:'Long'})));
                }''')
                page.wait_for_function("tree.root.querySelector('.debug-value-row[data-tui-chrome-target]')")
                page.evaluate('''()=>{
                  assertTUI(tree.rowHeight===presenter.settings.cellHeight,'debug row pitch differs');
                  assertTUI(parseFloat(tree.spacer.style.height)===200*tree.rowHeight,'virtual spacer kept the old pitch');
                  tree.root.focus();
                }''')
                page.keyboard.press('End')
                page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                page.evaluate('''()=>{
                  assertTUI(tree.selected===199,'original debug keyboard navigation was lost');
                  const row=tree.root.querySelector('[data-expression="value199"]');
                  assertTUI(row&&parseFloat(row.style.top)===199*tree.rowHeight,'selected row was not virtualized at the cell pitch');
                  assertTUI(presenter.chrome.entries.get(row)?.buffer?.toText().includes('value199'),'debug text not projected');
                }''')
                page.evaluate("vb6Studio.debuggerWindows.hide('locals')")
                page.evaluate('''async()=>{
                  await vb6Studio.dosMode.configure({mode:'classic'});
                  assertTUI(document.querySelector('.property-object')===canonicalInput,'classic restore replaced selector');
                  assertTUI(!document.querySelector('.vb-tui-surface,.vb-tui-chrome-surface'),'presentation surface leaked');
                  assertTUI(document.querySelector('.dock-workspace').style.cssText===classicTracks,'canonical docking CSS was overwritten');
                  assertTUI(!document.documentElement.style.getPropertyValue('--tui-desktop-pattern'),'texture lease leaked');
                  assertTUI(tree.rowHeight===19,'classic debug row pitch not restored');
                }''')
                assert not errors, errors
                results.append({'profile': profile, 'dpr': dpr, 'metrics': metrics, 'dialog': dialog, 'passed': True})
            except Exception:
                page.screenshot(path=str(report / ('fidelity-failure-' + label + '.png')))
                (report / ('fidelity-failure-' + label + '.json')).write_text(json.dumps({'errors': errors, 'previous': results, 'transcript': page.evaluate('''()=>{
                  const n=window.output,e=n&&window.presenter?.chrome.entries.get(n),s=document.getSelection(),r=s?.rangeCount?s.getRangeAt(0):null;
                  return n?{client:[n.clientWidth,n.clientHeight],scroll:[n.scrollWidth,n.scrollHeight,n.scrollLeft,n.scrollTop],
                    cells:e?.buffer?.toText(),selected:e?.state?.items.filter(i=>i.selected),
                    selection:r?{start:r.startContainer.nodeName,startOffset:r.startOffset,end:r.endContainer.nodeName,endOffset:r.endOffset,text:s.toString()}:null}:null;
                }''')}, indent=2))
                raise
            finally:
                page.close()
    (report / 'fidelity-matrix.json').write_text(json.dumps(results, indent=2))
    return results
