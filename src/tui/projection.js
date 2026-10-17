import {readControlPaintProperties} from '../rendering/invalidation.js';
const CONTROL = '.vb-control,.vb-form';
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const owned = (node, selector) => [...node.querySelectorAll(selector)].filter(child => child.closest(CONTROL) === node);

/** Convert live DOM client geometry back to layout pixels before quantizing.
 * Neither the model's twips nor hit targets are rounded or moved. */
export function projectionGrid(node, columns, rows, metrics = {}) {
  const rect = node.getBoundingClientRect();
  const scaleX = rect.width / Math.max(1, node.offsetWidth || node.clientWidth || rect.width);
  const scaleY = rect.height / Math.max(1, node.offsetHeight || node.clientHeight || rect.height);
  const width = metrics.cellWidth || node.clientWidth / columns || 8;
  const height = metrics.cellHeight || node.clientHeight / rows || 16;
  const x = rect.left + (node.clientLeft || 0) * scaleX;
  const y = rect.top + (node.clientTop || 0) * scaleY;
  const pitchX = width * scaleX, pitchY = height * scaleY;
  // Browser engines quantize DOM rectangles independently (commonly to 1/60
  // or 1/64 CSS pixel). A few thousandths below the same materialized edge must
  // not discard its first glyph/header. Genuine scrolling remains unsnapped.
  const edge=(value,origin,pitch,round)=>{
    const cell=(value-origin)/pitch,nearest=Math.round(cell);
    const rounded=round(Math.abs(cell-nearest)*pitch<=1/32?nearest:cell);
    return rounded===0?0:rounded;
  };
  return {
    rect, x, y, pitchX, pitchY,
    project(bounds) {
      const left = edge(bounds.left,x,pitchX,Math.floor);
      const top = edge(bounds.top,y,pitchY,Math.floor);
      return {x: left, y: top, width: edge(bounds.right,x,pitchX,Math.ceil) - left,
        height: edge(bounds.bottom,y,pitchY,Math.ceil) - top};
    }
  };
}

function visibleRect(element, limit) {
  if (element.closest('[hidden]') || !element.getClientRects().length) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > limit.top && rect.top < limit.bottom &&
    rect.right > limit.left && rect.left < limit.right ? rect : null;
}

/** Descendant scrollports are independent of the outer control. Preserve the
 * full row origin for text positioning, but clip its paint to actual ownership.
 */
function rowClip(element, node, bounds) {
  let left=bounds.left,top=bounds.top,right=bounds.right,bottom=bounds.bottom;
  const view=node.ownerDocument.defaultView;
  for(let parent=element.parentElement;parent&&parent!==node;parent=parent.parentElement){
    const style=view.getComputedStyle(parent),rect=parent.getBoundingClientRect();
    const sx=rect.width/Math.max(1,parent.offsetWidth||rect.width),sy=rect.height/Math.max(1,parent.offsetHeight||rect.height);
    if(/hidden|clip|scroll|auto/.test(style.overflowX)){
      left=Math.max(left,rect.left+(parent.clientLeft||0)*sx);right=Math.min(right,rect.left+((parent.clientLeft||0)+parent.clientWidth)*sx);
    }
    if(/hidden|clip|scroll|auto/.test(style.overflowY)){
      top=Math.max(top,rect.top+(parent.clientTop||0)*sy);bottom=Math.min(bottom,rect.top+((parent.clientTop||0)+parent.clientHeight)*sy);
    }
  }
  return right>left&&bottom>top?{left,top,right,bottom,width:right-left,height:bottom-top}:null;
}

/** A paint snapshot of the canonical materialized control, not a second model.
 * TextBox.value/selectedIndex and collection rows come from their real input
 * targets; names, VB6 properties and event dispatch never flow in reverse. */
