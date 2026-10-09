/** Shared compiler-only names and scalar contracts. No runtime state. */
import {NATIVE_DATE_CONSTANTS} from './date-intervals.js';
import {NATIVE_STRING_CONSTANTS} from './string-library.js';
export const key = value => String(value).toLowerCase();
export const lit = value => ({kind:'literal', value});
export const mem = memory => ({memory});
export const INT_TYPES = new Set(['long', 'integer', 'byte', 'boolean']);
export const BOOL_CONDITIONS = {'=':0x94, '<>':0x95, '<':0x9c, '<=':0x9e, '>':0x9f, '>=':0x9d};
export const CONSTANTS = {...NATIVE_DATE_CONSTANTS,...NATIVE_STRING_CONSTANTS,vbtrue:-1,vbfalse:0,vbnormal:0,vbminimized:1,vbmaximized:2,vbmodal:1,vbmodeless:0,vbokonly:0,vbokcancel:1,vbyesno:4,vbyesnocancel:3,vbinformation:64,vbexclamation:48,vbcritical:16,vbquestion:32,vbok:1,vbcancel:2,vbyes:6,vbno:7,vbcr:'\r',vblf:'\n',vbcrlf:'\r\n',vbnewline:'\r\n',vbtab:'\t',vbnullchar:'\0',vbnullstring:''};
