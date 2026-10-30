const specialKeys = Object.freeze({Escape: 'Esc', Backspace: 'BS', Delete: 'Del', Enter: 'CR', Tab: 'Tab', ' ': 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert'});

/** Translate the browser's layout-aware key to Vim notation. Do not turn IME,
 * dead keys, AltGr, or platform Command shortcuts into editing commands.
 */
export function vimKeyFromEvent(event) {
  if (!event || event.isComposing || event.keyCode === 229 || event.metaKey || event.getModifierState?.('AltGraph')) return null;
  const key = event.key;
  if (!key || ['Dead', 'Process', 'Unidentified', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock'].includes(key)) return null;
  // Alt is the IDE's menu mnemonic modifier. Vim's normal commands and Ctrl
  // chords remain available on every platform without stealing that access.
  if (event.altKey) return null;
  const named = specialKeys[key] || (/^F\d{1,2}$/.test(key) ? key : null);
  if (event.ctrlKey) {
    const value = named || (key.length === 1 ? key.toLowerCase() : null);
    return value ? '<C-' + (event.shiftKey && named ? 'S-' : '') + value + '>' : null;
  }
  if (named) return '<' + (event.shiftKey ? 'S-' : '') + named + '>';
  return [...key].length === 1 ? key : null;
}

/** IDE execution/window shortcuts remain useful while editing modally. */
export function isIdeReservedKey(event) {
  return !!event.metaKey || !!event.altKey || /^F(?:[1-9]|1[0-2])$/.test(event.key || '') ||
    (event.ctrlKey && (['Tab', 'Pause', 'Break', 'Cancel'].includes(event.key) || event.key?.toLowerCase() === 's'));
}
