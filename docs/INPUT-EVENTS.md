# Keyboard and mouse events

The browser runtime and exported single-file HTML applications share the same input implementation. No IDE layout or visual theme changes are required.

## Pong-style form input

Set `KeyPreview` when a form should receive keyboard events while a child control has focus. A bare form takes keyboard focus when shown; a form with enabled, visible, tab-stop controls initially focuses the first eligible control.

```vb
Private Sub Form_Load()
    Me.KeyPreview = True
End Sub

Private Sub Form_KeyDown(KeyCode As Integer, Shift As Integer)
    If KeyCode = 37 Then Paddle.Left = Paddle.Left - 150
    If KeyCode = 39 Then Paddle.Left = Paddle.Left + 150
End Sub

Private Sub Form_MouseMove(Button As Integer, Shift As Integer, X As Single, Y As Single)
    Paddle.Left = X
End Sub
```

This example expects a control named `Paddle` and the default twip scale. Under another ScaleMode, convert coordinates into the control's parent scale rather than assuming twips. Mouse events over a child belong to that child; form mouse events are not a global pointer listener. Add the child's own MouseMove handler when it should also control the paddle.

## Routing and arguments

Forms and controls receive MouseDown, MouseMove, MouseUp, KeyDown, KeyPress and KeyUp. Form Click and DblClick use the same target ownership guard. Nested containers and MDI child forms do not dispatch duplicate input through their parents.

Mouse Button uses VB masks: left 1, right 2, middle 4. MouseMove reports held-button combinations and zero while hovering. MouseUp reports the released button. Shift uses Shift 1, Ctrl 2, Alt 4. Form and PictureBox coordinates use their client drawing surface, ScaleMode, custom scale dimensions and origin, including reversed scales. Borders and CSS display scaling are removed before conversion.

KeyDown and KeyUp use VB/Windows virtual-key values, including arrow keys, function keys and numeric keypad keys. KeyPress supplies a character code rather than a virtual-key code. Control-array handlers receive Index before the usual event arguments. With KeyPreview, the form handler executes before the control handler using the same ByRef key cell: changes reach the control, and zero suppresses that corresponding VB control event.

Input is serialized through the interpreter's event queue. Pending mouse motion is replaced by the newest position for that exact control instance; key and mouse-button events are not coalesced. Disabled, invisible, disposed and unloaded targets are rejected. Pausing, stopping or entering an error state discards queued input while leaving the existing timer queue contract intact.

## Browser boundaries

The VB interpreter is asynchronous. Setting KeyCode or KeyAscii to zero controls subsequent VB handler routing; it does not synchronously undo browser-native text editing, focus navigation or default actions. Browser-reserved shortcuts, operating-system keyboard hooks and native IME/ANSI code-page equivalence are not claimed. Composition events are not misreported as ordinary KeyDown/KeyPress events. Pointer capture across the desktop or outside the browser is not emulated.

## Regression coverage

`tests/runtime-input.test.mjs` covers key conversion, modifiers, mouse masks, scales, input ordering, coalescing, lifecycle and queue bounds. `tools/browser-form-input.py` compiles actual VB procedures and checks form/control input, KeyPreview, control arrays, custom PictureBox scales, MDI isolation and an independent exported HTML application. The Input and designer regressions workflow executes these checks in Chromium, Firefox and WebKit, together with the reported selection and editor fixes.
