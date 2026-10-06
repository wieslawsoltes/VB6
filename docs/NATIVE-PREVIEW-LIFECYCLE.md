# Native IDE preview lifecycle

The IDE's document loader is selected before navigation. The normal browser IDE
sets iframe srcdoc; the desktop host first registers the generated document over
its root-only IPC bridge, then navigates the existing sandboxed frame directly to
the returned `vb6://app/preview/<id>` URL. Only that host-issued URL shape is accepted.
The preview retains its own hash-based Content Security Policy, opaque sandbox
origin, and no native IPC authority. The controller's policy is not weakened.

This replaces the previous desktop interception that started a srcdoc load and
removed the attribute in the same JavaScript task. Windows Electron traces showed
that the earlier srcdoc navigation could still commit after cancellation, block
the application script under the controller's CSP, and leave the DOM's later src
attribute pointing at a preview URL that never navigated. The failure reproduced
both on a fresh IDE and after detaching/restoring editor panes.

A registration response applies only to the run and connected iframe that
requested it. A late response or rejection for a stopped/replaced run cannot
navigate another frame or stop its execution. An active registration error stops
without waiting for a snapshot from a frame that never started; an obsolete error
does not overwrite a newer run's status. `nativePreviewReady` describes host
registration, **not** successful runtime execution. Native smoke checks separately
wait for actual frame navigation and the runtime application object.

`tests/native-preview.test.mjs` exercises registration, rejected URLs, synchronous
and asynchronous failures, stop/restart races, and browser-default preservation.
Windows desktop smoke runs the same project twice after pane detachment/restoration,
checks unique host documents, runtime startup, no native bridge, rejection of
unhashed inline scripts, and that no srcdoc navigation was initiated. Failure
reports retain the frame tree and requested iframe state without dumping project
source. Existing script hashes, sandbox flags and timeouts remain unchanged.

These checks apply to the Electron-hosted IDE preview. They do not change the
direct PE32 compiler, add a no-extraction WebGPU runtime, or certify physical GPU
execution or the proprietary Microsoft VB6 compiler.
