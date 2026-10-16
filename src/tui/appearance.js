/** Semantic EGA attributes. A mnemonic, disabled label, field and selected row
 * must remain legible independently; one global foreground is insufficient. */
const attr = (foreground, background, hotkey = foreground) => Object.freeze({foreground, background, hotkey});
const profiles = {
  turbo: {
    panel: attr(0,7,4), title: attr(15,1,14), inactiveTitle: attr(7,1,7), menu: attr(0,7,4),
    selected: attr(0,3,15), field: attr(0,3,0), button: attr(0,2,15), focusedButton: attr(15,2,14),
    disabled: attr(8,7,8), editor: attr(14,1,15), search: attr(0,14), status: attr(0,7,4), border: attr(15,7),
    window: attr(15,1,14), desktop: attr(0,1), shadow: attr(0,0)
  },
  commander: {
    panel: attr(14,1,15), title: attr(0,3,15), inactiveTitle: attr(7,1,7), menu: attr(0,3,15),
    selected: attr(0,3,15), field: attr(14,1,15), button: attr(0,3,15), focusedButton: attr(15,3,14),
    disabled: attr(8,1,8), editor: attr(14,1,15), search: attr(0,14), status: attr(0,3,15), border: attr(11,1),
    window: attr(14,1,15), desktop: attr(0,1), shadow: attr(0,0)
  },
  win31: {
    panel: attr(0,7,4), title: attr(15,1,15), inactiveTitle: attr(7,8,7), menu: attr(0,7,4),
    selected: attr(15,1,14), field: attr(0,15,4), button: attr(0,7,4), focusedButton: attr(0,7,4),
    disabled: attr(8,7,8), editor: attr(0,15,1), search: attr(0,14), status: attr(0,7,4), border: attr(0,7),
    window: attr(0,7,4), desktop: attr(3,3), shadow: attr(0,0)
  },
  monochrome: {
    panel: attr(7,0,15), title: attr(0,7,0), inactiveTitle: attr(7,0,15), menu: attr(0,7,0),
    selected: attr(0,7,0), field: attr(15,0,15), button: attr(0,7,0), focusedButton: attr(0,15,0),
    disabled: attr(8,0,8), editor: attr(7,0,15), search: attr(0,15), status: attr(0,7,0), border: attr(7,0),
    window: attr(7,0,15), desktop: attr(8,0), shadow: attr(0,0)
  }
};
for (const value of Object.values(profiles)) Object.freeze(value);
export const TUI_APPEARANCE = Object.freeze(profiles);
export function tuiAttribute(profile, role = 'panel') {
  const palette = Object.hasOwn(profiles, profile) ? profiles[profile] : profiles.turbo;
  return Object.hasOwn(palette, role) ? palette[role] : palette.panel;
}

/** Only presentation labels, never command IDs. Full titles remain available to
 * assistive technology, tooltips and the canonical command/menu infrastructure. */
const commands = Object.freeze({
  new:'New',open:'Open',save:'Save',saveAs:'Save as',saveAll:'Save all',cut:'Cut',copy:'Copy',paste:'Paste',
  undo:'Undo',redo:'Redo',run:'Run',pause:'Break',stop:'Stop',stepInto:'Step',stepOver:'Over',stepOut:'Out',
  viewCode:'Code',viewForm:'Design',projectExplorer:'Project',properties:'Properties',objectBrowser:'Objects',
  find:'Find',replace:'Replace',exportHTML:'Export',help:'Help',options:'Options',projectProperties:'Project settings',
  addForm:'Form',addModule:'Module',addClass:'Class',toggleFolders:'Folders',
  'align:left':'Left','align:right':'Right','align:top':'Top','align:bottom':'Bottom',
  'align:center':'Center','align:middle':'Middle','size:width':'Width','size:height':'Height','size:both':'Size'
});
const toolLabels=Object.freeze({'Object Browser Back':'Back','Object Browser Forward':'Forward','Copy member signature':'Copy','Refresh Object Browser':'Refresh','View definition':'Definition'});
export function commandLabel(id, fallback = '') {
  if(Object.hasOwn(toolLabels,fallback))return toolLabels[fallback];
  if (Object.hasOwn(commands,id)) return commands[id];
  return String(fallback || id || '').replace(/\s*\([^)]*\)\s*$/,'').replace(/\s*\/.*$/,'').trim();
}
export function fitLabel(text, columns, {ellipsis = true} = {}) {
  if (!Number.isSafeInteger(columns) || columns < 0) throw new RangeError('Invalid label width');
  const chars=Array.from(String(text??''));
  return chars.length<=columns?chars.join(''):columns===0?'':!ellipsis?chars.slice(0,columns).join(''):chars.slice(0,columns-1).join('')+'…';
}
/** Largest-remainder-free cumulative partition: no missing or duplicate pixels,
 * no row drift after resizing. All but the last segment are whole cells. */
export function partitionTracks(length, weights, pitch, gap=0) {
  if(!Number.isFinite(length)||length<0||!Number.isFinite(pitch)||pitch<=0||!Number.isFinite(gap)||gap<0||
     !Array.isArray(weights)||weights.some(n=>!Number.isFinite(n)||n<=0))throw new RangeError('Invalid track geometry');
  if(!weights.length)return [];
  const available=Math.max(0,length-gap*(weights.length-1)),total=weights.reduce((a,b)=>a+b,0),result=[];
  let previous=0,cumulative=0;
  for(let i=0;i<weights.length;i++){
    cumulative+=weights[i];
    const end=i===weights.length-1?available:Math.floor(available*cumulative/total/pitch)*pitch;
    result.push(Math.max(0,end-previous));previous=end;
  }
  return result;
}
