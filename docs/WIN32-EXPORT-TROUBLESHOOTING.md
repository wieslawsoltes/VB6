# Troubleshooting native EXE export

## Calculator fails on `firstNumber As Double`

The old error `Native storage requires Byte, Integer, Long, Boolean or String: firstNumber` came from an older native compiler that could not store Double values. The Calculator example intentionally uses Double. Do not change it to Integer or Long: that would lose fractional calculations instead of fixing the compiler.

Current source includes native Single/Double storage, arithmetic and conversions, floating arrays, and the indexed buttons used by the original Calculator. The unchanged `examples/calculator.vb6web` is exercised by native Windows and browser/worker export tests. See [numeric support](WIN32-NUMERIC.md).

A downloaded standalone HTML file embeds its own compiler. Updating the repository or opening a newer hosted IDE does not update that old file. Keep a saved copy of your project, replace the old standalone IDE with a freshly built/downloaded `dist/VB6-Studio-Web.html`, and reopen the project. Stop execution before selecting **File > Make Calculator.exe (Win32 AOT)**. A successful export downloads an EXE and reports its name and byte count in the status bar. Exporting does not run that executable in the browser.

## Build from source

From the repository root, with Node.js 22 or later:

```sh
npm run build
npm run build:win32 -- --project examples/calculator.vb6web --out release/calculator
npm run test:win32
```

The direct compiler does not need desktop npm dependencies. Original VBP projects use the same repository command; use `--source-root` when their referenced source files share a wider parent directory. Use a new output directory for another build: existing executable files are deliberately not overwritten.

Downloaded source archives include `LICENSE`, `THIRD-PARTY-NOTICES.md` and the source dependencies needed by Windows staging. CI extracts the actual source artifact into an empty workspace, without checking out the repository, then rebuilds and runs its full regression suite. An archive that builds only after silently borrowing files from another checkout is not considered reproducible.

## A different unsupported feature is reported

The browser VM, direct native compiler and classic VB6 compiler integration are separate targets. A program that runs in the browser is not automatically supported by the typed native compiler. Preserve the full diagnostic, module/procedure and source when reporting another failure. Unsupported features should produce diagnostics rather than an apparently successful EXE with missing behavior.

The direct compiler emits no-extraction PE32/x86 applications with native Windows controls/GDI. It is not the Electron/WebGPU target and does not provide all VB6 types, controls, COM/OCX, callback/structure ABIs or HTML/Electron database providers. See [native compiler contract](WIN32-AOT.md), [array contract](WIN32-ARRAYS.md), and [target selection](WINDOWS-BUILDS.md). Windows DLL imports require their original matching ABI and are not sandboxed. Run only trusted generated applications.
