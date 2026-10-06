#!/usr/bin/env python3
"""Real integration regressions for modeless tools, source transactions and 0.4 runtime."""
import importlib.util,json,os,shutil,sys,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('base_suite',ROOT/'tools/browser-tests.py');suite=importlib.util.module_from_spec(spec);spec.loader.exec_module(suite)
check=suite.check;case=suite.case
REPORTS=ROOT/'reports/features-04';REPORTS.mkdir(parents=True,exist_ok=True)
PROJECT={"schema":1,"id":"feature-project","name":"FeatureLab","startup":"Sub Main","settings":{"renderer":"canvas2d"},"modules":[
 {"id":"main","name":"MainModule","kind":"module","code":'Option Explicit\n\nPublic Sub Main()\n    Debug.Print "needle 😀"\nEnd Sub\n\nPublic Function Greeting(Optional name As String = "World") As String\n    Greeting = "Hello " & name\nEnd Function\n'},
 {"id":"other","name":"OtherModule","kind":"module","code":'Option Explicit\nPublic Const Needle = 2\nPublic Function ReadValue() As String\n    ReadValue = "needle"\nEnd Function\n'},
 {"id":"counter","name":"Counter","kind":"class","code":'Option Explicit\nPrivate hidden As Long\nPublic Function Increment() As Long\n    Static value As Long\n    value = value + 1\n    Increment = value\nEnd Function\nPrivate Sub Secret()\nEnd Sub\n'}]}

def boot(browser,project=True,size=(1440,960)):
 page=suite.open_ide(browser)
 page.set_viewport_size({'width':size[0],'height':size[1]})
 if project:page.evaluate('p=>vb6Studio.loadProject(p)',PROJECT)
 return page

def finish(page):suite.healthy(page);page.close()
def browser_tool(page):page.evaluate('()=>{vb6Studio.objectBrowser();}');return page.locator('.classic-object-browser')
def search_tool(page):page.evaluate('()=>{vb6Studio.projectSearch(true);}');return page.locator('.project-search-window')
def search(page,query='needle'):
 search_tool(page);page.get_by_label('Find in project',exact=True).fill(query);page.get_by_label('Find all in project',exact=True).click()

def test_modeless(browser):
 p=boot(browser);browser_tool(p);check(p.locator('.ide-modal-cover').count()==0);check(p.evaluate('vb6Studio.documents.mdi.active')=='tool:object-browser');p.evaluate('vb6Studio.openDocument("other","code")');p.evaluate('vb6Studio.editor.setValue(vb6Studio.editor.text+"\\nPublic Sub Added()\\nEnd Sub")');browser_tool(p);p.get_by_label('Object Browser search',exact=True).fill('Added');p.get_by_role('button',name='Search',exact=True).click();check('Added' in p.get_by_label('Member definition',exact=True).inner_text());finish(p)
def test_library(browser):
 p=boot(browser);browser_tool(p);p.get_by_label('Object Browser library').select_option('FeatureLab');check(p.get_by_label('Object Browser classes',exact=True).locator('[role="option"]').count()==3);p.get_by_label('Object Browser classes',exact=True).get_by_text('Counter',exact=True).click();p.get_by_label('Private members').uncheck();check('Secret' not in p.get_by_label('Object Browser members',exact=True).inner_text());p.get_by_label('Private members').check();check('Secret' in p.get_by_label('Object Browser members',exact=True).inner_text());finish(p)
def test_signatures(browser):
 p=boot(browser);browser_tool(p);p.get_by_label('Object Browser search',exact=True).fill('DateDiff');p.get_by_role('button',name='Search',exact=True).click();text=p.get_by_label('Member definition',exact=True).inner_text();check('DateDiff(interval As Variant, date1 As Variant, date2 As Variant, Optional firstdayofweek As VbDayOfWeek, Optional firstweekofyear As VbFirstWeekOfYear) As Long' in text);p.screenshot(path=str(REPORTS/'object-browser-classic.png'));finish(p)
def test_definition(browser):
 p=boot(browser);browser_tool(p);p.get_by_label('Object Browser library').select_option('FeatureLab');p.get_by_label('Object Browser search',exact=True).fill('Greeting');p.get_by_role('button',name='Search',exact=True).click();p.get_by_label('View definition',exact=True).click();check(p.evaluate('vb6Studio.activeModule.id')=='main');check(p.evaluate('vb6Studio.editor.cursor().line')==7);check(p.locator('.classic-object-browser').count()==1);finish(p)
