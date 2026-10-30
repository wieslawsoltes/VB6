# Vim editing engine

`vim.js` is the editor-independent engine from
[`@replit/codemirror-vim-core` 0.1.0](https://www.npmjs.com/package/@replit/codemirror-vim-core/v/0.1.0),
published by the [Replit CodeMirror Vim project](https://github.com/replit/codemirror-vim/tree/master/packages/codemirror-vim-core).
It has no runtime package dependencies. Its MIT license is retained in `LICENSE`.

Original source file SHA-256:
`a8c2887193e966a6d1c4acf01105a0b6e8ed11e8ff26dfe3bb8a898649efe650`.

Source with the nonsemantic packaging normalization below SHA-256:
`102e7818bc392e42fcbf638a63cae153be6dd23e8b4d0506ca810801e99fb5b1`.

Patched source file SHA-256:
`82ea6d8a0629d7d2ea2c30690f069158f7342be1f3adab496b0077a796dc2dc0`.

The three localized changes in `clipboard-host.patch` register `*` and delegate
clipboard register reads/writes to the host. The upstream direct browser calls
could reject without a handler or paste into a document that changed during an
asynchronous permission request. The adapter supplies permission-safe fallback,
document/selection/disposal guards, and atomic asynchronous edit transactions.
Two nonsemantic packaging normalizations precede that patch: trailing whitespace
is removed, and the HTML-comment opening in the documentation example is written
as `\x3c!--`. This prevents the standalone IDE payload from entering HTML
legacy double-escaped script parsing. All other engine source is unchanged.

The source is intentionally readable and pinned. The IDE's existing bundler
includes its named `initVim` export without a framework, package installation,
CDN request, alternate editor, or remote execution. The adjacent adapter supplies
the CodeMirror-style editing interface against the IDE's canonical editor host.

When updating, copy the package's `vim.js` and `LICENSE`, update this provenance
and hash, and run the input-mode unit and browser suites. The engine implements
modal editing, not a Vim executable: Vimscript, native plugins, terminal shell
execution, and arbitrary filesystem commands are outside its browser editor API.
