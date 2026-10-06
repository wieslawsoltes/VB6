from pathlib import Path
root=Path.cwd()
p=root/'desktop/smoke.cjs';s=p.read_text()
s=s.replace("exports.run = async", """// A renderer can disappear while an evaluation is in flight. Bound every
// evaluation so a lost Electron reply cannot bypass the smoke-test deadline.
async function evaluate(target, source, userGesture = true, timeout = 15000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => target.executeJavaScript(source, userGesture)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Renderer evaluation timed out: ' + source.slice(0, 240))), timeout); })
    ]);
  } finally { clearTimeout(timer); }
}
exports.evaluate = evaluate;
exports.run = async""")
s=s.replace("  const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };", """  const checkpoint = () => { if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); };
  const check = (name, value) => {
    assert.ok(value, name); report.checks.push(name); checkpoint();
    console.log('PASS ' + name);
  };""")
s=s.replace("root.webContents.executeJavaScript(text, true)", "evaluate(root.webContents, text)")
s=s.replace('frame.executeJavaScript(', 'evaluate(frame, ')
s=s.replace('immediateFrame.executeJavaScript(', 'evaluate(immediateFrame, ')
s=s.replace('tool.webContents.executeJavaScript(', 'evaluate(tool.webContents, ')
s=s.replace('w1.webContents.executeJavaScript(', 'evaluate(w1.webContents, ')
old='''      await inputWindow.webContents.executeJavaScript('document.querySelector("input").value="Native input OK";document.querySelector("form").requestSubmit();void 0;',true);'''
assert old in s
s=s.replace(old,'''      // Submitting destroys the InputBox webContents. Execute through the
      // surviving controller's shared DOM, not the renderer being destroyed:
      // its evaluation reply can otherwise be lost after the submit handler.
      await js(`(()=>{
        const dialog=[...host.nativeWindows.dialogs.values()][0];
        dialog.doc.querySelector('input').value='Native input OK';
        dialog.doc.querySelector('form').requestSubmit();return true;
      })()`);''')
p.write_text(s)
p=root/'tools/browser-intellisense-tests.py';s=p.read_text();old="    put(p,'SelSt');check(names(p)==['SelStart'],names(p));p.keyboard.press('Tab')"
assert old in s
s=s.replace(old,"""    put(p,'SelSt')
    # Firefox may acknowledge text insertion before the input-driven list
    # refresh completes. Observe the exact filtered state, not two racy reads.
    p.wait_for_function('!!vb6Studio.editor.completion && vb6Studio.editor.completionItems.length===1 && vb6Studio.editor.completionItems[0]==="SelStart"')
    check(names(p)==['SelStart'],names(p));p.keyboard.press('Tab')""",1)
p.write_text(s)
p=root/'tools/browser-native-build-tests.py';s=p.read_text()
old="""            original = json.loads((extra / f'{name}.vb6web').read_text())
            page.evaluate('p => vb6Studio.loadProject(p)', original)"""
new="""            # Isolate each export in a fresh document. Chromium limits bursts
            # of downloads from one frame even when the menu click is real;
            # the fixture matrix must not depend on the runner's speed.
            page.close()
            page = browser.new_page(accept_downloads=True, viewport={'width': 1440, 'height': 960})
            page.set_default_timeout(15000)
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('https:', 'http:')) else None)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_content((ROOT / 'dist/VB6-Studio-Web.html').read_text())
            page.wait_for_function('!!globalThis.vb6Studio?.project')
            original = json.loads((extra / f'{name}.vb6web').read_text())
            page.evaluate('p => vb6Studio.loadProject(p)', original)"""
assert old in s;s=s.replace(old,new,1)
old="""            with page.expect_download() as pending:
                page.locator('.classic-menu [data-command="exportWin32"]').click()
            downloaded = pending.value"""
new="""            try:
                with page.expect_download() as pending:
                    page.locator('.classic-menu [data-command="exportWin32"]').click()
                downloaded = pending.value
            except Exception:
                (OUT / f'{name}-failure.json').write_text(json.dumps({
                    'build': page.evaluate('vb6Studio.lastNativeBuild || null'),
                    'output': page.evaluate('vb6Studio.output'),
                    'pageErrors': errors, 'requests': requests,
                }, indent=2))
                page.screenshot(path=str(OUT / f'{name}-failure.png'))
                raise"""
assert old in s;s=s.replace(old,new,1)
p.write_text(s)
p=root/'tests/native-smoke-evaluation.test.mjs'
p.write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { evaluate } = createRequire(import.meta.url)('../desktop/smoke.cjs');

test('native smoke evaluations return values and preserve the user gesture', async () => {
  const calls = [];
  const target = { executeJavaScript(...args) { calls.push(args); return Promise.resolve(42); } };
  assert.equal(await evaluate(target, '6 * 7'), 42);
  assert.deepEqual(calls, [['6 * 7', true]]);
});

test('native smoke evaluations propagate synchronous destruction errors', async () => {
  const target = { executeJavaScript() { throw new Error('Object has been destroyed'); } };
  await assert.rejects(evaluate(target, 'query'), /Object has been destroyed/);
});

test('native smoke evaluations propagate rejected script promises', async () => {
  const target = { executeJavaScript() { return Promise.reject(new Error('script failed')); } };
  await assert.rejects(evaluate(target, 'query'), /script failed/);
});

test('a lost renderer reply cannot stall native smoke validation indefinitely', async () => {
  const target = { executeJavaScript() { return new Promise(() => {}); } };
  await assert.rejects(evaluate(target, 'lost reply', true, 10), /Renderer evaluation timed out: lost reply/);
});

test('a late rejected renderer reply after timeout is handled', async () => {
  let reject;
  const target = { executeJavaScript() { return new Promise((_, fail) => { reject = fail; }); } };
  await assert.rejects(evaluate(target, 'late reply', false, 10), /timed out/);
  reject(new Error('retired renderer'));
  await new Promise(resolve => setTimeout(resolve, 0));
});
""")