def test_history(browser):
 p=boot(browser);browser_tool(p);p.get_by_label('Object Browser library').select_option('FeatureLab');classes=p.get_by_label('Object Browser classes',exact=True);classes.get_by_text('MainModule',exact=True).click();classes.get_by_text('OtherModule',exact=True).click();p.get_by_label('Object Browser Back',exact=True).click();check(p.evaluate('vb6Studio.documents.tools.get("tool:object-browser").currentClass.name')=='MainModule');p.get_by_label('Object Browser Forward',exact=True).click();check(p.evaluate('vb6Studio.documents.tools.get("tool:object-browser").currentClass.name')=='OtherModule');finish(p)
def test_close(browser):
 p=boot(browser);browser_tool(p);p.get_by_label('Object Browser search',exact=True).focus();p.keyboard.press('Control+F4');check(p.locator('.classic-object-browser').count()==0);check(p.evaluate('vb6Studio.docs.length')==1);browser_tool(p);p.evaluate('vb6Studio.command("closeAll")');check(p.evaluate('vb6Studio.documents.mdi.windows.size')==0);check(p.evaluate('vb6Studio.documents.tools.size')==0);finish(p)
def test_refresh(browser):
 p=boot(browser);browser_tool(p);p.get_by_label('Object Browser search',exact=True).focus();p.keyboard.press('F5');check(p.evaluate('vb6Studio.runState')=='design');p.evaluate('vb6Studio.project.modules[0].code="#If x\\nPublic Sub Incomplete()\\n"');p.get_by_label('Refresh Object Browser').click();check(p.locator('.classic-object-browser').is_visible());finish(p)
def test_tool_layout(browser):
 p=boot(browser);browser_tool(p);p.evaluate('vb6Studio.renderAll()');check(p.evaluate('vb6Studio.documents.mdi.active')=='tool:object-browser');p.get_by_label('Object Browser search',exact=True).focus();p.keyboard.press('Control+F10');check(p.evaluate('vb6Studio.documents.mdi.windows.get("tool:object-browser").maximized'));p.keyboard.press('Control+F10');before=p.locator('.object-columns>section').first.bounding_box()['width'];p.get_by_label('Object Browser column splitter').focus();p.keyboard.press('ArrowRight');check(p.locator('.object-columns>section').first.bounding_box()['width']>before);finish(p)
def test_reset(browser):
 p=boot(browser);browser_tool(p);search_tool(p);p.evaluate('p=>vb6Studio.loadProject(p)',PROJECT);check(p.evaluate('vb6Studio.documents.tools.size')==0);check(p.locator('.tool-list').count()==0);finish(p)
def test_search_navigation(browser):
 p=boot(browser);search(p);check(p.evaluate('vb6Studio.documents.tools.get("tool:project-search").result.hits.length')==3);p.get_by_label('Project search results',exact=True).focus();p.keyboard.press('End');p.keyboard.press('Enter');check(p.evaluate('vb6Studio.activeModule.id')=='other');check(p.evaluate('vb6Studio.editor.input.value.slice(vb6Studio.editor.input.selectionStart,vb6Studio.editor.input.selectionEnd)')=='needle');p.evaluate('vb6Studio.projectSearch(true)');p.screenshot(path=str(REPORTS/'project-search.png'));finish(p)
def test_replace_undo(browser):
 p=boot(browser);original=p.evaluate('JSON.stringify(vb6Studio.project.modules)');search(p);p.get_by_label('Project replacement text',exact=True).fill('thread');p.get_by_label('Replace all in project',exact=True).click();check('3 replacements' in p.locator('.project-search-window .tool-status').inner_text());check(p.evaluate('vb6Studio.project.modules.every(m=>!m.code.toLowerCase().includes("needle"))'));p.evaluate('vb6Studio.command("undo")');check(p.evaluate('JSON.stringify(vb6Studio.project.modules)')==original);p.evaluate('vb6Studio.command("redo")');check(p.evaluate('vb6Studio.project.modules[0].code.includes("thread")'));finish(p)
