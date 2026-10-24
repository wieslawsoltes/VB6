/** Dimensions are expressed in display cells, not unrelated pixel constants.
 * These selectors never enter a runtime form's authored client/layout model. */
export const TUI_WORKSPACE_CSS = `
[data-tui-shell] .ide-shell {padding:0!important;border:0!important;grid-template-rows:var(--dos-line) var(--dos-line) auto minmax(0,1fr) auto var(--dos-line) var(--dos-line)!important;}
[data-tui-shell] .ide-shell:not(.command-bar-shell){grid-template-rows:var(--dos-line) var(--dos-line) auto minmax(0,1fr) var(--dos-line) var(--dos-line)!important;}
[data-tui-shell] .app-title {height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0 var(--dos-cell-width)!important;border:0!important;}
[data-tui-shell] .menubar {height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0 var(--dos-cell-width)!important;border:0!important;gap:var(--dos-cell-width)!important;}
[data-tui-shell] .menubar>button {height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0 var(--dos-cell-width)!important;line-height:var(--dos-line)!important;border:0!important;}
[data-tui-shell] .command-bars-host {padding:0!important;background:var(--dos-bg)!important;}
[data-tui-shell] .ide-shell .command-bar {min-height:var(--dos-line)!important;padding:0!important;border:0!important;gap:0!important;}
[data-tui-shell] .command-bar .tool-button,[data-tui-shell] .panel-toolbar .tool-button {width:var(--tui-label-width,calc(8*var(--dos-cell-width)))!important;min-width:0!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0!important;border:0!important;flex-shrink:0!important;}
[data-tui-shell] .command-bar .toolbar-grip{width:var(--dos-cell-width)!important;flex:0 0 var(--dos-cell-width)!important;min-height:var(--dos-line)!important;border:0!important;}
[data-tui-shell] .command-bar .tool-separator{width:var(--dos-cell-width)!important;flex:0 0 var(--dos-cell-width)!important;margin:0!important;border:0!important;}
[data-tui-shell] .command-bar .toolbar-select{width:calc(8*var(--dos-cell-width))!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;margin:0!important;}
[data-tui-shell] .toolbar .tool-button::after{content:none!important;}
[data-tui-shell] .ide-shell .workspace.dock-workspace {grid-template-columns:var(--tui-dock-left,192px) var(--tui-gap-left,8px) minmax(0,1fr) var(--tui-gap-right,8px) var(--tui-dock-right,320px)!important;grid-template-rows:var(--tui-dock-top,0px) var(--tui-gap-top,0px) minmax(0,1fr) var(--tui-gap-bottom,0px) var(--tui-dock-bottom,0px)!important;}
[data-tui-shell] .dock-zone>.dock-group{flex:0 0 var(--tui-group-size,auto)!important;box-sizing:border-box!important;border:0!important;padding:0 var(--dos-cell-width) var(--dos-line)!important;overflow:hidden!important;}
[data-tui-shell] .dock-zone>.dock-group-splitter{flex:0 0 var(--dos-line)!important;background:var(--dos-desk)!important;}
[data-tui-shell] :is(.dock-zone-top,.dock-zone-bottom)>.dock-group-splitter{flex-basis:var(--dos-cell-width)!important;}
[data-tui-shell] .dock-edge-splitter{background:var(--dos-desk)!important;}
[data-tui-shell] .dock-group .managed-panel>.tool-caption {flex:0 0 var(--dos-line)!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0!important;gap:0!important;background:var(--dos-bg)!important;color:var(--dos-fg)!important;}
[data-tui-shell] .tool-caption>strong{visibility:visible!important;font:inherit!important;}
[data-tui-shell] :is(.tool-caption,.document-title) :is(button,.window-buttons button){width:calc(3*var(--dos-cell-width))!important;min-width:0!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0!important;border:0!important;}
[data-tui-shell] .toolbox-tabs {padding:0!important;margin:0!important;min-height:var(--dos-line)!important;height:var(--dos-line)!important;}
[data-tui-shell] .toolbox-grid{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:0!important;padding:var(--dos-line) 0 0!important;justify-content:stretch!important;}
[data-tui-shell] .toolbox-grid button{display:block!important;width:100%!important;min-width:0!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0!important;border:0!important;}
[data-tui-shell] .toolbox-grid button::after{content:none!important;}
[data-tui-shell] .panel-toolbar{display:flex!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0!important;border:0!important;align-items:center!important;gap:0!important;overflow:auto!important;}
[data-tui-shell] .project-tree {padding:0!important;border:0!important;background:var(--dos-bg)!important;}
[data-tui-shell] .tree-row{height:var(--dos-line)!important;min-height:var(--dos-line)!important;line-height:var(--dos-line)!important;border:0!important;padding-top:0!important;padding-bottom:0!important;}
[data-tui-shell] .property-object {margin:0!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;box-sizing:border-box!important;border:0!important;padding:0!important;}
[data-tui-shell] .property-inspector,[data-tui-shell] .property-grid{border:0!important;}
[data-tui-shell] .property-tabs {height:calc(2*var(--dos-line))!important;min-height:calc(2*var(--dos-line))!important;margin:0!important;padding:0!important;gap:var(--dos-cell-width)!important;align-items:center!important;border:0!important;}
[data-tui-shell] .property-tabs button {height:var(--dos-line)!important;min-height:var(--dos-line)!important;border:0!important;padding:0 var(--dos-cell-width)!important;}
[data-tui-shell] .property-row {grid-template-columns:minmax(0,46%) minmax(0,54%)!important;min-height:var(--dos-line)!important;border:0!important;}
[data-tui-shell] .property-row :is(.property-name,.property-value,input,select){height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0!important;border:0!important;line-height:var(--dos-line)!important;}
[data-tui-shell] .property-row .property-edit-button{min-width:calc(3*var(--dos-cell-width))!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0!important;border:0!important;}
[data-tui-shell] .property-category {padding:0!important;min-height:var(--dos-line)!important;line-height:var(--dos-line)!important;border:0!important;}
[data-tui-shell] .property-description {min-height:calc(4*var(--dos-line))!important;padding:var(--dos-line) 0 0!important;border:0!important;line-height:var(--dos-line)!important;}
[data-tui-shell] :is(.property-description,.layout-monitor,.debug-body) {background:var(--dos-bg)!important;color:var(--dos-fg)!important;}
[data-tui-shell] .layout-monitor {border:0!important;box-shadow:none!important;margin:0!important;padding:var(--dos-line) var(--dos-cell-width)!important;}
[data-tui-shell] .layout-mini-form {border:0!important;box-shadow:none!important;}
[data-tui-shell] .layout-screen {border:0!important;box-shadow:none!important;background:var(--dos-desk)!important;}
[data-tui-shell] .dock-tabbar {height:var(--dos-line)!important;flex-basis:var(--dos-line)!important;gap:var(--dos-cell-width)!important;border:0!important;}
[data-tui-shell] .dock-tabbar>button {height:var(--dos-line)!important;min-height:var(--dos-line)!important;border:0!important;padding:0 var(--dos-cell-width)!important;}
[data-tui-shell] .mdi-window {padding:0 var(--dos-cell-width) var(--dos-line)!important;border:0!important;box-shadow:var(--dos-cell-width) var(--dos-line) #000!important;background:var(--dos-desk)!important;}
[data-tui-shell] .mdi-window>.document-title{height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0!important;gap:0!important;}
[data-tui-shell] .document-title .window-buttons{gap:0!important;}
[data-tui-shell] .mdi-client{border:0!important;}
[data-tui-shell] .mdi-desktop{background-image:var(--tui-desktop-pattern)!important;background-repeat:repeat!important;}
[data-tui-shell] .statusbar {height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0 var(--dos-cell-width)!important;border:0!important;gap:calc(2*var(--dos-cell-width))!important;}
[data-tui-shell] .statusbar>*{height:var(--dos-line)!important;padding:0!important;line-height:var(--dos-line)!important;border:0!important;}
[data-tui-shell] .dos-function-bar{height:var(--dos-line)!important;min-height:var(--dos-line)!important;flex-wrap:nowrap!important;overflow-x:auto!important;overflow-y:hidden!important;scrollbar-width:none!important;padding:0!important;}
[data-tui-shell] .dos-function-bar::-webkit-scrollbar{display:none!important;}
[data-tui-shell] .dos-function-bar button{flex:1 0 0!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;min-width:calc(14*var(--dos-cell-width))!important;padding:0!important;border:0!important;}
[data-tui-shell] .browser-window-root>.dos-function-bar{flex:0 0 var(--dos-line)!important;}
[data-tui-shell] .dos-function-bar kbd {margin:0!important;padding:0!important;}
[data-tui-shell] :is(.debug-tabs,.dialog-tabs){gap:var(--dos-cell-width)!important;border:0!important;padding:0!important;}
[data-tui-shell] :is(.debug-tabs,.dialog-tabs)>button{height:var(--dos-line)!important;min-height:var(--dos-line)!important;border:0!important;padding:0 var(--dos-cell-width)!important;}
[data-tui-shell] .debug-body :is(pre,textarea,input){font:calc(var(--dos-line)*.875)/var(--dos-line) monospace!important;background:var(--dos-desk)!important;color:var(--dos-hi)!important;border:0!important;}
[data-tui-shell] .ide-dialog {border:0!important;padding:var(--dos-line) var(--dos-cell-width)!important;background:var(--dos-bg)!important;box-shadow:calc(2*var(--dos-cell-width)) var(--dos-line) #000!important;}
[data-tui-shell] .ide-dialog-title{height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0!important;border:0!important;}
[data-tui-shell] .ide-dialog :is(fieldset,.options-group){border:1px solid var(--dos-border)!important;border-radius:0!important;}
[data-tui-shell] .ide-dialog :is(input,select,textarea,button){border-radius:0!important;box-shadow:none!important;}
[data-tui-shell] .ide-dialog :is(input:not([type=checkbox]):not([type=radio]),select,button){min-height:var(--dos-line)!important;}
/* Scrollbars are one display column, square and opaque; WebKit and standard
   scrollbar-color paths agree on the semantic EGA selection/track colors. */
[data-tui-shell] :is(.dock-panel,.toolbox,.project-tree,.property-inspector,.designer-scroll,.code-scroll,.debug-body,.ide-dialog) {scrollbar-color:var(--dos-fg) var(--dos-bg);scrollbar-width:thin;}
[data-tui-shell] ::-webkit-scrollbar {width:var(--dos-cell-width);height:var(--dos-line);}
[data-tui-shell] ::-webkit-scrollbar-track{background:var(--dos-bg);}
[data-tui-shell] ::-webkit-scrollbar-thumb{background:var(--dos-fg);border:0;border-radius:0;}
[data-tui-shell] ::-webkit-scrollbar-corner{background:var(--dos-bg);}
[data-tui-shell] .menubar>button{width:var(--tui-label-width)!important;flex:0 0 var(--tui-label-width)!important;}
[data-tui-shell] .toolbar-grip{margin:0!important;}
[data-tui-shell] :is(.tool-caption,.document-title,.app-title,.ide-titlebar) button{margin:0!important;}
[data-tui-shell] .app-title button{width:calc(3*var(--dos-cell-width))!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;padding:0!important;border:0!important;}
[data-tui-frame-target]{border-color:transparent!important;border-image:none!important;box-shadow:none!important;outline:none!important;}
[data-tui-frame-target].vb-frame::before,[data-tui-frame-target].vb-frame::after{opacity:0!important;}
[data-tui-chrome-target].vb-frame-legend {min-width:0!important;font:calc(var(--dos-line)*.875)/var(--dos-line) monospace!important;letter-spacing:calc(var(--dos-cell-width) - 1ch)!important;}
[data-tui-shell] .ide-dialog {min-width:min(calc(100vw - 4*var(--dos-cell-width)),calc(88*var(--dos-cell-width)))!important;font:calc(var(--dos-line)*.875)/var(--dos-line) monospace!important;letter-spacing:calc(var(--dos-cell-width) - 1ch)!important;}
[data-tui-shell] .ide-dialog-body :is(label,legend,p,span,div,button,select,input,textarea):not(.ide-theme-preview *):not(.application-theme-preview *){font:inherit!important;letter-spacing:inherit!important;}
[data-tui-shell] .ide-dialog-body {padding:var(--dos-line) var(--dos-cell-width)!important;font:calc(var(--dos-line)*.875)/var(--dos-line) monospace!important;letter-spacing:calc(var(--dos-cell-width) - 1ch)!important;}
[data-tui-shell] .ide-dialog-body :is(fieldset,.options-group){border:0!important;padding:var(--dos-line) calc(2*var(--dos-cell-width))!important;margin:0 0 var(--dos-line)!important;}
[data-tui-shell] .ide-dialog-body legend{padding:0 var(--dos-cell-width)!important;line-height:var(--dos-line)!important;}
[data-tui-shell] .ide-dialog-body .option-check {display:flex!important;align-items:center!important;gap:var(--dos-cell-width)!important;margin:0!important;min-height:var(--dos-line)!important;}
[data-tui-shell] .ide-dialog-body input:is([type=checkbox],[type=radio]){width:calc(3*var(--dos-cell-width))!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;margin:0!important;flex-shrink:0!important;}
[data-tui-shell] .ide-dialog-body .option-field{margin:0 0 var(--dos-line)!important;min-height:var(--dos-line)!important;}
[data-tui-shell] .ide-dialog-body :is(input,select){box-sizing:border-box!important;border:0!important;padding:0!important;min-height:var(--dos-line)!important;line-height:var(--dos-line)!important;}
[data-tui-shell] .ide-dialog-body .dialog-grid{grid-template-columns:max-content minmax(0,1fr)!important;gap:0 var(--dos-cell-width)!important;}
[data-tui-shell] .ide-dialog-body .classic-tab-pages{border:0!important;padding:var(--dos-line) 0!important;}
[data-tui-shell] .ide-dialog-body .dialog-tabs{height:var(--dos-line)!important;min-height:var(--dos-line)!important;}
[data-tui-shell] .ide-dialog-body .dialog-tabs>button{padding:0 var(--dos-cell-width)!important;}
[data-tui-content-target]>:not(.vb-tui-chrome-surface){opacity:1!important;}
.vb-tui-chrome-surface:not(.vb-tui-frame-surface){left:var(--tui-scroll-x,0px)!important;top:var(--tui-scroll-y,0px)!important;}
[data-tui-chrome]>.vb-form-title .vb-window-button{width:calc(3*var(--dos-cell-width))!important;min-width:calc(3*var(--dos-cell-width))!important;padding:0!important;margin:0!important;border:0!important;height:var(--dos-line)!important;}
[data-tui-chrome]>.vb-form-menu>button{font:calc(var(--dos-line)*.875)/var(--dos-line) monospace!important;letter-spacing:calc(var(--dos-cell-width) - 1ch)!important;padding:0 var(--dos-cell-width)!important;}
[data-tui-field-target]:not(:focus){color:transparent!important;text-shadow:none!important;}
[data-tui-field-target]{font:calc(var(--dos-line)*.875)/var(--dos-line) monospace!important;letter-spacing:calc(var(--dos-cell-width) - 1ch)!important;}
[data-tui-shell] .debug-value-tree{--tui-row-height:var(--dos-line);}
[data-tui-shell] :is(.debug-context-bar,.debug-value-header,.debug-value-row,.debug-stack-row){font:calc(var(--dos-line)*.875)/var(--dos-line) monospace!important;letter-spacing:calc(var(--dos-cell-width) - 1ch)!important;min-height:var(--dos-line)!important;border:0!important;}
[data-tui-shell] .debug-value-row{height:var(--dos-line)!important;}
[data-tui-shell] .debug-context-bar{gap:var(--dos-cell-width)!important;}
[data-tui-shell] .debug-value-row :is(span,button){font:inherit!important;letter-spacing:inherit!important;line-height:var(--dos-line)!important;}
[data-tui-shell] .debug-expand{width:var(--dos-cell-width)!important;min-width:var(--dos-cell-width)!important;height:var(--dos-line)!important;padding:0!important;border:0!important;}
[data-tui-shell] :is(.object-toolbar,.object-search,.tool-section-label,.tool-status,.immediate-input-row,.watch-entry){min-height:var(--dos-line)!important;padding:0!important;gap:var(--dos-cell-width)!important;border:0!important;}
[data-tui-shell] :is(.object-toolbar,.object-search,.tool-section-label,.tool-status,.tool-list-row,.object-definition,.output-text,.immediate-input-row,.watch-entry,.debug-table){font:calc(var(--dos-line)*.875)/var(--dos-line) monospace!important;letter-spacing:calc(var(--dos-cell-width) - 1ch)!important;background:var(--dos-bg)!important;color:var(--dos-fg)!important;}
[data-tui-shell] :is(.object-toolbar,.object-search,.immediate-input-row,.watch-entry) :is(input,select,button){font:inherit!important;letter-spacing:inherit!important;line-height:var(--dos-line)!important;height:var(--dos-line)!important;min-height:var(--dos-line)!important;border:0!important;padding:0 var(--dos-cell-width)!important;}
[data-tui-shell] .object-toolbar{flex-wrap:wrap!important;}
[data-tui-shell] .object-toolbar button,[data-tui-shell] .object-search button{width:var(--tui-label-width,auto)!important;min-width:0!important;flex-shrink:0!important;}
[data-tui-shell] .object-search input[type=checkbox]{width:calc(3*var(--dos-cell-width))!important;margin:0!important;}
[data-tui-shell] .tool-section-label button{height:var(--dos-line)!important;min-height:var(--dos-line)!important;width:calc(3*var(--dos-cell-width))!important;border:0!important;padding:0!important;}
[data-tui-shell] .tool-list{--tui-row-height:var(--dos-line);border:0!important;box-shadow:none!important;background:var(--dos-bg)!important;color:var(--dos-fg)!important;}
[data-tui-shell] .tool-list-layer{left:0!important;right:0!important;top:0!important;}
[data-tui-shell] .tool-list-row{height:var(--dos-line)!important;line-height:var(--dos-line)!important;padding:0!important;gap:var(--dos-cell-width)!important;}
[data-tui-shell] .tool-list-row :is(span,button){font:inherit!important;line-height:inherit!important;letter-spacing:inherit!important;}
[data-tui-shell] .tool-list-row .member-kind{width:var(--dos-cell-width)!important;}
[data-tui-shell] :is(.object-definition,.output-text){padding:0!important;margin:0!important;border:0!important;box-shadow:none!important;tab-size:8!important;word-break:break-all!important;background:var(--dos-desk)!important;color:var(--dos-hi)!important;}
[data-tui-shell] .immediate-input-row{height:var(--dos-line)!important;flex-shrink:0!important;}
[data-tui-shell] .immediate-input-row>span{padding:0!important;}
[data-tui-shell] .debug-table :is(th,td){padding:0 var(--dos-cell-width)!important;line-height:var(--dos-line)!important;height:var(--dos-line)!important;border:0!important;}
@media(forced-colors:active){[data-tui-field-target]{color:CanvasText!important;}}
@media print{[data-tui-field-target]{color:#000!important;}}
@media(max-width:640px){[data-tui-shell] .menubar{overflow:auto!important;}[data-tui-shell] .menubar>button{flex-shrink:0!important;}[data-tui-shell] .ide-dialog{max-width:calc(100vw - 4*var(--dos-cell-width))!important;}}

/* Optional editors retain their model, widgets and hit targets. */
.vb-tui-text-view {position:absolute!important;left:0;top:0;pointer-events:none!important;z-index:2!important;image-rendering:pixelated;}
[data-tui-text-view] {position:relative;overflow:hidden;}
[data-tui-text-view] .monaco-editor :is(.view-lines,.margin-view-overlays,.cursors-layer) {opacity:0;}
[data-tui-root] .monaco-editor :is(.minimap,.scrollbar,.slider,.contentWidgets,.overlayWidgets) {z-index:5;}
[data-tui-root] :is(.monaco-editor,.monaco-editor-background,.monaco-editor .margin) {background:var(--dos-desk)!important;}
[data-tui-root] :is(.monaco-hover,.suggest-widget,.parameter-hints-widget,.quick-input-widget,.find-widget,.monaco-menu) {border:1px solid var(--dos-border)!important;border-radius:0!important;box-shadow:8px 16px #000!important;background:var(--dos-bg)!important;color:var(--dos-fg)!important;}
@media(forced-colors:active) {.vb-tui-text-view{display:none!important;}[data-tui-text-view] .monaco-editor :is(.view-lines,.margin-view-overlays,.cursors-layer){opacity:1;}}
@media print{.vb-tui-text-view{display:none!important;}[data-tui-text-view] .monaco-editor :is(.view-lines,.margin-view-overlays,.cursors-layer){opacity:1;}}

.vb-tui-picker {position:fixed;z-index:2147483000;max-width:calc(100vw - 16px);max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--dos-border);padding:var(--dos-line) var(--dos-cell-width);background:var(--dos-bg);color:var(--dos-fg);box-shadow:8px 16px #000;font:calc(var(--dos-line)*.875)/var(--dos-line) monospace;letter-spacing:calc(var(--dos-cell-width) - 1ch);}
.vb-tui-picker :is(button,input) {border:0;box-shadow:none;border-radius:0;color:inherit;background:inherit;font:inherit;letter-spacing:inherit;line-height:var(--dos-line);min-height:var(--dos-line);padding:0 var(--dos-cell-width);}
.vb-tui-picker button:focus {outline:1px solid var(--dos-border);background:var(--dos-select);}
.vb-tui-picker-list {max-height:calc(16*var(--dos-line));min-width:calc(24*var(--dos-cell-width));overflow:auto;}
.vb-tui-picker-list>button {display:block;width:100%;text-align:left;white-space:nowrap;}
.vb-tui-calendar-head {display:flex;justify-content:space-between;margin-bottom:var(--dos-line);}
.vb-tui-calendar-grid {display:grid;grid-template-columns:repeat(7,calc(4*var(--dos-cell-width)));grid-auto-rows:var(--dos-line);}
.vb-tui-calendar-grid>span {text-align:center;}
.vb-tui-color-grid {display:grid;grid-template-columns:repeat(4,calc(10*var(--dos-cell-width)));}

[data-tui-shell] .mdi-window:has([data-tui-form-space]) {width:var(--tui-form-window-width)!important;height:var(--tui-form-window-height)!important;}

/* Rich runs retain their actual semantic styles and RTF ownership while the
 * presentation establishes an exact monospace cell pitch for hit-test ranges. */
[data-tui-rich-editor] .vb-richtext, [data-tui-rich-editor] .vb-richtext * {
 font-family:monospace!important;font-size:calc(var(--dos-line)*.875)!important;
 line-height:var(--dos-line)!important;letter-spacing:var(--tui-native-spacing,0px)!important;
}
[data-tui-frame-target] { border-color:transparent!important;box-shadow:none!important; }

[data-tui-text-view] .minimap canvas {opacity:0!important;}
[data-tui-text-view] .monaco-editor .minimap {background:transparent!important;}
[data-tui-text-view] .monaco-editor .scrollbar {background:var(--dos-editor-bg,var(--dos-desk))!important;}
[data-tui-text-view] .monaco-editor .scrollbar>.slider, [data-tui-text-view] .minimap-slider {background:var(--dos-select)!important;}
`;
