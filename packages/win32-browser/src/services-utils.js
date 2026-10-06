import {Win32Error,integer} from './core.js';

/** Register both Win32 string encodings without bringing in the VB6 runtime. */
export function registerAW(w,dll,name,arity,fn,options={}) {
  for (const wide of [false,true]) w.register(dll,name+(wide?'W':'A'),(...args)=>fn(wide,...args),{arity,...options});
}
export function units(m,text,wide) { return m.stringBytes(text,wide).length/(wide?2:1); }
export function putComplete(m,p,text,capacity,wide=false) {
  capacity=integer(capacity,0,Math.floor(m.maxBytes/(wide?2:1)));
  const length=units(m,text,wide);
  if(capacity<=length) throw new Win32Error('String buffer is too small',122);
  m.bytes(p,capacity*(wide?2:1));
  m.putString(p,text,capacity,wide);
  return length;
}
export function rejectOverlap(a,an,b,bn) {
  if(an && bn && Number(a)<Number(b)+bn && Number(b)<Number(a)+an)
    throw new Win32Error('Input and output buffers overlap',87);
}
