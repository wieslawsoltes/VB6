# Source debugger and runtime execution control

The browser IDE and the reusable JavaScript source runtime share the same debugger.
This guide describes implemented behavior and its boundaries, not certification
against Microsoft's VB6 executable runtime.

## Classic debugging workflow

| Command | Shortcut | Behavior |
| --- | --- | --- |
| Start / Continue | F5 | Starts the project, or continues its suspended execution. |
| Break | Ctrl+Break / Ctrl+Pause | Requests a cooperative break at the next executable statement. |
| End / Reset | Shift+F5 | Cancels execution and evaluation, closes the application, and returns to design mode. |
| Step Into | F8 | Starts in break mode or executes one source statement, entering called procedures. |
| Step Over | Shift+F8 | Executes called procedures without stopping for stepping inside them; breakpoints still interrupt. |
| Step Out | Ctrl+Shift+F8 | Finishes the current invocation and stops at the next caller statement. |
| Run to Cursor | Ctrl+F8 | Runs from design mode or a pause to the selected executable statement. |
| Set Next Statement | Ctrl+F9 | Changes the pending statement within a validated region of the active procedure. |
| Toggle Breakpoint | F9 | Adds or removes a breakpoint on executable source. |
| Clear All Breakpoints | Ctrl+Shift+F9 | Removes breakpoints without removing break watches. |
| Quick Watch | Shift+F9 | Inspects the selection in the selected stack frame. |
| Call Stack | Ctrl+L | Opens the call-stack tool window. |
| Immediate | Ctrl+G | Opens the Immediate window. |

Show Next Statement returns the editor to the pending statement, including its
column. Source highlighting distinguishes statements on a colon-separated line.
Declarations, blank lines, comments, and compiler-generated branch-skipping
instructions are not stepping locations. Loop tests and increments are executable
sequence points. A breakpoint on a physical line fires once per traversal, rather
than once for every colon-separated statement on that line.

```vb
Sub Main()
    Dim x As Long
    x = 1: x = 2: Debug.Print x
End Sub
```

Press F8 three times to stop before each statement on the third line. Place the
cursor on `Debug.Print x` and use Ctrl+F9 to skip preceding assignments within the
same safe region. Run to Cursor and Set Next Statement select a statement by
column; a physical-line breakpoint still applies to the line as a whole.

Statements split with `_` retain their physical starting line. When a logical
statement cannot be represented as one contiguous source span, the editor
highlights that starting line instead of inventing incorrect column coordinates.

## Error trapping and recovery

Tools → Options → General contains the classic Error Trapping choices. The saved
project setting is `settings.errorTrapping`; changing it updates an active IDE
runtime without requiring a restart.

| Choice | Runtime value | Behavior |
| --- | --- | --- |
| Break on All Errors | `all` | Breaks before dispatch to an enabled error handler. |
| Break in Class Module | `class` | Breaks at an unhandled class/form error even when its caller has a handler; locally handled class errors do not break. Unhandled standard-module errors also break. |
| Break on Unhandled Errors | `unhandled` | Allows enabled handlers to run. An unhandled class error surfaces at its caller; a top-level class/form callback has no caller and breaks there. |

An error break preserves the live frames that have not already unwound, their
local storage, ByRef references, `Err`, and `Erl`. The classic **End / Debug / Help**
dialog appears. Debug dismisses the dialog without resuming. End resets the
project. Help explains the available recovery actions without opening a network
page.

For an error with an enabled handler, Continue dispatches the already-raised
error to that handler, rather than executing the failed statement twice. For an
unhandled error, correct a value in Locals or Immediate, or apply a supported code
edit, then Continue to retry the pending statement. Set Next Statement can skip a
fault within a safe region. Retrying is not a transaction: side effects performed
before the error are not rolled back.

```vb
Sub Main()
    Dim divisor As Long, result As Long
    result = 12 / divisor
    Debug.Print result
End Sub
```

Run this project, choose Debug at error 11, enter `divisor = 3` in Immediate, then
press F5. The suspended assignment retries and prints `4`.

`Stop` and a false `Debug.Assert` break on their own source statement, including
when that is the final statement in a procedure. Continue moves past an already
executed Stop or Assert unless Set Next Statement explicitly redirects it. The
Assert expression is evaluated once, not again during inspection.

## Inspection, watches, and Immediate

Locals and Call Stack retain their existing dockable/detachable classic tool
windows. Caller locations now identify the active call site, not the following
statement. Each invocation has an independent frame identity, including recursive
calls. Selecting a caller changes the inspection/evaluation context without
changing the actual execution frame. Typed edits to a caller's ByRef variable are
visible in the callee.

Quick Watch, Locals, automatic data tips, breakpoint conditions, and automatic
watches use the bounded read-only inspector. They do not invoke source procedures,
property getters, lazy object constructors, or arbitrary JavaScript accessors.
Condition evaluation failures cause an inspectable breakpoint-condition pause
instead of silently hiding a failed condition.

Watch expressions, Break When True, and Break on Change retain module/procedure
scope. Procedure-scoped baselines belong to an invocation, so recursion does not
confuse values. A suspended caller changed ByRef is observed. Module-scoped watches
use module storage rather than a shadowing local and retain their baseline across
procedure returns. Changes made by a procedure's final statement are observed at
its implicit return. Break watches are installed before startup execution.

