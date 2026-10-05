"""A sole Timer event creates a handler, including the documents-manager wiring."""
from input_designer_test_support import fixture

with fixture() as page:
    page.evaluate('''() => {
        const {SourceEditor,newProject,createControl}=Fixture;
        window.project=newProject();window.module=project.modules[0];
        module.form.controls.push(createControl('Timer','Timer1',300,300));
        window.editor=new SourceEditor(document.querySelector('#test'));
        editor.setDocument(module,project);window.requests=[];
        editor.on('event',request=>requests.push(request));
    }''')
    page.get_by_label('Object', exact=True).select_option('Timer1')
    assert page.evaluate('editor.procedures.options.length') == 1
    assert page.evaluate('editor.procedures.selectedIndex') == -1
    assert page.evaluate('requests') == []
    page.get_by_label('Procedure', exact=True).focus()
    page.keyboard.press('Enter')
    assert page.evaluate('requests') == [{'object': 'Timer1', 'event': 'Timer'}]
    page.evaluate("requests=[];editor.eventObject=null;editor.updateSelectors(false,true)")
    page.get_by_label('Procedure', exact=True).select_option('event:Timer')
    assert page.evaluate('requests') == [{'object': 'Timer1', 'event': 'Timer'}]
    page.evaluate('requests=[];editor.setReadOnly(true);editor.activateProcedure()')
    assert page.evaluate('requests') == []
    page.evaluate('''() => {
        editor.setReadOnly(false);
        module.code+='\\nPrivate Sub Timer1_Timer()\\nEnd Sub\\n';
        editor.setDocument(module,project);editor.procedures.focus();editor.activateProcedure();
    }''')
    assert page.evaluate('requests') == []
    assert page.evaluate("editor.procedures.selectedOptions[0].dataset.event") == 'Timer'
    page.evaluate('''() => {
        requests=[];module.code=module.code.slice(0,module.code.indexOf('Private Sub Timer1_Timer'));
        editor.setDocument(module,project);
    }''')
    assert page.evaluate('editor.procedures.selectedIndex') == -1
    page.get_by_label('Procedure', exact=True).select_option('event:Timer')
    assert page.evaluate('requests') == [{'object': 'Timer1', 'event': 'Timer'}]
    page.evaluate('editor.dispose()')
    page.evaluate('''() => {
        const {IdeDocuments,VB6Studio,newProject,createControl}=Fixture;
        const project=newProject(),module=project.modules[0],noop=()=>{};
        module.form.controls.push(createControl('Timer','Timer1',300,300));
        window.ide={project,runState:'design',documentArea:document.querySelector('#test'),
          docs:[],appearance:{},breakpoints:[],diagnostics:[],visualRevision:0,autosave:noop,
          activeModule:null,record:noop,status:noop,statusCursor:{},
          ensureEvent:VB6Studio.prototype.ensureEvent,
          openDocument(id){this.activeModule=this.project.modules.find(m=>m.id===id);
            this.editor=this.documents.editor(this.activeModule);this.editor.setDocument(this.activeModule,this.project);}};
        ide.documents=new IdeDocuments(ide);window.editor=ide.documents.editor(module);
        editor.setDocument(module,project);document.querySelector('#test').append(editor.pane);
        editor.objects.value=editor.selectedObject='Timer1';editor.updateSelectors(false,true);
    }''')
    page.get_by_label('Procedure', exact=True).focus()
    page.keyboard.press('Enter')
    page.wait_for_function("ide.project.modules[0].code.includes('Private Sub Timer1_Timer()')")
    assert page.evaluate("(ide.project.modules[0].code.match(/Private Sub Timer1_Timer/g)||[]).length") == 1
    page.evaluate('editor.activateProcedure()')
    assert page.evaluate("(ide.project.modules[0].code.match(/Private Sub Timer1_Timer/g)||[]).length") == 1
    assert page.evaluate('ide.activeModule.id===editor.module.id')
    page.evaluate('ide.documents.reset();ide.documents.fallbackDesigner.dispose();ide.documents.fallbackEditor.dispose()')
print('PASS: sole-event keyboard/selection, no automatic creation, read-only guard, existing navigation, deleted-handler reselection, IDE handler wiring and deduplication')
