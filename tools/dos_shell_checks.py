"""Real IDE focus and command regressions for the DOS function-key workspace."""
from playwright.sync_api import Error, expect


def run_shell_checks(browser, root, report):
    page = browser.new_page(viewport={'width': 1440, 'height': 960})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    passed = []
    try:
        page.set_content((root / 'dist/VB6-Studio-Web.html').read_text(), wait_until='load')
        page.wait_for_function('window.vb6Studio?.dosMode')
        page.evaluate('''async () => {
          const ide=vb6Studio;
          ide.setRenderingPolicy({backend:'html'});
          const project=VB6StudioAPI.newProject('DOSShellFixture');
          project.modules[0].code='Option Explicit\\n\\nPrivate Sub Form_Load()\\n    DOSHelper\\nEnd Sub\\n\\nPrivate Sub DOSHelper()\\n    Debug.Print "DOS shell"\\nEnd Sub\\n';
          ide.loadProject(project);
          await ide.command('viewCode');
          window.dosNativeUpdate=ide.updateCommandState;
          await ide.dosMode.configure({mode:'dos',profile:'commander'});
          window.dosShell=ide.dosMode.shell;
          window.dosRecord=dosShell.documents.get(document);
          window.dosInput=ide.editor.input;
          dosInput.focus();dosInput.setSelectionRange(2,5);
          window.dosBefore=JSON.stringify(ide.project);
          window.dosCommands=[];
          window.dosNativeCommand=ide.command;
          ide.command=function(id,...args){dosCommands.push(id);return dosNativeCommand.call(this,id,...args);};
        }''')
        page.wait_for_function('dosRecord.buttons[5].entry?.enabled')
        expect(page.locator('.dos-function-bar')).to_have_count(1)
        expect(page.locator('.dos-function-bar button')).to_have_count(10)
        assert page.evaluate('dosShell.panes(dosRecord).length>=3')

        page.keyboard.down('Shift')
        expect(page.locator('.dos-function-bar')).to_have_attribute('data-dos-modifiers', 'shift')
        expect(page.locator('.dos-function-bar [data-dos-command=stop]')).to_be_disabled()
        expect(page.locator('.dos-function-bar [data-dos-command=viewForm]')).to_have_attribute('aria-keyshortcuts', 'Shift+F7')
        page.evaluate("document.querySelector('.dos-function-bar [data-dos-command=stop]').click()")
        assert not page.evaluate("dosCommands.includes('stop')")
        page.keyboard.up('Shift')
        page.keyboard.down('Control')
        expect(page.locator('.dos-function-bar')).to_have_attribute('data-dos-modifiers', 'control')
        expect(page.locator('.dos-function-bar [data-dos-command=dosNextDocument]')).to_have_attribute('aria-keyshortcuts', 'Control+F6')
        page.keyboard.up('Control')
        expect(page.locator('.dos-function-bar')).to_have_attribute('data-dos-modifiers', 'plain')
        passed.append('ten function-key slots, modifier pages and live menu disablement')

        # The installed editor owns Shift+F2 and Ctrl+Shift+F2 as Definition
        # and Last Position. Exercise both its real key handlers and the strip
        # against the same call site; empty history must disable the latter.
        page.evaluate('''() => {
          window.dosCallOffset=vb6Studio.editor.text.indexOf('DOSHelper')+3;
          vb6Studio.editor.selectGlobal(dosCallOffset);dosCommands.length=0;
        }''')
        assert page.evaluate('vb6Studio.definitionHistory.length') == 0
        page.keyboard.down('Control')
        page.keyboard.down('Shift')
        last_position = page.locator('.dos-function-bar [data-dos-command=lastPosition]')
        expect(last_position).to_be_disabled()
        expect(last_position).to_have_attribute('aria-keyshortcuts', 'Control+Shift+F2')
        page.evaluate("document.querySelector('.dos-function-bar [data-dos-command=lastPosition]').click()")
        assert page.evaluate('dosCommands') == []
        page.keyboard.up('Control')
        definition = page.locator('.dos-function-bar [data-dos-command=goToDefinition]')
        expect(definition).to_be_enabled()
        expect(definition).to_have_attribute('aria-keyshortcuts', 'Shift+F2')
        page.keyboard.press('F2')
        page.wait_for_function('vb6Studio.definitionHistory.length===1&&vb6Studio.editor.cursor().line===7')
        definition_offset = page.evaluate('vb6Studio.editor.cursor().offset')
        page.keyboard.down('Control')
        expect(last_position).to_be_enabled()
        page.keyboard.press('F2')
        page.wait_for_function('vb6Studio.definitionHistory.length===0&&vb6Studio.editor.cursor().offset===dosCallOffset')
        expect(last_position).to_be_disabled()
        page.keyboard.up('Control')
        page.evaluate('dosCommands.length=0')
        definition.click()
        page.wait_for_function('vb6Studio.definitionHistory.length===1')
        assert page.evaluate('vb6Studio.editor.cursor().offset') == definition_offset
        assert page.evaluate('dosCommands') == ['goToDefinition']
        page.keyboard.down('Control')
        expect(last_position).to_be_enabled()
        last_position.click()
        page.wait_for_function('vb6Studio.definitionHistory.length===0&&vb6Studio.editor.cursor().offset===dosCallOffset')
        expect(last_position).to_be_disabled()
        assert page.evaluate('dosCommands') == ['goToDefinition', 'lastPosition']
        page.keyboard.up('Control')
        page.keyboard.up('Shift')
        passed.append('Shift+F2 definition and Ctrl+Shift+F2 history match keyboard and strip activation')

        page.evaluate('''() => {
          dosInput.focus();dosInput.setSelectionRange(2,5);dosCommands.length=0;
          const panes=dosShell.panes(dosRecord),index=panes.findIndex(n=>n.contains(document.activeElement));
          window.dosExpectedPane=panes[(index+1)%panes.length];
        }''')
        page.keyboard.press('F6')
        assert page.evaluate('dosExpectedPane.contains(document.activeElement)')
        assert page.evaluate('dosCommands') == ['dosNextPane']
        page.keyboard.press('Shift+F6')
        assert page.evaluate('document.activeElement===dosInput&&dosInput.selectionStart===2&&dosInput.selectionEnd===5')
        assert page.evaluate('dosCommands') == ['dosNextPane', 'dosPreviousPane']
        passed.append('F6 and Shift+F6 traverse canonical panes and restore native selection')

        page.evaluate('''() => {
          const panes=dosShell.panes(dosRecord),index=panes.findIndex(n=>n.contains(document.activeElement));
          window.dosHiddenPane=panes[(index+1)%panes.length];
          window.dosHiddenBefore=dosHiddenPane.hidden;dosHiddenPane.hidden=true;
          const live=dosShell.panes(dosRecord),i=live.findIndex(n=>n.contains(document.activeElement));
          window.dosExpectedPane=live[(i+1)%live.length];
          const retired=document.createElement('input');dosExpectedPane.append(retired);
          dosShell.focusHistory.set(dosExpectedPane,retired);retired.remove();
        }''')
        page.keyboard.press('F6')
        assert page.evaluate('dosExpectedPane.contains(document.activeElement)&&!dosHiddenPane.contains(document.activeElement)')
        page.evaluate('dosHiddenPane.hidden=dosHiddenBefore;dosInput.focus()')
        passed.append('hidden panes and retired remembered fields are skipped')

        page.evaluate('''() => {
          const mdi=vb6Studio.documents.mdi;
          window.dosMdiCycle=mdi.cycle;window.dosCycles=[];
          mdi.cycle=function(direction){dosCycles.push(direction);return dosMdiCycle.call(this,direction);};
          dosInput.focus();dosCommands.length=0;
        }''')
        page.keyboard.press('Control+F6')
        page.keyboard.press('Control+Shift+F6')
        assert page.evaluate('dosCycles') == [1, -1]
        assert not page.evaluate("dosCommands.some(id=>id==='dosNextPane'||id==='dosPreviousPane')")
        page.evaluate('vb6Studio.documents.mdi.cycle=dosMdiCycle;dosInput.focus();vb6Studio.editor.goToLine(4,5);dosCommands.length=0')
        before_breakpoints = page.evaluate('vb6Studio.breakpoints.length')
        page.keyboard.press('F9')
        assert page.evaluate('vb6Studio.breakpoints.length') == before_breakpoints + 1
        assert page.evaluate("dosCommands.filter(id=>id==='breakpoint').length") == 1
        page.keyboard.press('F9')
        assert page.evaluate('vb6Studio.breakpoints.length') == before_breakpoints
        passed.append('Ctrl+F6 document navigation and F9 dispatch remain owned by the IDE')

        page.evaluate('dosInput.focus();dosInput.setSelectionRange(2,5);dosRecord.buttons[0].button.focus()')
        page.keyboard.press('ArrowRight')
        assert page.evaluate('document.activeElement===dosRecord.buttons[1].button')
        page.keyboard.press('End')
        assert page.evaluate('document.activeElement===dosRecord.buttons[9].button')
        assert page.locator('.dos-function-bar button[tabindex="0"]').count() == 1
        page.keyboard.press('Home')
        page.keyboard.down('Shift')
        page.wait_for_function('document.activeElement===dosRecord.buttons[1].button&&!document.activeElement.disabled')
        page.keyboard.up('Shift')
        page.keyboard.press('Escape')
        assert page.evaluate('document.activeElement===dosInput&&dosInput.selectionStart===2&&dosInput.selectionEnd===5')
        page.evaluate('dosCommands.length=0')
        page.locator('.dos-function-bar [data-dos-command=viewCode]').click()
        assert page.evaluate('dosCommands') == ['viewCode']
        passed.append('roving strip focus, native focus return and single command dispatch')

        page.evaluate("void vb6Studio.command('dosWorkspaceOptions')")
        dialog = page.get_by_role('dialog', name='DOS Workspace Options', exact=True)
        expect(dialog).to_be_visible()
        field = dialog.get_by_role('combobox', name='DOS designer grid', exact=True)
        field.focus()
        page.evaluate('dosCommands.length=0')
        page.keyboard.press('F6')
        expect(field).to_be_focused()
        assert not page.evaluate("dosCommands.includes('dosNextPane')")
        page.keyboard.press('Escape')
        expect(dialog).to_have_count(0)
        passed.append('modal controls retain F6 and normal Escape cancellation')

        # Disposal while the strip has focus returns to the original input and
        # releases only this controller's wrapper/listeners. Re-enabling must not
        # accumulate a second strip or dispatch a second pane command.
        for _ in range(3):
            page.evaluate('dosInput.focus();dosRecord.buttons[0].button.focus()')
            page.evaluate("vb6Studio.dosMode.configure({mode:'classic'})")
            assert page.evaluate('document.activeElement===dosInput')
            assert page.evaluate('vb6Studio.updateCommandState===dosNativeUpdate')
            assert page.locator('.dos-function-bar').count() == 0
            assert page.evaluate('''() => {
              const key=new KeyboardEvent('keydown',{key:'F6',bubbles:true,cancelable:true});
              dosInput.dispatchEvent(key);return !key.defaultPrevented;
            }''')
            page.evaluate('''async () => {
              await vb6Studio.dosMode.configure({mode:'dos',profile:'commander'});
              window.dosShell=vb6Studio.dosMode.shell;window.dosRecord=dosShell.documents.get(document);
              dosInput.focus();dosCommands.length=0;
            }''')
            page.wait_for_function('dosRecord.buttons[5].entry?.enabled')
            page.keyboard.press('F6')
            assert page.evaluate('dosCommands') == ['dosNextPane']
            expect(page.locator('.dos-function-bar')).to_have_count(1)
        passed.append('repeated presentation changes retire listeners and restore native focus')

        page.evaluate("vb6Studio.setWindowMode('hybrid');vb6Studio.command('viewCode');dosInput.focus()")
        with page.expect_popup() as detached:
            page.evaluate('vb6Studio.documents.mdi.detach(vb6Studio.activeDoc.key)')
        popup = detached.value
        popup.wait_for_function("document.querySelector('.browser-window-root')?.dataset.ready==='true'")
        expect(popup.locator('.dos-function-bar')).to_have_count(1)
        assert page.evaluate('dosShell.documents.size===2&&vb6Studio.dosMode.sessions.size===2')
        popup.wait_for_function("document.querySelector('.dos-function-bar').clientHeight>=16&&document.querySelector('.dos-function-bar .vb-tui-chrome-surface')")
        popup.keyboard.down('Shift')
        expect(popup.locator('.dos-function-bar')).to_have_attribute('data-dos-modifiers', 'shift')
        expect(page.locator('.dos-function-bar')).to_have_attribute('data-dos-modifiers', 'plain')
        popup.keyboard.up('Shift')
        with popup.expect_event('close'):
            try:
                popup.get_by_role('button', name='Return to IDE', exact=True).click()
            except Error:
                # Firefox can close the click's realm before acknowledging the
                # input. The close event plus restored live ownership below are
                # required; an error from a surviving popup is never ignored.
                if not popup.is_closed():
                    raise
        page.wait_for_function('dosShell.documents.size===1&&dosInput.ownerDocument===document&&dosInput.isConnected')
        assert page.evaluate('vb6Studio.dosMode.sessions.size===1')
        passed.append('detached windows own independent modifier strips and retire them on return')

        # Native focus callbacks run synchronously. A strip command must verify
        # its availability and ownership after returning focus to its editor.
        page.evaluate('''() => {
          dosInput.focus();dosRecord.buttons[6].button.focus();dosCommands.length=0;
          dosInput.addEventListener('focus',()=>{void vb6Studio.dosMode.options();},{once:true});
          dosRecord.buttons[6].button.click();
        }''')
        expect(dialog).to_be_visible()
        assert page.evaluate('dosCommands') == []
        page.keyboard.press('Escape')
        expect(dialog).to_have_count(0)

        page.evaluate('''async () => {
          vb6Studio.editor.selectGlobal(dosCallOffset);await vb6Studio.command('goToDefinition');
        }''')
        assert page.evaluate('vb6Studio.definitionHistory.length') == 1
        page.keyboard.down('Control')
        page.keyboard.down('Shift')
        expect(last_position).to_be_enabled()
        page.evaluate('''() => {
          dosInput.focus();dosRecord.buttons[1].button.focus();dosCommands.length=0;
          dosInput.addEventListener('focus',()=>{
            vb6Studio.definitionHistory.length=0;vb6Studio.updateCommandState();
          },{once:true});
          dosRecord.buttons[1].button.click();
        }''')
        expect(last_position).to_be_disabled()
        assert page.evaluate('dosCommands') == []
        page.keyboard.up('Control')
        page.keyboard.up('Shift')

        page.evaluate('''() => {
          dosInput.focus();dosRecord.buttons[6].button.focus();dosCommands.length=0;
          window.dosRetiredRecord=dosRecord;
          dosInput.addEventListener('focus',()=>{
            dosShell.detach(document);window.dosRecord=dosShell.attach(document);
          },{once:true});
          dosRetiredRecord.buttons[6].button.click();
        }''')
        assert page.evaluate('dosCommands') == []
        assert page.evaluate('dosRecord!==dosRetiredRecord&&dosRetiredRecord.buttons.length===0&&dosShell.documents.get(document)===dosRecord')
        expect(page.locator('.dos-function-bar')).to_have_count(1)
        passed.append('native focus callbacks cannot dispatch through modal, disabled or replaced shell contexts')

        page.evaluate('dosInput.blur();dosInput.focus()')
        page.wait_for_function('dosRecord.buttons[6].entry?.enabled')
        page.evaluate('dosInput.focus()')
        page.screenshot(path=str(report / 'shell-function-keys.png'), full_page=True)
        page.evaluate('''() => {
          dosRecord.buttons[6].button.focus();dosCommands.length=0;
          dosInput.addEventListener('focus',()=>vb6Studio.dosMode.dispose(),{once:true});
          dosRecord.buttons[6].button.click();
        }''')
        assert page.evaluate('dosCommands') == []
        assert page.evaluate('vb6Studio.dosMode.disposed&&dosShell.disposed&&dosShell.documents.size===0&&vb6Studio.dosMode.sessions.size===0')
        expect(page.locator('.dos-function-bar')).to_have_count(0)
        passed.append('synchronous workspace disposal during native focus return cancels the captured command')
        assert page.evaluate('JSON.stringify(vb6Studio.project)===dosBefore')
        assert not errors, errors
        return {'passed': passed, 'errors': errors}
    except Exception:
        page.screenshot(path=str(report / 'shell-failure.png'), full_page=True)
        raise
    finally:
        page.close()
