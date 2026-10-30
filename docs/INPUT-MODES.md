# Input modes and Vim

The IDE has an extensible input-mode service. **Default** is the initial mode and
uses the existing editor behavior. **Vim** adds modal editing to the same source
documents and project history. Input mode is independent of the editor backend,
workspace presentation, and authored application.

## Enable, switch, and discover commands

Choose **Tools → Input Mode → Vim**, click the input-mode button in the status
bar, or use **Tools → Options → Editor → Input Mode**. Options are staged until
OK; Cancel leaves the current mode unchanged. Select **Default** to restore the
familiar editor shortcuts immediately. In Vim, `:normalmode` also selects Default.

The preference is stored for this IDE in browser local storage under
`vb6-studio-web.input-mode.v1`. It is not a project setting or an exported runtime
dependency. Unavailable storage still allows switching for the current session;
invalid, unsupported, or unrecognized stored values fall back to Default.
If an extension registers the saved mode later during startup, it is restored
unless the user has already explicitly chosen a mode in the current session.

The status button displays the selected mode, Normal/Insert/Replace/Visual state,
pending keys, and macro recording. **Tools → Input Mode → Vim Key Reference**
opens an in-app reference. `:help` opens the same reference.

The same input mode applies to:

- Classic, Figma, and DOS / TUI workspace presentations.
- The built-in source editor and the optional Monaco editor.
- Module, procedure, declarations, large virtualized documents, and split panes.
- XAML source tools and source editors in detached browser windows.

Switching presentation or editor backend preserves the stable editor's Vim
session. Switching input mode disposes those sessions and restores the editor's
native cursor presentation and selection. Registers and macros are shared by Vim
sessions in the IDE. Marks and modal selections belong to their source session.

## Modal editing

Vim starts in Normal mode. Press `i` to insert text and `Esc` or `Ctrl+[` to return
to Normal. Ordinary Insert-mode typing continues through the underlying editor,
including its composition, completion, indentation, and language services.

| Area | Commands and examples |
| --- | --- |
| Modes | `i`, `a`, `I`, `A`, `o`, `O`; `R` for Replace; `v`, `V`, `Ctrl+V` for character, line, and block Visual modes |
| Counts and motions | `h j k l`, `gj gk` for wrapped rows, `w b e`, `W B E`, `0 ^ $`, `gg`, `G`, `12G`, `{ }`, `%`, `f/F`, `t/T`, `;`, `,` |
| Operators | `d`, `c`, `y`, `>`, `<`, `=`, `gu`, `gU`, `g~` combined with motions or selections; `3dw`, `ciw`, `dd`, `yy`, `>>` |
| Text objects | Inner/around words, paragraphs, quotes, paired delimiters, and tags; `iw`, `aw`, `ip`, `ap`, `i"`, `a(`, `it` |
| Editing | `x`, `X`, `r`, `D`, `C`, `s`, `S`, `J`, `gJ`, `p`, `P`, case changes, and numeric increment/decrement |
| Repeat and history | `.` repeats the last change, `u` undoes, `Ctrl+R` redoes; counted changes and native Insert text participate in repeat |
| Registers | `"a` through `"z`, uppercase append, unnamed and numbered registers, black-hole register, line/block contents, and `"+` / `"*` clipboard registers |
| Macros and marks | `qa … q`, `@a`, `@@`, counts on playback, `ma`, `'a`, and backtick plus `a` for an exact mark position |
| Search | `/pattern`, `?pattern`, `n`, `N`, `*`, `#`, search history, incremental search, and `:nohlsearch` / `:noh` to clear highlighting |
| Scrolling | `Ctrl+D/U`, `Ctrl+F/B`, `Ctrl+E/Y`, `H/M/L`, and `z` cursor placement commands |
| Ex editing | Line/range addresses, `:s`, `:%s/old/new/g`, confirmation with `gc`, `:global`, `:sort`, delete/yank/put, and supported `:set` / mapping commands |

In Visual block mode, operators act on the rectangular ranges. `I` and `A`
insert at the block's start or end; leaving Insert repeats the inserted text on
the other selected lines. Native source inputs display an overlay for ranges
their single-selection textarea cannot represent. Monaco uses its own multiple
selections. Both edit the same canonical document.

Monaco uses its displayed layout for vertical and page movement. `j` and `k`
move by source lines while skipping folded bodies; `gj` and `gk` move between
wrapped visual rows. A linewise operator spanning a fold includes its hidden
source. Macros and `:normal` also use the layout of their pending edits without
writing temporary text into the project or creating extra undo entries.