def test_stale_replace(browser):
 p=boot(browser);search(p);p.get_by_label('Project replacement text',exact=True).fill('wrong');p.evaluate('vb6Studio.project.modules[2].code+="\\n"');before=p.evaluate('JSON.stringify(vb6Studio.project)');p.get_by_label('Replace all in project',exact=True).click();check('changed' in p.locator('.project-search-window .tool-status').inner_text());check(p.evaluate('JSON.stringify(vb6Studio.project)')==before);finish(p)
def test_options_replace(browser):
 p=boot(browser);search(p);p.get_by_label('Match Case',exact=True).check();p.get_by_label('Replace all in project',exact=True).click();check('options changed' in p.locator('.project-search-window .tool-status').inner_text());p.get_by_label('Find all in project',exact=True).click();check(p.evaluate('vb6Studio.documents.tools.get("tool:project-search").result.hits.length')==2);finish(p)
def test_search_guard(browser):
 p=boot(browser);search_tool(p);p.get_by_label('Replace all in project',exact=True).click();check('Find All first' in p.locator('.project-search-window .tool-status').inner_text());search(p);p.evaluate('vb6Studio.runState="running";vb6Studio.documents.tools.get("tool:project-search").replace()');check('End the running program' in p.locator('.project-search-window .tool-status').inner_text());p.evaluate('vb6Studio.runState="design"');finish(p)
def test_search_shortcut(browser):
 p=boot(browser);p.evaluate('vb6Studio.editor.input.focus()');p.keyboard.press('Control+Shift+f');check(p.get_by_label('Find in project',exact=True).is_visible());check(p.locator('.editor-find:not([hidden])').count()==0);p.get_by_label('Find in project',exact=True).fill('needle');p.keyboard.press('Enter');check(p.evaluate('vb6Studio.documents.tools.get("tool:project-search").result.hits.length')==3);finish(p)
def test_search_scope(browser):
 p=boot(browser);search_tool(p);p.get_by_label('Search scope',exact=True).select_option('module');p.get_by_label('Find in project',exact=True).fill('needle');p.get_by_label('Find all in project',exact=True).click();check(p.evaluate('vb6Studio.documents.tools.get("tool:project-search").result.hits.length')==1);finish(p)
def test_search_large(browser):
 p=boot(browser);p.evaluate('vb6Studio.project.modules[0].code="needle\\n".repeat(25000)');search(p);check(p.evaluate('vb6Studio.documents.tools.get("tool:project-search").result.truncated'));check(p.locator('[aria-label="Project search results"] [role="option"]').count()<50);p.get_by_label('Project search results',exact=True).focus();p.keyboard.press('End');check(p.evaluate('vb6Studio.documents.tools.get("tool:project-search").list.selected')==19999);p.get_by_label('Replace all in project',exact=True).click();check('limit' in p.locator('.project-search-window .tool-status').inner_text());finish(p)
def test_bookmark_edit(browser):
 p=boot(browser);p.evaluate('vb6Studio.editor.goToLine(4)');p.keyboard.press('Control+F2');check(p.evaluate('vb6Studio.activeModule.bookmarks')==[4]);p.evaluate('vb6Studio.editor.setValue("\\n"+vb6Studio.editor.text)');check(p.evaluate('vb6Studio.activeModule.bookmarks')==[5]);p.evaluate('vb6Studio.command("undo")');check(p.evaluate('vb6Studio.activeModule.bookmarks')==[4]);p.evaluate('vb6Studio.command("redo")');check(p.evaluate('vb6Studio.activeModule.bookmarks')==[5]);finish(p)
def test_bookmark_navigation(browser):
 p=boot(browser);p.evaluate('vb6Studio.toggleBookmark("main",4);vb6Studio.toggleBookmark("other",4);vb6Studio.openDocument("main","code",4)');p.keyboard.press('Control+Alt+F2');check(p.evaluate('vb6Studio.activeModule.id')=='other');p.keyboard.press('Control+Alt+Shift+F2');check(p.evaluate('vb6Studio.activeModule.id')=='main');p.evaluate('vb6Studio.clearBookmarks()');check(p.evaluate('vb6Studio.project.modules.every(m=>!m.bookmarks?.length)'));finish(p)
