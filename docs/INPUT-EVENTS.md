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

Mouse Button uses VB masks: left 1, right 2, middle 4. MouseMove reports held-button combinations and zero while hovering. MouseUp reports the released button. Shift uses Shift 1, Ctrl 2, Alt 4. Form and PictureBox coordinates use their client drawing surface, ScaleMode, custom scale dimensions and origin, including reversed scales. Borders and CSS display scaling are removed before conversion. Character-mode input uses separate horizontal and vertical units: 120 and 240 twips respectively, or 8 by 16 CSS pixels. ScaleWidth and ScaleHeight use the corresponding client-axis conversion.

Chorded presses and releases are recognized even when the browser reports them as pointermove rather than pointerdown or pointerup. The owning live VB target suppresses a right-button native context menu only when it has a MouseDown or MouseUp handler. Unhandled controls and keyboard-invoked native menus retain their native behavior.

KeyDown and KeyUp use VB/Windows virtual-key values, including arrow keys, function keys and numeric keypad keys. KeyPress supplies a character code rather than a virtual-key code. Control-array handlers receive Index before the usual event arguments. With KeyPreview, the form handler executes before the control handler using the same ByRef key cell: changes reach the control, and zero suppresses that corresponding VB control event.

Input is serialized through the interpreter's event queue. Pending mouse motion is replaced by the newest position for that exact control instance; key and mouse-button events are not coalesced. Motion replacement never crosses a keyboard, mouse-button, timer or other application-event boundary. Disabled, invisible, disposed and unloaded targets are rejected. Pausing, stopping or entering an error state discards queued input while leaving the existing timer queue contract intact.

## Browser boundaries

The VB interpreter is asynchronous. Setting KeyCode or KeyAscii to zero controls subsequent VB handler routing; it does not synchronously undo browser-native text editing, focus navigation or default actions. Browser-reserved shortcuts, operating-system keyboard hooks and native IME/ANSI code-page equivalence are not claimed. Composition events are not misreported as ordinary KeyDown/KeyPress events. Pointer capture across the desktop or outside the browser is not emulated. This is shared browser-source runtime support, not certification of native Microsoft VB6 or the separate Win32 AOT target.

## Regression coverage

The three `tests/runtime-input*.test.mjs` files contain 55 tests covering key conversion, modifiers, mouse masks, chorded buttons, scales, input ordering, coalescing, lifecycle and queue bounds. `tools/browser-form-input.py` compiles actual VB procedures and checks form/control input, KeyPreview, control arrays, custom PictureBox scales, MDI isolation and an independent exported HTML application. The Input and designer regressions workflow executes these checks in Chromium, Firefox and WebKit, together with the reported selection and editor fixes. It verifies reproducible generated bundles and retains test logs, including on failure.

The WebKit review found a test-side interference: dispatching an uncancelled synthetic keyboard contextmenu before a genuine right click caused the subsequent native release to disappear. A fresh runtime page without that prelude delivered both down and up. The policy probe now records the application's defaultPrevented value at the end of propagation, then cancels only its own synthetic test event. It removes that observer immediately. The genuine right-button and chorded-button assertions still use unmodified production listeners and exact VB event traces; neither assertions nor WebKit coverage are skipped.

On October 5, 2026 the source integrated with main `16c8ef706c525de141e1d5d547b3cf14b45beeea` passed all 2,104 Node tests locally, including the 55 input regressions, with no failures or skips. All four focused browser scripts passed locally in Chromium. Source, test and generated-distribution Git trees were independently matched to the published feature branch. That candidate then passed all 17 applicable PR workflows, including all three input/browser engines; an unrelated data-job dependency download required one unchanged retry. Its downloaded 490-file source artifact rebuilt and passed the same 2,104 tests, remaining byte-identical afterward.

The debugger PR subsequently merged as main `605fc10bcef483a52c9d50eddfd5ba5036eea04d`. The input branch integrated it rather than replacing its newer VM with the earlier input version. The only handwritten source conflict combined input state invalidation with the debugger's new executable-breakpoint methods. Recoverable error handling, queued-event settlement, native cleanup and design-mode Immediate guards remain present. The exact combined VM SHA-256 is `e712ccea6e72d44cd62b0548499cb44998b81cde750f79dfa65a6a04a5dd27ab`. All **2,177 combined Node tests** and the **four focused Chromium browser suites** passed locally, and distributions were rebuilt from those combined sources. Final integration CI results are recorded in PR #31; prior-candidate results and restricted local system-browser runs are not substitutes for that final matrix. Temporary integration workflows and native-delivery experiments are absent from the final tree.

## References

- [W3C Pointer Events: button state and chorded input](https://www.w3.org/TR/pointerevents/)
- [Microsoft ScaleMode units](https://learn.microsoft.com/en-us/office/vba/api/access.report.scalemode)
- [Microsoft VB6 character-scale constant](https://learn.microsoft.com/en-us/previous-versions/bb918081(v=vs.140))
