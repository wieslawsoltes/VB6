/** AppKit measurements from an active, key macOS 26.6.2 (25G83) window.
 * Source: tools/macos-theme-reference.swift, capture revision b6472b68740e282562aadd728f43f8cac97aa0b0.
 * Values are sRGB; translucent paint remains translucent rather than baking in
 * a white background. These metrics do not certify font or WindowServer parity.
 * No native artwork, raster assets, or fonts are included in the runtime.
 */
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
export const MACOS_REFERENCE = freeze({
  os: '26.6.2', build: '25G83', colorSpace: 'sRGB',
  revision: 'b6472b68740e282562aadd728f43f8cac97aa0b0',
  active: true, keyWindow: true, scales: [1, 2],
  control: {height: 28, paintedButtonHeight: 24, radius: 6},
  check: {size: 16, radius: 5, markWidth: 10, markHeight: 9, mixedWidth: 8, mixedHeight: 2},
  radio: {size: 16, dotSize: 6},
  slider: {trackHeight: 6, thumbWidth: 20, thumbHeight: 18},
  progress: {height: 8},
  stepper: {width: 20, height: 26},
  light: {
    background: '#ffffff', text: '#000000', label: '#272727', disabledLabel: '#c0c0c0',
    accent: '#007aff', accentPressed: '#006ee6', selectedContent: '#0064e1',
    selectedControl: '#0077f9',
    neutral: '#00000014', neutralDisabled: '#0000000a', checkOff: '#00000019',
    separator: '#00000019', fieldBorder: '#e5e5e5', group: '#00000008',
    progressTrack: '#0000000f', focus: '#0067f47f',
    inactiveSelection: '#dddddd', inactiveSelectionText: '#272727',
    // Actual non-key captures: 4b6c481c, artifact 11954783994 (see inactive fixture).
    inactiveCheck: '#00000024', inactiveRange: '#0000003a', inactiveSegment: '#00000032'
  },
  dark: {
    background: '#1e1e1e', text: '#ffffff', label: '#dddddd', disabledLabel: '#565656',
    accent: '#007aff', accentPressed: '#1987ff', selectedContent: '#0059d1',
    selectedControl: '#067dff',
    neutral: '#ffffff14', neutralDisabled: '#ffffff0a', checkOff: '#ffffff19',
    separator: '#ffffff19', fieldBorder: '#3a3a3a', group: '#ffffff08',
    progressTrack: '#ffffff14', focus: '#1aa9ff7f',
    inactiveSelection: '#484848', inactiveSelectionText: '#dddddd',
    inactiveCheck: '#ffffff24', inactiveRange: '#ffffff3a', inactiveSegment: '#ffffff32'
  }
});

/** Opaque system-color roles for OLE and graphics; component layers use alpha.
 * Transparent controls compose correctly on their actual owning background.
 */
export function macosSystemColors(scheme) {
  const m = MACOS_REFERENCE[scheme];
  if (!m || (scheme !== 'light' && scheme !== 'dark')) throw new RangeError('Unknown macOS appearance');
  return {
    face:m.background, title:m.background, titleEnd:m.background, text:m.label, titleText:m.label,
    inactive:m.background, inactiveEnd:m.background, inactiveText:scheme==='dark'?'#8e8e8e':'#767676',
    window:m.background, windowText:m.text, selection:m.selectedContent, selectionText:'#ffffff',
    gray:m.disabledLabel, info:m.background, infoText:m.label
  };
}
