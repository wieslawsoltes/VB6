import {emitNativeListHelpers} from './control-lists.js';
/** Bounded dynamic HWND text reads. The compiler-owned BSTR is adopted before
 * invoking Windows, so error cleanup owns it even during reentrant callbacks. */
import {emitNativeItemTextHelpers} from './control-items.js';
import {MAX_NATIVE_STRING} from './storage.js';
const arg=argument=>({argument});
export const nativeControlTextMethods={
  readNativeControlText(object){
    this.nativeControlTextRead=true;
    const out=this.temporaryString(),x=this.x;
    this.rawStorageAddress(out);x.push().push(this.controlHandleRef(object)).call('native:control:get-text');
  },
  readNativeRichSelection(object){
    this.nativeRichSelectionRead=true;
    const out=this.temporaryString(),x=this.x;
    this.rawStorageAddress(out);x.push().push(this.controlHandleRef(object)).call('native:control:get-selection');
  },
  emitNativeControlTextHelpers(){
    emitNativeItemTextHelpers(this);emitNativeListHelpers(this);
    if(this.nativeRichSelectionRead){
      const x=this.x,ready=x.unique();
      // CHARRANGE uses RichEdit's logical positions, not offsets into the CRLF
      // representation returned by WM_GETTEXT. Keep TEXTRANGE per invocation.
      x.label('native:control:get-selection').enter(12).value(arg(12)).emit(0x89,0xc6,0xff,0x36).invoke('oleaut32.dll','SysFreeString').emit(0xc7,0x06,0,0,0,0);
      x.value(0).emit(0x89,0x45,0xf4,0x89,0x45,0xf8).local(-12).push().push(0).push(0x434).push(arg(8)).invoke('user32.dll','SendMessageW');
      x.value(arg(-12)).test().branch('s','error:5').emit(0x89,0xc1).value(arg(-8)).emit(0x39,0xc8).branch('l','error:5').emit(0x29,0xc8).compare(MAX_NATIVE_STRING).branch('a','error:7').emit(0x89,0xc3).push().push(0).invoke('oleaut32.dll','SysAllocStringLen').test().branch('e','error:7').emit(0x89,0x06,0x89,0xc7,0x89,0x45,0xfc);
      x.local(-12).push().push(0).push(0x44b).push(arg(8)).invoke('user32.dll','SendMessageW').emit(0x39,0xd8).branch('e',ready).branch('a','error:5').push().emit(0x57,0x56).invoke('oleaut32.dll','SysReAllocStringLen').test().branch('e','error:7');
      x.label(ready).emit(0x8b,0x06).leave(8);
    }
    if(!this.nativeControlTextRead)return;
    const x=this.x,ready=x.unique();
    x.label('native:control:get-text').enter().value(arg(12)).emit(0x89,0xc6,0xff,0x36).invoke('oleaut32.dll','SysFreeString').emit(0xc7,0x06,0,0,0,0);
    x.api('user32.dll','GetWindowTextLengthW',[arg(8)]).compare(MAX_NATIVE_STRING).branch('a','error:7').emit(0x89,0xc3).push().push(0).invoke('oleaut32.dll','SysAllocStringLen').test().branch('e','error:7').emit(0x89,0x06,0x89,0xc7,0x8d,0x43,1).push().emit(0x57).push(arg(8)).invoke('user32.dll','GetWindowTextW');
    // Text can shrink during a nested WM_GETTEXT. Reallocate through OleAut32,
    // never edit the undocumented allocation header or retain uninitialized tail.
    x.emit(0x39,0xd8).branch('e',ready).branch('a','error:5').push().emit(0x57,0x56).invoke('oleaut32.dll','SysReAllocStringLen').test().branch('e','error:7');
    x.label(ready).emit(0x8b,0x06).leave(8);
  }
};
