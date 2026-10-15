import test from 'node:test';
import assert from 'node:assert/strict';
import {controlThemePaint,controlThemeColor} from '../src/theme/control-theme-color.js';
import {commandPaint,comboPaint} from '../src/theme/control-paint.js';
import {cssColor} from '../src/theme/theme.js';

test('WinUI brush composes over macOS command state without resolving either boundary',()=>{
  const paint=commandPaint(0x8000000f,0x80000012);
  assert.equal(controlThemePaint(0x8000000f,'commandBackground',paint.background),
    `var(--winui-control-background, ${paint.background})`);
  assert.equal(controlThemePaint(0x80000012,'commandForeground',paint.color),
    `var(--winui-control-foreground, ${paint.color})`);
  assert.match(paint.background,/^var\(--command-fill,/);
});
test('popup material composes with WinUI input state while editable combos keep their own fill',()=>{
  const dropdown=comboPaint(0x80000005,0x80000008,2);
  assert.match(dropdown,/^var\(--detail-popup-button-fill,/);
  assert.equal(controlThemePaint(0x80000005,'inputBackground',dropdown),
    `var(--winui-control-background, ${dropdown})`);
  assert.equal(comboPaint(0x80000005,0x80000008,0),cssColor(0x80000005));
});
test('author RGB, mismatched OLE roles and malformed 32-bit aliases are never state brushes',()=>{
  for(const value of [0,0xffffff,0x8000000d,0x18000000f,-0x17ffffff1,0x8000000f+.5,NaN,Infinity,'#007aff']) {
    const raw=cssColor(value);
    assert.equal(controlThemePaint(value,'commandBackground',raw),raw);
    assert.equal(controlThemeColor(value,'commandBackground'),raw);
  }
});
test('state-paint composition rejects unknown slots rather than manufacturing CSS names',()=>{
  for(const slot of ['__proto__','constructor','other',null])
    assert.throws(()=>controlThemePaint(0x8000000f,slot,'red'),RangeError);
});