Search and Ex prompts are real inputs in the editor's owning window. This keeps
command history, keyboard selection, IME, and substitute confirmation usable in
detached windows. The engine supports Vim-style regular expressions and its PCRE
option; use the prompt's regex selector or `:set` options to choose the dialect.
Visible matches are highlighted in Classic, XAML, Monaco, and the DOS / TUI cell
renderer. `:nohlsearch` clears the highlights; a later search restores them.
Highlighting visits visible source ranges and leaves source selections and
history unchanged. Switching backends retains the active search; switching to
Default clears the Vim presentation and releases its listeners.

## IDE commands

| Command | IDE behavior |
| --- | --- |
| `:w`, `:write`, `:wall` | Save the project with the normal IDE save workflow |
| `:q`, `:quit`, `:close`, `:bd` | Close a split pane first, or close the editor document; project source remains in the project |
| `:wq`, `:x` | Save successfully, then close the active split or editor document |
| `:bn`, `:bp`, `:bN` | Open the next or previous project source module |
| `:buffer NAME`, `:buffer NUMBER` | Open a module by its name or its one-based position in the buffer list |
| `:ls`, `:buffers` | List project source buffers |
| `:split`, `:vsplit`, `:only` | Open a horizontal or vertical split, or return to a single pane |
| `Ctrl+W` then `s`, `v`, `o` | Split horizontally, split vertically, or retain one pane |
| `Ctrl+W` then `h/j/k/l` or arrows | Move to the neighboring pane in that direction, respecting the split orientation and stopping at its edge; cycle MDI documents when there is no split |
| `Ctrl+W` then `w/W/p`, `t/b` | Cycle panes or return to the other pane; select the top-left or bottom-right pane |
| `Ctrl+W` then `c/q`, `=` | Close the pane/document or equalize split size |
| `gd` | Use the editor's language definition navigation |
| `:run`, `:stop`, `:build` | Run, stop, or check syntax through the IDE |
| `:explore` | Focus Project Explorer |
| `:help`, `:normalmode`, `:vim` | Open the reference, select Default, or select Vim |

Ex operates on IDE documents and projects. To choose a filename use the IDE's
Save As workflow; `:write filename` does not bypass it. Closing a source window
does not delete its module. Save-and-close honors cancelled and failed saves.
Closing a split retains the other pane's cursor and view; `:only` retains the
current pane. A delayed save-and-close remains attached to the originally
requested pane. It cannot close another pane after focus moves or close the
remaining document after the original split has been removed or replaced.

## Input, clipboard, and history ownership

Only source text inputs receive modal commands. Menus, Properties, dialogs,
Project Explorer, Immediate/Watch fields, and authored running forms keep their
own input behavior. IDE function-key commands, `Ctrl+S`, `Ctrl+Tab`, Alt menu
mnemonics, and platform Command shortcuts retain priority. Browser/OS-reserved
shortcuts can still be handled before the page receives them.

Keys use the browser's layout-aware `event.key`; the engine's `langmap` option
can translate Normal-mode keys. Dead keys, AltGr, and active IME composition are
not interpreted as modal commands. Starting composition in Normal enters Insert
so the existing editor can own the preedit sequence.

The `+` and `*` registers use the owning window's clipboard when the browser
permits it. Permission denial or unavailable clipboard APIs leave a usable Vim
register and display a notification. A delayed clipboard read is discarded if
the source, selection, active text input, or session changes before it resolves.
Native paste is committed through the same editing host.

Pascal source uses the project's language unless its module declares an override.
Bracket motions in both classic and Monaco editors recognize Pascal strings,
brace comments, `(* ... *)` comments and compiler directives, so brackets inside
those spans do not change the matching source range.

Vim cursors, directed selections, and marks stay on complete Unicode code-point
boundaries. Leaving Insert or Replace mode over a supplementary character does
not leave the cursor inside a UTF-16 surrogate pair. Replace-mode Backspace
restores overwritten text during live editing, dot repeat, and macro playback;
typing a character identical to the existing source still participates in repeat.

Every Vim operation commits to the existing project history. A change followed
by an Insert/Replace session groups into one undo step, including typing slower
than the editor's ordinary timeout. Escape, focus changes, save/history
boundaries, and unrelated edits end that grouping. The history's existing size
budgets continue to apply; long insertions use bounded patch groups rather than
an open transaction that could hide unsaved edits. Project savepoints, dirty
state, bookmarks, diagnostics, and XAML/designer synchronization use the normal
edit notifications.

