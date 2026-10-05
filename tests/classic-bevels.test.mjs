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