def test_bookmark_gutter(browser):
 p=boot(browser);p.evaluate('vb6Studio.editor.toggleSplit(true)');g=p.locator('.code-pane-view').first.locator('.gutter-line[data-line="4"]');g.click(modifiers=['Control']);check(p.locator('.gutter-line[data-line="4"].has-bookmark').count()==2);check(p.evaluate('vb6Studio.breakpoints.length')==0);g.click();check(p.locator('.gutter-line[data-line="4"].has-bookmark.has-breakpoint').count()==2);p.screenshot(path=str(REPORTS/'bookmarks-split.png'));finish(p)
def test_bookmark_source_undo(browser):
 p=boot(browser);p.evaluate('vb6Studio.toggleBookmark("main",4)');search(p);p.get_by_label('Project replacement text',exact=True).fill('two\nlines');p.get_by_label('Replace all in project',exact=True).click();p.evaluate('vb6Studio.command("undo")');check(p.evaluate('vb6Studio.project.modules[0].bookmarks')==[4]);finish(p)
def test_object_keyboard(browser):
 p=boot(browser);browser_tool(p);p.get_by_label('Object Browser library').select_option('FeatureLab');p.get_by_label('Object Browser classes',exact=True).focus();p.keyboard.press('End');check(p.evaluate('vb6Studio.documents.tools.get("tool:object-browser").currentClass.name')=='OtherModule');p.get_by_label('Object Browser members',exact=True).focus();p.keyboard.press('End');p.keyboard.press('Enter');check(p.evaluate('vb6Studio.activeModule.id')=='other');finish(p)
def test_themes(browser,theme):
 p=boot(browser);p.evaluate('t=>{vb6Studio.appearance.theme=t;vb6Studio.applyAppearance();}',theme);browser_tool(p);p.get_by_label('Object Browser library').select_option('FeatureLab');p.screenshot(path=str(REPORTS/f'object-browser-{theme}.png'));check(p.locator('.classic-object-browser').is_visible());finish(p)
def test_narrow(browser):
 p=boot(browser,size=(390,844));browser_tool(p);box=p.locator('.mdi-window[data-mdi-key="tool:object-browser"]').bounding_box();check(box['x']>=0 and box['x']+box['width']<=391);p.get_by_label('Object Browser search',exact=True).fill('Mid');p.get_by_role('button',name='Search',exact=True).click();check('Mid(' in p.get_by_label('Member definition',exact=True).inner_text());p.screenshot(path=str(REPORTS/'object-browser-narrow.png'));finish(p)
def test_source_script_text(browser):
 p=boot(browser);p.evaluate('vb6Studio.project.modules[0].code="Public Sub X()\\n\\\"</pre><img src=x onerror=alert(1)>\\\"\\nEnd Sub"');browser_tool(p);check(p.locator('.classic-object-browser img').count()==0);finish(p)
def test_runtime_export(browser):
 p=boot(browser,False)
 p.evaluate('''()=>{const api=VB6StudioAPI,p=api.newProject('RuntimeCompatibility');p.settings.renderer='canvas2d';p.modules[0].form.controls=[api.createControl('Label','Result',300,300)];p.modules[0].code=`Option Explicit
Private Sub Form_Load()
Dim a As New Counter, b As New Counter
Dim e As Variant
e = CVErr(2001)
CallByName Result, "Caption", vbLet, CStr(CallByName(a, "NextValue", vbMethod)) & ":" & CStr(b.NextValue()) & ":" & CStr(Day(DateAdd("yyyy",1,#2024-02-29#))) & ":" & CStr(IsError(e)) & ":" & CStr(Named(right:="R", left:="L"))
End Sub
Private Function Named(left As String, right As String) As String
Named = left & right
End Function`;p.modules.push({id:'counter-runtime',name:'Counter',kind:'class',code:`Public Function NextValue() As Long
Static count As Long
count = count + 1
NextValue = count
End Function`});vb6Studio.loadProject(p);}''')
 html=p.evaluate('VB6StudioAPI.exportApplication(vb6Studio.project,{persist:false})');check('class VB6Studio' not in html);app=suite.new_page(browser);app.set_content(html);app.wait_for_function('typeof vb6Application!=="undefined" && vb6Application.vm.state==="running"');check(app.locator('[data-control="Result"]').inner_text()=='1:1:28:True:LR');suite.healthy(app);(REPORTS/'runtime-export.html').write_text(html);app.close();finish(p)

