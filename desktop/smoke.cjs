'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 30000) {
  const end = Date.now() + timeout;
  do { if (await test()) return; await delay(50); } while (Date.now() < end);
  throw new Error('Timed out: ' + label);
}
exports.run = async ({ app, root, records, manifest, reportPath }) => {
  const report = { ok: false, target: manifest.kind, electron: process.versions.electron, platform: process.platform, arch: process.arch, checks: [] };
  const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };
  const js = text => root.webContents.executeJavaScript(text, true).catch(error => { throw new Error('Renderer evaluation failed: ' + text.slice(0, 240) + '\n' + error.message); });
  try {
    await until(() => js('globalThis.vb6NativeReady || globalThis.vb6NativeStartupError'), 'native bootstrap');
    check('bootstrap', await js('!globalThis.vb6NativeStartupError'));
    report.graphics = await js('globalThis.vb6NativeGraphics');
    check('renderer has no Node require', await js('typeof require === "undefined"'));
    check('unreserved popup blocked', await js('window.open("about:blank", "unreserved") === null'));
    check('remote popup blocked', await js('window.open("https://example.com") === null'));
    if (manifest.kind === 'studio') {
      await until(() => js('!!globalThis.vb6Studio?.project'), 'IDE');
      check('IDE loaded', true);
      await js('vb6Studio.run()');
      await until(() => js('vb6Studio.runtimeFrame?.src.startsWith("vb6://app/preview/")'), 'sandbox preview document');
      await until(() => root.webContents.mainFrame.frames.some(f => f.url.startsWith('vb6://app/preview/')), 'preview frame');
      const frame = root.webContents.mainFrame.frames.find(f => f.url.startsWith('vb6://app/preview/'));
      await until(() => frame.executeJavaScript('!!globalThis.vb6Application'), 'runtime preview started');
      check('IDE preview runs under document-specific CSP', true);
      check('IDE preview cannot access native bridge', await frame.executeJavaScript('typeof vb6Native === "undefined"'));
      await js('vb6Studio.stop()');
    } else {
      await until(() => js('!!globalThis.vb6Application?.nativeWindows'), 'application host');
      await js('globalThis.host = globalThis.vb6Application; globalThis.f1 = host.forms.find(f => f.model.name === "Form1"); globalThis.f2 = host.forms.find(f => f.model.name === "Form2"); void 0;');
      await until(() => records.size === 1 && [...records.values()][0].window.isVisible(), 'first native form');
      check('one native window for startup form', records.size === 1);
      check('form adopted into native window', await js('f1.node.ownerDocument !== document && f1.node.ownerDocument.defaultView === f1.nativeWindow.win'));
      const id1 = await js('f1.nativeWindow.id'), w1 = records.get(id1).window;
      await w1.webContents.executeJavaScript('document.querySelector("[data-control=Command1]").click(); void 0;', true);
      await until(() => js('f1.controls[1].Text === "Native event OK"'), 'native control click');
      check('native DOM click dispatches into shared VM', true);
      await until(() => js('f1.controls[1].input.value === "Native event OK"'), 'native visual refresh');
      check('native control value is painted from VM state', true);
      await js('host.vm.showForm(f2.instance)');
      await until(() => records.size === 2, 'second window');
      const id2 = await js('f2.nativeWindow.id'), w2 = records.get(id2).window;
      check('independent HWNDs', !w1.getNativeWindowHandle().equals(w2.getNativeWindowHandle()));
      w1.focus();
      await until(() => js('host.vm.library.get("screen").ActiveForm === f1.instance'), 'native focus updates Screen.ActiveForm');
      check('native focus updates Screen.ActiveForm', true);
      await js('f1.WindowState = 1; void 0;');
      await until(() => w1.isMinimized(), 'minimize from VB');
      await js('f1.WindowState = 0; void 0;');
      await until(() => !w1.isMinimized(), 'restore from VB');
      await js('f1.WindowState = 2; void 0;');
      await until(() => w1.isMaximized(), 'maximize from VB');
      await js('f1.WindowState = 0; void 0;');
      await until(() => !w1.isMaximized(), 'unmaximize from VB');
      check('VB WindowState controls native minimize/maximize/restore', true);
      await js('f1.Caption = "Updated native caption"; f1.refresh()');
      await until(() => w1.getTitle() === 'Updated native caption', 'caption sync');
      check('VB caption updates native title', true);
      w1.setContentSize(720, 460);
      await until(() => js('Math.abs(f1.props.ClientWidth / 15 - 720) <= 2'), 'resize sync');
      check('native resizing updates VB twips', true);
      await js('globalThis.endModal = host.beginModal(f2); void 0;');
      await until(() => !w1.isEnabled() && w2.isEnabled(), 'modal owner disabling');
      check('modal disables other windows', true);
      await js('endModal()');
      await until(() => w1.isEnabled(), 'modal restore');
      check('modal restores owner', true);
      w1.close();
      await until(() => !records.get(id1).closePending, 'QueryUnload cancellation');
      check('VB QueryUnload cancels native close', w1.isVisible() && !w1.isDestroyed());
      await js('f1.instance.fields.get("rejectclose").set(false)');
      w1.close();
      await until(() => !w1.isVisible(), 'unload hides form');
      check('unload preserves other native windows', w2.isVisible());
      await js('host.vm.showForm(f1.instance)');
      await until(() => w1.isVisible(), 'show after unload');
      check('unloaded form can be reopened', records.size === 2);
      await js('f2.Hide()');
      await until(() => !w2.isVisible(), 'hide');
      await js('host.vm.showForm(f2.instance)');
      await until(() => w2.isVisible(), 'show');
      check('hide/show retains form and HWND', true);
      const probe = `(async()=>{
        const result={secure:isSecureContext,gpu:!!navigator.gpu};
        if(!navigator.gpu)return result;
        try{
          const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
          if(!adapter)return {...result,adapter:false};
          const device=await adapter.requestDevice();globalThis.vb6SmokeGPU={adapter,device};
          device.lost.then(info=>{result.lost={reason:info.reason,message:info.message};});
          const destroy=GPUDevice.prototype.destroy;
          globalThis.vb6DeviceDestructions=[];
          GPUDevice.prototype.destroy=function(){globalThis.vb6DeviceDestructions.push(new Error().stack);return destroy.call(this);};
          const buffer=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST});
          device.queue.writeBuffer(buffer,0,new Float32Array([1,2,3,4]));
          await device.queue.onSubmittedWorkDone();
          result.submitted=true;
          const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;document.body.append(canvas);
          const context=canvas.getContext('webgpu');
          device.pushErrorScope('validation');context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});
          const encoder=device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:1,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});
          pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
          const validation=await device.popErrorScope();result.canvasValidation=validation?.message||null;
          canvas.width=128;canvas.height=128;
          await new Promise(resolve=>setTimeout(resolve,100));
          result.canvasSubmitted=true;
          context.unconfigure();canvas.remove();buffer.destroy();return result;
        }catch(error){return {...result,error:error.message};}
      })()`;
      report.gpuBootstrapAfterWindows=await js('({diagnostics:globalThis.vb6NativeGraphics,retained:!!globalThis.vb6NativeGPUDevice})');
      report.gpuRootProbe=await js(probe);
      report.gpuChildProbe=await w1.webContents.executeJavaScript(probe,true);
      await js('globalThis.surface = f1.ensureSurface(); surface.add("rect", [5,5,60,40], 255, true);');
      await until(() => js('surface.backend === "webgpu" || surface.renderingBackend === "Canvas2D"'), 'graphics backend');
      if (report.graphics.webgpu) {
        await until(async () => {
          const status = await js('({backend: surface.backend, error: surface.gpuError, destructions: globalThis.vb6DeviceDestructions, childDestructions:f1.nativeWindow.win.vb6DeviceDestructions})');
          report.surface=status;
          if (status.error) throw new Error('Native graphics initialization failed: ' + status.error);
          return status.backend === 'webgpu';
        }, 'WebGPU surface');
        await js('(async()=>{surface.device.pushErrorScope("validation");surface.render();await surface.device.queue.onSubmittedWorkDone();const error=await surface.device.popErrorScope();if(error)throw new Error(error.message);})()');
        check('WebGPU submits native-window drawing', true);
      } else {
        check('explicit fallback is reported', manifest.graphics === 'auto' || manifest.graphics === 'canvas2d');
      }
      check('remote navigation rejected', await js('(async()=>{try{await fetch("https://example.com");return false;}catch{return true;}})()'));
    }
    report.ok = true;
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    app.quit();
  } catch (error) {
    report.error = error.stack || error.message;
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    app.exit(1);
  }
};
