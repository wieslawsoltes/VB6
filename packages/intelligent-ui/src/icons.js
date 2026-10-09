/** Trusted geometry only. Model input selects a name, never markup or path data. */
export const ICON_PATHS=Object.freeze({
  'arrow-right':'M4 12h16 M13 5l7 7-7 7',
  'arrow-left':'M20 12H4 M11 5l-7 7 7 7',
  'chevron-down':'M5 9l7 7 7-7',
  'chevron-up':'M5 15l7-7 7 7',
  check:'M4 12l5 5L20 6',
  close:'M5 5l14 14 M19 5L5 19',
  plus:'M12 4v16 M4 12h16',
  minus:'M4 12h16',
  search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  copy:'M8 8h12v13H8z M16 8V3H3v13h5',
  info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 10v7 M12 7v1',
  warning:'M12 3L2 21h20z M12 9v6 M12 17v1',
  refresh:'M20 8a8 8 0 1 0 0 8 M20 3v5h-5',
  expand:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M16 21h5v-5'
});
export function renderIcon(document,root,name,label='') {
  root.replaceChildren();
  if(!Object.hasOwn(ICON_PATHS,name))return;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'1em',height:'1em',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(key,value);
  if(label){svg.setAttribute('role','img');svg.setAttribute('aria-label',label);}
  else svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',ICON_PATHS[name]);svg.append(path);root.append(svg);
}
