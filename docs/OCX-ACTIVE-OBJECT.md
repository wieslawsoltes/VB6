# Native OCX active-object communication

The opt-in Windows companion exposes explicit `IOleInPlaceActiveObject`
communication through `NativeAutomationClient`. This extends existing hosted
controls; it does not embed a binary OCX in browser DOM or replace AxHost's
Windows message loop. Native windowless rendering, border-space negotiation,
menu merging and a complete custom `IOleInPlaceSite` are separate work.

## API

```js
const info = await client.controlActivationInfo(handle);
if (info.supported) {
  await client.setControlFrameActive(handle, true);
  await client.setControlDocumentActive(handle, true);
  const reply = await client.translateControlAccelerator(handle, {
    kind: 'keyDown', code: 9, repeatCount: 1, scanCode: 15,
    extended: false, altContext: false, wasDown: false
  });
  // S_OK (0) means consumed; S_FALSE (1) alone permits container fallback.
  if (!reply.translated && !reply.suppressed) {
    // Perform the embedding application's normal fallback, not a second call
    // to the component's accelerator translation.
  }
  await client.withControlModal(handle, async () => {
    // Show the embedding application's modal UI. Nested scopes are supported.
    // The outermost acquisition disables the component's modeless UI;
    // the final release re-enables it, including after callback rejection.
    await showMyModalDialog();
  });
}
```

The eight message kinds are `keyDown`, `keyUp`, `character`, `deadCharacter`,
`systemKeyDown`, `systemKeyUp`, `systemCharacter`, and `systemDeadCharacter`.
Virtual keys are 1..255; character messages carry one UTF-16 code unit 1..65535.
Repeat counts are 1..65535 and scan codes 0..255. Boolean flags are strict.
Key-up messages set previous-state and transition bits automatically. The host
sign-extends LPARAM on x64 and always supplies the hosted control's own HWND.

These are explicit host calls, not synthetic operating-system input. There is
no caller-supplied HWND, raw lParam, pointer or global keyboard-state update.
`altContext` encodes the MSG context bit, not a change to GetKeyState. Control,
Shift and other modifier-state synthesis are deliberately not represented.
Real Windows keyboard input continues through AxHost's existing message loop.
Do not call this API for the same message already handled by that loop.

## Lifecycle and errors

Native HRESULT failures propagate with their original code. Unexpected positive
accelerator HRESULTs are diagnosed rather than mistaken for S_FALSE. Design,
disabled, hidden and modal controls report suppressed keyboard delivery without
calling the component. Frame/document status is recorded only after success;
`null` means no explicit notification has been made through this API.

Modal depth is maintained on the STA, bounded to 256, and changes only after the
native operation succeeds. Failed restoration retains the depth so the host
can retry. Teardown attempts modeless restoration before destroying the window,
while still releasing resources if restoration itself fails. Reentrant state
changes are rejected; native outgoing events can still make ordinary reads.
`withControlModal` preserves both callback and restoration failures using
`AggregateError`, including non-Error JavaScript rejection values.

The caller owns modal UI creation/closure. The helper balances notifications;
it cannot undo a component's internal state changes after a native failure.

## Validation

Portable tests cover validation, callback ordering, nested scopes and errors.
The Windows container fixture executes production state transitions and crosses
an actual COM CCW vtable to check inherited IOleWindow slots, MSG and BOOL ABI
on x86 and x64. It is a repository-owned contract fixture, not certification of
arbitrary third-party binaries. The installed Shell.Explorer.2 test records its
actual active-object outcome separately, including explicit E_NOTIMPL outcomes.

## References

- [IOleInPlaceActiveObject](https://learn.microsoft.com/en-us/windows/win32/api/oleidl/nn-oleidl-ioleinplaceactiveobject)
- [TranslateAccelerator](https://learn.microsoft.com/en-us/windows/win32/api/oleidl/nf-oleidl-ioleinplaceactiveobject-translateaccelerator)
- [EnableModeless](https://learn.microsoft.com/en-us/windows/win32/api/oleidl/nf-oleidl-ioleinplaceactiveobject-enablemodeless)
