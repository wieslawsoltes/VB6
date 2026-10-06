/** Structured native VB error frames. Windows callback boundaries never unwind across user32. */
export const NATIVE_ERROR_FRAME_BYTES = 48;
const key = value => String(value).toLowerCase();
const mem = memory => ({memory});
const arg = argument => ({argument});
const E = 'native:error:';
const DESCRIPTIONS = new Map([[5,'Invalid procedure call or argument'],[6,'Overflow'],[7,'Out of memory'],[9,'Subscript out of range'],[10,'This array is fixed or temporarily locked'],[11,'Division by zero'],[13,'Type mismatch'],[20,'Resume without error'],[340,'Control array element does not exist']]);
// Metadata is relative to the native VB procedure's EBP, before its user locals.
const F = {previous:-4,stack:-8,dispatch:-12,handler:-16,active:-20,current:-24,next:-28,fault:-32,resumeNext:-36,line:-40,erl:-44,source:-48};
const localStore = (x, offset) => x.emit(0x89,0x85).imm(offset);
const localImmediate = (x, offset, value) => { x.value(value);localStore(x,offset); };

export const nativeErrorMethods = {
  prepareErrors() {
    for (const name of ['frame','pending','number','description','source','erl','lastdllerror']) this.slot(E+name);
  },
  errorProperty(node) {
    if(node.kind!=='member'||node.object.kind!=='id'||key(node.object.name)!=='err')return null;
    const name=key(node.name);
    if(!['number','description','source','lastdllerror'].includes(name))this.fail('Native Err property is not implemented: '+node.name);
    return name;
  },
  errorExpression(node) {
    const property=this.errorProperty(node),x=this.x;
    if(property){x.value(mem(E+property));if(!['number','lastdllerror'].includes(property)){x.push().call('native:string:copy');this.ownString();}return true;}
    if(node.kind==='id'&&key(node.name)==='erl'){x.value(mem(E+'erl'));return true;}
    return false;
  },
  errorCall(node) {
    const callee=node.callee,x=this.x;
    if(callee.kind==='id'&&key(callee.name)==='erl'){
      if(node.args.length)this.fail('Erl takes no arguments');x.value(mem(E+'erl'));return true;
    }
    if(callee.kind!=='member'||callee.object.kind!=='id'||key(callee.object.name)!=='err')return false;
    const name=key(callee.name);
    if(name==='clear'&&!node.args.length){x.call(E+'clear');return true;}
    if(name==='raise'&&node.args.length===1){this.numeric(node.args[0]);x.jump(E+'raise');return true;}
    this.fail('Native Err supports Clear and Raise(number); custom source/help arguments are not yet lowered');
  },
  errorCheckpoint(context, index, instruction) {
    const x=this.x;
    localImmediate(x,F.current,context.label+':'+index);
    localImmediate(x,F.next,context.label+':'+(index+1));
    localImmediate(x,F.line,instruction.line||0);
  },
  errorInstruction(instruction,context) {
    const x=this.x;
    if(instruction.op==='lineNumber'){localImmediate(x,F.erl,instruction.number);return true;}
    if(instruction.op==='onError'){
      localImmediate(x,F.handler,instruction.mode==='goto'?context.label+':'+instruction.target:instruction.mode==='next'?-1:0);
      localImmediate(x,F.active,0);localImmediate(x,F.fault,0);
      x.call(E+'clear');return true;
    }
    if(instruction.op==='raiseError'){this.numeric(instruction.expr);x.jump(E+'raise');return true;}
    if(instruction.op==='resume'){
      x.value(arg(F.fault)).test().branch('e','error:20');
      if(instruction.mode==='next')x.value(arg(F.resumeNext));
      else if(instruction.mode==='goto')x.value(context.label+':'+instruction.target);
      x.push();localImmediate(x,F.active,0);localImmediate(x,F.fault,0);x.call(E+'clear').emit(0x58,0xff,0xe0);return true;
    }
    return false;
  },
  checkNativeError(target=this.context?.label+':error-dispatch') {
    this.x.emit(0x83,0x3d).addr(E+'pending').emit(0).branch('ne',target);
  },
  enterErrorFrame(context) {
    const x=this.x;
    for(const offset of Object.values(F))localImmediate(x,offset,0);
    x.value(mem(E+'frame'));localStore(x,F.previous);
    x.emit(0x89,0xe8).store(E+'frame');
    x.emit(0x89,0xe0);localStore(x,F.stack);
    localImmediate(x,F.dispatch,context.label+':error-dispatch');
    localImmediate(x,F.source,this.string(context.module.name));
    localImmediate(x,F.current,context.label+':0');localImmediate(x,F.next,context.label+':0');
    if(context.module.nativeInternal){
      // Intrinsics are not authored procedures: retain the caller's Erl/Source.
      const noCaller=x.unique();x.value(arg(F.previous)).test().branch('e',noCaller).emit(0x89,0xc2);
      x.emit(0x8b,0x42,F.erl&255);localStore(x,F.erl);
      x.emit(0x8b,0x42,F.source&255);localStore(x,F.source);x.label(noCaller);
    }
  },
  leaveErrorFrame() {
    // EAX is the return value; restoring the prior frame must not overwrite it.
    this.x.emit(0x8b,0x95).imm(F.previous).emit(0x89,0x15).addr(E+'frame');
  },
  emitErrorDispatch(context) {
    const x=this.x,autoNext=x.unique();
    x.label(context.label+':error-dispatch');
    // A caller may have partially evaluated argument or expression stacks. Discard
    // those slots before cleanup or entering a handler; all managed values have owners.
    x.value(arg(F.stack)).emit(0x89,0xc4);
    x.value(arg(F.handler)).test().branch('e',context.label+':error-return');
    x.emit(0x83,0xbd).imm(F.active).emit(0).branch('ne',context.label+':error-return');
    x.value(arg(F.current));localStore(x,F.fault);x.value(arg(F.next));localStore(x,F.resumeNext);
    x.value(0).store(E+'pending');
    x.value(arg(F.handler)).compare(-1).branch('e',autoNext);
    x.push();localImmediate(x,F.active,1);x.emit(0x58,0xff,0xe0);
    x.label(autoNext).value(arg(F.next)).emit(0xff,0xe0);
  },
  enterCallbackBoundary(offset) {
    // A window procedure is entered through a Windows ABI frame. Never transfer
    // control non-locally across that frame into a suspended Show/SendMessage caller.
    const x=this.x;x.value(mem(E+'frame'));localStore(x,offset);x.value(0).store(E+'frame');
  },
  leaveCallbackBoundary(offset) {
    this.x.emit(0x8b,0x95).imm(offset).emit(0x89,0x15).addr(E+'frame');
  }
};

