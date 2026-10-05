"""Disabled/nonvisual controls must remain hit targets only in the designer."""
from input_designer_test_support import fixture

with fixture() as page:
    page.evaluate('''async () => {
        const {FormDesigner,newProject,createControl}=Fixture;
        const project=newProject(), module=project.modules[0];
        project.settings.renderer='canvas2d'; project.settings.snapToGrid=false;
        module.form.properties.ClientWidth=15000;
        module.form.properties.ClientHeight=10000;
        const controls=[['Timer','Timer1'],['CommandButton','Command1'],['TextBox','Text1'],['CommonDialog','Dialog1'],['ImageList','Images1'],['Frame','Frame1']];
        module.form.controls=controls.map(([type,name],i)=>{
            const c=createControl(type,name,300+i*2100,600);
            c.properties.Enabled=0;return c;
        });
        const child=createControl('CommandButton','Child1',150,400);
        child.properties.Enabled=0; child.parent='Frame1';module.form.controls.push(child);
        window.designer=new FormDesigner(document.querySelector('#test'));
        designer.setDocument(module,project);
        window.opened=[];designer.on('event',({control})=>opened.push(control?.name));
    }''')
    for name in ['Timer1', 'Command1', 'Text1', 'Dialog1', 'Images1', 'Child1']:
        target = page.locator(f'[data-control="{name}"]')
        target.click(position={'x': 8, 'y': 8})
        assert page.evaluate('designer.selected().map(c=>c.name)') == [name], name
        before = page.evaluate('designer.selected()[0].properties.Left')
        box = target.bounding_box()
        page.mouse.move(box['x'] + 8, box['y'] + 8)
        page.mouse.down()
        page.mouse.move(box['x'] + 40, box['y'] + 24, steps=4)
        page.mouse.up()
        assert page.evaluate('designer.selected()[0].properties.Left') == before + 480, name
    page.locator('[data-control="Timer1"]').dblclick(position={'x': 8, 'y': 8})
    assert page.evaluate('opened.at(-1)') == 'Timer1'
    result = page.evaluate('''async () => {
        const {BrowserControl,createControl}=Fixture;
        const model=createControl('CommandButton','Disabled',0,0);model.properties.Enabled=0;
        const runtime=new BrowserControl(model);document.querySelector('#test').append(runtime.node);
        const pointer=getComputedStyle(runtime.node).pointerEvents;
        runtime.dispose();designer.dispose();return pointer;
    }''')
    assert result == 'none', result
print('PASS: six disabled/nonvisual hit targets, direct dragging, timer double-click, runtime isolation')
