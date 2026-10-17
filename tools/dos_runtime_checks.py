"""Runtime-only TUI regression cases using the production runtime, no mock VM.

All browser engines execute the same isolated fixtures. Assertions inspect both
canonical controls and retained paint; snapshots alone do not certify behavior.
"""
import json
from playwright.sync_api import expect


def run_runtime_checks(browser, root, report, seed):
    page = browser.new_page(viewport={'width': 1600, 'height': 1100})
    errors, passed = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        css = (root / 'dist/vb6-controls.css').read_text()
        page.set_content('<!doctype html><html><head><style>' + css +
                         '</style><style>html,body{margin:0;width:100%;height:100%}</style></head><body></body></html>')
        page.add_script_tag(content=(root / 'dist/vb6-runtime.js').read_text())
        page.evaluate('''async seed => {
          window.runtimeMessages=[];
          window.control=(host,name)=>host.forms[0].controls.find(c=>c.model.name===name);
          window.assertTUI=(value,message)=>{if(!value)throw Error(message);};
          window.makeProject=(name)=>{
            const p=structuredClone(seed);p.id=name;p.name=name;
            const m=p.modules[0];
            Object.assign(m.form.properties,{ClientWidth:6600,ClientHeight:11000,StartUpPosition:0,Left:0,Top:0});
            const types=['TextBox','CommandButton','CheckBox','ListBox','Slider','Toolbar','MonthView'];
            m.form.controls=m.form.controls.filter(c=>types.includes(c.type));
            const bounds=[[150,150,2055,495],[150,750,2055,450],[150,1350,3000,450],
              [150,1950,2055,1650],[3000,150,450,2100],[150,3900,4200,450],[150,4650,4200,2850]];
            for(let i=0;i<types.length;i++){
              const c=m.form.controls.find(c=>c.type===types[i]),[Left,Top,Width,Height]=bounds[i];
              Object.assign(c.properties,{Left,Top,Width,Height});
              if(c.type==='Slider')Object.assign(c.properties,{Orientation:1,Min:0,Max:100,Value:25});
            }
            const password=structuredClone(m.form.controls.find(c=>c.type==='TextBox'));
            password.id+='password';password.name='PasswordTest';
            Object.assign(password.properties,{Left:150,Top:7800,Text:'secret-password',PasswordChar:'*'});
            m.form.controls.push(password);return p;
          };
          window.mountHost=async(name,left,presentation,parent=document.body,direct=false)=>{
            const container=document.createElement('div');container.id=name;
            container.style.cssText=`position:absolute;left:${left}px;top:0;width:500px;height:1050px`;
            parent.append(container);
            const project=makeProject(name),options={presentation,persist:false,rendering:false,nativeWindows:false,
              onMessage:message=>runtimeMessages.push({host:name,...message})};
            let host;
            if(direct){host=new VB6Runtime.RuntimeAPI.ApplicationHost(project,container,options);await host.start();}
            else host=await VB6Runtime.mountApplication(project,container,options);
            return host;
          };
          window.a=await mountHost('A',0,{mode:'dos',profile:'turbo'},document.body,true);
          window.b=await mountHost('B',520,{mode:'dos',profile:'commander'});
          window.c=await mountHost('C',1040,{mode:'classic'});
        }''', seed)
        page.wait_for_function('a.tuiPresentation.snapshot().length>=6 && b.tuiPresentation.snapshot().length>=6')

        def checked(name, expression):
            page.evaluate(expression)
            passed.append(name)

        checked('independent runtime roots, direct constructor and native sibling', '''() => {
          assertTUI(a.tuiPresentation!==b.tuiPresentation,'presenters were shared');
          assertTUI(a.stage.dataset.vbDos==='turbo'&&b.stage.dataset.vbDos==='commander','palettes were overwritten');
          assertTUI(c.tuiPresentation===null&&!c.stage.querySelector('.vb-tui-surface'),'classic application was painted');
          assertTUI(!document.documentElement.hasAttribute('data-vb-dos'),'runtime rethemed the document');
          assertTUI(document.querySelectorAll('#vb6-tui-style').length===1,'stylesheet is not shared');
        }''')
        # Actual VB6 event, not a DOM-side test handler. Verify the form remains
        # live as well as waiting for the asynchronous control refresh.
        button = page.locator('#A [data-control="CommandButtonTest"]')
        text = page.locator('#A [data-control="TextBoxTest"] input')
        button.click()
        expect(text).to_have_value('DOS event works')
        checked('real pointer activation executes VB6 and retains the runtime', '''() => {
          assertTUI(!a.disposed&&a.vm.state!=='stopped','runtime stopped after click');
          assertTUI(control(a,'TextBoxTest').get('Text')==='DOS event works','VM value differs');
        }''')
        text.fill('Live native editor')
        expect(text).to_have_value('Live native editor')
        checked('editing keeps the original input and event state', '''() => {
          window.originalInput=control(a,'TextBoxTest').input;
          assertTUI(control(a,'TextBoxTest').get('Text')==='Live native editor','input did not update VB6');
          control(a,'CommandButtonTest').SetFocus();
        }''')
        # Drain existing focus/scroll paints before the property-only update.
        # Firefox can retain or adjust its native horizontal viewport on blur.
        # The new value must paint through that viewport, including clipped
        # leading characters, rather than depending on a visible text prefix.
        page.evaluate('originalInput.scrollLeft=0')
        page.wait_for_function('a.tuiPresentation.frame===0')
        page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        page.evaluate("control(a,'TextBoxTest').set('Text','Property-only repaint')")
        page.wait_for_function('''() => {
          const c=control(a,'TextBoxTest'),entry=a.tuiPresentation.controls.get(c.node);
          const value='Property-only repaint';
          if(c.input.value!==value||!entry?.buffer)return false;
          const column=Math.max(0,Math.floor(c.input.scrollLeft/entry.painter.cellWidth));
          const visible=value.slice(column,column+entry.buffer.columns);
          return visible.length>=8&&entry.buffer.toText().split('\\n')[0]===visible.padEnd(entry.buffer.columns,' ');
        }''')
        checked('materialization invalidation paints .value changes without input events', '''() => {
          assertTUI(control(a,'TextBoxTest').input===originalInput,'input was replaced');
          const node=control(a,'TextBoxTest').node,entry=a.tuiPresentation.controls.get(node);
          assertTUI(entry.buffer.columns===Math.ceil(node.clientWidth/8),'wrong column quantization');
          assertTUI(entry.painter.cellWidth===8&&parseFloat(entry.canvas.style.width)===node.clientWidth,'cell viewport was stretched');
          assertTUI(entry.canvas.width===Math.round(node.clientWidth*devicePixelRatio),'partial cells were not clipped in the backing bitmap');
          assertTUI(entry.canvas.style.clipPath.includes('inset'),'partial cells are not clipped');
          assertTUI(!a.tuiPresentation.snapshot().some(s=>s.glyphs.map(n=>String.fromCodePoint(n)).join('').includes('secret-password')),'password leaked into snapshot');
        }''')
        checked('vertical slider preserves the native direction and live values', '''() => {
          const slider=control(a,'SliderTest');slider.set('Value',100);slider.refresh();
          a.tuiPresentation.flush();
          const buffer=a.tuiPresentation.controls.get(slider.node).buffer;
          const row=Math.floor(Array.from(buffer.glyphs).indexOf('█'.codePointAt(0))/buffer.columns);
          assertTUI(slider.input.getAttribute('aria-orientation')==='vertical','native orientation missing');
          assertTUI(row===1,'maximum value is not at the top');
        }''')
        # A nested classic host has an explicit ownership boundary, so the outer
        # renderer must not discover and repaint its controls later via mutations.
        page.evaluate('''async()=>{
          window.nested=await mountHost('Nested',240,{mode:'classic'},a.stage);
          nested.container.style.top='570px';nested.container.style.width='220px';nested.container.style.height='400px';
        }''')
        page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        checked('nested classic host remains native', '''() => {
          assertTUI(!nested.stage.querySelector('.vb-tui-surface'),'nested native controls were discovered');
          assertTUI(![...a.tuiPresentation.controls.keys()].some(n=>nested.stage.contains(n)),'outer ownership crossed a host boundary');
          const normal=control(c,'CommandButtonTest').node,inner=control(nested,'CommandButtonTest').node;
          assertTUI(getComputedStyle(normal).backgroundColor===getComputedStyle(inner).backgroundColor,'native appearance inherited TUI paint');
          nested.dispose();nested.container.remove();
        }''')
        checked('live presentation switching preserves geometry and identity', '''() => {
          const nodes=[c.forms[0].node,...c.forms[0].controls.map(control=>control.node)],project=JSON.stringify(c.project);
          const bounds=()=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];});
          const before=JSON.stringify(bounds());
          c.setPresentation({mode:'dos',profile:'win31',cellWidth:9,cellHeight:18});c.tuiPresentation.flush();
          assertTUI(before===JSON.stringify(bounds()),'presentation changed a hit rectangle');
          assertTUI(project===JSON.stringify(c.project),'presentation changed the model');
          assertTUI(nodes.every(n=>n.isConnected),'control identity was lost');
          c.setPresentation({mode:'classic'});
          assertTUI(before===JSON.stringify(bounds()),'restoration changed geometry');
          assertTUI(!c.stage.querySelector('.vb-tui-surface'),'classic transition leaked canvases');
        }''')
        page.wait_for_function('a.tuiPresentation.frame===0&&b.tuiPresentation.frame===0')
        before = page.evaluate('[a.tuiPresentation.metrics.frames,b.tuiPresentation.metrics.frames]')
        # Advance real frames, not a guessed timeout. There is no animation clock
        # in this fixture, so an unchanged tree must remain completely quiescent.
        page.evaluate('new Promise(resolve=>{let frames=12;function next(){if(--frames)requestAnimationFrame(next);else resolve();}requestAnimationFrame(next);})')
        assert before == page.evaluate('[a.tuiPresentation.metrics.frames,b.tuiPresentation.metrics.frames]'), 'TUI redraws continuously while idle'
        passed.append('idle trees do not schedule repaint loops')
        checked('disposing one host retains its sibling and shared stylesheet', '''() => {
          window.aRenderer=a.tuiPresentation;window.bRenderer=b.tuiPresentation;
          a.dispose();a.dispose();
          assertTUI(aRenderer.disposed&&!aRenderer.controls.size&&!aRenderer.frame,'host disposal retained resources');
          assertTUI(!bRenderer.disposed&&b.stage.querySelector('.vb-tui-surface'),'sibling was disposed');
          assertTUI(!!document.getElementById('vb6-tui-style'),'shared stylesheet was removed too early');
          assertTUI(!a.stage.hasAttribute('data-tui-boundary'),'stage marker was retained after disposal');
        }''')
        page.evaluate('b.container.remove()')
        page.wait_for_function('bRenderer.disposed')
        checked('detached roots retire observers and the last stylesheet lease', '''() => {
          assertTUI(!bRenderer.controls.size&&!bRenderer.frame,'detached root retained resources');
          b.dispose();c.dispose();
          assertTUI(!document.getElementById('vb6-tui-style'),'last stylesheet lease leaked');
          assertTUI(!document.querySelector('.vb-tui-surface'),'canvases leaked');
        }''')
        assert not errors, errors
        (report / 'runtime-lifecycle.json').write_text(json.dumps({'passed': passed, 'errors': errors}, indent=2))
        return passed
    except Exception:
        page.screenshot(path=str(report / 'runtime-lifecycle-failure.png'), full_page=True)
        (report / 'runtime-lifecycle-failure.json').write_text(json.dumps({'passed': passed, 'errors': errors,
            'runtime': page.evaluate('''()=>({messages:window.runtimeMessages,hosts:[window.a,window.b,window.c].filter(Boolean).map(h=>({name:h.project.name,state:h.vm?.state,disposed:h.disposed,presentation:h.tuiPresentation?.settings,metrics:h.tuiPresentation?.metrics,controls:h.forms[0]?.controls.map(c=>({name:c.model.name,connected:c.node.isConnected,html:c.node.outerHTML.slice(0,1000)}))}))})''')}, indent=2))
        raise
    finally:
        page.evaluate('()=>{for(const host of [window.a,window.b,window.c,window.nested])host?.dispose();}')
        page.close()
