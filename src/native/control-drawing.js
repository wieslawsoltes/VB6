/** Owner-drawn intrinsic controls and OLE_COLOR translation. Only used families
 * emit code; every created brush/pen is released after restoring the HDC. */
import {NATIVE_DRAW_CONTROLS} from './control-plan.js';
import {mem32} from './x86-operands.js';
const mem=memory=>({memory}),arg=argument=>({argument}),at=(base,displacement=0)=>mem32({base,displacement});
const paintTypes=new Set(['Label','TextBox','RichTextBox','ListBox','ComboBox','Frame','DirListBox','FileListBox','DriveListBox']);
export const nativeControlDrawingMethods={
  nativeControlPaintMessages(module,fallback,exit){
    const x=this.x,after=x.unique(),draw=x.unique(),color=x.unique(),controls=[...module.controls.values()];
    const drawings=controls.filter(c=>NATIVE_DRAW_CONTROLS.has(c.model.type)),colors=controls.filter(c=>paintTypes.has(c.model.type));
    if(!drawings.length&&!colors.length)return;
    x.value(arg(12));if(drawings.length)x.compare(0x2b).branch('e',draw);
    if(colors.length)for(const message of [0x133,0x134,0x135,0x138])x.compare(message).branch('e',color);
    x.jump(after);
    if(drawings.length){
      x.label(draw).value(arg(20)).test().branch('e',fallback).emit(0x89,0xc3,0x8b,0x43,4);
      for(const control of drawings){
        const next=x.unique();x.compare(control.id).branch('ne',next);
        if(this.nativeSurfaceOwnerDraw(control,exit)){x.label(next);continue;}
        const family=control.model.type==='Shape'?'shape':control.model.type==='Line'?'line':'surface';
        (this.nativeDrawingFamilies ||= new Set()).add(family);
        x.push(arg(20)).push(control.state).call('native:control:draw:'+family).value(1).jump(exit).label(next);
      }
      x.jump(fallback);
    }
    if(colors.length){
      x.label(color).value(arg(20)).test().branch('e',fallback);
      for(const control of colors){const next=x.unique();x.emit(0x3b,0x05).addr(control.handle).branch('ne',next);this.nativeControlColors=true;x.push(arg(20)).push(arg(16)).push(control.state).call('native:control:colors').jump(exit).label(next);}
      x.jump(fallback);
    }
    x.label(after);
  },
  nativeFrameBackgroundMessages(control,exit){
    if(control.model.type!=='Frame')return;
    const x=this.x,next=x.unique();
    x.value(arg(12)).compare(0x14).branch('ne',next);
    this.nativeControlColors=true;
    x.push(arg(8)).push(arg(16)).push(control.state).call('native:control:erase').jump(exit).label(next);
  },
  emitNativeColorHelpers(){
    if(!this.nativeControlColors&&!this.nativeDrawingFamilies?.size)return;
    const x=this.x,plain=x.unique();
    x.label('native:control:ole-color').enter().value(arg(8)).test().branch('ns',plain).emit(0x25).imm(255).push().invoke('user32.dll','GetSysColor').leave(4);
    x.label(plain).emit(0x25).imm(0xffffff).leave(4);
    if(!this.nativeControlColors)return;
    const transparent=x.unique(),cached=x.unique(),done=x.unique();
    x.label('native:control:colors').enter().value(arg(8)).emit(0x89,0xc6).value(arg(12)).emit(0x89,0xc7,0xff,0x76,36).call('native:control:ole-color').push().emit(0x57).invoke('gdi32.dll','SetTextColor');
    x.emit(0x83,0x7e,68,0).branch('e',transparent).emit(0xff,0x76,32).call('native:control:ole-color').emit(0x89,0xc3).push().emit(0x57).invoke('gdi32.dll','SetBkColor');
    x.push(2).emit(0x57).invoke('gdi32.dll','SetBkMode').emit(0x8b,0x46,64).test().branch('ne',cached).emit(0x53).invoke('gdi32.dll','CreateSolidBrush').emit(0x89,0x46,64);
    x.label(cached).jump(done).label(transparent).push(arg(12)).push(arg(16)).call('native:control:parent-background').push(1).emit(0x57).invoke('gdi32.dll','SetBkMode').api('gdi32.dll','GetStockObject',[5]);
    x.label(done).leave(12);

    // WS_CLIPCHILDREN excludes transparent STATICs and group boxes from the
    // form's background paint. Render the actual parent into the child HDC;
    // a NULL_BRUSH alone otherwise leaves the old desktop pixels untouched.
    // The clipped, translated DC preserves Form.Picture/AutoRedraw content and
    // nested container colors without reading pixels from the screen.
    const finish=x.unique(),restore=x.unique();
    x.label('native:control:parent-background').enter(32)
      .api('user32.dll','GetClientRect',[arg(8),{address:-16}]).test().branch('e',finish)
      .api('user32.dll','GetSysColorBrush',[15]).push().local(-16).push().push(arg(12)).invoke('user32.dll','FillRect')
      .api('user32.dll','GetParent',[arg(8)]).test().branch('e',finish).mov(at('ebp',-20),'eax')
      .api('gdi32.dll','SaveDC',[arg(12)]).test().branch('e',finish).mov(at('ebp',-24),'eax')
      .api('gdi32.dll','IntersectClipRect',[arg(12),0,0,arg(-8),arg(-4)])
      .mov(at('ebp',-32),0).mov(at('ebp',-28),0)
      .api('user32.dll','MapWindowPoints',[arg(8),arg(-20),{address:-32},1])
      .value(arg(-32)).neg('eax').mov(at('ebp',-32),'eax').value(arg(-28)).neg('eax').mov(at('ebp',-28),'eax')
      .api('gdi32.dll','OffsetViewportOrgEx',[arg(12),arg(-32),arg(-28),0]).test().branch('e',restore)
      .api('user32.dll','SendMessageW',[arg(-20),0x14,arg(12),0])
      .api('user32.dll','SendMessageW',[arg(-20),0x318,arg(12),4])
      .label(restore).api('gdi32.dll','RestoreDC',[arg(12),arg(-24)])
      .label(finish).value(1).leave(8);

    // Native BS_GROUPBOX does not erase its full interior. Own that erase even
    // for an opaque Frame, while retaining the native border/caption painter.
    const erased=x.unique();
    x.label('native:control:erase').enter(16)
      .push(arg(16)).push(arg(12)).push(arg(8)).call('native:control:colors').mov('ebx','eax')
      .api('user32.dll','GetClientRect',[arg(16),{address:-16}]).test().branch('e',erased).pushOperand('ebx')
      .local(-16).push().push(arg(12)).invoke('user32.dll','FillRect').label(erased).value(1).leave(12);
  },
  emitNativeDrawingHelpers(){
    const x=this.x;
    for(const family of this.nativeDrawingFamilies||[]){
      const finish=x.unique(),noPen=x.unique(),noBrush=x.unique();
      x.label('native:control:draw:'+family).enter(40).value(arg(8)).emit(0x89,0xc6).value(arg(12)).emit(0x89,0xc7,0x8b,0x47,24,0x89,0x45,0xf4).push().invoke('gdi32.dll','SaveDC').emit(0x89,0x45,0xf0);
      x.value(0).emit(0x89,0x45,0xfc,0x89,0x45,0xf8); // owned pen and brush
      if(family==='surface'){
        x.emit(0xff,0x76,32).call('native:control:ole-color').push().invoke('gdi32.dll','CreateSolidBrush').emit(0x89,0x45,0xf8).push();x.emit(0x8d,0x47,28).push().push(arg(-12)).invoke('user32.dll','FillRect');
        if(this.nativePictureFeatures?.size){x.emit(0xff,0x76,80,0x8b,0x47,40,0x2b,0x47,32).push().emit(0x8b,0x47,36,0x2b,0x47,28).push().emit(0xff,0x77,32,0xff,0x77,28).push(arg(-12)).emit(0xff,0x76,76).call('native:picture:draw');}
        x.jump(finish);
      }else{
        // OLE_COLOR may be a negative system-color identifier, not RGB bits.
        x.emit(0xff,0x76,52).call('native:control:ole-color').push().emit(0xff,0x76,56,0x8b,0x46,60);const penStyle=x.unique();x.test().branch('ne',penStyle).value(6).label(penStyle).emit(0x48).push().invoke('gdi32.dll','CreatePen').emit(0x89,0x45,0xfc).push().push(arg(-12)).invoke('gdi32.dll','SelectObject');
        if(family==='line'){
          x.push(0).emit(0xff,0x77,32,0xff,0x77,28).push(arg(-12)).invoke('gdi32.dll','MoveToEx');
          x.emit(0x8b,0x47,40,0x48).push().emit(0x8b,0x47,36,0x48).push().push(arg(-12)).invoke('gdi32.dll','LineTo').jump(finish);
        }else{
          const solid=x.unique(),transparent=x.unique(),selected=x.unique();
          x.emit(0x8b,0x46,44).compare(1).branch('e',transparent).test().branch('e',solid);
          const hatch='native:control:hatches';if(!this.ro.labels.has(hatch))this.ro.align(4).label(hatch).u32(0).u32(1).u32(3).u32(2).u32(4).u32(5);
          x.emit(0x83,0xe8,2).compare(5).branch('a','error:5').emit(0x8b,0x1c,0x85).addr(hatch).emit(0xff,0x76,40).call('native:control:ole-color').push().emit(0x53).invoke('gdi32.dll','CreateHatchBrush').emit(0x89,0x45,0xf8).jump(selected);
          x.label(solid).emit(0xff,0x76,40).call('native:control:ole-color').push().invoke('gdi32.dll','CreateSolidBrush').emit(0x89,0x45,0xf8).jump(selected);
          x.label(transparent).api('gdi32.dll','GetStockObject',[5]);x.label(selected).push().push(arg(-12)).invoke('gdi32.dll','SelectObject');
          // Keep the original coordinates; square/circle shapes take the smaller
          // dimension rather than stretching into an ellipse on resize.
          x.emit(0x8b,0x47,36,0x89,0x45,0xe8,0x8b,0x47,40,0x89,0x45,0xe4,0x8b,0x46,48,0xa8,1);const rectangle=x.unique(),sized=x.unique(),ellipse=x.unique(),rounded=x.unique();x.branch('e',sized);
          x.emit(0x8b,0x47,36,0x2b,0x47,28,0x8b,0x4f,40,0x2b,0x4f,32,0x39,0xc8);const minimum=x.unique();x.branch('le',minimum).emit(0x89,0xc8).label(minimum).emit(0x89,0xc1,0x03,0x47,28,0x89,0x45,0xe8,0x03,0x4f,32,0x89,0x4d,0xe4);
          x.label(sized).emit(0x8b,0x46,48).compare(2).branch('e',ellipse).compare(3).branch('e',ellipse).compare(4).branch('ge',rounded).jump(rectangle);
          const bounds=()=>{x.push(arg(-28)).push(arg(-24)).emit(0xff,0x77,32,0xff,0x77,28).push(arg(-12));};
          x.label(rectangle);bounds();x.invoke('gdi32.dll','Rectangle').jump(finish);
          x.label(ellipse);bounds();x.invoke('gdi32.dll','Ellipse').jump(finish);
          x.label(rounded).value(arg(-28)).emit(0x2b,0x47,32,0xc1,0xe8,2).push().value(arg(-24)).emit(0x2b,0x47,28,0xc1,0xe8,2).push();bounds();x.invoke('gdi32.dll','RoundRect');
        }
      }
      x.label(finish).push(arg(-16)).push(arg(-12)).invoke('gdi32.dll','RestoreDC');
      x.value(arg(-4)).test().branch('e',noPen).push().invoke('gdi32.dll','DeleteObject').label(noPen);
      x.value(arg(-8)).test().branch('e',noBrush).push().invoke('gdi32.dll','DeleteObject').label(noBrush).value(1).leave(8);
    }
  }
};
