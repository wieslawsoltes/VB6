/** Toolbar/segmented presentation shares the public VB Buttons collection.
 * Collection objects and their DOM buttons survive repaint and theme changes;
 * no parallel selection state can diverge from Button.Value.
 */
import {el} from '../core/core.js';
import {truth} from '../runtime/values.js';
import {acceptsInput} from './input.js';
import {ToolbarButtons} from './collections.js';
import {validateMacOS26ToolbarButtons} from '../theme/macos26-compat.js';
import {writeThemeAttributes} from '../theme/environment.js';
import {commandPaint} from '../theme/control-paint.js';

const caption = value => String(value ?? '').replace(/&&/g, '\0').replace(/&/g, '').replace(/\0/g, '&');
const interactive = button => ![3, 4].includes(button.Style);
const available = button => interactive(button) && truth(button.Visible) && truth(button.Enabled);
const segmented = view => view.props.MacOSControlStyle === 'segmented';
const single = view => segmented(view) && view.Buttons.items[0]?.Style === 2;

/** Update the same public values that a VB ButtonClick handler reads. Grouped
 * Button.Value setters commit exclusive selection atomically in the collection. */
export function activateToolbarButton(view, button) {
  if (!view.Buttons.owns(button) || !available(button) || !acceptsInput(view)) return false;
  if (button.Style === 1) button.Value = button.Value ? 0 : 1;
  else if (button.Style === 2) button.Value = 1;
  view.toolbarState.focus = button;
  refreshToolbar(view);
  view.event('ButtonClick', [button]);
  return true;
}

function eventButton(view, event) {
  const node = event.target.closest?.('[data-toolbar-index]');
  if (!node || node.parentElement !== view.node) return null;
  const button = view.Buttons.items[Number(node.dataset.toolbarIndex)];
  return view.toolbarState.nodes.get(button) === node ? button : null;
}

export function buildToolbar(view) {
  view.node.classList.add('vb-toolbar');
  view.toolbarState = {nodes: new Map(), focus: null};
  view.Buttons = new ToolbarButtons(() => view.invalidate(), {
    validate: buttons => {if (segmented(view)) validateMacOS26ToolbarButtons(buttons);}
  });
  view.Buttons.batch(() => {
    for (const item of view.props.Buttons || []) {
      const button = view.Buttons.Add(undefined, item.Key, item.Caption, item.Style, item.Image);
      for (const key of ['Enabled', 'Visible', 'Value', 'ToolTipText', 'Tag', 'Description', 'MixedState'])
        if (item[key] !== undefined) button[key] = item[key];
    }
  });
  view.SetFocus = () => {
    const button = view.toolbarState.focus;
    (view.toolbarState.nodes.get(button) || view.node).focus({preventScroll: true});
  };
  view.node.addEventListener('focusin', event => {
    const button = eventButton(view, event);
    if (button && available(button)) {view.toolbarState.focus = button; refreshToolbar(view);}
  });
  view.node.addEventListener('click', event => {
    const button = eventButton(view, event);
    if (!button || view.design) return;
    event.preventDefault(); event.stopPropagation();
    activateToolbarButton(view, button);
  });
  view.node.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || !acceptsInput(view)) return;
    const button = eventButton(view, event);
    if (!button) return;
    if (event.key === 'Enter' || event.key === ' ') {
      // Owning Enter also prevents the form's default CommandButton from firing.
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) activateToolbarButton(view, button);
      return;
    }
    const buttons = view.Buttons.items.filter(available);
    if (!buttons.length) return;
    const at = Math.max(0, buttons.indexOf(button)), rtl = view.node.ownerDocument.defaultView.getComputedStyle(view.node).direction === 'rtl';
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = (at + ((event.key === 'ArrowRight') !== rtl ? 1 : -1) + buttons.length) % buttons.length;
    else return;
    event.preventDefault(); event.stopPropagation();
    const target = buttons[next]; view.toolbarState.focus = target;
    if (single(view) && !target.Value) activateToolbarButton(view, target);
    else refreshToolbar(view);
    view.toolbarState.nodes.get(target)?.focus({preventScroll: true});
  });
}