Immediate supports expressions (`? x`), explicit procedure calls (`Call Work()`),
Let/Set assignment, indexed array/member targets, and multiple statements separated
by colons. Colons inside string/date literals are not separators. Set preserves
object assignment semantics; Let uses default-value conversion. A running source
frame cannot be mutated concurrently through Immediate: pause it first.

Evaluate Expression is the explicit, potentially effectful alternative to
inspection. Existing instruction/time budgets, cancellation, and restoration of
paused debugger state remain in force. Evaluation cannot be used to evade a Reset
through `On Error Resume Next`. Values and other side effects intentionally caused
by explicit evaluation remain application changes; cancelling is not rollback.

## Live editing and state safety

Supported code edits are validated atomically before live frames or procedures
are modified. Paused statement replacements and supported linear insertions
retain state; source-line/column mappings, call sites, and breakpoints relocate.
Execution-setting comparisons ignore the debugger-only Error Trapping preference.

Changes to live declarations, storage layouts, signatures, modules, or unsafe
active control flow still require restarting. Set Next Statement does not cross
procedure, declaration, loop/With, branch, or active-error-handler boundaries that
the VM cannot safely reconstruct. Rejected edits do not partially mutate the
program. This is not unrestricted native VB6 Edit and Continue.

Each new pause, successful Set Next Statement, or applied live edit advances the
pause identity. Explicit evaluation and mutation APIs can supply that identity to
reject stale operations. Reset also cancels pending debugger evaluation and
settles queued-event promises; a paused application does not dispatch queued user
events behind the debugger.

## Embedding the reusable runtime

```js
import { VirtualMachine } from '../src/runtime/vm.js';

const vm = new VirtualMachine(project, host, {
  debuggerEnabled: true,
  debugStatements: true,
  errorTrapping: 'unhandled',
});

vm.on('pause', event => {
  // Keep this callback short. A UI or protocol client resumes later.
  console.log(event.reason, event.pauseId, vm.debugStack());
});

vm.setBreakpoint('Module1', 12, 'counter > 3');
await vm.start(); // Resolves after startup finishes; a startup pause waits here.
```

The independent debugger control module is `src/runtime/debug-control.js`.
`VirtualMachine` remains the public integration point. No additional dependency or
network service is required.

| API | Contract |
| --- | --- |
| `configureDebugger({enabled, errorTrapping})` | Validates options before updating them. |
| `setBreakpoint(module, line, condition, enabled)` | Validates an executable location and parses a bounded condition. |
| `replaceBreakpoints(array)` | Validates the complete batch before replacing any existing breakpoint. |
| `debugStack()` | Returns serializable frame IDs, indices, modules, procedures, and source spans. |
| `inspectDebug(expression, {frameIndex})` | Read-only inspection in the chosen live frame. |
| `immediate(text, {frameIndex, pauseId})` | Explicit bounded evaluation/assignment while paused. |
| `resume('continue' \| 'into' \| 'over' \| 'out')` | Continues a suspended frame. |
| `start({breakOnEntry, runToCursor})` | Supports startup break or a validated `{module,line,column?}` target. |
| `runToCursor(module, line, column?)` | Sets a one-shot target and resumes from break mode. |
| `setNextStatement(module, line, column?)` | Redirects within the active procedure after safety checks. |
| `resumeError('retry' \| 'next' \| 'handler')` | Explicit error-break recovery for debugger hosts. |
| `stop()` | Cancels execution/evaluation and resets the runtime. |

The existing authenticated IDE iframe bridge forwards debugger options, error
recovery, stack inspection, and source-column commands alongside existing
inspection, evaluation, watch, and live-edit commands. Its source-window/token
checks are unchanged. Existing agent operations continue using these VM APIs.

Headless VMs do not enable interactive error trapping by default. IDE application
hosts enable it; ordinary exported HTML applications do not. In ordinary HTML
exports, Assert is not evaluated and Stop resets rather than waiting for an
unavailable debugger. This project's established `Debug.Print` console output is
retained in exported HTML as a browser extension; it is not native compiled-VB6
Debug-object removal.

## Validation and compatibility limits

`tests/debugger-runtime.test.mjs` adds 50 focused regression tests. The full unit
suite at implementation time passes 1,502 tests. The generated-application browser
suite `tools/browser-debugger-runtime.py` covers 12 end-to-end workflows, including
actual shortcuts, source highlights, the error dialog, Immediate repair, caller
locals, startup watches, live settings, and exported-app behavior. It records
JSON and screenshots under `reports/debugger-runtime/`; CI retains these as
artifacts. Existing compiler, runtime, live-edit, evaluation, and browser suites
remain enabled.

```sh
npm test
npm run build
python tools/browser-debugger-runtime.py
# CI also runs the same browser suite with VB6_BROWSER=firefox and webkit.
```

Remaining boundaries include native machine-code/P-code debugging, attaching to
arbitrary Windows EXE/DLL/COM processes, native cross-process stacks, unrestricted
Edit and Continue, design-mode Immediate without a started runtime, and exact
native VB6 pixel/font behavior. Automatic watch/getter restrictions are deliberate
safety differences. No licensed native VB6 debugger oracle was available for
this validation, so full original-runtime equivalence is not asserted.

## Reference behavior

Microsoft's classic Visual Basic/VBA documentation was used for command and error
mode semantics, not as evidence of a native VB6 certification:

- [Debug menu and shortcuts](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/debug-menu)
- [Options / General / Error Trapping](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/options-dialog-box)
- [Stop statement](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/stop-statement)
- [Assert method](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/assert-method)