Procedure and virtualized inputs are views of the complete source. Motions and
operators use full-document UTF-16 offsets, so they can cross procedure and
virtual-window boundaries. A spanning selection switches a procedure projection
to the full module when needed. Source remains one canonical string; this
integration does not change the editor's large-document storage model.

Read-only source permits movement, selection, search, and yank operations while
rejecting edits, paste, undo, and redo. Mode changes and editor disposal remove
listeners, prompts, visual overlays, and temporary cursor settings.

## Add another input mode

`ide.inputModes` is an `EditorInputModeService`. Register a mode at runtime and
it appears in the menu, status selector, and newly opened Options dialogs:

```js
const unregister = ide.inputModes.registerMode({
  id: 'example',
  label: 'Example',
  description: 'Example editor key bindings.',
  createSession(host, {onStatus}) {
    const state = {mode: 'command', keyBuffer: '', status: ''};
    return {
      get state() { return state; },
      handleKey(key, event) {
        if (key !== '<C-j>') return false;
        const {head} = host.getSelections()[0];
        const next = host.getText().indexOf('\n', head);
        if (next >= 0) host.setSelections([{anchor: next + 1, head: next + 1}]);
        onStatus(state);
        return true;
      },
      sync(change) { /* Reconcile external edits/cursor changes if needed. */ },
      dispose() { /* Release session-owned resources. */ }
    };
  }
});

ide.inputModes.configure({mode: 'example'});
// Later: unregister();  // An active removed mode returns to Default.
```

IDs are unique lowercase names (`[a-z][a-z0-9-]{0,63}`). The built-in `default`
entry cannot be removed. Factories are lazy and receive one host per stable
editor, including editors opened later. A failed factory returns all editors to
Default. Repeated configuration with the same mode retains live sessions.

The host exposes full text, directed selections (`{anchor, head}`), sparse
canonical edits, undo/redo, focus, read-only state, language/options, geometry,
prompts, clipboard, and IDE commands. `host.apply(text, selections, options)`
commits an operation; `host.setSelections` only changes selection. Do not mutate
the textarea or create a second history/model. Backend-specific resolution
belongs in `editor-host.js`, not in a mode's command map.

Sessions must implement `handleKey` and `dispose`; `state`, `sync`,
`keyFromEvent`, and `executeEx` are optional. Return `true` only when a key is
handled. Call `onStatus` after state changes. Use `service.on('change', ...)` and
`service.snapshot()` for UI integration. Explicit `service.executeEx(command,
editor?)` selects the active code/XAML document, or the supplied stable editor.
An extension may publish its state entirely through `onStatus` without a
`state` getter. Callbacks belong to their creating session and are ignored after
that session is released. `keyFromEvent(event)` may return `undefined` to use the
shared key notation or `null` to decline handling that key. Translation failures
are reported through the same guarded path as command failures.

Optional `beginComposition` and `endComposition` hooks let a mode own its IME
state transitions. The service does not send Vim commands to other modes.
Deferred composition completion is delivered only to the session and composition
that started it; switching modes or starting another composition retires it.

## Engine, scope, and validation

The readable, pinned MIT-licensed `@replit/codemirror-vim-core` engine supplies
modal semantics. The adjacent adapter implements its editing interface against
the IDE host. See [vendor provenance, patch, and license](../src/editor/input-modes/vendor/README.md).
The production build bundles this engine locally and needs no extra package,
CDN, or server for Vim. It provides editor Vim behavior; it is not a native Vim
process and does not provide arbitrary Vimscript, native plugins, shell
execution, or operating-system filesystem commands.

Run the focused tests with:

```sh
npm run test:input-modes
npm run build
npm run test:input-modes:browser
```

For real Monaco coverage, install/build the optional advanced editor as described
in [Advanced editor](ADVANCED-EDITOR.md), then set `VB6_TEST_ADVANCED=1` for the
browser suite. `CHROMIUM_PATH` can select an installed Chromium executable;
`VB6_BROWSER` selects Chromium, Firefox, or WebKit. `VB6_TEST_TRANSPORT=file`
tests the standalone HTML build; the default uses local HTTP. Reports are written
under `reports/input-modes` and explicitly identify any advanced checks not run.

The CI advanced-editor group runs these tests on HTTP and file origins in all
three browser engines with actual Monaco enabled. Unit coverage includes modal
semantics, host offsets/projections, lifecycle, clipboard race handling, default
mode isolation, and bounded history grouping. Browser acceptance covers the
actual keyboard/UI path, Options persistence, Classic/DOS presentations, XAML,
virtualized sources, split views, and detached windows.
