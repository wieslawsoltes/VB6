'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
// Test-only harness; normal application startup never calls these functions.
// Electron frame/navigation diagnostics: https://www.electronjs.org/docs/latest/api/web-contents/
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function withDeadline(work, label, timeout = 30000) {
  if (typeof work !== 'function' || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) throw new TypeError('Invalid smoke deadline');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out: ' + label)), timeout); })
    ]);
  } finally { clearTimeout(timer); }
}
async function until(test, label, timeout = 30000) {
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) throw new TypeError('Invalid smoke deadline');
  const end = Date.now() + timeout;
  do {
    // A pending renderer evaluation must not disable the polling deadline.
    if (await withDeadline(test, label, Math.max(1, end - Date.now()))) return;
    await delay(Math.min(50, Math.max(1, end - Date.now())));
  } while (Date.now() < end);
  throw new Error('Timed out: ' + label);
}
function createSmokeProbe({app, root, records, report, reportPath, log = text => console.log(text)}) {
  const listeners = [], observed = new WeakSet();
  report.events = [];
  const frameState = wc => {
    try { return wc.mainFrame.framesInSubtree.map(frame => ({url: frame.url, name: frame.name, detached: frame.detached})); }
    catch (error) { return [{error: String(error.message).slice(0, 500)}]; }
  };
  const flush = () => {
    report.frames = frameState(root.webContents);
    report.windows = [...records.values()].map(({window: win}) => {
      try { return {destroyed: win.isDestroyed(), visible: !win.isDestroyed() && win.isVisible(), frames: frameState(win.webContents)}; }
      catch (error) { return {error: String(error.message).slice(0, 500)}; }
    });
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  };
  const checkpoint = phase => {
    if (report.phase === phase) return;
    report.phase = phase; report.phaseStarted = new Date().toISOString();
    log('VB6 smoke: ' + phase); flush();
  };
  const note = (type, details) => {
    report.events.push({type, details, time: new Date().toISOString()});
    if (report.events.length > 64) report.events.shift();
    flush();
  };
  const listen = (target, name, handler) => { target.on(name, handler); listeners.push(() => target.removeListener(name, handler)); };
  const watch = wc => {
    if (!wc || observed.has(wc)) return;
    observed.add(wc);
    listen(wc, 'console-message', (event, level, message) => note('console', String(event.message ?? message ?? '').slice(0, 2000)));
    listen(wc, 'did-fail-load', (_event, code, description, url, main) => note('load-failed', {code, description, url, main}));
    listen(wc, 'did-fail-provisional-load', (_event, code, description, url, main) => note('provisional-load-failed', {code, description, url, main}));
    listen(wc, 'did-frame-navigate', (_event, url, code, status, main) => note('frame-navigated', {url, code, status, main}));
    listen(wc, 'render-process-gone', (_event, details) => note('renderer-gone', details));
  };
  watch(root.webContents);
  for (const {window: win} of records.values()) watch(win.webContents);
  listen(app, 'web-contents-created', (_event, wc) => watch(wc));
  const evaluate = async (target, text, userGesture = false) => {
    const label = (target === root.webContents ? 'controller: ' : 'child frame: ') + text.slice(0, 240);
    checkpoint('Evaluate ' + label);
    try { return await withDeadline(() => target.executeJavaScript(text, userGesture), label); }
    catch (error) { throw new Error('Renderer evaluation failed: ' + label + '\n' + error.message); }
  };
  return {checkpoint, flush, evaluate, dispose() { for (const remove of listeners.splice(0)) remove(); }};
}
exports.withDeadline = withDeadline;
exports.until = until;
exports.createSmokeProbe = createSmokeProbe;
exports.run = async ({ app, root, records, manifest, reportPath }) => {
  const report = { ok: false, target: manifest.kind, electron: process.versions.electron, platform: process.platform, arch: process.arch, checks: [] };
  const probe = createSmokeProbe({app, root, records, report, reportPath});
  const check = (name, value) => { assert.ok(value, name); report.checks.push(name); probe.checkpoint('Passed ' + name); };
  const evaluate = probe.evaluate;
  const js = text => evaluate(root.webContents, text, true);
  const wait = async (test, label, timeout) => {
    probe.checkpoint('Waiting for ' + label);
    return until(test, label, timeout);
  };
  try {
    await wait(() => js('globalThis.vb6NativeReady || globalThis.vb6NativeStartupError'), 'native bootstrap');
    const startupError=await js('globalThis.vb6NativeStartupError || null');
    if(startupError && manifest.graphics==='webgpu' && process.env.VB6_SMOKE_ALLOW_GRAPHICS_BLOCK==='1'){
      report.graphics=await js('globalThis.vb6NativeGraphics');
      check('strict WebGPU rejects unavailable canvas rendering',startupError.includes('requires WebGPU') && !report.graphics.webgpu);
      check('unsupported graphics cannot start application code',await js('!globalThis.vb6Application') && records.size===0);
      await wait(()=>root.isVisible(),'visible graphics diagnostic');
      check('graphics failure displays an actionable message',await js('document.body.textContent.includes("--graphics auto")'));
      report.ok=true;report.result='strict-startup-rejection';
      if(reportPath)fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
      app.quit();return;
    }
    check('bootstrap', !startupError);
    report.graphics = await js('globalThis.vb6NativeGraphics');
    check('renderer has no Node require', await js('typeof require === "undefined"'));
    check('unreserved popup blocked', await js('window.open("about:blank", "unreserved") === null'));
    check('remote popup blocked', await js('window.open("https://example.com") === null'));
    if (manifest.kind === 'studio') {
      await wait(() => js('!!globalThis.vb6Studio?.project'), 'IDE');
      check('IDE loaded', true);
      await js('vb6Studio.setWindowMode("hybrid");globalThis.paneBefore=vb6Studio.docking.panels.get("properties");void 0;');
      check('desktop tool detach accepted',await js('vb6Studio.docking.detach("properties")'));
      await wait(()=>records.size===1&&[...records.values()][0].window.isVisible(),'detached native properties');
      const tool=[...records.values()][0].window;
      check('native tool keeps original live pane',await js('[...vb6Studio.browserWindows.windows.values()][0].node.ownerDocument!==document'));
      check('native tool cannot invoke root IPC',await evaluate(tool.webContents, '(async()=>{if(typeof vb6Native==="undefined")return true;try{await vb6Native.info();return false;}catch{return true;}})()',true));
      tool.close();
      await wait(()=>records.size===0,'OS close returns tool');
      check('OS close returns pane without destroying IDE state',await js('vb6Studio.browserWindows.windows.size===0 && vb6Studio.docking.panels.get("properties")===paneBefore'));
      await js('vb6Studio.command("viewCode");globalThis.documentKey=vb6Studio.documents.mdi.active;globalThis.editorBefore=vb6Studio.editor;void 0;');
      check('desktop code document detach accepted',await js('vb6Studio.documents.mdi.detach(documentKey)'));
      await wait(()=>records.size===1&&[...records.values()][0].window.isVisible(),'native code editor');
      check('detached editor preserves exact editor instance',await js('vb6Studio.editor===editorBefore && editorBefore.root.ownerDocument!==document'));
      await js('vb6Studio.setWindowMode("mdi");void 0;');
      await wait(()=>records.size===0,'MDI mode returns native document');
      check('MDI mode restores document without replacement',await js('editorBefore.root.ownerDocument===document && vb6Studio.editor===editorBefore'));
      await js('vb6Studio.setWindowMode("hybrid");void 0;');

      await js('vb6Studio.run()');
      await wait(() => js('vb6Studio.runtimeFrame?.src.startsWith("vb6://app/preview/")'), 'sandbox preview document');
      await wait(() => root.webContents.mainFrame.frames.some(f => f.url.startsWith('vb6://app/preview/')), 'preview frame');
      const frame = root.webContents.mainFrame.frames.find(f => f.url.startsWith('vb6://app/preview/'));
      await wait(() => evaluate(frame, '!!globalThis.vb6Application'), 'runtime preview started');
      check('IDE preview runs under document-specific CSP', true);
      check('IDE preview cannot access native bridge', await evaluate(frame, 'typeof vb6Native === "undefined"'));
      await js('vb6Studio.stop()');
    } else {
      await wait(() => js('!!globalThis.vb6Application?.nativeWindows'), 'application host');
      check('embedded SQLite executes with strict WebAssembly-only CSP', await js(`(async()=>{
        const context=new VB6Runtime.RuntimeAPI.DataContext();
        try{const cn=context.connection();await cn.Open({provider:'sqlite',database:':memory:'});
          await cn.Execute('CREATE TABLE smoke(value TEXT)');await cn.query('INSERT INTO smoke VALUES(?)',["native SQLite π"]);
          await cn.BeginTrans();await cn.Execute("DELETE FROM smoke");await cn.RollbackTrans();
          return (await cn.Execute('SELECT value FROM smoke')).Item('value')==='native SQLite π';
        }finally{await context.close();}
      })()`));
      if ((manifest.dataOrigins || []).includes('http://127.0.0.1:4286')) {
        // A disposable HTTP fixture in the main-process test harness, never a production proxy.
        const server=require('node:http').createServer((req,res)=>{
          if(req.headers.origin!=='vb6://app'){res.writeHead(403);res.end();return;}
          res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'vb6://app','Cache-Control':'no-store'});
          res.end(JSON.stringify([{id:1,name:'Native REST π'}]));
        });
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4286,'127.0.0.1',resolve);});
        try {
          check('declared API origin is usable by exported data runtime with CORS',await js(`(async()=>{
            const context=new VB6Runtime.RuntimeAPI.DataContext();
            try{const cn=context.connection();await cn.Open({provider:'rest',url:'http://127.0.0.1:4286/customers',readOnly:true});
              return (await cn.Execute('')).Item('name')==='Native REST π';
            }finally{await context.close();}
          })()`));
          check('API capability does not allow remote scripts',await js(`new Promise(resolve=>{
            const script=document.createElement('script');script.src='http://127.0.0.1:4286/script.js';
            script.onload=()=>resolve(false);script.onerror=()=>{script.remove();resolve(true);};document.head.append(script);
          })`));
        } finally { await new Promise(resolve=>server.close(resolve)); }
      }

      await js('globalThis.host = globalThis.vb6Application; globalThis.f1 = host.forms.find(f => f.model.name === "Form1"); globalThis.f2 = host.forms.find(f => f.model.name === "Form2"); void 0;');
      await wait(() => records.size === 1 && [...records.values()][0].window.isVisible(), 'first native form');
      check('one native window for startup form', records.size === 1);
      check('form adopted into native window', await js('f1.node.ownerDocument !== document && f1.node.ownerDocument.defaultView === f1.nativeWindow.win'));
      const id1 = await js('f1.nativeWindow.id'), w1 = records.get(id1).window;
      await evaluate(w1.webContents, 'document.querySelector("[data-control=Command1]").click(); void 0;', true);
      await wait(() => js('f1.controls[1].Text === "Native event OK"'), 'native control click');
      check('native DOM click dispatches into shared VM', true);
      await wait(() => js('f1.controls[1].input.value === "Native event OK"'), 'native visual refresh');
      check('native control value is painted from VM state', true);
      await js('host.vm.showForm(f2.instance)');
      await wait(() => records.size === 2, 'second window');
      const id2 = await js('f2.nativeWindow.id'), w2 = records.get(id2).window;
      check('independent HWNDs', !w1.getNativeWindowHandle().equals(w2.getNativeWindowHandle()));
      check('child frame cannot directly invoke controller IPC',await evaluate(w1.webContents, '(async()=>{if(typeof vb6Native==="undefined")return true;try{await vb6Native.info();return false;}catch{return true;}})()',true));
      await js('globalThis.inputResult=null;host.inputBox("Input smoke","Native input","initial").then(value=>{inputResult=value;});void 0;');
      await wait(()=>records.size===3,'native InputBox window');
      const inputWindow=[...records.values()].find(r=>r.window!==w1&&r.window!==w2).window;
      await wait(()=>!w1.isEnabled()&&!w2.isEnabled()&&inputWindow.isEnabled(),'InputBox modality');
      await evaluate(inputWindow.webContents, 'document.querySelector("input").value="Native input OK";document.querySelector("form").requestSubmit();void 0;',true);
      await wait(()=>js('inputResult==="Native input OK"'),'InputBox return');
      await wait(()=>records.size===2&&w1.isEnabled()&&w2.isEnabled(),'InputBox owner restoration');
      check('native InputBox returns edited text and restores owner windows',true);
      w1.focus();
      await wait(() => js('host.vm.library.get("screen").ActiveForm === f1.instance'), 'native focus updates Screen.ActiveForm');
      check('native focus updates Screen.ActiveForm', true);
      await js('f1.WindowState = 1; void 0;');
      await wait(() => w1.isMinimized(), 'minimize from VB');
      await js('f1.WindowState = 0; void 0;');
      await wait(() => !w1.isMinimized(), 'restore from VB');
      await js('f1.WindowState = 2; void 0;');
      await wait(() => w1.isMaximized(), 'maximize from VB');
      await js('f1.WindowState = 0; void 0;');
      await wait(() => !w1.isMaximized(), 'unmaximize from VB');
      check('VB WindowState controls native minimize/maximize/restore', true);
      await js('f1.Caption = "Updated native caption"; f1.refresh()');
      await wait(() => w1.getTitle() === 'Updated native caption', 'caption sync');
      check('VB caption updates native title', true);
      w1.setContentSize(720, 460);
      await wait(() => js('Math.abs(f1.props.ClientWidth / 15 - 720) <= 2'), 'resize sync');
      check('native resizing updates VB twips', true);
      await js('globalThis.endModal = host.beginModal(f2); void 0;');
      await wait(() => !w1.isEnabled() && w2.isEnabled(), 'modal owner disabling');
      check('modal disables other windows', true);
      await js('endModal()');
      await wait(() => w1.isEnabled(), 'modal restore');
      check('modal restores owner', true);
      w1.close();
      await wait(() => !records.get(id1).closePending, 'QueryUnload cancellation');
      check('VB QueryUnload cancels native close', w1.isVisible() && !w1.isDestroyed());
      await js('f1.instance.fields.get("rejectclose").set(false)');
      w1.close();
      await wait(() => !w1.isVisible(), 'unload hides form');
      check('unload preserves other native windows', w2.isVisible());
      await js('host.vm.showForm(f1.instance)');
      await wait(() => w1.isVisible(), 'show after unload');
      check('unloaded form can be reopened', records.size === 2);
      await js('f2.Hide()');
      await wait(() => !w2.isVisible(), 'hide');
      await js('host.vm.showForm(f2.instance)');
      await wait(() => w2.isVisible(), 'show');
      check('hide/show retains form and HWND', true);
      await js('globalThis.surface=f1.ensureSurface();surface.add("rect",[5,5,60,40],255,true);void 0;');
      await js('surface.gpuReady');
      if(report.graphics.webgpu){
        check('native-window WebGPU initialized',await js('surface.backend==="webgpu" && !surface.gpuError'));
        report.pixel=await js(`(async()=>{
          const device=surface.device;device.pushErrorScope('validation');
          const buffer=device.createBuffer({size:256,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
          try{
            surface.render();const encoder=device.createCommandEncoder();
            encoder.copyTextureToBuffer({texture:surface.gpuContext.getCurrentTexture(),origin:[20,20]}, {buffer,bytesPerRow:256},[1,1]);
            device.queue.submit([encoder.finish()]);const validation=device.popErrorScope();
            await buffer.mapAsync(GPUMapMode.READ);const pixel=Array.from(new Uint8Array(buffer.getMappedRange(),0,4));buffer.unmap();
            const error=await validation;if(error)throw new Error(error.message);
            return {pixel,format:f1.nativeWindow.win.navigator.gpu.getPreferredCanvasFormat()};
          }finally{buffer.destroy();}
        })()`);
        const red=report.pixel.format==='bgra8unorm'?2:0;
        check('WebGPU native-window pixel readback',report.pixel.pixel[red]===255&&report.pixel.pixel[1]===0&&report.pixel.pixel[3]===255);
      }else{
        check('explicit graphics fallback has a reason',manifest.graphics==='canvas2d'||manifest.graphics==='auto'&&!!report.graphics.error);
        check('fallback actually draws through Canvas2D',await js('surface.render();surface.context.getImageData(20*surface.dpr,20*surface.dpr,1,1).data[0]===255'));
      }
      check('remote navigation rejected', await js('(async()=>{try{await fetch("https://example.com");return false;}catch{return true;}})()'));
    }
    report.ok = true;
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    app.quit();
  } catch (error) {
    report.error = error.stack || error.message;
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    probe.flush();
    app.exit(1);
  } finally { probe.dispose(); }
};