def test_workbench(browser):
 p=suite.open_example(browser,'compatibility');p.wait_for_function('vb6Application.forms[0].controlMap.get("txtoutput").Text.includes("Negative DATE")');output=p.locator('[data-control="txtOutput"] textarea').input_value();check('Optional: Missing versus Empty' in output);check('LSet: [aXYdef    ]' in output);check('RSet: [    aXYdef]' in output);check('CVErr: Error 2001 / type 10' in output);check('Negative DATE round trip: -1.25' in output);p.screenshot(path=str(REPORTS/'runtime-workbench.png'));finish(p)
def test_workbench_controls(browser):
 p=suite.open_example(browser,'compatibility');p.locator('[data-control="cmdA"]').click();p.locator('[data-control="cmdA"]').click();p.locator('[data-control="cmdB"]').click();p.wait_for_function('vb6Application.forms[0].controlMap.get("lblcounters").Caption==="A = 2     B = 1"');check(p.locator('[data-control="lblCalendar"]').inner_text()=='2025-02-28');p.locator('[data-control="txtYears"] input').fill('4');p.locator('[data-control="cmdCalendar"]').click();p.wait_for_function('vb6Application.forms[0].controlMap.get("lblcalendar").Caption==="2028-02-29"');p.locator('[data-control="cmdClear"]').click();p.wait_for_function('vb6Application.forms[0].controlMap.get("txtoutput").Text===""');finish(p)

def main():
 chromium=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium');
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=chromium,args=['--no-sandbox']);version=browser.version
  tests=[('Modeless Object Browser and live source refresh',test_modeless),('Library selection and private member filtering',test_library),('Implemented intrinsic signature search',test_signatures),('Object Browser navigation to source definition',test_definition),('Member navigation Back and Forward',test_history),('Tool-aware Ctrl+F4 and Close All Windows',test_close),('F5 tool refresh and incomplete source tolerance',test_refresh),('Tool activation retention, maximize and keyboard splitter',test_tool_layout),('Project reset disposes modeless tools',test_reset),('Project search locations and Enter navigation',test_search_navigation),('Atomic project replacement with undo/redo',test_replace_undo),('Stale source rejects replacement without mutation',test_stale_replace),('Changed search options require a new search',test_options_replace),('Replace review and running-program guards',test_search_guard),('Ctrl+Shift+F from a source pane',test_search_shortcut),('Current module search scope',test_search_scope),('20,000 visible-result cap with bounded DOM',test_search_large),('Edit-aware bookmark undo/redo',test_bookmark_edit),('Project bookmark shortcuts and wrapping navigation',test_bookmark_navigation),('Bookmarks and breakpoints coexist in both split gutters',test_bookmark_gutter),('Bookmarks survive undo of multi-module replacement',test_bookmark_source_undo),('Object Browser keyboard class/member navigation',test_object_keyboard),('390px Object Browser search and window bounds',test_narrow),('Source text cannot inject tool markup',test_source_script_text),('Exported runtime named calls, statics, dates, CVErr and CallByName',test_runtime_export)]
  tests += [('Runtime Workbench: complete initial language output',test_workbench),('Runtime Workbench: instance counters and leap-year editing',test_workbench_controls)]
  for name,fn in tests:case(name,lambda fn=fn:fn(browser))
  for theme in ['classic','standard','contrast']:case('Modeless Object Browser theme '+theme,lambda t=theme:test_themes(browser,t))
  browser.close()
 report={'browser':version,'passed':sum(r['passed'] for r in suite.RESULTS),'failed':sum(not r['passed'] for r in suite.RESULTS),'nativePixelParityVerified':False,'tests':suite.RESULTS};(ROOT/'reports/browser-features-04.json').write_text(json.dumps(report,indent=2));(ROOT/'reports/browser-features-04.md').write_text('# 0.4.0 browser feature validation\n\n'+f'{report["passed"]} passed; {report["failed"]} failed.\n\n'+'\n'.join('- '+('PASS' if r['passed'] else 'FAIL')+' — '+r['name']+(' — '+r.get('error','') if not r['passed'] else '') for r in suite.RESULTS)+'\n');print(report['passed'],'passed;',report['failed'],'failed');return int(report['failed']>0)
if __name__=='__main__':sys.exit(main())
