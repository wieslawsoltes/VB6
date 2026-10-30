export const APPLICATION_DESKTOP_CSS = `
html[data-vb-desktop=true] #app{bottom:40px}
html[data-vb-desktop=true] #vb6-startup{bottom:calc(40px + 1rem)}
#vb6-desktop{font:12px/1.4 var(--vb-font,sans-serif);color:var(--vb-text);--disk-border:var(--vb-shadow)}
#vb6-desktop .vb6-desktop-bar{position:fixed;bottom:0;left:0;right:0;height:40px;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:4px 8px;background:var(--vb-face);border-top:2px outset var(--vb-light);z-index:2147483001}
#vb6-desktop button{font:inherit;color:inherit;background:var(--vb-face);border:2px outset var(--vb-light);padding:3px 10px;min-height:28px;cursor:pointer}
#vb6-desktop button:active{border-style:inset}
#vb6-desktop button:focus-visible{outline:2px solid var(--vb-selection);outline-offset:2px}
#vb6-desktop button:disabled{color:var(--vb-gray);cursor:default}
#vb6-desktop .vb6-desktop-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:bold}
#vb6-desktop .vb6-desktop-state{margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#vb6-desktop .vb6-disk-window{box-sizing:border-box;width:min(720px,calc(100vw - 24px));max-height:calc(100vh - 64px);padding:12px;background:var(--vb-face);color:var(--vb-text);border:2px outset var(--vb-light)}
#vb6-desktop .vb6-disk-window::backdrop{background:#0005}
#vb6-desktop .vb6-disk-window header,#vb6-desktop .vb6-disk-window nav,#vb6-desktop .vb6-disk-window footer{display:flex;align-items:center;gap:10px}
#vb6-desktop .vb6-disk-window header{justify-content:space-between}
#vb6-desktop .vb6-disk-window h1{font-size:16px;margin:0}
#vb6-desktop .vb6-disk-window footer{justify-content:flex-end;margin-top:12px}
#vb6-desktop .vb6-disk-notice{margin:12px 0;white-space:pre-wrap;overflow-wrap:anywhere}
#vb6-desktop .vb6-disk-path{flex:1;overflow-wrap:anywhere}
#vb6-desktop .vb6-disk-scroll{margin-top:12px;overflow:auto;max-height:50vh;border:2px inset var(--vb-light);background:var(--vb-window);color:var(--vb-window-text)}
#vb6-desktop .vb6-disk-table{border-collapse:collapse;width:100%}
#vb6-desktop th,#vb6-desktop td{padding:6px 8px;border-bottom:1px solid var(--disk-border);text-align:left;overflow-wrap:anywhere}
#vb6-desktop th{position:sticky;top:0;background:var(--vb-face)}
#vb6-desktop td:nth-child(2){white-space:nowrap}
@media(max-width:560px){#vb6-desktop .vb6-desktop-title,#vb6-desktop .vb6-desktop-state{display:none}#vb6-desktop .vb6-desktop-bar{justify-content:space-between}#vb6-desktop th,#vb6-desktop td{padding:5px}}
`;
