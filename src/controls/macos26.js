import {cssColor} from '../theme/theme.js';
import {macos26ControlAttributes} from '../theme/macos26-compat.js';
import {MACOS26_COLOR_ROLES} from '../theme/macos26-resources.js';
import {writeThemeAttributes} from '../theme/environment.js';
import {acceptsInput} from './input.js';
import {macos26MaterialPaint,macos26SearchPaint} from '../theme/control-paint.js';

const text = value => String(value ?? '');
const enabled = c => !c.design && !c.disposed && Number(c.props.Enabled) !== 0 && !Number(c.props.Locked) && acceptsInput(c);
function symbol(document, path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  const shape = document.createElementNS(svg.namespaceURI,'path');
  shape.setAttribute('d',path);shape.setAttribute('fill','none');shape.setAttribute('stroke','currentColor');
  shape.setAttribute('stroke-width','1.5');shape.setAttribute('stroke-linecap','round');
  svg.append(shape);return svg;
}

/** Search affordances are owned by the original TextBox. A theme change never
 * rebuilds the input, loses composition/selection, or introduces a second value. */
function createSearch(c) {
  const document = c.node.ownerDocument, icon = document.createElement('span'), clear = document.createElement('button');
  icon.className = 'macos26-search-icon';icon.setAttribute('aria-hidden','true');
  icon.append(symbol(document,'M11 6.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0M10 10l4 4'));
  clear.className = 'macos26-search-clear';clear.type = 'button';clear.tabIndex = -1;
  clear.setAttribute('aria-label','Clear search');clear.title = 'Clear search';
  clear.append(symbol(document,'M5 5l6 6M11 5l-6 6'));
  const update = () => {clear.hidden = c.props.MacOSControlStyle !== 'search' || !text(c.props.Text);clear.disabled = c.design || !Number(c.props.Enabled) || !!Number(c.props.Locked);};
  const reset = event => {
    if (c.props.MacOSControlStyle !== 'search' || !enabled(c) || !text(c.props.Text)) return false;
    event?.preventDefault();event?.stopPropagation();
    c.input.value = '';c.set('Text','',true);update();c.input.focus({preventScroll:true});return true;
  };
  const pointer = event => {if (enabled(c)) event.preventDefault();};
  const key = event => {
    if (c.props.MacOSControlStyle === 'search' && event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && !event.altKey && !event.ctrlKey && !event.metaKey) reset(event);
  };
  clear.addEventListener('pointerdown',pointer);clear.addEventListener('click',reset);
  c.input.addEventListener('input',update);c.input.addEventListener('keydown',key);
  c.node.append(icon,clear);
  return {icon,clear,update,dispose(){
    clear.removeEventListener('pointerdown',pointer);clear.removeEventListener('click',reset);
    c.input.removeEventListener('input',update);c.input.removeEventListener('keydown',key);
    icon.remove();clear.remove();
  }};
}

export function macos26ColorPaint(role, fallback) {
  return typeof role === 'string' && Object.hasOwn(MACOS26_COLOR_ROLES,role)
    ? `var(--macos26-${role}, ${fallback})` : fallback;
}

/** Restore owned overrides before the ordinary painter runs. This also handles
 * composites whose normal paint is entirely CSS and has no inline refresh. */
export function resetMacOS26ControlPaint(c) {
  for (const {node,key,value,previous} of (c.macos26Paint || []).slice().reverse()) {
    if (node.style[key] === value) node.style[key] = previous;
  }
  c.macos26Paint = [];
}

function paint(c,node,key,value) {
  const previous = node.style[key];node.style[key] = value;
  (c.macos26Paint ||= []).push({node,key,value:node.style[key],previous});
}

/** DOM input changes deliberately skip the ordinary painter, so accessibility
 * state follows the original value path immediately without another VB event. */
