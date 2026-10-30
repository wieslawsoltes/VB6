# Theme lifecycle and accessibility

This work builds on main `638b5f4a6e5e9feda7e30b435a3720124725ff7c` (tree `8c93739b616d698793ed0761beed2ca609ca57c9`). The initial audit used Classic as the default; the current initial palette is Windows Standard (2000). It preserves explicit saved themes, independent IDE and project preferences, all nine registered palettes, authored RGB/font/geometry values, existing native caption hosts and the macOS reference measurements.

## Audited gaps and acceptance criteria

- Share and release system-media subscriptions per window. Follow live dark/light, reduced motion, reduced transparency, increased contrast and forced-color changes without persisting OS state into project settings. Apply a coherent set of attributes before emitting one application notification. Rebind adopted application roots and handle BFCache and disposal safely.
- Keep nested application portals on their owner's palette, forward owner changes, ignore bubbled descendant changes and release listeners when closed. Prevent modern IDE styles from recoloring runtime tooltips.
- Provide keyboard as well as pointer tooltips, Escape dismissal, hover persistence, collision-free descriptions, safe text, correct title restoration, trigger-removal cleanup and viewport-constrained placement. Do not steal focus or replace existing accessible descriptions.
- Make popup menu sessions document-local. Retain keyboard/submenu behavior, add RTL navigation and viewport-aware placement, recheck dynamic enabled state, respect explicit themes, remove obsolete ARIA relationships, and clean up only the session's opener. Close on document/window lifecycle changes without leaking listeners.
- Update the inert IDE Options preview when system appearance changes, and dispose the preview subscriptions on both acceptance and cancellation.

## Validation and merge gate

Implementation is in progress on this branch. This initial document is an audit checkpoint, not a completion claim. Require focused model tests, actual browser input tests against the source modules and production build, existing theme/application regression suites, reproducible generated artifacts and successful final integrated-head CI before merging.

## Boundaries

Browser theme fidelity is not native pixel-parity certification. OS-managed dialogs, native OCX/COM windows, system font rasterization, window-server materials and title bars remain platform-owned where documented. The preceding macOS native comparison did not establish exact image matches; this work must not relabel those differences as passed. These lifecycle and accessibility gates do not claim implementation of every conceivable theme customization feature.
