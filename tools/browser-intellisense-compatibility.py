#!/usr/bin/env python3
"""Extend the original 18 scenarios; never replace or skip its assertions."""
import importlib.util
from pathlib import Path
import sys
spec=importlib.util.spec_from_file_location('baseline',Path(__file__).with_name('browser-intellisense-tests.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
setup,check,put,names=base.setup,base.check,base.put,base.names

PUBLISHER={'id':'Publisher','name':'Publisher','kind':'class','code':'Public Event Changed(ByVal Value As Long)\nPublic Sub Fire()\nRaiseEvent Changed(42)\nEnd Sub'}

def with_events_dropdown(p):
    setup(p,'Private WithEvents source As Publisher',others=[PUBLISHER])
    objects=p.get_by_role('combobox',name='Object',exact=True)
    check('source' in objects.inner_text(),objects.inner_text());objects.select_option('source')
    selector=p.get_by_role('combobox',name='Procedure',exact=True)
    check(selector.input_value()=='');selector.select_option('event:Changed')
    p.wait_for_function('vb6Studio.editor.text.includes("Private Sub source_Changed(ByVal Value As Long)")')
    code=p.evaluate('vb6Studio.editor.text');check(code.count('Private Sub source_Changed')==1)
    p.evaluate('vb6Studio.ensureEvent("source","Changed")');check(p.evaluate('vb6Studio.editor.text')==code)
    p.evaluate('vb6Studio.command("undo")');check(not 'Private Sub source_Changed' in p.evaluate('vb6Studio.editor.text'))
    base.shot(p,'withevents-undo')

def single_timer_event(p):
    setup(p,'',controls=[{'name':'Timer1','type':'Timer'}])
    p.get_by_role('combobox',name='Object',exact=True).select_option('Timer1')
    selector=p.get_by_role('combobox',name='Procedure',exact=True)
    check(selector.input_value()=='');check(selector.locator('option').count()==1);check(selector.evaluate('(s)=>s.selectedIndex')==-1)
    selector.select_option('event:Timer');p.wait_for_function('vb6Studio.editor.text.includes("Private Sub Timer1_Timer()")')

def live_event_declarations(p):
    setup(p,'Private WithEvents source As Publisher',others=[PUBLISHER])
    p.evaluate('()=>{const e=vb6Studio.editor;const at=e.text.indexOf("source");e.replaceGlobal("updated",at,at+6);}')
    choices=p.get_by_role('combobox',name='Object',exact=True).inner_text()
    check('updated' in choices and 'source' not in choices,choices)
    p.evaluate('()=>{const e=vb6Studio.editor;const at=e.text.indexOf("WithEvents ");e.replaceGlobal("",at,at+11);}')
    check('updated' not in p.get_by_role('combobox',name='Object',exact=True).inner_text())

def interface_dropdown(p):
    contract={'id':'IThing','name':'IThing','kind':'class','code':'Public Function Read(ByRef Key As Long) As String\nEnd Function\nPublic Property Get Value() As Long\nEnd Property\nPublic Property Let Value(ByVal Value As Long)\nEnd Property'}
    setup(p,'Implements IThing',others=[contract]);p.get_by_role('combobox',name='Object',exact=True).select_option('IThing')
    selector=p.get_by_role('combobox',name='Procedure',exact=True)
    for key in ['Read','Value:get','Value:let']:
        selector.select_option('event:'+key)
        p.wait_for_function('key=>!Array.from(vb6Studio.editor.procedures.options).some(o=>o.value=== "event:"+key)',arg=key)
    code=p.evaluate('vb6Studio.editor.text')
    check('Private Function IThing_Read(ByRef Key As Long) As String' in code)
    check('Private Property Get IThing_Value() As Long' in code)
    check('Private Property Let IThing_Value(ByVal Value As Long)' in code)
    base.shot(p,'interface-dropdown')

def classic_mouse_selection(p):
    setup(p,'Private Sub Form_Load()\nText1.',controls=[{'name':'Text1','type':'TextBox'}])
    p.keyboard.press('Control+j');put(p,'SelSt');p.wait_for_selector('.completion-item')
    before=p.evaluate('vb6Studio.editor.text');p.get_by_role('option',name='SelStart',exact=True).click()
    check(p.evaluate('vb6Studio.editor.text')==before,'Single click must select, not insert')
    check(p.locator('.completion-list').count()==1);p.get_by_role('option',name='SelStart',exact=True).dblclick()
    check(p.evaluate('vb6Studio.editor.text.endsWith("Text1.SelStart")'))

def menu_routes_to_immediate(p):
    setup(p,'Private Sub Form_Load()\nEnd Sub',controls=[{'name':'Text1','type':'TextBox'}])
    before=p.evaluate('vb6Studio.editor.text');p.evaluate('vb6Studio.command("immediate")')
    field=p.locator('.immediate-input');field.fill('? Text1.SelSt');field.focus()
    p.evaluate('vb6Studio.command("completeWord")')
    check(field.input_value()=='? Text1.SelStart',field.input_value());check(p.evaluate('vb6Studio.editor.text')==before)
    check(p.evaluate('vb6Studio.immediateOutput.length')==0)
    p.evaluate('()=>{vb6Studio.openDocument("main","code");vb6Studio.editor.input.focus();}')
    p.evaluate('vb6Studio.command("listMembers")');check(p.evaluate('!!vb6Studio.editor.completion'))

def manual_list_does_not_reopen_after_commit(p):
    setup(p,'Private Sub Form_Load()\nEnd Sub',controls=[{'name':'Text1','type':'TextBox'}]);p.evaluate('vb6Studio.command("immediate")')
    field=p.locator('.immediate-input');field.fill('? Text1.');field.focus();p.keyboard.press('Control+j');put(p,'SelSt');p.keyboard.press('Tab')
    check(field.input_value()=='? Text1.SelStart');check(p.locator('.completion-list').count()==0)

def expression_readonly_guard(p):
    setup(p,'',controls=[{'name':'Text1','type':'TextBox'}]);p.evaluate('vb6Studio.command("immediate")');field=p.locator('.immediate-input');field.fill('? Text1.');field.focus();p.keyboard.press('Control+j')
    p.evaluate('document.querySelector(".immediate-input").readOnly=true');p.keyboard.press('Tab');check(field.input_value()=='? Text1.')

def label_completion_navigation(p):
    code='Sub Work()\nGoTo Do\nDone:\nEnd Sub';setup(p,code)
    p.evaluate('vb6Studio.editor.goToLine(2,8)');p.keyboard.press('Control+Space')
    check('GoTo Done\n' in p.evaluate('vb6Studio.editor.text'));p.keyboard.press('Shift+F2');check(p.evaluate('vb6Studio.editor.cursor().line')==3)

def namespace_and_suffix_lists(p):
    setup(p,'Sub Work()\nVBA.Strings.');p.keyboard.press('Control+j')
    check('Left$' in names(p),names(p));check('MsgBox' not in names(p))
    put(p,'Left$');check(names(p)==['Left$'],names(p));p.keyboard.press('Tab')
    check(p.evaluate('vb6Studio.editor.text.endsWith("VBA.Strings.Left$")'))

def select_case_constants(p):
    code='Public Enum Options\nOne=1\nTwo=2\nEnd Enum\nSub Work()\nDim flags As Options\nSelect Case flags\nCase '
    setup(p,code);p.keyboard.press('Control+j');check(names(p)==['One','Two'],names(p))

def priority_and_disable_references(p):
    setup(p,'Dim client As Client\nclient.')
    p.evaluate('''()=>{vb6Studio.project.typeLibraries=['First','Second'].map(name=>({name,types:[{name:'Client',members:[{name:name+'Only',type:'String'}]}]}));void vb6Studio.command('references');}''')
    library=p.locator('select[aria-label="IntelliSense type libraries"]');library.select_option('1');p.get_by_role('button',name='Move Up',exact=True).click()
    check('Second' in library.locator('option').first.inner_text())
    p.get_by_role('checkbox',name='Enable selected type library').uncheck();p.get_by_role('button',name='OK',exact=True).click()
    p.evaluate('()=>{vb6Studio.editor.selectGlobal(vb6Studio.editor.text.length);vb6Studio.editor.complete();}')
    check(names(p)==['FirstOnly'],names(p));p.keyboard.press('Escape')
    p.evaluate('void vb6Studio.command("references")');library.select_option('0');p.get_by_role('checkbox',name='Enable selected type library').check();p.get_by_role('button',name='OK',exact=True).click()
    p.evaluate('()=>{vb6Studio.editor.selectGlobal(vb6Studio.editor.text.length);vb6Studio.editor.complete();}')
    check(names(p)==['SecondOnly'],names(p))

def inline_call_hints(p):
    setup(p,'Sub Work()\nIf True Then MsgBox "Hello", ');p.keyboard.press('Control+Shift+i')
    check(p.evaluate('vb6Studio.editor.lastInfo.name')=='MsgBox');check('buttons' in p.locator('.source-info strong').inner_text())

def indexed_call_hints(p):
    setup(p,'Sub Work()\nDim customers() As Customer\ncustomers(0).Find ',others=[base.CUSTOMER|{'code':'Public Function Find(ByVal Key As String) As Customer\nEnd Function'}])
    p.keyboard.press('Control+Shift+i');check(p.evaluate('vb6Studio.editor.lastInfo.name')=='Find');check('Key As String' in p.locator('.source-info strong').inner_text())


def bracket_replacement(p):
    source='Private Sub Form_Load()\nDim [Display Name] As Long\n[Display Name]';setup(p,source)
    p.evaluate('()=>{const e=vb6Studio.editor;e.selectGlobal(e.text.lastIndexOf("[Display Name]")+4);e.completeWord();}')
    check(p.evaluate('vb6Studio.editor.text')==source,p.evaluate('vb6Studio.editor.text'))
    p.keyboard.press('Control+i');check('Long' in p.locator('.source-info').inner_text())

def interface_fields(p):
    contract={'id':'IState','name':'IState','kind':'class','code':'Public Count As Long\nPublic Child As IState'}
    setup(p,'Implements IState',others=[contract]);p.get_by_role('combobox',name='Object',exact=True).select_option('IState')
    selector=p.get_by_role('combobox',name='Procedure',exact=True)
    for key in ['Count:get','Count:let','Child:get','Child:set']:
        selector.select_option('event:'+key)
        p.wait_for_function('key=>!Array.from(vb6Studio.editor.procedures.options).some(o=>o.value=== "event:"+key)',arg=key)
    code=p.evaluate('vb6Studio.editor.text');check('Private Property Set IState_Child(ByRef value As IState)' in code)
    diagnostics=p.evaluate('VB6StudioAPI.compileProject(vb6Studio.project).diagnostics');check(not diagnostics,diagnostics)
    base.shot(p,'interface-fields')

def malformed_metadata(p):
    setup(p,'Private WithEvents source As Custom.Publisher');p.evaluate('void vb6Studio.command("references")')
    import json
    descriptor={'name':'Custom','types':[{'name':'Publisher','members':[{'name':'Changed','kind':'event','params':['Value As Long: Stop']}]}]}
    p.locator('input[aria-label="Import type-library metadata"]').set_input_files({'name':'unsafe.json','mimeType':'application/json','buffer':json.dumps(descriptor).encode()})
    p.wait_for_function('document.querySelector(".ide-dialog [role=status]")?.textContent.includes("Invalid")')
    check(p.locator('select[aria-label="IntelliSense type libraries"] option').count()==0)
    p.get_by_role('button',name='Cancel',exact=True).click();check(p.evaluate('(vb6Studio.project.typeLibraries||[]).length')==0)

def rejected_handler(p):
    setup(p,'Private WithEvents source As Publisher',others=[PUBLISHER]);before=p.evaluate('vb6Studio.editor.text')
    p.evaluate('vb6Studio.ensureEvent("source","NotAnEvent")');check(p.evaluate('vb6Studio.editor.text')==before)
    check(not p.evaluate('vb6Studio.editor.text.includes("source_NotAnEvent")'))

def labelled_call(p):
    setup(p,'Private Sub Form_Load()\n100 MsgBox "Choose", ');p.keyboard.press('Control+Shift+i');check(p.evaluate('vb6Studio.editor.lastInfo.name')=='MsgBox')
    p.keyboard.press('Control+Shift+j');check('vbYesNo' in names(p));check('vbRed' not in names(p))
    setup(p,'Private Sub Form_Load()\nDim x As Date\nx = #');p.keyboard.press('Control+j');check(p.locator('.completion-list').count()==0)

def dao_chains(p):
    setup(p,'Private Sub Form_Load()\nDim db As DAO.Database\ndb.QueryDefs("Items").OpenRecordset().');p.keyboard.press('Control+j')
    check('Edit' in names(p),names(p));check('FindFirst' in names(p));check('UpdateBatch' not in names(p));put(p,'CopyQueryDef');p.keyboard.press('(');p.keyboard.press(')');p.keyboard.press('.')
    check('Parameters' in names(p),names(p));base.shot(p,'dao-recordset')

def source_literal_signatures(p):
    setup(p,'Private Sub Form_Load()\nDim buttons(0 To 1,0 To 2) As CommandButton\nbuttons(');p.keyboard.press('Control+Shift+i')
    check(p.evaluate('vb6Studio.editor.lastInfo.kind')=='array');check('Index2 As Long' in p.locator('.source-info').inner_text())

base.CASES += [with_events_dropdown,single_timer_event,live_event_declarations,interface_dropdown,classic_mouse_selection,menu_routes_to_immediate,manual_list_does_not_reopen_after_commit,expression_readonly_guard,label_completion_navigation,namespace_and_suffix_lists,select_case_constants,priority_and_disable_references,inline_call_hints,indexed_call_hints,bracket_replacement,interface_fields,malformed_metadata,rejected_handler,labelled_call,dao_chains,source_literal_signatures]
if __name__=='__main__':sys.exit(base.main())