export function refreshMacOS26ControlValue(c) {
  const p = c.props;
  if (c.type === 'CheckBox') {
    const mixed = Number(p.Value) === 2, toggle = p.MacOSControlStyle === 'switch' && !mixed;
    writeThemeAttributes(c.input,{role:toggle ? 'switch' : null,'aria-checked':toggle ? String(!!Number(p.Value)) : null});
  }
  if (c.type === 'ProgressBar') {
    writeThemeAttributes(c.node,{role:'progressbar','aria-valuemin':Number(p.Min) || 0,'aria-valuemax':Number(p.Max) || 0,
      'aria-valuenow':p.MacOSIndeterminate === -1 ? null : Number(p.Value) || 0});
    if (p.MacOSIndeterminate === -1) c.fill.style.width = 'var(--macos26-IndeterminateWidth, 30%)';
  }
}

/** Called after the ordinary painter, so explicit bindings replace only the
 * intended role. Clearing metadata restores the ordinary paint on next refresh. */
export function refreshMacOS26Control(c) {
  const p = c.props, n = c.node;
  writeThemeAttributes(n,macos26ControlAttributes(p));
  const fore = p.MacOSForegroundRole, back = p.MacOSBackgroundRole;
  const foreground = macos26ColorPaint(fore,cssColor(p.ForeColor,'#000000'));
  const background = macos26ColorPaint(back,cssColor(p.BackColor));
  for (const [key,role,value] of [['--macos-control-background',back,background],['--macos-control-foreground',fore,foreground]]) {
    if (role) n.style.setProperty(key,value);else n.style.removeProperty(key);
  }
  if (p.MacOSMaterial && p.MacOSMaterial !== 'none') {
    const host = c.content || n, fill = host.style.background || cssColor(p.BackColor);
    paint(c,host,'background',macos26MaterialPaint(p.BackColor,p.ForeColor,fill));
    if (c.legend) paint(c,c.legend,'background',macos26MaterialPaint(p.BackColor,p.ForeColor,c.legend.style.background || cssColor(p.BackColor)));
  }
  if (c.type === 'TextBox' && p.MacOSControlStyle === 'search') {
    paint(c,c.input,'backgroundColor',macos26SearchPaint(p.BackColor,p.ForeColor,c.input.style.backgroundColor || cssColor(p.BackColor)));
  }
  if (fore) {paint(c,n,'color','var(--macos-control-foreground)');if(c.input)paint(c,c.input,'color','var(--macos-control-foreground)');}
  if (back && !(c.type === 'Label' && Number(p.BackStyle) === 0)) {
    paint(c,c.content || n,'background','var(--macos-control-background)');
    if (c.input && !['Slider','CheckBox','OptionButton','UpDown'].includes(c.type)) paint(c,c.input,'backgroundColor','var(--macos-control-background)');
    if (c.legend) paint(c,c.legend,'background','var(--macos-control-background)');
  }
  if (c.surface) c.surface.backgroundRole = back || '';
  const label = p.MacOSAccessibilityLabel || text(p.Caption || c.model.name).replace(/&&/g,'\0').replace(/&/g,'').replace(/\0/g,'&');
  writeThemeAttributes(n,{'aria-label':label,'aria-description':p.MacOSAccessibilityHelp || null});
  if (c.input) {
    writeThemeAttributes(c.input,{'aria-label':label,'aria-description':p.MacOSAccessibilityHelp || null});
    if (['TextBox','ComboBox'].includes(c.type)) c.input.placeholder = text(p.PlaceholderText);
  }
  if (c.type === 'TextBox') {
    const search = p.MacOSControlStyle === 'search';
    if (search && !c.macos26Search) c.macos26Search = createSearch(c);
    if (c.macos26Search) {c.macos26Search.icon.hidden = !search;c.macos26Search.update();}
    writeThemeAttributes(c.input,{role:search ? 'searchbox' : null});
  }
  refreshMacOS26ControlValue(c);
}

export function disposeMacOS26Control(c) {c.macos26Search?.dispose();c.macos26Search = null;}