export function emitNativeErrorHelpers(compiler) {
  const x=compiler.x, unknown=x.unique(),sourceDone=x.unique();
  x.label(E+'clear').value(0);
  for(const name of ['pending','number','description','source','erl'])x.store(E+name);
  x.emit(0xc3);
  for(const number of DESCRIPTIONS.keys())x.label('error:'+number).value(number).jump(E+'raise');
  x.label(E+'raise');
  // VB Error numbers are nonzero unsigned 16-bit values for this backend.
  x.compare(1).branch('l',unknown).compare(65535).branch('g',unknown);
  const valid=x.unique();x.jump(valid).label(unknown).value(5).label(valid).store(E+'number');
  x.value(compiler.string('Application-defined or object-defined error')).store(E+'description');
  const described=x.unique();
  for(const [number,text]of DESCRIPTIONS){const next=x.unique();x.value(mem(E+'number')).compare(number).branch('ne',next).value(compiler.string(text)).store(E+'description').jump(described).label(next);}
  x.label(described).value(0).store(E+'erl').value(compiler.string(compiler.project.name)).store(E+'source');
  x.value(mem(E+'frame')).test().branch('e',sourceDone).emit(0x89,0xc2,0x8b,0x42,F.source&255).store(E+'source').emit(0x8b,0x42,F.erl&255).store(E+'erl');
  x.label(sourceDone).value(1).store(E+'pending');
  x.value(mem(E+'frame')).test().branch('e',E+'fatal').emit(0x89,0xc5,0x8b,0x65,F.stack&255,0xff,0x65,F.dispatch&255);
  x.label(E+'fatal');
  // Disable non-local transfers before constructing the final diagnostic itself.
  x.value(0).store(E+'frame');
  const fatalReady=x.unique();
  for(const number of DESCRIPTIONS.keys()){const next=x.unique();x.value(mem(E+'number')).compare(number).branch('ne',next).value(compiler.string('Run-time error '+number)).jump(fatalReady).label(next);}
  x.value(compiler.string('Run-time error (application-defined)'));
  x.label(fatalReady).emit(0x89,0xc3).push(16).push(compiler.errorTitle).emit(0x53).push(0).invoke('user32.dll','MessageBoxW').api('kernel32.dll','ExitProcess',[mem(E+'number')]);
}
