/** Native compiler forms lowering. Kept separate from PE linkage and runtime kernels. */

import {key,mem} from './compiler-constants.js';
export const nativeCompilerFormMethods={
  timer(control) {
    const x = this.x, skip = x.unique(); x.api('user32.dll','KillTimer',[mem(control.module.handle),control.id]);
    x.value(mem(control.enabled)).test().branch('e',skip).value(mem(control.interval)).test().branch('e',skip);
    x.api('user32.dll','SetTimer',[mem(control.module.handle),control.id,mem(control.interval),0]).test().branch('e','error:7').label(skip);
  },
  formStyle(module) {
    const p = module.form.properties, border = Number(p.BorderStyle ?? 2);
    if (![0,1,2,3,4,5].includes(border)) this.fail('Invalid native BorderStyle',module);
    if (border === 0) return 0x80000000;
    let style = 0xc00000;
    if (p.ControlBox !== 0) style |= 0x80000;
    if ([2,5].includes(border)) style |= 0x40000;
    if ([1,2].includes(border) && p.MinButton !== 0) style |= 0x20000;
    if (border === 2 && p.MaxButton !== 0) style |= 0x10000;
    return style | 0x02000000;
  },
  controls(module) { this.createNativeControls(module); },
  pixels(value) { const n = Number(value) / 15; if (!Number.isFinite(n) || n < -32768 || n > 32767) this.fail('Native geometry is outside the supported range'); return Math.round(n); },
  menus(module) {
    const menus = module.form.menus || []; if (!menus.length) return;
    const x = this.x, used = new Set(); let next = 10000; module.menuCommands = new Map();
    const roots = menus.filter(m => !m.parent);
    const build = (items,handle,depth) => {
      if (depth > 16) this.fail('Native menu nesting limit exceeded',module);
      for (const menu of items) {
        if (used.has(key(menu.name))) this.fail('Duplicate or cyclic native menu',module); used.add(key(menu.name));
        if (menu.properties.Visible === 0) continue;
        let flags = (menu.properties.Enabled === 0 ? 1 : 0) | (menu.properties.Checked ? 8 : 0);
        const children = menus.filter(m => key(m.parent) === key(menu.name));
        if (children.length || menu.properties.WindowList) { const child = this.slot('menu:' + module.name + ':' + menu.name); x.api('user32.dll','CreatePopupMenu').test().branch('e','error:7').store(child); build(children,child,depth + 1); if (menu.properties.WindowList) module.windowMenu = child; x.api('user32.dll','AppendMenuW',[mem(handle),flags | 0x10,mem(child),this.string(menu.properties.Caption || menu.name)]); }
        else if (menu.properties.Caption === '-') x.api('user32.dll','AppendMenuW',[mem(handle),0x800,0,0]);
        else { const id = next++; if (next > 20000) this.fail('Native menu item limit exceeded',module); module.menuCommands.set(id,menu.name + '_Click'); x.api('user32.dll','AppendMenuW',[mem(handle),flags,id,this.string(menu.properties.Caption || menu.name)]); }
      }
    };
    x.api('user32.dll','CreateMenu').test().branch('e','error:7').store(module.menu); build(roots,module.menu,0);
    if (used.size < menus.filter(m => m.properties.Visible !== 0).length) this.fail('Unreachable or cyclic native menus',module);
  },
  form(module) {
    this.context={module,proc:{},locals:new Map()};
    const x = this.x, prefix = module.form.type === 'MDIForm' ? 'MDIForm_' : 'Form_', p = module.form.properties;
    const done = x.unique(), wnd = 'wndproc:' + module.name, wc = 'wndclass:' + module.name;
    const style = this.formStyle(module), ex = Number(p.BorderStyle) >= 4 ? 0x80 : 0;
    this.data.align(4).label(wc).u32(3).reference(wnd).u32(0).u32(0).u32(0).u32(0).u32(0).u32(16).u32(0).reference(module.className);
    module.wc = wc;
    const initialized=x.unique();
    // Initialize a default form instance once, before window creation. Reentrant UI
    // access from Form_Initialize can load that form without recursively firing Initialize.
    x.label(module.initialize).enter().value(mem(module.initialized)).test().branch('ne',initialized).value(1).store(module.initialized);
    for (const variable of module.globals.values()) {
      this.context = {module,proc:{},locals:new Map()};if(variable.nativeArray)this.destroyArrayStorage(variable);else if(key(variable.type)==='string')this.clearStringStorage(variable);else if(key(variable.type)==='variant')this.clearVariantStorage(variable);else this.zeroStorage(variable);this.initializeFixedString(variable);if(variable.initial){const first=this.globalVariantTemps?.length||0;this.storageExpression(variable,variable.initial);this.store(variable);for(const temp of (this.globalVariantTemps||[]).slice(first))this.clearVariantStorage(temp);}
    }
    this.handler(module,prefix + 'Initialize');
    x.label(initialized).value(0).leave();
    x.label(module.create).enter().call(module.initialize).value(mem(module.handle)).test().branch('ne',done);
    this.menus(module);
    const width = this.pixels(p.ClientWidth ?? p.Width ?? 9000), height = this.pixels(p.ClientHeight ?? p.Height ?? 6000);
    x.value(0).store(module.rect).store(module.rect,4).value(width).store(module.rect,8).value(height).store(module.rect,12);
    x.api('user32.dll','AdjustWindowRectEx',[module.rect,style,module.form.menus?.length ? 1 : 0,ex]);
    if (p.MDIChild) {
      x.call(this.mdi.create);
      x.api('user32.dll','CreateMDIWindowW',[module.className,this.string(p.Caption || module.name),style,this.pixels(p.Left || 0),this.pixels(p.Top || 0),width,height,mem(this.mdi.client),mem('instance'),0]);
    } else {
      // AdjustWindowRectEx produces outer dimensions without assuming a title-bar height.
      x.value({memory:module.rect,addend:8}).emit(0x2b,0x05).addr(module.rect).emit(0x89,0xc6);
      x.value({memory:module.rect,addend:12}).emit(0x2b,0x05).addr(module.rect,4).emit(0x89,0xc7);
      x.push(0).push(mem('instance')).push(mem(module.menu)).push(0).emit(0x57,0x56);
      const position = Number(p.StartUpPosition) === 0;
      x.push(position ? this.pixels(p.Top || 0) : -2147483648).push(position ? this.pixels(p.Left || 0) : -2147483648).push(style).push(this.string(p.Caption || module.name)).push(module.className).push(ex).invoke('user32.dll','CreateWindowExW');
    }
    x.test().branch('e','error:7').store(module.handle);
    x.emit(0xff,0x05).addr('live-forms');
    if (module.form.type === 'MDIForm') {
      const clientInfo = this.slot('client-create:' + module.name,0); this.data.u32(30000); if (module.windowMenu) x.value(mem(module.windowMenu)).store(clientInfo);
      x.api('user32.dll','CreateWindowExW',[0,this.string('MDICLIENT'),this.string(''),0x50300000,0,0,width,height,mem(module.handle),1,mem('instance'),clientInfo]).test().branch('e','error:7').store(module.client);
    }
    this.initializeNativeFormPictures(module);this.controls(module); x.value(1).store(module.loaded); this.initializeLayout(module); this.handler(module,prefix + 'Load');
    x.label(done).value(mem(module.handle)).leave();
    this.emitNativeControlProcedures(module);
    this.windowProcedure(module,wnd,prefix); this.showProcedure(module);
  },
  showProcedure(module) {
    const x=this.x, done=x.unique(), modeless=x.unique(), loop=x.unique(), finish=x.unique(), dispatch=x.unique(), interrupted=x.unique();
    const others=[...this.modules.values()].filter(m=>m.form&&m!==module);
    const saved=others.map((m,i)=>({module:m,hwnd:-40-i*8,enabled:-44-i*8}));
    const oldOwner=-48-others.length*8;
    x.label('show:'+module.name).enter(56+others.length*8);
    x.value({argument:8}).compare(0).branch('e',modeless).compare(1).branch('ne','error:5');
    if(module.form.properties.MDIChild)x.jump('error:5');
    // A nested message loop retains the caller's stack, VM-equivalent modal blocking.
    // Record HWND identity and enabled state so a recreated form is never modified on return.
    for(const item of saved){
      x.value(mem(item.module.handle)).emit(0x89,0x85).imm(item.hwnd).push().invoke('user32.dll','IsWindowEnabled').emit(0x89,0x85).imm(item.enabled);
      x.api('user32.dll','EnableWindow',[mem(item.module.handle),0]);
    }
    x.api('user32.dll','SetWindowLongW',[mem(module.handle),-8,{argument:12}]).emit(0x89,0x85).imm(oldOwner);
    x.api('user32.dll','ShowWindow',[mem(module.handle),5]).api('user32.dll','UpdateWindow',[mem(module.handle)]);
    x.label(loop).value(mem(module.handle)).test().branch('e',finish).push().invoke('user32.dll','IsWindowVisible').test().branch('e',finish);
    x.push(0).push(0).push(0).local(-32).push().invoke('user32.dll','GetMessageW').test().branch('e',interrupted).branch('s','error:5');
    x.local(-32).push().push(mem(module.handle)).invoke('user32.dll','IsDialogMessageW').test().branch('ne',loop);
    x.local(-32).push().invoke('user32.dll','TranslateMessage');x.local(-32).push().invoke('user32.dll','DispatchMessageW').jump(loop);
    x.label(interrupted).api('user32.dll','PostQuitMessage',[0]);
    x.label(finish);
    for(const item of saved){const skip=x.unique();x.value({argument:item.hwnd}).test().branch('e',skip).emit(0x3b,0x05).addr(item.module.handle).branch('ne',skip);x.api('user32.dll','EnableWindow',[{argument:item.hwnd},{argument:item.enabled}]).label(skip);}
    const noWindow=x.unique();x.value(mem(module.handle)).test().branch('e',noWindow).api('user32.dll','SetWindowLongW',[mem(module.handle),-8,{argument:oldOwner}]).label(noWindow);
    x.api('user32.dll','SetActiveWindow',[{argument:12}]).jump(done);
    x.label(modeless).api('user32.dll','ShowWindow',[mem(module.handle),5]).api('user32.dll','UpdateWindow',[mem(module.handle)]);
    x.label(done).value(0).leave(8);
  },
  windowProcedure(module,wnd,prefix) {
    const x = this.x, fallback = x.unique(), zero = x.unique(), exit = x.unique(), close = x.unique(), destroy = x.unique(), command = x.unique(), timer = x.unique(), size = x.unique(), focus = x.unique();
    x.label(wnd).enter(64);this.enterCallbackBoundary(-12);
    x.value({argument:12}).compare(2).branch('e',destroy).compare(0x10).branch('e',close);
    this.nativeFormPictureMessage(module,fallback,exit);this.nativeControlPaintMessages(module,fallback,exit);
    x.value(mem(module.loaded)).test().branch('e',fallback);
    this.gridEditNotifications(module,zero,exit);this.gridNotificationMessages(module,zero,fallback);
    this.nativeControlWindowMessages(module,fallback,zero,exit);
    x.value({argument:12}).compare(0x111).branch('e',command).compare(0x113).branch('e',timer).compare(5).branch('e',size).compare(6).branch('e',focus).jump(fallback);
    x.label(command).value({argument:16}).emit(0x89,0xc3,0x25).imm(65535);
    for (const control of module.controls.values()) {
      if (control.model.type === 'Timer') continue;
      const next = x.unique(); x.compare(control.id).branch('ne',next).emit(0xc1,0xeb,16);
      const events = this.nativeCommandEvents(control.model.type);
      for (const [code,event] of events) { const another = x.unique(); x.emit(0x83,0xfb,code & 255); if (code > 127) { // Replace sign-extended short comparison with imm32.
          this.text.bytes.splice(this.text.bytes.length - 3,3); x.emit(0x81,0xfb).imm(code);
        } x.branch('ne',another); this.controlHandler(module,control,event); x.jump(zero).label(another); }
      x.jump(fallback).label(next);
    }
    for (const [id,event] of module.menuCommands || []) { const next = x.unique(); x.compare(id).branch('ne',next); this.handler(module,event); x.jump(zero).label(next); }
    x.jump(fallback);
    x.label(timer).value({argument:16});
    for (const control of module.controls.values()) if (control.model.type === 'Timer') { const next = x.unique(); x.compare(control.id).branch('ne',next); this.controlHandler(module,control,'Timer'); x.jump(zero).label(next); }
    x.jump(fallback);
    x.label(size);
    if (module.form.type === 'MDIForm') {
      x.api('user32.dll','GetClientRect',[{argument:8},module.rect]);
      x.api('user32.dll','MoveWindow',[mem(module.client),0,0,{memory:module.rect,addend:8},{memory:module.rect,addend:12},1]);
    }
    this.runLayout(module); this.handler(module,prefix + 'Resize'); x.jump(fallback);
    x.label(focus).value({argument:16}).emit(0x25).imm(65535).test(); const deactivate = x.unique(); x.branch('e',deactivate); this.handler(module,prefix + 'Activate'); x.jump(fallback).label(deactivate); this.handler(module,prefix + 'Deactivate'); x.jump(fallback);
    x.label(close).value(mem(module.loaded)).test().branch('e',fallback).value(0).emit(0x89,0x45,0xfc).value({argument:16}).emit(0x89,0x45,0xf8);
    this.handler(module,prefix + 'QueryUnload',[{ref:-4},{ref:-8}]); x.emit(0x83,0x7d,0xfc,0).branch('ne',zero);
    if(module.form.type==='MDIForm')for(const child of this.modules.values())if(child.form?.properties.MDIChild){
      const skip=x.unique();x.value(mem(child.handle)).test().branch('e',skip).api('user32.dll','SendMessageW',[mem(child.handle),0x10,2,0]);x.value(mem(child.handle)).test().branch('ne',zero).label(skip);
    }
    this.handler(module,prefix + 'Unload',[{ref:-4}]); x.emit(0x83,0x7d,0xfc,0).branch('ne',zero);
    if(module.form.properties.MDIChild)x.api('user32.dll','SendMessageW',[mem(this.mdi.client),0x221,{argument:8},0]);else x.api('user32.dll','DestroyWindow',[{argument:8}]);x.jump(zero);
    x.label(destroy).value(mem(module.handle)).test().branch('e',zero).value(0).store(module.handle).store(module.loaded).store(module.initialized).store(module.client).store(module.menu);
    for (const control of module.controls.values()) x.store(control.handle);
    for(const variable of module.globals.values())if(key(variable.type)==='variant'&&!variable.nativeArray)this.clearVariantStorage({...variable,owner:null});
    this.disposeNativePictures(module);this.disposeNativeControls(module);
    x.emit(0xff,0x0d).addr('live-forms').value(mem('live-forms')).test().branch('ne',zero).api('user32.dll','PostQuitMessage',[0]).jump(zero);
    x.label(fallback);
    if (module.form.type === 'MDIForm') x.api('user32.dll','DefFrameProcW',[{argument:8},mem(module.client),{argument:12},{argument:16},{argument:20}]);
    else x.api('user32.dll',module.form.properties.MDIChild ? 'DefMDIChildProcW' : 'DefWindowProcW',[{argument:8},{argument:12},{argument:16},{argument:20}]);
    x.jump(exit).label(zero).value(0).label(exit);this.leaveCallbackBoundary(-12);x.leave(16);
  }
};
