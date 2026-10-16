# Vim editing engine

`vim.js` is the editor-independent engine from
[`@replit/codemirror-vim-core` 0.1.0](https://www.npmjs.com/package/@replit/codemirror-vim-core/v/0.1.0),
published by the [Replit CodeMirror Vim project](https://github.com/replit/codemirror-vim/tree/master/packages/codemirror-vim-core).
It has no runtime package dependencies. Its MIT license is retained in `LICENSE`.

Original source file SHA-256:
`a8c2887193e966a6d1c4acf01105a0b6e8ed11e8ff26dfe3bb8a898649efe650`.

Source with trailing whitespace normalized SHA-256:
`7e0127c558f98f6053fca82888836650ac4074a857636058d541aa7c40496838`.

Patched source file SHA-256:
`7bc67a1391ea08162eb4dedb3f4f2b234258fa59a2841f3a08c652e228b71122`.

The three localized changes in `clipboard-host.patch` register `*` and delegate
clipboard register reads/writes to the host. The upstream direct browser calls
could reject without a handler or paste into a document that changed during an
asynchronous permission request. The adapter supplies permission-safe fallback,
document/selection/disposal guards, and atomic asynchronous edit transactions.
Trailing whitespace is normalized without changing behavior; all other engine
source is unchanged. The patch applies after that whitespace normalization.

The source is intentionally readable and pinned. The IDE's existing bundler
includes its named `initVim` export without a framework, package installation,
CDN request, alternate editor, or remote execution. The adjacent adapter supplies
the CodeMirror-style editing interface against the IDE's canonical editor host.

When updating, copy the package's `vim.js` and `LICENSE`, update this provenance
and hash, and run the input-mode unit and browser suites. The engine implements
modal editing, not a Vim executable: Vimscript, native plugins, terminal shell
execution, and arbitrary filesystem commands are outside its browser editor API.
