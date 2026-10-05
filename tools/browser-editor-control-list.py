"""Object selectors follow form-only edits without replacing editor state."""
from input_designer_test_support import fixture

with fixture() as page:
    result = page.evaluate('''() => {
        const {SourceEditor,newProject,createControl,IdeDocuments}=Fixture;
        const project=newProject(),module=project.modules[0];
        const editor=new SourceEditor(document.querySelector('#test'));
        editor.setDocument(module,project);editor.goToLine(3,5);
        const start=editor.selectionBounds().start,text=editor.text;
        const objects=()=>Array.from(editor.objects.options,o=>o.value);
        const check=(condition,message)=>{if(!condition)throw Error(message);};
        const timer=createControl('Timer','Timer1',300,300);
        module.form.controls.push(timer);
        check(editor.refreshObjects(),'add did not refresh');
        check(objects().includes('Timer1'),'new Timer is missing');
        check(editor.selectionBounds().start===start&&editor.text===text,'source/caret changed');
        editor.selectedObject='Timer1';editor.objects.value='Timer1';
        timer.name=timer.properties.Name='Clock';
        editor.refreshObjects();check(editor.objects.value==='Clock','rename lost selection');
        const option=editor.objects.options[2];
        timer.properties.Left+=120;check(!editor.refreshObjects(),'geometry rebuilt objects');
        check(editor.objects.options[2]===option,'unchanged options replaced');
        const second=createControl('Timer','Clock',900,300);second.properties.Index=1;
        timer.properties.Index=0;module.form.controls.push(second);editor.refreshObjects();
        check(objects().filter(n=>n==='Clock').length===1,'control array duplicated');
        module.form.controls=module.form.controls.filter(c=>c.id!==timer.id);editor.refreshObjects();
        check(editor.objects.value==='Clock','remaining array item lost selection');
        module.form.controls=[];editor.refreshObjects();
        check(editor.objects.value==='(General)'&&editor.selectedObject==='(General)','deleted control retained');
        module.form.controls.push(timer);editor.refreshObjects();editor.selectedObject='Clock';
        editor.setDocument(structuredClone(module),project);
        check(editor.objects.value==='Clock','same-module refresh lost object');
        editor.dispose();return {cases:8};
    }''')
    integration = page.evaluate('''() => {
        const {IdeDocuments,newProject,createControl}=Fixture;
        const project=newProject(),module=project.modules[0];
        project.settings.renderer='canvas2d';
        const noop=()=>{},caption=document.createElement('div');caption.innerHTML='<strong></strong>';
        const ide={project,runState:'design',documentArea:document.querySelector('#test'),
          docs:[],appearance:{},breakpoints:[],diagnostics:[],visualRevision:0,
          inspector:{render:noop},record:noop,updateLayoutMini:noop,autosave:noop,
          activeModule:module,propertyCaption:caption,toolboxGrid:document.createElement('div'),
          status:noop,statusBackend:{},statusPosition:{},statusCursor:{}};
        const docs=new IdeDocuments(ide),editor=docs.editor(module);
        editor.setDocument(module,project);
        const designer=docs.designer(module);designer.setDocument(module,project);
        const before=structuredClone(module.form);
        module.form.controls.push(createControl('Timer','DrawnTimer',300,300));
        designer.emit('change',{label:'Add control',before,after:structuredClone(module.form)});
        const drawn=Array.from(editor.objects.options,o=>o.value).includes('DrawnTimer');
        module.form.controls.push(createControl('CommandButton','ToolboxButton',900,900));
        docs.ensure({id:module.id,view:'code',key:module.id+':code'});
        const toolbox=Array.from(editor.objects.options,o=>o.value).includes('ToolboxButton');
        docs.reset();docs.fallbackDesigner.dispose();docs.fallbackEditor.dispose();
        return {drawn,toolbox};
    }''')
    assert integration == {'drawn': True, 'toolbox': True}, integration
print('PASS: 8 selector state regressions and both designer/document-manager refresh paths')
