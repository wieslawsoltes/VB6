"""Real VB procedures receive form/control mouse and keyboard input in the shared host."""
from input_designer_test_support import fixture


def context_menu_prevented(target, button):
    """Observe the app's policy without opening native UI during a synthetic test.

    WebKit can open a native menu for an uncancelled synthetic contextmenu,
    consuming the next pointer release. Observe the runtime's cancellation at
    the end of propagation, THEN cancel this test event only. Real right-button
    presses below still exercise the unmodified production event listeners.
    """
    return target.evaluate("""(node, button) => {
      const view=node.ownerDocument.defaultView;
      const event=new view.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button});
      let prevented;
      const observe=e=>{if(e!==event)return;prevented=e.defaultPrevented;e.preventDefault();};
      view.addEventListener('contextmenu',observe);
      try{node.dispatchEvent(event);}finally{view.removeEventListener('contextmenu',observe);}
      if(typeof prevented!=='boolean')throw new Error('Context-menu policy probe did not reach the observer');
      return prevented;
    }""", button)


def expect_trace(page, expected):
    # Browser delivery and the interpreter queue are separate asynchronous stages.
    # Retain the exact trace assertion while waiting for both to finish.
    page.wait_for_function(
        "expected => value('Trace') === expected && !host.vm.processing && !host.vm.eventQueue.length",
        arg=expected, timeout=5000)
    assert page.evaluate("value('Trace')") == expected

