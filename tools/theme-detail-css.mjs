/** Shared caption/control paint, rebound at every IDE and application boundary.
 * No global theme selectors in the component sheet: nested apps stay independent.
 * Dimensions affect chrome only; authored client/control bounds are unchanged.
 */
export function themeDetailTokens(theme) {
  const family=theme.family||'classic',classic=family==='classic',mac=family==='macos26',x11=family==='x11',fluent=family==='fluent';
  const t=theme.tokens||{},c=theme.colors;
  const values={
    'button-background':classic||x11?c.face:'transparent',
    'button-hover':classic?c.face:t.hover,
    'button-pressed':classic?c.face:t.pressed,
    'button-ink':c.text,'button-shadow':classic?'var(--vb-bevel-raised)':x11?t.controlShadow:'none',
    'pressed-shadow':classic?'var(--vb-bevel-pressed)':x11?t.pressedShadow:'none',
    'button-border':x11?'1px solid '+t.border:'0px solid transparent',
    'button-radius':'0px','button-shift':classic||x11?'1px':'0px',
    'button-width':classic?'initial':mac?'12px':fluent?'24px':'18px',
    'button-height':mac?'12px':'initial','compact-width':classic?'initial':mac?'12px':fluent?'20px':'16px',
    'compact-height':mac?'12px':'initial',
    'emboss-display':classic?'block':'none','controls-order':mac?'-2':'0',
    'controls-gap':mac?'8px':'2px','title-align':mac||x11?'center':'start',
    'system-icon-display':mac?'none':'inline-flex','close-order':mac?'-3':'0',
    'minimize-order':mac?'-2':'0','maximize-order':mac?'-1':'0',
    'close-gap':mac||fluent?'0px':'2px','action-radius':mac?'50%':'0px',
    'action-shadow':mac?'inset 0 0 0 1px #0000001f':'initial',
    'action-glyph-opacity':mac?'0':'1','action-ink':mac?'#272727':c.text,
    'close-background':mac?'#ff5f57':classic||x11?c.face:'transparent',
    'minimize-background':mac?'#febc2e':classic||x11?c.face:'transparent',
    'minimize-hover':mac?'#febc2e':'initial','minimize-pressed':mac?'#d99e22':'initial',
    'minimize-ink':mac?'#6b4b00':'initial',
    'maximize-background':mac?'#28c840':classic||x11?c.face:'transparent',
    'maximize-hover':mac?'#28c840':'initial','maximize-pressed':mac?'#1fa333':'initial',
    'maximize-ink':mac?'#005b0c':'initial',
    'close-hover':mac?'#ff5f57':fluent?'#c42b1c':classic?c.face:t.hover,
    'close-hover-ink':fluent?'#ffffff':mac?'#4d0000':c.text,
    'close-pressed':mac?'#df4942':fluent?'#a92216':classic?c.face:t.pressed,
    'disabled-background':mac?t.separator:classic||x11?c.face:'transparent',
    'disabled-ink':c.gray,'focus-style':classic||x11?'dotted':'solid',
    'focus-width':classic||x11?'1px':'2px','focus-color':classic?c.text:t.focus,
    'caption-weight':classic||x11?'700':fluent?'400':'600',
    'check-clip':classic?'polygon(0 3px,1px 3px,1px 4px,2px 4px,2px 5px,3px 5px,3px 4px,4px 4px,4px 3px,5px 3px,5px 2px,6px 2px,6px 1px,7px 1px,7px 0,8px 0,8px 3px,7px 3px,7px 4px,6px 4px,6px 5px,5px 5px,5px 6px,4px 6px,4px 7px,3px 7px,3px 8px,2px 8px,2px 7px,1px 7px,1px 6px,0 6px)':'polygon(0 35%,33% 68%,100% 0,100% 36%,33% 100%,0 66%)',
    'menu-separator':classic||x11?'1px solid var(--vb-light)':'0px solid transparent',
    'menu-radius':classic||x11?'0px':t.radius,
    'menu-selected-shadow':x11?t.controlShadow:'none',
    'scrollbar-radius':classic||x11?'0px':'8px',
    'scrollbar-size':classic||x11?'16px':'12px',
    'scrollbar-border':classic||x11?'0px':'3px solid var(--vb-face)',
    'scrollbar-shadow':classic?'var(--vb-bevel-raised)':x11?t.controlShadow:'none',
    'scrollbar-buttons':classic||x11?'block':'none',
    'scrollbar-thumb':classic||x11?c.face:t.thumb,
    'scrollbar-track':classic?'repeating-conic-gradient(var(--vb-face) 0% 25%,var(--vb-highlight) 0% 50%) 0 0/2px 2px':c.face
  };
  const macPaint={
    'command-fill':t.control,'command-hover':t.hover,'command-pressed':t.pressed,
    'command-disabled':c.face,'command-ink':c.text,'default-fill':c.selection,
    'default-ink':c.selectionText,'default-pressed':`color-mix(in srgb, ${c.selection} 85%, #000000)`,
    'default-outline-width':'0px','default-focus-ink':'currentColor','command-focus-inset':'1px','command-focus-width':'2px',
    'check-radius':'3px','check-border':t.border,'check-shadow':t.controlShadow,
    'mixed-width':'7px','mixed-height':'2px','mixed-left':'2px','mixed-top':'5px',
    'composite-border-width':'1px','composite-padding':'1px','richtext-padding':'4px',
    'field-overflow':'visible','control-focus-width':'2px','field-border':t.border,'field-focus-shadow':`0 0 0 3px color-mix(in srgb, ${t.focus} 35%, transparent), inset 0 0 0 1px ${t.focus}`,
    'frame-shadow':'none','status-border':'transparent',
    'menu-material':'var(--app-material)','menu-backdrop':'var(--app-backdrop)',
    'popup-radius':'10px','popup-padding':'4px','popup-item-radius':'5px',
    'range-radius':'999px','range-thumb':'#ffffff','range-thumb-size':'14px',
    'range-thumb-offset':'-5px','range-thumb-border':`1px solid ${t.border}`,
    'range-thumb-shadow':'0 1px 3px #00000040','range-track-border':'0px solid transparent',
    'range-track':t.separator,'range-accent':c.selection,
    'progress-radius':'999px','progress-border':'transparent','progress-align':'center',
    'progress-height':'6px','progress-track':`linear-gradient(transparent calc(50% - 3px), ${t.separator} calc(50% - 3px), ${t.separator} calc(50% + 3px), transparent calc(50% + 3px))`,
    'tab-radius':'5px','tab-active-fill':t.control,'tab-border':'transparent',
    'tab-idle-fill':'transparent','tab-header-fill':`color-mix(in srgb, ${c.text} 7%, ${c.face})`,
    'calendar-collapse':'separate','calendar-spacing':'2px','calendar-header':c.window,'calendar-header-ink':c.windowText,'calendar-day-radius':'50%',
    'grid-border':t.separator,'grid-focus-style':'solid','menu-check-background':'transparent',
    'scroll-arrow-display':'none','scroll-border':'transparent','scroll-thumb-border':'0px solid transparent',
    'scroll-thumb-shadow':'none','scroll-thumb-radius':'999px','scroll-thumb-cross':'calc(100% - 6px)','scroll-thumb-inset':'3px',
    'tree-toggle-size':'0px','tree-toggle-border':'transparent','tree-toggle-fill':'transparent',
    'tree-disclosure':'""','tree-disclosure-ink':c.gray,
    'mnemonic-decoration':'none','toolbar-fill':'transparent','toolbar-border':t.separator,
    'combo-fill':c.selection,'combo-ink':c.selectionText,'dialog-actions':'flex-end'
  };
  for(const [key,value] of Object.entries(macPaint))values[key]=mac?value:'initial';
  return Object.entries(values).map(([name,value])=>`  --detail-${name}: ${value};\n`).join('');
}
