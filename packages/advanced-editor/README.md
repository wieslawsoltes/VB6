# Optional advanced editor build dependencies

This private package pins the vendor dependencies for the opt-in VB6/XAML editor.
It is not installed by the normal dependency-free IDE build and does not publish
a replacement VB6 runtime.

From the repository root:

```sh
npm ci --prefix packages/advanced-editor
npm run build
npm run build:advanced-editor
npm run test:advanced-editor
```

The source implementation is in `src/editor/advanced/`; IDE integration is in
`src/ide/advanced-editor.js`. Transport, UTF-16 documents, protocol client,
workspace planning and language-server modules have explicit exported APIs and
can be imported independently from source. The Monaco surface uses the existing
IDE/project/designer/debugger adapters and is not a separate drop-in IDE.

See [Advanced editor architecture, deployment and compatibility](../../docs/ADVANCED-EDITOR.md)
for build outputs, language-server connection requirements, feature boundaries,
shortcuts and cross-browser validation. Review `monaco-compat.js` and its tests
when changing the pinned Monaco version.
