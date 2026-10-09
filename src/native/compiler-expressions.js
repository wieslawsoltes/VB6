/** Native compiler expressions lowering. Kept separate from PE linkage and runtime kernels. */
import {REAL_TYPES} from './numeric.js';
import {key,lit,mem,BOOL_CONDITIONS} from './compiler-constants.js';
export const nativeCompilerExpressionMethods={
  type(node) {
    if(this.typeCache?.has(node))return this.typeCache.get(node);
    const type=this.computeNativeType(node);this.typeCache?.set(node,type);return type;
  },
  computeNativeType(node) {
    if(node.kind==='nativeKernelValue')return 'long';
    const surfaceType=this.nativeSurfaceType(node);if(surfaceType)return surfaceType;
    const variantType=this.variantType(node);if(variantType)return variantType;
    const stringType=this.stringLibraryType(node);if(stringType)return stringType;
    const layoutType=this.layoutType(node);if(layoutType)return layoutType;
    const controlType=this.nativeControlType(node);if(controlType)return controlType;
    const bound=this.nativeConstant(node);if(bound)return bound.type;
    const intervalType=this.dateIntervalType(node);if(intervalType)return intervalType;
    const dateType=this.dateType(node);if(dateType)return dateType;
    const currencyType=this.currencyType(node);if(currencyType)return currencyType;
    const integerType=this.integerType(node);if(integerType)return integerType;
    const numericType=this.numericType(node);if(numericType)return numericType;
    if (node.kind === 'group') return this.type(node.expr);
    const errorProperty=this.errorProperty(node);if(errorProperty)return ['number','lastdllerror','helpcontext'].includes(errorProperty)?'long':'string';
    const variable=this.variable(node);if(variable)return key(variable.type);
    if(node.kind==='call'){
      const name=node.callee.kind==='id'?key(node.callee.name).replace(/\$$/,''):'';
      if(['cstr','left','right','mid','chrw','space'].includes(name))return 'string';
      const result=this.nativeFunctionType(node);if(result)return result;
    }
    if(node.kind==='id'||node.kind==='member'){const result=this.nativeFunctionType(node);if(result)return result;}
    if (node.kind === 'id' && key(node.name)==='caption' && this.context?.module.form && !this.variable(node)) return 'string';
    if (node.kind === 'literal') return typeof node.value === 'string' ? 'string' : 'long';
    const constant = this.constant(node); if (constant !== undefined) return typeof constant === 'string' ? 'string' : 'long';
    if (node.kind==='binary' && (node.op==='&' || node.op==='+' && this.type(node.left)==='string' && this.type(node.right)==='string')) return 'string';
    if (node.kind === 'member' && ['caption','text'].includes(key(node.name)) && this.object(node.object)) return 'string';
    if (node.kind === 'call' && node.callee.kind === 'id' && key(node.callee.name) === 'cstr') return 'string';
    return 'long';
  },
  numeric(node) { if(this.type(node)==='variant'){this.expression(node);this.unboxVariant('long');return;} if (this.type(node) === 'string') this.fail('Use CLng/CInt explicitly to convert native text to a number'); this.expression(node);if(this.type(node)==='currency')this.currencyToInteger();else if(REAL_TYPES.has(this.type(node)))this.floatToInteger(); },
  textExpression(node) { if(this.type(node)==='variant'){this.expression(node);this.unboxVariant('string');this.stringPointer();return;} this.expression(node); if(this.type(node)==='date'){this.dateToString();}else if(this.type(node)==='currency'){this.currencyToString();}else if(REAL_TYPES.has(this.type(node))){this.floatToString(this.type(node));}else if(this.type(node)!=='string'){this.x.push().call('native:string:from-int');this.ownString();}this.stringPointer(); },
  expression(node) {
    if (!node) this.fail('Missing expression'); const x = this.x;
    if(node.kind==='nativeKernelValue'){x.value(node.value);return;}
    if(node.kind==='id'&&this.context?.module.form&&!this.variable(node)&&!this.resolveProcedure(node)&&this.getNativeSurfaceProperty(this.context.module,key(node.name)))return;
    if(this.variantOperation(node))return;
    if(this.layoutExpression(node)||this.gridExpression(node)||this.chartExpression(node))return;
    const bound=this.nativeConstant(node);if(bound)return this.emitNativeConstant(bound);
    if(this.nativeNullString(node)){x.value(0);return;}
    if(this.dateOperation(node))return;
    if(this.currencyOperation(node))return;
    if(this.integerExpression(node))return;
    if(this.numericExpression(node))return;
    if (node.kind === 'group') return this.expression(node.expr);
    if (node.kind === 'unary' && node.op === '-' && node.expr?.kind === 'literal' && node.expr.value === 2147483648) { x.value(-2147483648); return; }
    if (node.kind === 'literal') { if (typeof node.value === 'string') x.value(this.string(node.value)); else if (typeof node.value === 'boolean') x.value(node.value ? -1 : 0); else if (Number.isInteger(node.value) && node.value >= -2147483648 && node.value <= 2147483647) x.value(node.value); else this.fail('Native AOT currently requires signed 32-bit integer or string-literal values'); return; }
    const constant = this.constant(node); if (constant !== undefined) return this.expression(lit(constant));
    const variable = this.variable(node); if (variable) return this.load(variable);
    if(this.errorExpression(node))return;
    if (node.kind === 'member') {
      if(this.nativeFunctionType(node))return this.call({kind:'call',callee:node,args:[]});
      return this.getProperty(this.object(node.object),key(node.name));
    }
    if (node.kind === 'id') { if (this.context?.module.form && (['caption','hwnd','visible','enabled','windowstate','scalewidth','scaleheight'].includes(key(node.name))||this.layoutField(this.context.module,key(node.name))!==undefined)) return this.getProperty(this.context.module,key(node.name)); return this.call({kind:'call',callee:node,args:[]}); }
    if (node.kind === 'call') return this.call(node);
    if (node.kind === 'unary') {
      this.numeric(node.value ?? node.expr ?? node.operand); if (node.op === '-') x.emit(0xf7,0xd8).branch('o','error:6'); else if (key(node.op) === 'not') x.emit(0xf7,0xd0); else if (node.op !== '+') this.fail('Unsupported native unary operator: ' + node.op); return;
    }
    if (node.kind !== 'binary') this.fail('Unsupported native expression: ' + node.kind);
    const op = key(node.op);
    if (op === '&' || op==='+' && this.type(node.left)==='string' && this.type(node.right)==='string') {
      this.textExpression(node.left);x.push();this.textExpression(node.right);x.emit(0x5b).push().emit(0x53).call('native:string:concat');this.ownString();return;
    }
    if (this.type(node.left) === 'string' || this.type(node.right) === 'string') {
      if (!Object.hasOwn(BOOL_CONDITIONS,op) || this.type(node.left) !== this.type(node.right)) this.fail('Unsupported native string operation: ' + op);
      this.compareNativeStrings(node.left,node.right);x.compare(0);this.boolean(op);return;
    }
    this.numeric(node.left); x.push(); this.numeric(node.right); x.emit(0x89,0xc1,0x58);
    if (op === '+') x.emit(0x01,0xc8).branch('o','error:6');
    else if (op === '-') x.emit(0x29,0xc8).branch('o','error:6');
    else if (op === '*') x.emit(0x0f,0xaf,0xc1).branch('o','error:6');
    else if (op === '\\' || op === 'mod') this.emitIntegerDivision(op);
    else if (op === 'and') x.emit(0x21,0xc8); else if (op === 'or') x.emit(0x09,0xc8); else if (op === 'xor') x.emit(0x31,0xc8);
    else if (op === 'eqv') x.emit(0x31,0xc8,0xf7,0xd0); else if (op === 'imp') x.emit(0xf7,0xd0,0x09,0xc8);
    else if (Object.hasOwn(BOOL_CONDITIONS,op)) { x.emit(0x39,0xc8); this.boolean(op); }
    else this.fail('Native operator is not lowered: ' + op);
  },
  boolean(op) { this.x.emit(0x0f,BOOL_CONDITIONS[op],0xc0,0x0f,0xb6,0xc0,0xf7,0xd8); },
  getProperty(object, property) {
    if (!object) this.fail('Unknown native object'); const x = this.x;
    this.withGuard(object.nativeWithActive);
    if(this.controlArrayProperty(object,property))return;
    if(this.getNativeSurfaceProperty(object,property))return;
    if(this.getLayoutProperty(object,property))return;
    if(this.getNativeControlProperty(object,property))return;
    if (property === 'hwnd') { if (object.model?.type === 'Timer') this.fail('Timer has no hWnd'); this.handle(object); return; }
    if (['text','caption'].includes(property)) {
      if (object.model?.type === 'Timer') this.fail('Timer has no text');
      const buffer = this.buffer(); this.handle(object); x.push().invoke('user32.dll','GetWindowTextLengthW').compare(4095).branch('g','error:7');
      x.api('user32.dll','GetWindowTextW',[this.controlHandleRef(object),buffer,4096]).push(buffer).invoke('oleaut32.dll','SysAllocString').test().branch('e','error:7');this.ownString(); return;
    }
    if (property === 'enabled' || property === 'visible') { if (object.model?.type === 'Timer') { if (property !== 'enabled') this.fail('Timer has no Visible property'); x.value(mem(object.enabled)); } else { this.handle(object); x.push().invoke('user32.dll',property === 'enabled' ? 'IsWindowEnabled' : 'IsWindowVisible').emit(0xf7,0xd8); } return; }
    if (property === 'interval' && object.model?.type === 'Timer') { x.value(mem(object.interval)); return; }
    if (property === 'value' && ['CheckBox','OptionButton'].includes(object.model?.type)) { this.ensure(object); x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0xf0,0,0]); if (object.model.type === 'OptionButton') x.emit(0xf7,0xd8); return; }
    if (['listindex','listcount'].includes(property) && ['ListBox','ComboBox'].includes(object.model?.type)) { this.ensure(object); const combo = object.model.type === 'ComboBox'; x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),property === 'listindex' ? combo ? 0x147 : 0x188 : combo ? 0x146 : 0x18b,0,0]); return; }
    if (property === 'windowstate' && object.form) { const done = x.unique(), normal = x.unique(); this.ensure(object); x.api('user32.dll','IsIconic',[this.controlHandleRef(object)]).test().branch('e',normal).value(1).jump(done).label(normal).api('user32.dll','IsZoomed',[this.controlHandleRef(object)]).emit(0xd1,0xe0).label(done); return; }
    if (['scalewidth','scaleheight'].includes(property) && object.form) { this.ensure(object); x.api('user32.dll','GetClientRect',[this.controlHandleRef(object),object.rect]).value({memory:object.rect,addend:property === 'scalewidth' ? 8 : 12}); if(Number(object.form.properties.ScaleMode ?? 1)===1)x.emit(0x6b,0xc0,15); return; }
    this.fail('Native property is not lowered: ' + property);
  },
  setProperty(object, property, expr) {
    if (!object) this.fail('Unknown native assignment target'); const x = this.x;
    if(this.setNativeSurfaceProperty(object,property,expr))return;
    this.ensure(object);
    if(this.setLayoutProperty(object,property,expr))return;
    if(this.setNativeControlProperty(object,property,expr))return;
    if (['text','caption'].includes(property) && object.model?.type !== 'Timer') { this.textExpression(expr); x.push().push(this.controlHandleRef(object)).invoke('user32.dll','SetWindowTextW'); return; }
    if (property === 'enabled' && object.model?.type === 'Timer' || property === 'interval' && object.model?.type === 'Timer') { this.numeric(expr); if (property === 'enabled') this.check('Boolean'); else x.compare(0).branch('l','error:5').compare(65535).branch('g','error:5'); x.store(property === 'enabled' ? object.enabled : object.interval); this.timer(object); return; }
    if (['enabled','visible'].includes(property)) { this.numeric(expr); this.check('Boolean'); x.emit(0xf7,0xd8); if (property === 'visible') x.emit(0x6b,0xc0,5); x.push().push(this.controlHandleRef(object)).invoke('user32.dll',property === 'enabled' ? 'EnableWindow' : 'ShowWindow'); return; }
    if (property === 'windowstate' && object.form) { const normal = x.unique(), minimize = x.unique(), done = x.unique(); this.numeric(expr); x.compare(0).branch('e',normal).compare(1).branch('e',minimize).compare(2).branch('ne','error:5').value(3).jump(done).label(minimize).value(6).jump(done).label(normal).value(9).label(done).push().push(this.controlHandleRef(object)).invoke('user32.dll','ShowWindow'); return; }
    if (property === 'value' && ['CheckBox','OptionButton'].includes(object.model?.type)) { this.numeric(expr); if (object.model.type === 'OptionButton') { this.check('Boolean'); x.emit(0xf7,0xd8); } x.compare(0).branch('l','error:5').compare(2).branch('g','error:5'); x.emit(0x89,0xc3).push(0).emit(0x53).push(0xf1).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW'); return; }
    if (property === 'listindex' && ['ListBox','ComboBox'].includes(object.model?.type)) { this.numeric(expr); x.emit(0x89,0xc3).push(0).emit(0x53).push(object.model.type === 'ComboBox' ? 0x14e : 0x186).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW'); return; }
    this.fail('Native assignment is not lowered: ' + property);
  },
  call(node) {
    const x = this.x, args = node.args, name = node.callee.kind === 'id' ? key(node.callee.name).replace(/\$$/,'') : null;
    if(this.variantBuiltin(node,name))return;
    if(this.nativePictureBuiltin(node,name))return;
    if(this.layoutHostCall(node,name))return;
    if(this.errorCall(node))return;
    if(node.callee.kind==='id'&&!this.resolveProcedure(node.callee)&&this.context?.module.form&&this.nativeSurfaceMethod(this.context.module,name,args))return;
    if(this.dateIntervalBuiltin(node,name))return;
    if(this.dateBuiltin(node,name))return;
    if(this.currencyBuiltin(node,name))return;
    if(this.numericBuiltin(node,name))return;
    if(this.recordBuiltin(node,name))return;
    if(this.stringLibraryBuiltin(node,name)||this.stringBuiltin(node,name))return;
    if(name==='lbound'||name==='ubound'){this.arrayBoundCall(node,name==='ubound');return;}
    if (name === 'msgbox') {
      if (args.length < 1 || args.length > 3) this.fail('MsgBox expects one to three arguments');
      this.textExpression(args[0]); x.push(); this.numeric(args[1] || lit(0)); x.push(); this.textExpression(args[2] || lit(this.project.name)); x.emit(0x89,0xc2,0x59,0x5b,0x51,0x52,0x53).push(this.context.module.form ? mem(this.context.module.handle) : 0).invoke('user32.dll','MessageBoxW'); return;
    }
    if (['clng','cint','cbyte','cbool'].includes(name)) {
      if (args.length !== 1) this.fail(name + ' expects one argument');
      if (this.type(args[0]) === 'string') { const out = this.slot(x.unique('conversion')); this.expression(args[0]);x.push().call('native:string:numeric-text'); x.emit(0x89,0xc3).push(out).push(0).push(0x400).emit(0x53).invoke('oleaut32.dll','VarI4FromStr').compare(0x8002000a).branch('e','error:6').test().branch('s','error:13').value(mem(out)); } else this.numeric(args[0]);
      this.check({clng:'Long',cint:'Integer',cbyte:'Byte',cbool:'Boolean'}[name]); return;
    }
    if (name === 'cstr') { if (args.length !== 1) this.fail('CStr expects one argument'); this.textExpression(args[0]); return; }
    if (name === 'len') { if (args.length !== 1 || this.type(args[0]) !== 'string') this.fail('Native Len requires text'); this.expression(args[0]); x.push().invoke('kernel32.dll','lstrlenW'); return; }
    if (name === 'strptr') { if (args.length !== 1 || this.type(args[0]) !== 'string') this.fail('StrPtr requires text'); this.expression(args[0]); return; }
    if (name === 'abs' || name === 'sgn') { if (args.length !== 1) this.fail(name + ' expects one argument'); this.numeric(args[0]); const done = x.unique(); if (name === 'abs') {x.test().branch('ns',done).emit(0xf7,0xd8).branch('o','error:6').label(done);this.check(this.type(node));} else { x.emit(0x99,0x85,0xc0,0x0f,0x95,0xc0,0x0f,0xb6,0xc0,0x09,0xd0); } return; }
    if (name === 'beep') { if (args.length) this.fail('Beep takes no arguments'); x.api('user32.dll','MessageBeep',[0]); return; }
    if (node.callee.kind === 'member') {
      const object = this.object(node.callee.object), method = key(node.callee.name);
      if (object) {
        if(this.layoutMethod(object,method,args))return;
        if(this.nativeSurfaceMethod(object,method,args)||this.nativeControlMethod(object,method,args))return;
        if (['show','hide','setfocus','additem','clear','removeitem'].includes(method)) this.ensure(object);
        if (method === 'show' && object.form) {
          if(args.length>2)this.fail('Native Show expects mode and optional owner');
          this.numeric(args[0] || lit(0));x.push();
          if(args[1]){const owner=this.object(args[1]);if(!owner?.form)this.fail('Native Show owner must be a form');this.handle(owner);}else x.api('user32.dll','GetActiveWindow');
          x.emit(0x59,0x50,0x51).call('show:'+object.name);return;
        }
        if (method === 'hide' && object.form && !args.length) { x.api('user32.dll','ShowWindow',[this.controlHandleRef(object),0]); return; }
        if (method === 'setfocus' && !args.length) { x.api('user32.dll','SetFocus',[this.controlHandleRef(object)]); return; }
        if (['ListBox','ComboBox'].includes(object.model?.type)) {
          const combo = object.model.type === 'ComboBox';
          if (method === 'additem' && args.length === 1) { this.textExpression(args[0]); x.push().push(0).push(combo ? 0x143 : 0x180).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW').test().branch('s','error:7'); return; }
          if (method === 'clear' && !args.length) { x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),combo ? 0x14b : 0x184,0,0]); return; }
          if (method === 'removeitem' && args.length === 1) { this.numeric(args[0]); x.emit(0x89,0xc3).push(0).emit(0x53).push(combo ? 0x144 : 0x182).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW').test().branch('s','error:5'); return; }
        }
      }
    }
    const target = this.resolveProcedure(node.callee);
    if (!target) this.fail('Native procedure is not available: ' + (name || node.callee.name));
    const plan=this.nativeCallPlan(target,args);
    if(target.module?.form && target.module!==this.context.module)x.call(target.module.initialize);
    this.nativeRecordAwareCall(target,plan);
  }
};
