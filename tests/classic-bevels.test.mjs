import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const bevels=read('src/theme/bevels.css');
test('adapted 98.css technique retains attribution and its full MIT notice',()=>{
  for(const source of ['https://news.ycombinator.com/item?id=49963404','https://jdan.github.io/98.css/','Copyright 2020 Jordan Scales'])assert.ok(bevels.includes(source),source);
  const notice=read('LICENSES/98.css.txt').trim();
  const embedded=bevels.replace(/^ \* ?/gm,'');
  assert.ok(embedded.includes(notice));
});
test('the bevel rules retain forced-colors real borders and reset nested theme tokens',()=>{
  assert.match(bevels,/:root, \[data-vb-theme\] \{/);
  assert.match(bevels,/@media \(forced-colors: none\)/);
  assert.match(bevels,/\.vb-form:not\(\.vb-borderless\)/);
  assert.ok(!bevels.includes('@font-face'));
});
test('runtime and standalone IDE include the same attributed bevel CSS once',()=>{
  for(const file of ['dist/vb6-controls.css','dist/studio.css','dist/VB6-Studio-Web.html']){
    const text=read(file);
    assert.ok(text.includes(bevels),file);
    // The IDE embeds exported runtime CSS inside JS too; the active <style>
    // sheet itself must contain the rules only once.
    if(!file.endsWith('.html'))assert.equal(text.split('Classic staircase bevels adapted').length-1,1,file);
  }
});


test('checkbox staircase preserves border layout and leaves radio circles untouched',async()=>{
  const {readFile}=await import('node:fs/promises');
  const css=await readFile(new URL('../src/theme/bevels.css',import.meta.url),'utf8');
  const rule=/\.vb-check input\[type=checkbox\]\s*\{([^}]+)\}/.exec(css)?.[1];
  assert.ok(rule);assert.match(rule,/border-color:transparent;box-shadow:none/);
  assert.match(rule,/background-image:var\(--vb-bevel-sunken-image\)/);
  assert.doesNotMatch(rule,/(?:^|[;\s])(?:border|border-width|padding|width|height)\s*:/);
  assert.match(css,/--vb-bevel-sunken-image:/);
});


test('classic designer scrollbar strips preserve native mechanics and other themes',()=>{
  const css=read('src/theme/bevels.css');
  const rules=css.slice(css.indexOf('/* Classic designer scrollbars remain native controls.'));
  assert.match(rules,/@media \(forced-colors: none\)/);
  assert.match(rules,/https:\/\/www.w3.org\/TR\/css-backgrounds-3\/#layering/);
  const selectors=[...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,selector])=>selector.includes('::-webkit-scrollbar'));
  assert.equal(selectors.length,8);
  for(const [,selector,body] of selectors){
    for(const part of selector.trim().split(','))assert.ok(part.trim().startsWith('.designer-scroll[data-vb-theme-family="classic"]::'),part);
    assert.doesNotMatch(body,/(?:^|[;\s])(?:width|height|display|overflow|position|padding|scrollbar-width|scrollbar-color)\s*:/);
    assert.doesNotMatch(body,/(?:45deg|135deg|inset|url\(|!important)/);
  }
  assert.match(rules,/scrollbar-button:single-button:active/);
  assert.match(rules,/scrollbar-button:single-button:disabled/);
  for(const axis of ['vertical','horizontal'])for(const end of ['increment','decrement'])
    assert.ok(rules.includes(`scrollbar-button:single-button:${axis}:${end}`));
});
