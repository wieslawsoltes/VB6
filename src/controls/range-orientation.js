/** Range orientation is a rendering capability, not a CSS syntax capability.
 * Some WebKit ports accept vertical-lr but force form controls to horizontal-tb
 * during style adjustment. Their legacy vertical slider still supplies native
 * hit testing, dragging, keyboard handling and accessibility for our CSS skin.
 * Never enable that deprecated appearance on engines with real writing modes.
 */
const modes = new WeakMap();

export function verticalRangeMode(document) {
  const root = document?.documentElement, view = document?.defaultView;
  // Detached/server-side model consumers have no rendered capability to probe.
  if (!root || typeof view?.getComputedStyle !== 'function') return 'writing-mode';
  const cached = modes.get(document);
  if (cached) return cached;
  const probe = document.createElement('input');
  probe.type = 'range';
  probe.tabIndex = -1;
  probe.disabled = true;
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:2px;visibility:hidden;pointer-events:none;writing-mode:vertical-lr;direction:rtl;appearance:none';
  let mode = 'writing-mode';
  try {
    root.appendChild(probe);
    if (view.getComputedStyle(probe).writingMode !== 'vertical-lr') {
      probe.style.appearance = 'slider-vertical';
      if (view.getComputedStyle(probe).appearance === 'slider-vertical') mode = 'legacy-appearance';
    }
  } finally {
    probe.remove();
  }
  modes.set(document, mode);
  return mode;
}

export function applyRangeOrientation(input, vertical) {
  input.classList.toggle('vb-vrange', vertical);
  input.classList.toggle('vb-range-legacy-vertical', vertical && verticalRangeMode(input.ownerDocument) === 'legacy-appearance');
  const orientation = vertical ? 'vertical' : 'horizontal';
  if (input.getAttribute('aria-orientation') !== orientation) input.setAttribute('aria-orientation', orientation);
}

/** Supply consistent unmodified Home/End navigation where native ports omit it.
 * Arrow keys, pointer hit testing and dragging remain entirely browser-owned.
 * Use the native input's value sanitizer (including step/min/max constraints),
 * and its existing input/change listeners rather than writing a second VM path.
 */
export function handleRangeEndpointKey(input, event) {
  if (input.disabled || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      (event.key !== 'Home' && event.key !== 'End')) return;
  const previous = input.value;
  const raw = event.key === 'Home' ? input.min : input.max;
  const fallback = event.key === 'Home' ? 0 : 100;
  input.value = String(raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : fallback);
  event.preventDefault();
  if (input.value !== previous) {
    const Event = input.ownerDocument.defaultView.Event;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
  }
}
