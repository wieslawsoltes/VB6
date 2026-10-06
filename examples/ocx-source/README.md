# VB UserControl source lab

`Gauge.ctl` is real VB-formatted UserControl source; `ControlsLab.vbp` references
it as a control project. The lab parses the `.ctl` and executes its VB property,
lifecycle, persistence, mouse, key and Paint procedures with `SourceUserControl`.
It does not compile this project into a native OCX.

From the repository root:

```sh
npm run build
# Open dist/OCX-Source-Control-Lab.html, or serve dist/ over HTTP.
```

The generated HTML is self-contained. Try Apply, Step Up, Cancel Changes, Freeze
Outgoing Events, Save/Load State and Locale. Click the gauge to invoke its VB
MouseDown procedure. Design mode requires a separate consent checkbox and suppresses
input/outgoing events. Recreate the control to test initialization and cleanup.

The code pane displays the actual embedded `.ctl`. The visual gauge is Canvas2D
host rendering driven by the VB Value property; the VB Paint callback executes
without claiming the full VB drawing API. The child Readout object demonstrates
VB child-control property access.

`lab.template.html` contains the example host UI, not generated code. Regenerate the
runtime first; `node tools/build-ocx-lab.mjs` then rebuilds the lab alone.

`python tools/browser-ocx-source-lab.py` exercises 12 checks per origin. Its default
origins are HTTP and file; `VB6_OCX_LAB_ORIGINS=inline` explicitly selects the local
inline harness instead. See [the contract guide](../../docs/OCX-CONTAINER-CONTRACTS.md)
for API usage, trust boundaries, pending native validation, and remaining gaps.