export function captureControl(node, columns, rows, metrics) {
  const type = node.dataset.type || '';
  const props = readControlPaintProperties(node, ['Caption','Alignment','Shape','FillStyle','FillColor','BorderStyle','BorderColor','BorderWidth','Default','Style','Orientation','Min','Max','Value','Enabled']);
  const input = owned(node, 'input,textarea,select,[contenteditable]')[0];
  const grid = projectionGrid(node, columns, rows, metrics);
  const style = node.ownerDocument.defaultView.getComputedStyle(node);
  const captionElement = owned(node, '.vb-frame-legend,.vb-command-caption')[0];
  const caption = captionElement?.textContent || node.getAttribute('aria-label') || node.dataset.control || '';
  const value = input?.value ?? input?.textContent ?? '';
  const state = {
    type, mnemonics: Object.hasOwn(props,'Caption'), name: node.dataset.control || type, caption: props.Caption ?? caption,
    cellAspect:(metrics?.cellHeight||16)/(metrics?.cellWidth||8),shape: props.Shape, fillStyle: props.FillStyle, fillColor: props.FillColor, borderStyle: props.BorderStyle, borderColor: props.BorderColor, borderWidth: props.BorderWidth, defaultButton: !!props.Default,
    text: String(value), checked: !!input?.checked, indeterminate: !!input?.indeterminate,
    password: input?.type === 'password',
    disabled: !!node.closest('.disabled,[aria-disabled=true],[inert]') || !!input?.disabled || props.Enabled===0,
    focused: node.contains(node.ownerDocument.activeElement), pressed: node.matches(':active'),
    min: finite(input?.min), max: finite(input?.max, 100), value: finite(input?.value),
    vertical: type === 'VScrollBar' || input?.getAttribute('aria-orientation') === 'vertical' ||
      input?.classList.contains('vb-vrange'),
    alignment: style.textAlign === 'right' ? 'right' : style.textAlign === 'center' ? 'center' : 'left',
    scrollColumn: Math.max(0, Math.floor((input?.scrollLeft || 0) / (metrics?.cellWidth || 8))),
    selectionStart: input?.selectionStart??0,selectionEnd:input?.selectionEnd??0,selectionDirection:input?.selectionDirection||'none',
    readOnly:!!input?.readOnly,wrap:input?.tagName==='TEXTAREA'&&input.wrap!=='off',
    scrollRow: Math.max(0, Math.floor((input?.scrollTop || 0) / (metrics?.cellHeight || 16))),
    rows: []
  };
  if(type==='ComboBox'){state.simple=node.classList.contains('simple');state.inputHeight=input?Math.max(1,grid.project(input.getBoundingClientRect()).height):1;}
  if(type==='RichTextBox')state.text=owned(node,'.vb-rich-paragraph').map(p=>p.textContent||'').join('\r\n');
  if (type === 'Label' && !Object.hasOwn(props,'Caption')) state.caption = node.textContent;
  if (Object.hasOwn(props,'Alignment')) state.alignment=['left','right','center'][Number(props.Alignment)]||'left';
  if (type === 'ProgressBar') {
    const fill = node.querySelector('.vb-progress-fill'), track = fill?.parentElement;
    state.min = 0; state.max = 100;
    state.value = fill && track ? fill.getBoundingClientRect().width / Math.max(1, track.getBoundingClientRect().width) * 100 : 0;
  }
  if (type === 'HScrollBar' || type === 'VScrollBar') {
    const range = node.matches('[role=scrollbar]') ? node : node.querySelector('[role=scrollbar]');
    state.min = finite(range?.getAttribute('aria-valuemin'));
    state.max = finite(range?.getAttribute('aria-valuemax'), 100);
    state.value = finite(range?.getAttribute('aria-valuenow'));
  }
  if(['Slider','ProgressBar'].includes(type)&&Object.hasOwn(props,'Orientation')) state.vertical=Number(props.Orientation)===1;
  if(['Slider','ProgressBar','HScrollBar','VScrollBar'].includes(type))for(const [key,name]of [['Min','min'],['Max','max'],['Value','value']])if(Object.hasOwn(props,key))state[name]=Number(props[key]);
  state.reverse = type === 'Slider' && state.vertical;
  const addRow = (element, text = element.textContent || '', selected = false, separator = false) => {
    const rect = visibleRect(element, grid.rect);
    if (!rect) return;
    const clipped=rowClip(element,node,rect);if(!clipped)return;
    const bounds = grid.project(rect);
    // Collapsed table borders and transformed DOM rectangles may start at a
    // half pixel. Row height is independent of that phase: a one-cell row must
    // not erase the following row merely because its edges straddle the grid.
    bounds.height=Math.max(1,Math.round(rect.height/grid.pitchY));
    if (bounds.width <= 0 || bounds.height <= 0 || bounds.x >= columns || bounds.y >= rows) return;
    const style=node.ownerDocument.defaultView.getComputedStyle(element);
    state.rows.push({...bounds,clip:grid.project(clipped),text,selected,separator,
      kind:element.matches('th,.vb-lv-header>div')?'header':element.tagName==='BUTTON'?'button':'item',
      focused:element===node.ownerDocument.activeElement,pressed:element.getAttribute('aria-pressed')==='true'||element.matches(':active'),
      alignment:style.textAlign==='right'?'right':style.textAlign==='center'?'center':'left',
      disabled:!!element.disabled||!!element.closest('[aria-disabled=true],[disabled]')});
  };
  if (input?.tagName === 'SELECT') {
    state.text = input.selectedOptions?.[0]?.textContent || '';
    // Listbox option rectangles are exposed by current browser engines. A
    // collapsed native select has no visible option rectangles; its selected
    // text is painted instead. Focused selects always retain their native UI.
    for (const option of input.options) addRow(option, option.textContent || '', option.selected);
  } else {
    const selectors = type === 'Toolbar' || type === 'Data' || type === 'Adodc' || type === 'UpDown'
      ? 'button,.vb-data-label'
      : type === 'MonthView' ? '.vb-month-header>span,.vb-month-header>button,th,td'
      : type === 'ComboBox' ? '.vb-combo-option'
      : type === 'ListView' ? '.vb-lv-row>div,.vb-lv-header>div'
      : 'td:not(.vb-grid-spacer),th:not(.vb-grid-spacer),.vb-tree-row,.vb-status-panel,button[role=tab]';
    for (const element of owned(node, selectors)) {
      let text = element.textContent || '';
      if(element.matches('.vb-spin-button'))text=node.classList.contains('horizontal')?(element.classList.contains('up')?'►':'◄'):(element.classList.contains('up')?'▲':'▼');
      const row = element.closest('.vb-lv-row') || element;
      if (element.classList.contains('vb-tree-row')) {
        text = ' '.repeat(Math.min(128, Math.max(0, finite(element.getAttribute('aria-level'), 1) - 1) * 2)) +
          (element.getAttribute('aria-expanded') === null ? '├─' : element.getAttribute('aria-expanded') === 'true' ? '[-]' : '[+]') +
          (element.querySelector('.vb-tree-label')?.textContent || text);
      }
      addRow(element, text, row.classList.contains('selected') || row.classList.contains('active') ||
        row.getAttribute('aria-selected') === 'true', element.matches('td,th,.vb-lv-row>div,.vb-lv-header>div'));
    }
  }
  return state;
}