with fixture() as page:
    page.evaluate('''async () => {
      const {newProject,createControl,ApplicationHost}=Fixture;
      window.project=newProject();project.settings.renderer='canvas2d';
      const m=project.modules[0];m.form.properties.ScaleMode=3;
      m.form.properties.KeyPreview=-1;
      m.form.controls=[createControl('OptionButton','Paddle',1500,1500)];
      m.code=`Option Explicit
Public Trace As String
Public LastX As Single
Public LastY As Single
Public LastButton As Integer
Public LastShift As Integer
Public Moves As Long
Private Sub Form_MouseMove(Button As Integer, Shift As Integer, X As Single, Y As Single)
    LastX = X
    LastY = Y
    LastButton = Button
    LastShift = Shift
    Moves = Moves + 1
End Sub
Private Sub Form_MouseDown(Button As Integer, Shift As Integer, X As Single, Y As Single)
    Trace = Trace & "D" & CStr(Button)
End Sub
Private Sub Form_MouseUp(Button As Integer, Shift As Integer, X As Single, Y As Single)
    Trace = Trace & "U" & CStr(Button)
End Sub
Private Sub Form_KeyDown(KeyCode As Integer, Shift As Integer)
    Trace = Trace & "F" & CStr(KeyCode) & ":"
    If KeyCode = 65 Then KeyCode = 0
End Sub
Private Sub Form_KeyPress(KeyAscii As Integer)
    Trace = Trace & "P" & CStr(KeyAscii) & ":"
End Sub
Private Sub Form_KeyUp(KeyCode As Integer, Shift As Integer)
    Trace = Trace & "U" & CStr(KeyCode) & ":"
End Sub
Private Sub Paddle_KeyDown(KeyCode As Integer, Shift As Integer)
    Trace = Trace & "C" & CStr(KeyCode) & ":"
    If KeyCode = 39 Then Paddle.Left = Paddle.Left + 150
End Sub
Private Sub Paddle_KeyPress(KeyAscii As Integer)
    Trace = Trace & "p" & CStr(KeyAscii) & ":"
End Sub
Private Sub Paddle_KeyUp(KeyCode As Integer, Shift As Integer)
    Trace = Trace & "u" & CStr(KeyCode) & ":"
End Sub
Private Sub Paddle_MouseMove(Button As Integer, Shift As Integer, X As Single, Y As Single)
    LastX = X
    LastY = Y
    LastButton = Button
    LastShift = Shift
    Trace = Trace & "M:"
End Sub`;
      window.host=new ApplicationHost(project,document.querySelector('#test'),{persist:false});
      await host.start();window.form=host.forms[0];
      window.value=name=>host.vm.instances.values().next().value.fields.get(name.toLowerCase()).get();
      window.clearTrace=()=>host.vm.instances.values().next().value.fields.get('trace').set('');
      window.drain=async()=>{for(let i=0;i<200&&(host.vm.processing||host.vm.eventQueue.length);i++)await new Promise(r=>setTimeout(r,5));if(host.vm.state==='error')throw host.vm.lastError;};
    }''')
    content = page.locator('.vb-form-content')
    box = content.bounding_box()
    page.mouse.move(box['x'] + 25, box['y'] + 35)
    page.evaluate('drain()')
    assert page.evaluate("value('Moves')") >= 1, 'Form_MouseMove must execute'
    assert page.evaluate("[value('LastX'),value('LastY'),value('LastButton')]") == [25, 35, 0]
    assert context_menu_prevented(content, 2) is True
    assert context_menu_prevented(content, 0) is False
    page.mouse.down(button='right')
    page.mouse.up(button='right')
    page.evaluate('drain()')
    expect_trace(page, 'D2U2')
    page.evaluate('clearTrace()')
    # Additional pressed/released buttons arrive as pointermove, not down/up.
    page.mouse.down(button='left')
    page.mouse.down(button='middle')
    page.mouse.up(button='left')
    page.mouse.up(button='middle')
    page.evaluate('drain()')
    expect_trace(page, 'D1D4U1U4')
    page.evaluate('clearTrace()')
    page.locator('[data-control="Paddle"]').focus()
    page.keyboard.press('ArrowRight')
    page.evaluate('drain()')
    expect_trace(page, 'F39:C39:U39:u39:')
    assert page.evaluate('form.controls[0].Left') == 1650
    page.evaluate('clearTrace()')
    page.keyboard.press('a')
    page.evaluate('drain()')
    page.wait_for_function("value('Trace').endsWith('U65:u65:')", timeout=5000)
    trace = page.evaluate("value('Trace')")
    assert trace.startswith('F65:'), trace
    assert 'C65:' not in trace, 'KeyPreview cancellation must suppress control KeyDown'
    assert 'P97:p97:' in trace, trace
    assert trace.endswith('U65:u65:'), trace
    page.evaluate('clearTrace()')
    paddle = page.locator('[data-control="Paddle"]')
    paddle_box = paddle.bounding_box()
    page.mouse.move(paddle_box['x'] + 10, paddle_box['y'] + 10)
    page.evaluate('drain()')
    expect_trace(page, 'M:')
    assert page.evaluate("value('LastButton')") == 0
    before = page.evaluate("value('Moves')")
    page.evaluate('host.vm.setState("paused")')
    page.mouse.move(box['x'] + 45, box['y'] + 55)
    page.evaluate('drain()')
    assert page.evaluate("value('Moves')") == before
    page.evaluate('host.vm.setState("running");host.dispose()')
    # With no focusable controls a form, rather than the page body, owns the keyboard.
    page.evaluate('''async () => {
      project.modules[0].form.controls=[];
      project.modules[0].form.properties.KeyPreview=0;
      host=new Fixture.ApplicationHost(project,document.querySelector('#test'),{persist:false});
      await host.start();form=host.forms[0];
    }''')
    page.keyboard.press('z')
    page.evaluate('drain()')
    expect_trace(page, 'F90:P122:U90:')
    page.evaluate('host.dispose()')
    # An MDI child owns its keyboard route; its parent must not dispatch it twice.
    page.evaluate('''async () => {
      const p=Fixture.newProject('MDIInput'),parent=p.modules[0];
      p.settings.renderer='canvas2d';parent.form.type='MDIForm';parent.form.properties.KeyPreview=-1;
      parent.code=`Public Trace As String
Private Sub MDIForm_KeyDown(KeyCode As Integer, Shift As Integer)
Trace = Trace & "parent:"
End Sub`;
      const child=Fixture.createForm('Child');child.form.properties.MDIChild=-1;child.form.properties.KeyPreview=-1;
      child.form.controls=[Fixture.createControl('TextBox','Text1',300,300)];
      child.code=`Public Trace As String
Private Sub Form_KeyDown(KeyCode As Integer, Shift As Integer)
Trace = Trace & "form:"
End Sub
Private Sub Text1_KeyDown(KeyCode As Integer, Shift As Integer)
Trace = Trace & "text:"
End Sub`;
      p.modules.push(child);p.startup='Child';
      host=new Fixture.ApplicationHost(p,document.querySelector('#test'),{persist:false});await host.start();
      host.forms.find(f=>f.type==='Form').controls[0].SetFocus();
    }''')
    assert context_menu_prevented(page.locator('[data-control="Text1"] input'), 2) is False
    page.keyboard.press('q')
    page.evaluate('drain()')
    assert page.evaluate("host.vm.instances.get('child').fields.get('trace').get()") == 'form:text:'
    assert page.evaluate("host.vm.instances.get('form1').fields.get('trace').get()") == ''
    assert page.evaluate("host.forms.find(f=>f.type==='Form').controls[0].Text") == 'q'
    page.evaluate('host.dispose()')
    # Independent single-file export runs the bundled runtime, not the fixture modules.
    html = page.evaluate('''() => {
      project.modules[0].form.properties.KeyPreview=-1;
      project.modules[0].form.controls=[Fixture.createControl('OptionButton','Paddle',1500,1500)];
      return Fixture.exportApplication(project);
    }''')
    page.set_content(html)
    page.wait_for_function('window.vb6Application?.vm?.state === "running"')
    page.evaluate('''() => {
      window.host=vb6Application;window.form=host.forms[0];
      window.value=name=>host.vm.instances.values().next().value.fields.get(name.toLowerCase()).get();
      window.drain=async()=>{for(let i=0;i<200&&(host.vm.processing||host.vm.eventQueue.length);i++)await new Promise(r=>setTimeout(r,5));if(host.vm.state==='error')throw host.vm.lastError;};
    }''')
    assert page.evaluate('[form.ScaleWidth,form.ScaleHeight]') == [600,400]
    page.keyboard.press('ArrowRight')
    page.evaluate('drain()')
    assert page.evaluate('form.controls[0].Left') == 1650
    expect_trace(page, 'F39:C39:U39:u39:')
    box=page.locator('.vb-form-content').bounding_box()
    page.mouse.move(box['x']+40,box['y']+50)
    page.evaluate('drain()')
    assert page.evaluate("[value('LastX'),value('LastY'),value('LastButton')]") == [40,50,0]
    page.evaluate('host.dispose()')