export function refreshToolbar(view) {
  const {node, toolbarState: state, Buttons} = view;
  const focused = node.ownerDocument.activeElement, ownedFocus = node.contains(focused);
  const buttons = Buttons.items, candidates = buttons.filter(available);
  const visible = buttons.filter(button => truth(button.Visible));
  const successors = new Map(visible.map((button, index) => [button, visible[index + 1]]));
  const previous = state.focus;
  if (!candidates.includes(state.focus)) state.focus = candidates.find(button => button.Value) || candidates[0] || null;
  const isSingle = single(view), isSegmented = segmented(view), disabled = !truth(view.props.Enabled);
  const colors = commandPaint(view.props.BackColor, view.props.ForeColor);
  node.style.background = isSegmented ? colors.background : '';
  writeThemeAttributes(node, {role: isSingle ? 'radiogroup' : isSegmented ? 'group' : 'toolbar',
    'aria-orientation': 'horizontal', 'aria-disabled': disabled ? 'true' : null,
    'data-macos-segment-tracking': isSegmented ? isSingle ? 'single' : buttons[0]?.Style === 1 ? 'multiple' : 'momentary' : null});
  if (node.tabIndex !== -1) node.tabIndex = -1;
  for (const [button, child] of state.nodes) if (!Buttons.owns(button)) {child.remove(); state.nodes.delete(button);}
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index], tag = interactive(button) ? 'BUTTON' : 'SPAN';
    let child = state.nodes.get(button);
    if (!child || child.tagName !== tag) {
      const next = el(tag.toLowerCase(), {class: 'vb-toolbar-button'});
      if (tag === 'BUTTON') next.type = 'button';
      if (child) child.replaceWith(next);
      child = next; state.nodes.set(button, child);
    }
    if (node.children[index] !== child) node.insertBefore(child, node.children[index] || null);
    const text = button.Style === 3 || button.Style === 4 ? '' : caption(button.Caption || button.Key);
    if (child.textContent !== text) child.textContent = text;
    child.hidden = !truth(button.Visible);
    child.classList.toggle('vb-toolbar-separator', button.Style === 3);
    child.classList.toggle('vb-toolbar-placeholder', button.Style === 4);
    child.classList.toggle('active', (button.Style === 1 || button.Style === 2) && !!button.Value);
    child.classList.toggle('vb-toolbar-divider', !!successors.get(button) && !button.Value && !successors.get(button).Value);
    const title = String(button.ToolTipText || button.Caption || '');
    if (child.title !== title) child.title = title;
    writeThemeAttributes(child, {'data-toolbar-index': index,
      role: button.Style === 3 ? 'separator' : button.Style === 4 ? 'presentation' : isSingle ? 'radio' : null,
      'aria-checked': isSingle ? String(!!button.Value) : null,
      'aria-pressed': !isSingle && (button.Style === 1 || button.Style === 2) ? String(!!button.Value) : null,
      'aria-label': interactive(button) ? text : null,
      'aria-description': button.Description || null});
    if (interactive(button)) {
      child.style.background = isSegmented ? colors.background : '';
      child.style.color = isSegmented ? colors.color : '';
      child.disabled = disabled || !truth(button.Enabled);
      child.tabIndex = !view.design && !disabled && button === state.focus && truth(view.props.TabStop) ? Number(view.props.TabIndex) || 0 : -1;
    }
  }
  // The designer's empty-toolbar affordance has no collection or runtime state.
  if (!buttons.length && view.design) {
    if (!node.querySelector('[data-toolbar-placeholder]')) node.append(el('span', {'data-toolbar-placeholder': '', 'aria-hidden': 'true'}, 'New   Open   Save'));
  } else node.querySelector('[data-toolbar-placeholder]')?.remove();
  if (ownedFocus && (!focused.isConnected || focused.hidden || focused.disabled) && previous !== state.focus)
    (state.nodes.get(state.focus) || node).focus({preventScroll: true});
}
