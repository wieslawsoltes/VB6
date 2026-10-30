"""Real native editing/focus regressions under the runtime cell presentation.

These checks exercise the production VB6 event path. Their palette assertions
are implementation regressions, not native DOS/vendor screenshot comparisons.
"""
import json
from playwright.sync_api import expect


def run_text_focus_checks(browser, root, report, seed):
    page = browser.new_page(viewport={'width': 1000, 'height': 700})
    errors, results = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        css = (root / 'dist/vb6-controls.css').read_text()
        page.set_content('<!doctype html><html><head><style>' + css +
                         '</style><style>html,body{margin:0;width:100%;height:100%}</style></head><body></body></html>')
        page.add_script_tag(content=(root / 'dist/vb6-runtime.js').read_text())
        page.evaluate('''async seed => {
          const project=structuredClone(seed),module=project.modules[0],templates=module.form.controls;
          project.name='DOSFocus';project.id='dos-focus';project.modules=[module];
          project.startup=module.name;project.settings.anchoring=false;
          Object.assign(module.form.properties,{ClientWidth:8100,ClientHeight:6300,StartUpPosition:0,Left:150,Top:150});
          const fixture=(type,name,properties)=>{
            const control=structuredClone(templates.find(c=>c.type===type));
            if(!control)throw Error('Missing seed control: '+type);
            control.id='dos-focus-'+name;control.name=name;control.parent=null;
            Object.assign(control.properties,{Name:name,Left:240,Width:2700,Height:315,TabStop:-1,Visible:-1,Enabled:-1},properties);
            return control;
          };
          module.form.controls=[
            fixture('TextBox','RightText',{Top:300,Alignment:1,Text:'abc',TabIndex:1}),
            fixture('TextBox','CenterText',{Top:900,Alignment:2,Text:'',TabIndex:2}),
            fixture('TextBox','MultiRight',{Top:1500,Height:1200,MultiLine:-1,Alignment:1,Text:'abc\\n',TabIndex:3}),
            fixture('TextBox','MultiCenter',{Left:3600,Top:1500,Height:1200,MultiLine:-1,Alignment:2,Text:'abc\\n',TabIndex:4}),
            fixture('CheckBox','ChoiceCheck',{Top:3300,Height:480,Caption:'&Choose',Value:0,TabIndex:5}),
            fixture('OptionButton','ChoiceRadio',{Top:4050,Height:480,Caption:'&Radio',Value:0,TabIndex:6}),
            fixture('Slider','Level',{Left:3600,Top:4800,Height:480,Min:0,Max:10,SmallChange:1,Value:4,TabIndex:7}),
            fixture('CommandButton','Commit',{Top:4800,Height:480,Caption:'&Commit',Default:-1,TabIndex:8}),
            fixture('Label','Status',{Left:3600,Top:3300,Width:3600,Height:1500,Caption:'Ready',TabStop:0})
          ];
          module.code='Option Explicit\\nPrivate Sub ChoiceCheck_Click()\\n  Status.Caption = "Check activated"\\nEnd Sub\\n'+
            'Private Sub ChoiceRadio_Click()\\n  Status.Caption = "Radio activated"\\nEnd Sub\\n'+
            'Private Sub Level_Change()\\n  Status.Caption = "Slider changed"\\nEnd Sub\\n'+
            'Private Sub Commit_Click()\\n  Status.Caption = "Commit activated"\\nEnd Sub\\n';
          const container=document.createElement('div');container.style.cssText='width:900px;height:650px';document.body.append(container);
          window.focusHost=await VB6Runtime.mountApplication(project,container,{persist:false,rendering:false,nativeWindows:false,
            presentation:{mode:'dos',profile:'turbo',formLayout:'authored',editing:'cells'}});
          window.control=name=>focusHost.forms[0].controls.find(c=>c.model.name===name);
          window.focusOriginals=focusHost.forms[0].controls.map(c=>({control:c,node:c.node,input:c.input}));
          window.focusProjectBefore=JSON.stringify(focusHost.project);
          window.paint=name=>focusHost.tuiPresentation.controls.get(control(name).node);
          window.assertTUI=(condition,message)=>{if(!condition)throw Error(message);};
        }''', seed)
        page.wait_for_function("paint('ChoiceCheck')?.buffer && paint('MultiRight')?.buffer")

        def settle():
            page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')

        right = page.locator('[data-control="RightText"] input')
        center = page.locator('[data-control="CenterText"] input')
        check = page.locator('[data-control="ChoiceCheck"] input')
        radio = page.locator('[data-control="ChoiceRadio"] input')
        slider = page.locator('[data-control="Level"] input')
        for profile in ['turbo', 'commander', 'win31', 'monochrome']:
            page.evaluate('''profile=>{
              focusHost.setPresentation({mode:'dos',profile,formLayout:'authored',editing:'cells'});
              control('ChoiceRadio').set('Value',0);control('Level').set('Value',4);control('Status').set('Caption','Ready');
            }''', profile)
            right.focus()
            right.press('End')
            settle()
            page.evaluate('''()=>{
              const entry=paint('RightText'),buffer=entry.buffer,field=VB6Runtime.RuntimeAPI.TUI.tuiAttribute(focusHost.tuiPresentation.settings.profile,'field');
              assertTUI(buffer.toText().split('\\n')[0].endsWith('abc'),'right-aligned text moved');
              assertTUI(buffer.colors[buffer.columns-1]===(field.background|(field.foreground<<4)),'right-edge caret disappeared');
              assertTUI(control('RightText').input.selectionStart===3&&control('RightText').input.selectionEnd===3,'native caret changed');
            }''')
            center.focus()
            settle()
            page.evaluate('''()=>{
              const buffer=paint('CenterText').buffer,field=VB6Runtime.RuntimeAPI.TUI.tuiAttribute(focusHost.tuiPresentation.settings.profile,'field');
              assertTUI(buffer.colors[Math.floor(buffer.columns/2)]===(field.background|(field.foreground<<4)),'empty centered caret was left-aligned');
            }''')
            for name, alignment in [('MultiRight', 'right'), ('MultiCenter', 'center')]:
                field = page.locator('[data-control="' + name + '"] textarea')
                field.fill('abc\n')
                field.press('Control+End')
                settle()
                page.evaluate('''({name,alignment})=>{
                  const buffer=paint(name).buffer,field=VB6Runtime.RuntimeAPI.TUI.tuiAttribute(focusHost.tuiPresentation.settings.profile,'field');
                  const x=alignment==='right'?buffer.columns-1:Math.floor(buffer.columns/2);
                  assertTUI(buffer.colors[buffer.columns+x]===(field.background|(field.foreground<<4)),'trailing empty-line caret lost alignment');
                }''', {'name': name, 'alignment': alignment})
                field.fill('abc\nnext')
                field.press('Control+Home')
                settle()
                before = page.evaluate('(name)=>Array.from(paint(name).buffer.glyphs)', name)
                field.press('Shift+End')
                field.press('Shift+ArrowRight')
                settle()
                assert field.evaluate('input=>[input.selectionStart,input.selectionEnd]') == [0, 4]
                assert page.evaluate('(name)=>Array.from(paint(name).buffer.glyphs)', name) == before, alignment

            right.focus()
            settle()
            normal_check = page.evaluate("paint('ChoiceCheck').buffer.snapshot()")
            check.focus()
            check.press('Shift+Tab')
            page.keyboard.press('Tab')
            expect(check).to_be_focused()
            settle()
            focused_check = page.evaluate("paint('ChoiceCheck').buffer.snapshot()")
            assert focused_check['glyphs'] == normal_check['glyphs']
            assert focused_check['colors'] != normal_check['colors'], profile
            value = check.is_checked()
            page.keyboard.press('Space')
            expect(check).to_be_checked(checked=not value)
            page.wait_for_function("control('Status').get('Caption')==='Check activated'")
            assert page.evaluate("control('ChoiceCheck').get('Value')") == (0 if value else 1)

            page.evaluate("control('Status').set('Caption','Ready')")
            settle()
            normal_radio = page.evaluate("paint('ChoiceRadio').buffer.snapshot()")
            check.press('Tab')
            expect(radio).to_be_focused()
            settle()
            focused_radio = page.evaluate("paint('ChoiceRadio').buffer.snapshot()")
            assert focused_radio['glyphs'] == normal_radio['glyphs']
            assert focused_radio['colors'] != normal_radio['colors'], profile
            page.keyboard.press('Space')
            expect(radio).to_be_checked()
            page.wait_for_function("control('Status').get('Caption')==='Radio activated'")
            assert page.evaluate("control('ChoiceRadio').get('Value')") == -1

            page.evaluate("control('Status').set('Caption','Ready')")
            settle()
            normal_slider = page.evaluate("paint('Level').buffer.snapshot()")
            radio.press('Tab')
            expect(slider).to_be_focused()
            settle()
            focused_slider = page.evaluate("paint('Level').buffer.snapshot()")
            assert focused_slider['glyphs'] == normal_slider['glyphs']
            assert focused_slider['colors'] != normal_slider['colors'], profile
            expect(slider).to_have_value('4')
            page.keyboard.press('ArrowRight')
            expect(slider).to_have_value('5')
            page.wait_for_function("control('Level').get('Value')===5&&control('Status').get('Caption')==='Slider changed'")
            settle()
            assert page.evaluate("Array.from(paint('Level').buffer.glyphs)") != focused_slider['glyphs'], profile

            page.locator('[data-control="Commit"]').click()
            page.wait_for_function("control('Status').get('Caption')==='Commit activated'")
            settle()
            page.evaluate('''()=>{
              assertTUI(focusOriginals.every(saved=>saved.control.node===saved.node&&saved.control.input===saved.input),'paint replaced native controls');
              assertTUI(JSON.stringify(focusHost.project)===focusProjectBefore,'presentation edited authored project');
              const presenter=focusHost.tuiPresentation;
              assertTUI(!presenter.metrics.failures&&!presenter.metrics.budgetFallbacks,'runtime focus paint failed');
            }''')
            results.append({'profile': profile, 'alignedCarets': True, 'selectionKeepsGeometry': True,
                            'nativeTabSpace': True, 'vbClickEvents': True, 'nativeRangeArrow': True,
                            'vbChangeEvents': True, 'controlIdentity': True})
        page.screenshot(path=str(report / 'text-focus.png'))
        page.evaluate('''()=>{
          focusHost.setPresentation({mode:'classic'});
          assertTUI(!focusHost.stage.querySelector('.vb-tui-surface'),'classic retained cell paint');
          assertTUI(focusOriginals.every(saved=>saved.control.node===saved.node&&saved.control.input===saved.input),'classic restoration replaced native controls');
          focusHost.dispose();
        }''')
        assert not errors, errors
        result = {'passed': True, 'profiles': results, 'errors': errors,
                  'transport': 'memory', 'scope': 'Native DOM and VB6 event regressions; no vendor-pixel certification.'}
        (report / 'text-focus.json').write_text(json.dumps(result, indent=2))
        return result
    finally:
        page.close()