print('PASS: real VB form mouse/keyboard, KeyPreview ordering and cancellation, control input, no duplicate bubbling, pixel coordinates, paused input, bare-form focus, MDI route isolation, independent exported HTML')

with fixture() as page:
    page.evaluate('''async () => {
      const p=Fixture.newProject(),m=p.modules[0];p.settings.renderer='canvas2d';m.form.properties.KeyPreview=-1;
      const picture=Fixture.createControl('PictureBox','Picture1',600,600);
      Object.assign(picture.properties,{Width:3000,Height:2100,ScaleMode:0,ScaleWidth:1000,ScaleHeight:-500,ScaleLeft:10,ScaleTop:20});
      const controls=[0,1].map(i=>{const c=Fixture.createControl('OptionButton','Pad',600+2400*i,3300);c.properties.Index=i;return c;});
      m.form.controls=[picture,...controls];m.code=`Public Trace As String
Public MouseX As Single
Public MouseY As Single
Public MouseIndex As Integer
Private Sub Form_KeyDown(KeyCode As Integer, Shift As Integer)
Trace = Trace & "F" & CStr(KeyCode) & ";"
KeyCode = 77
End Sub
Private Sub Form_KeyPress(KeyAscii As Integer)
Trace = Trace & "P" & CStr(KeyAscii) & ";"
KeyAscii = 0
End Sub
Private Sub Form_KeyUp(KeyCode As Integer, Shift As Integer)
Trace = Trace & "U" & CStr(KeyCode) & ";"
End Sub
Private Sub Pad_KeyDown(Index As Integer, KeyCode As Integer, Shift As Integer)
Trace = Trace & "C" & CStr(Index) & ":" & CStr(KeyCode) & ";"
End Sub
Private Sub Pad_KeyPress(Index As Integer, KeyAscii As Integer)
Trace = Trace & "unexpected;"
End Sub
Private Sub Pad_KeyUp(Index As Integer, KeyCode As Integer, Shift As Integer)
Trace = Trace & "u" & CStr(Index) & ":" & CStr(KeyCode) & ";"
End Sub
Private Sub Pad_MouseMove(Index As Integer, Button As Integer, Shift As Integer, X As Single, Y As Single)
MouseIndex = Index
End Sub
Private Sub Picture1_MouseMove(Button As Integer, Shift As Integer, X As Single, Y As Single)
MouseX = X
MouseY = Y
End Sub`;
      window.host=new Fixture.ApplicationHost(p,document.querySelector('#test'),{persist:false});await host.start();
      window.form=host.forms[0];form.controls[2].SetFocus();
      window.value=name=>host.vm.instances.values().next().value.fields.get(name.toLowerCase()).get();
      window.drain=async()=>{for(let i=0;i<200&&(host.vm.processing||host.vm.eventQueue.length);i++)await new Promise(r=>setTimeout(r,5));if(host.vm.state==='error')throw host.vm.lastError;};
    }''')
    page.keyboard.press('b')
    page.evaluate('drain()')
    expect_trace(page, 'F66;C1:77;P98;U66;u1:66;')
    box=page.locator('[data-control="Pad"]').nth(1).bounding_box()
    page.mouse.move(box['x']+10,box['y']+10)
    page.evaluate('drain()')
    assert page.evaluate("value('MouseIndex')") == 1
    geometry=page.evaluate('''() => {const n=form.controls[0].node,r=n.getBoundingClientRect();return {x:r.left+n.clientLeft+20,y:r.top+n.clientTop+30,w:n.clientWidth,h:n.clientHeight};}''')
    page.mouse.move(geometry['x'],geometry['y'])
    page.evaluate('drain()')
    assert abs(page.evaluate("value('MouseX')") - (10+20*1000/geometry['w'])) < .001
    assert abs(page.evaluate("value('MouseY')") - (20-30*500/geometry['h'])) < .001
    # Queued input cannot invoke a handler after the target is disposed.
    page.evaluate('''async () => {
      host.vm.processing=true;
      form.controls[0].node.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:100,clientY:100}));
      form.controls[0].dispose();host.vm.processing=false;await host.vm.processEvents();
    }''')
    assert abs(page.evaluate("value('MouseX')") - (10+20*1000/geometry['w'])) < .001
    page.evaluate('host.dispose()')
print('PASS: control-array indices, shared ByRef key remapping, KeyPress cancellation, custom/reversed PictureBox scales, disposed-target queue guard')
