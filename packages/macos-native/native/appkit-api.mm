// Source-level Win32 contracts implemented with AppKit, Foundation and POSIX.
// This is a checked adapter, not a loader for Windows DLLs or raw Win32 pointers.
#include "appkit.hpp"
#include "appkit-appearance.hpp"
#include "appkit-pixels.hpp"
#include "file-codec.hpp"
#include <cerrno>
#include <cstring>
#include <cstdio>
#include <fcntl.h>
#include <pthread.h>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>

namespace vb6 {
namespace {
Value longValue(uint32_t value){return Value::integer(value<=INT32_MAX?int64_t(value):int64_t(value)-4294967296LL);}
Value bad(Runtime&rt,int code,int64_t result=0){rt.error.lastDllError=code;return Value::integer(result);}
int osError(int code){switch(code){case ENOENT:return 2;case ENOTDIR:return 3;case EACCES:case EPERM:return 5;case EBADF:return 6;case ENOMEM:return 8;case EEXIST:return 183;case ENOSPC:return 112;case ENAMETOOLONG:return 206;case EINVAL:return 87;default:return 31;}}
uint32_t u32(Value value){return uint32_t(coerce(value,"long").integral());}
int32_t i32(Value value){return int32_t(coerce(value,"long").integral());}
Bytes rawBytes(const Arg&arg){
  const Value&v=arg.value;if(v.type==Type::Array){auto array=v.asArray();if(!array->allocated||array->elementType!="byte")fail(13,"API buffer must be a Byte array");Bytes bytes;bytes.reserve(array->values.size());for(auto&cell:array->values)bytes.push_back(uint8_t(cell.integral()));return bytes;}
  if(v.type==Type::Record)return encodeVariable(v,{v.asRecord()->name,0,false},"binary");
  if(v.type==Type::Currency){uint64_t n=uint64_t(std::get<int64_t>(v.payload));Bytes bytes(8);for(size_t i=0;i<8;i++)bytes[i]=uint8_t(n>>(i*8));return bytes;}
  if(v.type==Type::Long){uint32_t n=u32(v);Bytes bytes(4);for(size_t i=0;i<4;i++)bytes[i]=uint8_t(n>>(i*8));return bytes;}
  fail(13,"API requires a typed scalar, record or Byte buffer");
}
void writeBytes(const Arg&arg,const Bytes&bytes){
  auto v=arg.value;if(v.type==Type::Array){auto array=v.asArray();if(!array->allocated||array->elementType!="byte"||array->values.size()<bytes.size())fail(5,"API output buffer is too small");for(size_t i=0;i<bytes.size();i++)array->values[i]=Value::integer(bytes[i],Type::Byte);return;}
  if(v.type==Type::Record){auto record=v.asRecord();auto previous=encodeVariable(v,{record->name,0,false},"binary");if(previous.size()<bytes.size())fail(5,"API record is too small");std::copy(bytes.begin(),bytes.end(),previous.begin());auto decoded=decodeVariable(previous,{record->name,0,false},v,"binary",16777216).first.asRecord();for(auto&entry:record->fields)entry.second->value=decoded->fields.at(entry.first)->value;return;}
  if(!arg.reference||!arg.nativeByRef)fail(13,"API output scalar must be ByRef");
  if(v.type==Type::Long&&bytes.size()==4){uint32_t n=0;for(size_t i=0;i<4;i++)n|=uint32_t(bytes[i])<<(i*8);arg.reference.set(longValue(n));return;}
  if(v.type==Type::Currency&&bytes.size()==8){uint64_t n=0;for(size_t i=0;i<8;i++)n|=uint64_t(bytes[i])<<(i*8);int64_t signedValue;std::memcpy(&signedValue,&n,8);arg.reference.set(Value::integer(signedValue,Type::Currency));return;}
  fail(13,"API output scalar width does not match the native contract");
}
void writeLong(const Arg&arg,int64_t value){if(!arg.reference||!arg.nativeByRef)fail(13,"API output must be ByRef");arg.reference.set(Value::integer(value));}
void write64(const Arg&arg,uint64_t value){Bytes bytes(8);for(size_t i=0;i<8;i++)bytes[i]=uint8_t(value>>(8*i));writeBytes(arg,bytes);}
std::vector<int32_t>readInts(const Arg&arg,size_t count){auto bytes=rawBytes(arg);if(bytes.size()<count*4)fail(5,"API record is too small");std::vector<int32_t>values;for(size_t i=0;i<count;i++){uint32_t n=0;for(size_t j=0;j<4;j++)n|=uint32_t(bytes[i*4+j])<<(j*8);values.push_back(int32_t(n<=INT32_MAX?int64_t(n):int64_t(n)-4294967296LL));}return values;}
void writeInts(const Arg&arg,const std::vector<int32_t>&values){Bytes bytes(values.size()*4);for(size_t i=0;i<values.size();i++)for(size_t j=0;j<4;j++)bytes[i*4+j]=uint8_t(uint32_t(values[i])>>(8*j));writeBytes(arg,bytes);}
Text readText(const Arg&arg,bool wide,bool terminated=true,int64_t count=-1){
  Text result;const auto&value=arg.value;
  if(value.type==Type::String){result=value.string();if(!wide){auto bytes=encodeANSI(result);if(count>=0){if(uint64_t(count)>bytes.size())fail(5,"API input length exceeds String capacity");bytes.resize(size_t(count));}result=decodeANSI(bytes);}}
  else if(value.type==Type::Array){auto bytes=rawBytes(arg);if(wide){if(bytes.size()%2)fail(5,"Wide buffer has an odd byte length");for(size_t i=0;i<bytes.size();i+=2)result.push_back(char16_t(uint16_t(bytes[i])|(uint16_t(bytes[i+1])<<8)));}else{if(count>=0){if(uint64_t(count)>bytes.size())fail(5);bytes.resize(size_t(count));}result=decodeANSI(bytes);}}
  else if(value.type==Type::Empty||value.type==Type::Long&&value.integral()==0||value.type==Type::Integer&&value.integral()==0)return {};
  else fail(13,"Raw pointers are not valid native String arguments");
  if(wide&&count>=0){if(uint64_t(count)>result.size())fail(5,"Wide input length exceeds buffer capacity");result.resize(size_t(count));}
  if(terminated){auto end=result.find(u'\0');if(end!=Text::npos)result.resize(end);}return result;
}
size_t textUnits(const Text&text,bool wide){return wide?text.size():encodeANSI(text).size();}
size_t textCapacity(const Arg&arg,bool wide){if(arg.value.type==Type::String)return wide?arg.value.string().size():encodeANSI(arg.value.string()).size();if(arg.value.type==Type::Array)return rawBytes(arg).size()/(wide?2:1);return 0;}
size_t writeText(const Arg&arg,const Text&value,bool wide,size_t capacity,bool terminate=true){
  if(capacity>textCapacity(arg,wide))fail(5,"Declared output capacity exceeds the VB buffer");size_t available=capacity-(terminate&&capacity?1:0),count=std::min(available,textUnits(value,wide));Text output;
  if(wide)output=value.substr(0,count);else{auto bytes=encodeANSI(value);bytes.resize(count);output=decodeANSI(bytes);}
  if(terminate&&capacity)output.push_back(0);
  if(arg.value.type==Type::String){if(!arg.reference)fail(13,"String output requires writable VB storage");auto previous=arg.value.string();if(output.size()>previous.size())fail(5);std::copy(output.begin(),output.end(),previous.begin());arg.reference.set(Value::string(previous));}
  else{Bytes bytes;if(wide){bytes.reserve(output.size()*2);for(char16_t ch:output){bytes.push_back(uint8_t(ch));bytes.push_back(uint8_t(ch>>8));}}else bytes=encodeANSI(output);writeBytes(arg,bytes);}
  return count;
}
std::string pathText(const Arg&arg,bool wide){auto path=readText(arg,wide);if(path.empty())fail(52);auto result=toUTF8(path);std::replace(result.begin(),result.end(),'\\','/');if(result.size()>1&&result[1]==':')fail(52,"Windows drive paths need an explicit macOS path mapping");return result;}
Text windowText(MacHost&host,const std::shared_ptr<MacControl>&c){if(c->spec.type=="Form"||c->spec.type=="MDIForm")return text(c->form()->window.title);if(c->spec.type=="TextBox"||c->spec.type=="RichTextBox"||c->spec.type=="ComboBox")return c->get(*host.runtime,"text").string();return c->property("caption",Value::string(u"")).string();}
void setWindowText(MacHost&host,const std::shared_ptr<MacControl>&c,const Text&value){if(c->spec.type=="Form"||c->spec.type=="MDIForm")host.formSet(c->owner.lock(),"caption",Value::string(value));else c->set(*host.runtime,c->spec.type=="TextBox"||c->spec.type=="RichTextBox"||c->spec.type=="ComboBox"?"text":"caption",Value::string(value));}
NSRect screenRect(const std::shared_ptr<MacControl>&c){if(c->spec.type=="Form"||c->spec.type=="MDIForm")return c->form()->window.frame;return [c->view.window convertRectToScreen:[c->view convertRect:c->view.bounds toView:nil]];}
std::vector<int32_t>winRect(NSRect rect){double top=NSMaxY(NSScreen.mainScreen.frame)-NSMaxY(rect);return {int32_t(bankers(rect.origin.x)),int32_t(bankers(top)),int32_t(bankers(NSMaxX(rect))),int32_t(bankers(top+rect.size.height))};}
struct GdiResource final:Object {HandleKind kind;int32_t handle=0,color=0;double width=1;int style=0;bool stock=false;size_t selections=0;Text font=u"Helvetica";double size=11;bool bold=false,italic=false;explicit GdiResource(HandleKind k):kind(k){}std::string className()const override{return "GDIObject";}};
struct DeviceContext final:Object {
  std::weak_ptr<MacControl>target;std::shared_ptr<GdiResource>pen,brush,font;NSPoint position=NSZeroPoint;int32_t textColor=0,backgroundColor=0xffffff;int backgroundMode=2;
  explicit DeviceContext(std::shared_ptr<MacControl>c):target(c){}
  ~DeviceContext()override{for(auto object:{pen,brush,font})if(object&&object->selections)--object->selections;}
};
std::shared_ptr<GdiResource>stock(MacHost&host,int index){
  std::string key="gdi-stock-"+std::to_string(index);auto found=host.systemObjects.find(key);if(found!=host.systemObjects.end())return std::dynamic_pointer_cast<GdiResource>(found->second);
  std::shared_ptr<GdiResource>value;
  if(index>=0&&index<=5){value=std::make_shared<GdiResource>(HandleKind::Brush);int colors[]={0xffffff,0xc0c0c0,0x808080,0x404040,0,0};value->color=colors[index];if(index==5)value->style=5;}
  else if(index>=6&&index<=8){value=std::make_shared<GdiResource>(HandleKind::Pen);value->color=index==6?0xffffff:0;value->style=index==8?5:0;}
  else if(index==10||index==11||index==12||index==13||index==14||index==16||index==17){value=std::make_shared<GdiResource>(HandleKind::Font);if(index==10||index==11||index==16)value->font=u"Menlo";}
  else if(index==18)value=std::make_shared<GdiResource>(HandleKind::Brush);else if(index==19)value=std::make_shared<GdiResource>(HandleKind::Pen);else return nullptr;
  value->stock=true;value->handle=host.handles.add(value,value->kind,true);host.systemObjects[key]=value;return value;
}
void selectGdi(std::shared_ptr<GdiResource>&slot,std::shared_ptr<GdiResource>value){if(slot&&slot->selections)--slot->selections;slot=std::move(value);if(slot)++slot->selections;}
std::shared_ptr<DeviceContext>dc(MacHost&host,Value handle){return std::dynamic_pointer_cast<DeviceContext>(host.handles.find(i32(handle),HandleKind::DC));}
GraphicCommand dcCommand(const std::shared_ptr<DeviceContext>&context,MacControl&control,const std::string&kind){auto command=nativeCommand(control,kind);if(context->font){command.fontName=context->font->font;command.fontSize=context->font->size;command.bold=context->font->bold;command.italic=context->font->italic;}return command;}
int64_t controlMessage(MacHost&host,const std::shared_ptr<MacControl>&control,uint32_t message,const Arg&wp,const Arg&lp,bool wide){
  struct Suppress {MacControl&control;bool active;Suppress(MacControl&c,bool a):control(c),active(a){if(active)++control.eventSuppression;}~Suppress(){if(active)--control.eventSuppression;}} suppress(*control,message!=0xf5);
  auto&rt=*host.runtime;int64_t w=wp.value.type==Type::Object?0:wp.value.integral(),l=lp.value.type==Type::Object||lp.value.type==Type::String||lp.value.type==Type::Array||lp.value.type==Type::Record?0:lp.value.integral();
  if(message==0x0d){if(w<0)fail(5);return int64_t(writeText(lp,windowText(host,control),wide,size_t(w)));}
  if(message==0x0e)return int64_t(textUnits(windowText(host,control),wide));if(message==0x0c){setWindowText(host,control,readText(lp,wide));return 1;}
  if(message==0x10){if(auto owner=control->owner.lock())rt.unload(owner);return 0;}
  if(message==0x0a){control->set(rt,"enabled",Value::boolean(w!=0));return 0;}if(message==0x18){control->set(rt,"visible",Value::boolean(w!=0));return 0;}
  if(message==0x0f){control->view.needsDisplay=YES;control->widget.needsDisplay=YES;[control->view displayIfNeeded];return 0;}
  if(message==0x07){control->invoke(rt,"setfocus",{});return 0;}
  if(message==0x113)return 0; // An un-subclassed form has no WM_TIMER handler.
  if(message==0xf0)return control->get(rt,"value").integral();if(message==0xf1){control->set(rt,"value",Value::integer(w,Type::Integer));return 0;}
  if(message==0xf5){if([control->widget isKindOfClass:NSButton.class])[(NSButton*)control->widget performClick:nil];else if([control->widget isKindOfClass:NSSwitch.class])clickNativeSwitch(*control);else control->event("click");host.check();return 0;}
  if(message==0xb0){auto start=control->get(rt,"selstart").integral(),length=control->get(rt,"sellength").integral();if(wp.reference&&wp.nativeByRef)writeLong(wp,start);if(lp.reference&&lp.nativeByRef)writeLong(lp,start+length);return int64_t(uint32_t((uint32_t(start)&65535)|((uint32_t(start+length)&65535)<<16)));}
  if(message==0xb1){auto size=control->get(rt,"text").string().size();size_t start=w<0?size:std::min(size_t(w),size),end=l<0?size:std::min(size_t(l),size);control->set(rt,"selstart",Value::integer(std::min(start,end)));control->set(rt,"sellength",Value::integer(std::max(start,end)-std::min(start,end)));return 0;}
  if(message==0xc2){control->set(rt,"seltext",Value::string(readText(lp,wide)));return 1;}
  if(message==0xcf){control->set(rt,"locked",Value::boolean(w!=0));return 1;}
  bool combo=control->spec.type=="ComboBox"||control->spec.type=="DriveListBox",list=control->spec.type=="ListBox"||control->spec.type=="FileListBox"||control->spec.type=="DirListBox";
  if(combo||list){
    auto is=[&](uint32_t cb,uint32_t lb){return message==(combo?cb:lb);};
    if(is(0x143,0x180)||is(0x14a,0x181)){Args args{Arg(Value::string(readText(lp,wide)))};if(is(0x14a,0x181)&&w>=0)args.emplace_back(Value::integer(w));control->invoke(rt,"additem",args);return control->property("newindex",Value::integer(control->list.size()-1)).integral();}
    if(is(0x144,0x182)){if(w<0||size_t(w)>=control->list.size())return -1;control->invoke(rt,"removeitem",{Arg(Value::integer(w))});return int64_t(control->list.size());}
    if(is(0x14b,0x184)){control->invoke(rt,"clear",{});return 0;}
    if(is(0x146,0x18b))return int64_t(control->list.size());if(is(0x147,0x188))return control->get(rt,"listindex").integral();
    if(is(0x14e,0x186)){if(w< -1||w>=int64_t(control->list.size()))return -1;control->set(rt,"listindex",Value::integer(w));return w;}
    if(is(0x148,0x189)){if(w<0||size_t(w)>=control->list.size())return -1;auto size=textUnits(control->list[size_t(w)],wide);if(textCapacity(lp,wide)<size+1)fail(5,"List text output buffer is too small");return int64_t(writeText(lp,control->list[size_t(w)],wide,size+1));}
    if(is(0x149,0x18a)){if(w<0||size_t(w)>=control->list.size())return -1;return int64_t(textUnits(control->list[size_t(w)],wide));}
    if(is(0x150,0x199)){if(w<0||size_t(w)>=control->itemData.size())return -1;return control->itemData[size_t(w)];}
    if(is(0x151,0x19a)){if(w<0||size_t(w)>=control->itemData.size())return -1;control->itemData[size_t(w)]=int32_t(l);return 0;}
    if(is(0x14c,0x18f)||is(0x158,0x1a2)||is(0x14d,0x18c)){
      auto needle=changeCase(readText(lp,wide),false);if(control->list.empty()||w< -1||w>=int64_t(control->list.size()))return -1;
      for(size_t i=1;i<=control->list.size();i++){size_t index=size_t((w+int64_t(i)+int64_t(control->list.size()))%int64_t(control->list.size()));auto hay=changeCase(control->list[index],false);bool match=is(0x158,0x1a2)?hay==needle:hay.rfind(needle,0)==0;if(match){if(is(0x14d,0x18c))control->set(rt,"listindex",Value::integer(index));return int64_t(index);}}return -1;
    }
    if(list&&message==0x187){if(w<0||size_t(w)>=control->list.size())return -1;return control->selected.count(size_t(w))?1:0;}
    if(list&&message==0x185){if(l==-1){control->selected.clear();if(w)for(size_t i=0;i<control->list.size();i++)control->selected.insert(i);}else{if(l<0||size_t(l)>=control->list.size())return -1;if(w)control->selected.insert(size_t(l));else control->selected.erase(size_t(l));}control->reloadList();return 0;}
    if(list&&message==0x190)return int64_t(control->selected.size());
  }
  if(control->spec.type=="ProgressBar"){
    auto previous=int64_t(control->number("value",0));if(message==0x402){control->set(rt,"value",Value::integer(w));return previous;}if(message==0x403){control->set(rt,"value",Value::integer(previous+w));return previous;}
    if(message==0x404){auto old=int64_t(control->number("step",10));control->properties["step"]=Value::integer(w);return old;}if(message==0x405){control->set(rt,"value",Value::integer(previous+int64_t(control->number("step",10))));return previous;}if(message==0x408)return previous;
    if(message==0x401||message==0x406){int64_t minimum=message==0x401?int16_t(uint32_t(l)&65535):w,maximum=message==0x401?int16_t((uint32_t(l)>>16)&65535):l;if(minimum>maximum)fail(380);auto packed=(uint32_t(int32_t(control->number("min",0)))&65535)|((uint32_t(int32_t(control->number("max",100)))&65535)<<16);control->properties["min"]=Value::integer(minimum);control->properties["max"]=Value::integer(maximum);control->properties["value"]=Value::integer(std::clamp(previous,minimum,maximum));control->refresh();return packed;}
  }
  if(control->spec.type=="Slider"||control->spec.type=="HScrollBar"||control->spec.type=="VScrollBar"){
    if(message==0x400)return int64_t(control->number("value",0));if(message==0x401)return int64_t(control->number("min",0));if(message==0x402)return int64_t(control->number("max",0));if(message==0x405){control->set(rt,"value",Value::integer(l));return 0;}
    if(message==0x406||message==0x407||message==0x408){auto minimum=message==0x406?int64_t(int16_t(uint32_t(l)&65535)):message==0x407?l:int64_t(control->number("min",0)),maximum=message==0x406?int64_t(int16_t((uint32_t(l)>>16)&65535)):message==0x408?l:int64_t(control->number("max",100));if(minimum>maximum)fail(380);control->properties["min"]=Value::integer(minimum);control->properties["max"]=Value::integer(maximum);control->properties["value"]=Value::integer(std::clamp(int64_t(control->number("value",0)),minimum,maximum));control->refresh();return 0;}
  }
  fail(453,"No native adapter for message "+std::to_string(message)+" on "+control->spec.type);
}
struct TimerOwner final:Object {Value callback;std::weak_ptr<MacControl>window;int32_t hwnd=0,id=0;};
}
void MacHost::cancelWindowTimers(int32_t hwnd){
  for(auto it=apiTimers.begin();it!=apiTimers.end();){if(it->first.first!=hwnd){++it;continue;}[it->second invalidate];auto owner=apiTimerOwners.find(it->first);if(owner!=apiTimerOwners.end()){if(handles.find(it->first.second,HandleKind::Timer)==owner->second)handles.remove(it->first.second);apiTimerOwners.erase(owner);}it=apiTimers.erase(it);}
}
Value MacHost::api(Runtime&rt,const std::string&raw,Args args){
  auto dot=raw.find('.');std::string library=lower(raw.substr(0,dot)),name=dot==std::string::npos?raw:raw.substr(dot+1);bool wide=name.size()>1&&name.back()=='W';if(wide||name.size()>1&&name.back()=='A')name.pop_back();
  auto a=[&](size_t i)->const Arg&{if(i>=args.size())fail(450);return args[i];};auto n=[&](size_t i){return a(i).value.integral();};auto result=[&](bool value){return Value::integer(value?1:0);};
  if(library=="kernel32"||library=="advapi32"&&name=="GetUserName"){
    if(name=="Sleep"){std::this_thread::sleep_for(std::chrono::milliseconds(uint32_t(n(0))));return {};}
    if(name=="GetTickCount")return longValue(uint32_t(std::fmod(std::floor(NSProcessInfo.processInfo.systemUptime*1000),4294967296.0)));
    if(name=="GetCurrentProcessId")return Value::integer(getpid());if(name=="GetCurrentThreadId")return longValue(pthread_mach_thread_np(pthread_self()));
    if(name=="GetLastError")return Value::integer(rt.error.lastDllError);if(name=="SetLastError"){rt.error.lastDllError=i32(a(0).value);return {};}
    if(name=="Beep"){ensureApplication();auto frequency=n(0);if(frequency<37||frequency>32767)return bad(rt,87);NSBeep();return Value::integer(1);}
    if(name=="MulDiv"){
      int64_t left=i32(a(0).value),right=i32(a(1).value),denominator=i32(a(2).value);if(!denominator)return Value::integer(-1);int64_t product=left*right;bool negative=(product<0)!=(denominator<0);uint64_t numerator=uint64_t(product<0?-product:product),divisor=uint64_t(denominator<0?-denominator:denominator);uint64_t quotient=numerator/divisor;if(numerator%divisor>=(divisor+1)/2)++quotient;if(quotient>uint64_t(negative?2147483648LL:2147483647LL))return Value::integer(-1);return Value::integer(negative?-int64_t(quotient):int64_t(quotient));
    }
    if(name=="QueryPerformanceFrequency"||name=="QueryPerformanceCounter"){uint64_t value=name=="QueryPerformanceFrequency"?1000000000ULL:uint64_t(std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());write64(a(0),value);return Value::integer(1);}
    if(name=="GetModuleHandle"){
      if(a(0).value.type==Type::String&&!readText(a(0),wide).empty()){auto requested=lower(toUTF8(readText(a(0),wide)));if(requested!=lower(rt.executablePath.filename().string()))return bad(rt,126);}
      auto found=systemObjects.find("module");if(found==systemObjects.end()){auto value=std::make_shared<GdiResource>(HandleKind::Module);value->handle=handles.add(value,HandleKind::Module,true);systemObjects["module"]=value;return Value::integer(value->handle);}return Value::integer(std::dynamic_pointer_cast<GdiResource>(found->second)->handle);
    }
    if(name=="GetComputerName"||name=="GetUserName"){
      Text value=name=="GetComputerName"?text(NSProcessInfo.processInfo.hostName):text(NSUserName());auto capacity=n(1);size_t required=textUnits(value,wide)+1;if(capacity<0)return bad(rt,87);if(uint64_t(capacity)<required){writeLong(a(1),required);return bad(rt,111);}writeText(a(0),value,wide,size_t(capacity));writeLong(a(1),name=="GetUserName"?required:required-1);return Value::integer(1);
    }
    if(name=="GetModuleFileName"){
      if(n(0)!=0&&!handles.find(i32(a(0).value),HandleKind::Module))return bad(rt,6);auto capacity=n(2);if(capacity<=0)return bad(rt,122);Text path=fromUTF8(rt.executablePath.string());size_t length=textUnits(path,wide);writeText(a(1),path,wide,size_t(capacity));if(length>=uint64_t(capacity))return bad(rt,122,capacity);return Value::integer(length);
    }
    if(name=="GetTempPath"||name=="GetCurrentDirectory"){
      auto capacity=n(0);if(capacity<0)return bad(rt,87);Text value=name=="GetTempPath"?text(NSTemporaryDirectory()):fromUTF8(std::filesystem::current_path().string());size_t required=textUnits(value,wide)+1;if(uint64_t(capacity)<required)return Value::integer(required);writeText(a(1),value,wide,size_t(capacity));return Value::integer(required-1);
    }
    if(name=="SetCurrentDirectory"){auto path=pathText(a(0),wide);if(chdir(path.c_str())!=0)return bad(rt,osError(errno));return Value::integer(1);}
    if(name=="GetTempFileName"){
      auto folder=std::filesystem::path(pathText(a(0),wide));Text prefix=readText(a(1),wide);if(prefix.size()>3)prefix.resize(3);if(prefix.find_first_of(u"/\\:")!=Text::npos)return bad(rt,87);uint32_t unique=uint32_t(n(2))&65535;bool create=unique==0;if(create)unique=uint32_t(std::chrono::steady_clock::now().time_since_epoch().count())%65535+1;
      for(size_t attempts=0;attempts<65535;attempts++){char suffix[16];std::snprintf(suffix,sizeof(suffix),"%04X.tmp",unique);auto path=folder/(toUTF8(prefix)+suffix);if(create){int file=open(path.c_str(),O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,0600);if(file<0){if(errno==EEXIST){unique=unique%65535+1;continue;}return bad(rt,osError(errno));}close(file);}auto value=fromUTF8(path.string());size_t required=textUnits(value,wide)+1;if(textCapacity(a(3),wide)<required){if(create)unlink(path.c_str());return bad(rt,122);}writeText(a(3),value,wide,required);return Value::integer(unique);}return bad(rt,80);
    }
    if(name=="DeleteFile"){auto path=pathText(a(0),wide);struct stat info{};if(lstat(path.c_str(),&info)!=0)return bad(rt,osError(errno));if(S_ISDIR(info.st_mode))return bad(rt,5);return unlink(path.c_str())==0?Value::integer(1):bad(rt,osError(errno));}
    if(name=="CreateDirectory"){if(a(1).value.type!=Type::Long&&a(1).value.type!=Type::Integer||n(1)!=0)return bad(rt,50);auto path=pathText(a(0),wide);return mkdir(path.c_str(),0777)==0?Value::integer(1):bad(rt,osError(errno));}
    if(name=="RemoveDirectory"){auto path=pathText(a(0),wide);return rmdir(path.c_str())==0?Value::integer(1):bad(rt,osError(errno));}
    if(name=="MoveFile"||name=="CopyFile"){
      auto source=pathText(a(0),wide),destination=pathText(a(1),wide);if(name=="MoveFile")return renamex_np(source.c_str(),destination.c_str(),RENAME_EXCL)==0?Value::integer(1):bad(rt,osError(errno));
      std::error_code error;bool success=std::filesystem::copy_file(source,destination,n(2)?std::filesystem::copy_options::none:std::filesystem::copy_options::overwrite_existing,error);if(error)return bad(rt,osError(error.value()));return result(success);
    }
    if(name=="GetFileAttributes"||name=="SetFileAttributes"){
      auto path=pathText(a(0),wide);struct stat info{};if(stat(path.c_str(),&info)!=0)return bad(rt,osError(errno),name=="GetFileAttributes"?-1:0);
      if(name=="GetFileAttributes"){uint32_t flags=S_ISDIR(info.st_mode)?16:32;if((info.st_mode&0222)==0)flags|=1;if(info.st_flags&UF_HIDDEN||std::filesystem::path(path).filename().string().rfind('.',0)==0)flags|=2;return longValue(flags);}
      uint32_t flags=u32(a(1).value);if(flags&~uint32_t(1|2|16|32|128))return bad(rt,50);mode_t mode=flags&1?info.st_mode&~0222:info.st_mode|0200;if(chmod(path.c_str(),mode)!=0)return bad(rt,osError(errno));u_int nativeFlags=(info.st_flags&~UF_HIDDEN)|((flags&2)?UF_HIDDEN:0);if(chflags(path.c_str(),nativeFlags)!=0){int error=errno;(void)chmod(path.c_str(),info.st_mode);return bad(rt,osError(error));}return Value::integer(1);
    }
    if(name=="GetEnvironmentVariable"){
      auto key=toUTF8(readText(a(0),wide));if(key.empty()||key.find('=')!=std::string::npos)return bad(rt,87);const char*rawValue=getenv(key.c_str());if(!rawValue)return bad(rt,203);auto value=fromUTF8(rawValue);auto capacity=n(2);if(capacity<0)return bad(rt,87);size_t required=textUnits(value,wide)+1;if(uint64_t(capacity)<required)return Value::integer(required);writeText(a(1),value,wide,size_t(capacity));return Value::integer(required-1);
    }
    if(name=="SetEnvironmentVariable"){
      auto key=toUTF8(readText(a(0),wide));if(key.empty()||key.find('=')!=std::string::npos)return bad(rt,87);bool remove=(a(1).value.type==Type::Long||a(1).value.type==Type::Integer)&&n(1)==0;int error=remove?unsetenv(key.c_str()):setenv(key.c_str(),toUTF8(readText(a(1),wide)).c_str(),1);return error==0?Value::integer(1):bad(rt,osError(errno));
    }
  }
  if(library=="winmm"&&name=="timeGetTime")return api(rt,"kernel32.GetTickCount",{});
  if(library=="shell32"&&name=="ShellExecute"){
    ensureApplication();auto operation=lower(toUTF8(readText(a(1),wide)));if(!operation.empty()&&operation!="open"&&operation!="explore")return Value::integer(31);auto path=readText(a(2),wide),parameters=readText(a(3),wide);if(!parameters.empty())return bad(rt,50,31);NSURL*url=nil;NSString*input=ns(path);if([input hasPrefix:@"https://"]||[input hasPrefix:@"http://"]||[input hasPrefix:@"mailto:"])url=[NSURL URLWithString:input];else{auto directory=readText(a(4),wide);std::filesystem::path file(toUTF8(path));if(file.is_relative()&&!directory.empty())file=std::filesystem::path(toUTF8(directory))/file;url=[NSURL fileURLWithPath:ns(fromUTF8(file.string()))];}return Value::integer(url&&[NSWorkspace.sharedWorkspace openURL:url]?33:31);
  }
  if(library=="user32"&&name!="FillRect"&&name!="DrawText"){
    ensureApplication();
    if(name=="MessageBox")return messageBox(readText(a(1),wide),n(3),readText(a(2),wide));
    if(name=="MessageBeep"){NSBeep();return Value::integer(1);}
    if(name=="GetSysColor")return Value::integer(colorValue(color(int64_t(uint32_t(0x80000000u|uint32_t(n(0)))))));
    if(name=="GetSystemMetrics"){
      auto screen=NSScreen.mainScreen;NSRect all=NSZeroRect;bool first=true;for(NSScreen*item in NSScreen.screens){all=first?item.frame:NSUnionRect(all,item.frame);first=false;}
      switch(n(0)){case 0:return Value::integer(bankers(screen.frame.size.width));case 1:return Value::integer(bankers(screen.frame.size.height));case 2:case 3:return Value::integer(15);case 4:return Value::integer(28);case 5:case 6:return Value::integer(1);case 7:case 8:return Value::integer(4);case 11:case 12:return Value::integer(32);case 13:case 14:return Value::integer(16);case 15:return Value::integer(22);case 19:return Value::integer(1);case 21:return Value::integer(3);case 23:return Value::integer(0);case 32:case 33:return Value::integer(4);case 36:case 37:return Value::integer(4);case 43:return Value::integer(3);case 75:return Value::integer(1);case 76:return Value::integer(bankers(all.origin.x));case 77:return Value::integer(bankers(NSMaxY(screen.frame)-NSMaxY(all)));case 78:return Value::integer(bankers(all.size.width));case 79:return Value::integer(bankers(all.size.height));case 80:return Value::integer(NSScreen.screens.count);case 81:return Value::integer(1);default:return Value::integer(0);}
    }
    if(name=="GetCursorPos"){auto point=NSEvent.mouseLocation;writeInts(a(0),{int32_t(bankers(point.x)),int32_t(bankers(NSMaxY(NSScreen.mainScreen.frame)-point.y))});return Value::integer(1);}
    if(name=="SetCursorPos"){auto error=CGWarpMouseCursorPosition(CGPointMake(n(0),n(1)));return error==kCGErrorSuccess?Value::integer(1):bad(rt,5);}
    if(name=="GetFocus"||name=="GetActiveWindow"||name=="GetForegroundWindow"){
      if(name=="GetForegroundWindow"&&!NSRunningApplication.currentApplication.active)return Value::integer(0);
      if(name=="GetFocus"){id responder=NSApp.keyWindow.firstResponder;auto c=[responder isKindOfClass:NSView.class]?controlForView((NSView*)responder):nullptr;return Value::integer(c?c->handle:0);}for(auto&entry:forms)if(entry.second->window==NSApp.keyWindow)return Value::integer(entry.second->surface->handle);return Value::integer(0);
    }
    if(name=="FindWindow"||name=="FindWindowEx"){
      int32_t parent=name=="FindWindowEx"?i32(a(0).value):0,after=name=="FindWindowEx"?i32(a(1).value):0;size_t offset=name=="FindWindowEx"?2:0;auto className=lower(toUTF8(readText(a(offset),wide)));auto title=readText(a(offset+1),wide);bool ready=after==0;
      for(auto&entry:forms){std::vector<std::shared_ptr<MacControl>>candidates;if(parent==0)candidates.push_back(entry.second->surface);else for(auto&item:entry.second->owner->controls){if(auto c=std::dynamic_pointer_cast<MacControl>(item.second))candidates.push_back(c);else if(auto array=std::dynamic_pointer_cast<MacControlArray>(item.second))for(auto&child:array->elements)candidates.push_back(child.second);}
        for(auto&c:candidates){if(!ready){if(c->handle==after)ready=true;continue;}if(parent){auto p=controlForView(c->view.superview);if(!p||p->handle!=parent)continue;}bool matches=className.empty()||className==lower(c->spec.type)||className=="thunderrt6formdc"&&(c->spec.type=="Form"||c->spec.type=="MDIForm");if(matches&&(title.empty()||compareText(windowText(*this,c),title,true)==0))return Value::integer(c->handle);}
      }return Value::integer(0);
    }
    if(name=="SetTimer"){
      int32_t hwnd=i32(a(0).value),id=i32(a(1).value);auto window=control(hwnd);if(hwnd&&!window)return bad(rt,1400);uint32_t interval=std::clamp(uint32_t(n(2)),uint32_t(10),uint32_t(0x7fffffff));
      auto owner=std::make_shared<TimerOwner>();owner->hwnd=hwnd;owner->window=window;owner->callback=a(3).value;
      if(owner->callback.type==Type::Object){auto callback=std::dynamic_pointer_cast<NativeCallback>(owner->callback.asObject());if(!callback)return bad(rt,87);auto instance=callback->owner.lock();if(!instance)return bad(rt,6);auto procedure=instance->module->procedures.find(callback->procedure);if(procedure==instance->module->procedures.end()||procedure->second.parameters.size()!=4)return bad(rt,87);for(auto&parameter:procedure->second.parameters)if(parameter.byRef||lower(parameter.type)!="long")return bad(rt,87);}
      else if(owner->callback.integral()!=0)return bad(rt,87);
      if(!hwnd||!id)id=handles.add(owner,HandleKind::Timer,true);owner->id=id;auto key=std::make_pair(hwnd,id);if(auto it=apiTimers.find(key);it!=apiTimers.end())[it->second invalidate];apiTimerOwners[key]=owner;
      MacHost*host=this;std::weak_ptr<int>alive=life;auto timer=[NSTimer timerWithTimeInterval:double(interval)/1000 repeats:YES block:^(NSTimer*){if(alive.expired())return;host->event([host,owner]{if(owner->callback.type==Type::Object)owner->callback.asObject()->invoke(*host->runtime,"",{Arg(Value::integer(owner->hwnd)),Arg(Value::integer(0x113)),Arg(Value::integer(owner->id)),Arg(host->api(*host->runtime,"kernel32.GetTickCount",{}))});});}];apiTimers[key]=timer;[NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];return Value::integer(id);
    }
    if(name=="KillTimer"){auto key=std::make_pair(i32(a(0).value),i32(a(1).value));auto it=apiTimers.find(key);if(it==apiTimers.end())return bad(rt,87);[it->second invalidate];apiTimers.erase(it);auto owner=apiTimerOwners.find(key);if(owner!=apiTimerOwners.end()&&handles.find(key.second,HandleKind::Timer)==owner->second)handles.remove(key.second);apiTimerOwners.erase(key);return Value::integer(1);}
    auto c=control(i32(a(0).value));
    if(name=="IsWindow")return result(c&&!c->disposed);if(!c||c->disposed)return bad(rt,1400);
    if(name=="IsWindowVisible")return result(c->spec.type=="Form"||c->spec.type=="MDIForm"?c->form()->window.visible:c->view&&!c->view.hidden);
    if(name=="IsWindowEnabled")return result(c->flag("enabled",true));
    if(name=="EnableWindow"){bool wasDisabled=!c->flag("enabled",true);if(c->spec.type=="Form"||c->spec.type=="MDIForm")formSet(c->owner.lock(),"enabled",Value::boolean(n(1)!=0));else c->set(rt,"enabled",Value::boolean(n(1)!=0));return result(wasDisabled);}
    if(name=="ShowWindow"){
      bool formWindow=c->spec.type=="Form"||c->spec.type=="MDIForm",visible=formWindow?c->form()->window.visible:c->view&&!c->view.hidden;auto command=n(1);if(formWindow){formCall(c->owner.lock(),command==0?"hide":"show",{});if(command==2||command==6||command==7||command==11)formSet(c->owner.lock(),"windowstate",Value::integer(1,Type::Integer));else if(command==3)formSet(c->owner.lock(),"windowstate",Value::integer(2,Type::Integer));else if(command==1||command==9)formSet(c->owner.lock(),"windowstate",Value::integer(0,Type::Integer));}else c->set(rt,"visible",Value::boolean(command!=0));return result(visible);
    }
    if(name=="SetFocus"){auto previous=api(rt,"user32.GetFocus",{});if(!c->view||![c->view.window makeFirstResponder:nativeFocusView(*c)])return bad(rt,87);return previous;}
    if(name=="SetActiveWindow"||name=="SetForegroundWindow"){if(!c->view.window)return bad(rt,1400);auto previous=api(rt,"user32.GetActiveWindow",{});[c->view.window makeKeyAndOrderFront:nil];if(name=="SetForegroundWindow")return result([NSRunningApplication.currentApplication activateWithOptions:NSApplicationActivateIgnoringOtherApps]);return previous;}
    if(name=="SetWindowText"){setWindowText(*this,c,readText(a(1),wide));return Value::integer(1);}
    if(name=="GetWindowTextLength")return Value::integer(textUnits(windowText(*this,c),wide));
    if(name=="GetWindowText"){auto capacity=n(2);if(capacity<0)return bad(rt,87);return Value::integer(writeText(a(1),windowText(*this,c),wide,size_t(capacity)));}
    if(name=="GetClientRect"){if(!c->view)return bad(rt,87);writeInts(a(1),{0,0,int32_t(bankers(c->view.bounds.size.width)),int32_t(bankers(c->view.bounds.size.height))});return Value::integer(1);}
    if(name=="GetWindowRect"){if(!c->view)return bad(rt,87);writeInts(a(1),winRect(screenRect(c)));return Value::integer(1);}
    if(name=="ClientToScreen"||name=="ScreenToClient"){
      auto point=readInts(a(1),2);NSView*coordinates=c->appearanceContent?:c->view;NSPoint p=NSMakePoint(point[0],point[1]);if(name=="ClientToScreen"){p=[coordinates convertPoint:p toView:nil];p=[coordinates.window convertPointToScreen:p];p.y=NSMaxY(NSScreen.mainScreen.frame)-p.y;}else{p.y=NSMaxY(NSScreen.mainScreen.frame)-p.y;p=[coordinates.window convertPointFromScreen:p];p=[coordinates convertPoint:p fromView:nil];}writeInts(a(1),{int32_t(bankers(p.x)),int32_t(bankers(p.y))});return Value::integer(1);
    }
    if(name=="MoveWindow"||name=="SetWindowPos"){
      size_t offset=name=="SetWindowPos"?2:1;uint32_t flags=name=="SetWindowPos"?u32(a(6).value):0;double x=n(offset),y=n(offset+1),width=n(offset+2),height=n(offset+3);if(width<0||height<0||std::max({std::abs(x),std::abs(y),width,height})>20000)return bad(rt,87);
      bool formWindow=c->spec.type=="Form"||c->spec.type=="MDIForm";
      if(formWindow){auto frame=c->form()->window.frame;if(!(flags&2)){frame.origin.x=x;frame.origin.y=NSMaxY(NSScreen.mainScreen.frame)-y-frame.size.height;}if(!(flags&1)){frame.origin.y+=frame.size.height-height;frame.size=NSMakeSize(width,height);}[c->form()->window setFrame:frame display:name=="MoveWindow"?n(5)!=0:!(flags&8)];if(name=="SetWindowPos"&&!(flags&4)){auto after=n(1);if(after==-1)c->form()->window.level=NSFloatingWindowLevel;else if(after==-2)c->form()->window.level=NSNormalWindowLevel;else if(after==1)[c->form()->window orderBack:nil];else [c->form()->window orderFront:nil];}}
      else{auto frame=c->view.frame;if(!(flags&2))frame.origin=NSMakePoint(x,y);if(!(flags&1))frame.size=NSMakeSize(width,height);c->view.frame=frame;c->properties["left"]=Value::real(frame.origin.x*15);c->properties["top"]=Value::real(frame.origin.y*15);c->properties["width"]=Value::real(frame.size.width*15);c->properties["height"]=Value::real(frame.size.height*15);}
      if(flags&64){if(formWindow)formCall(c->owner.lock(),"show",{});else c->view.hidden=NO;}if(flags&128){if(formWindow)formCall(c->owner.lock(),"hide",{});else c->view.hidden=YES;}return Value::integer(1);
    }
    if(name=="GetDlgCtrlID")return Value::integer(c->spec.index>=0?c->spec.index:(uint32_t(c->handle)&65535));
    if(name=="GetDlgItem"){for(auto&entry:forms)for(auto&item:entry.second->owner->controls)if(auto child=std::dynamic_pointer_cast<MacControl>(item.second))if(controlForView(child->view.superview)==c&&(child->spec.index>=0?child->spec.index:int32_t(uint32_t(child->handle)&65535))==n(1))return Value::integer(child->handle);return Value::integer(0);}
    if(name=="GetParent"){auto parent=controlForView(c->view.superview);if(parent==c)parent=nullptr;return Value::integer(parent?parent->handle:0);}
    if(name=="SetParent"){
      auto previous=api(rt,"user32.GetParent",{a(0)});auto parent=control(i32(a(1).value));if(!parent||!c->view||!parent->container()||parent==c||[parent->container()isDescendantOf:c->view])return bad(rt,87);[c->view removeFromSuperview];[parent->container()addSubview:c->view];return previous;
    }
    if(name=="InvalidateRect"||name=="UpdateWindow"){
      if(name=="InvalidateRect"&&(a(1).value.type==Type::Record||a(1).value.type==Type::Array)){auto rect=readInts(a(1),4);[c->view setNeedsDisplayInRect:NSMakeRect(rect[0],rect[1],rect[2]-rect[0],rect[3]-rect[1])];}else c->view.needsDisplay=YES;c->widget.needsDisplay=YES;if(name=="UpdateWindow")[c->view displayIfNeeded];return Value::integer(1);
    }
    if(name=="DestroyWindow"){if(c->spec.type=="Form"||c->spec.type=="MDIForm")rt.unload(c->owner.lock());else c->dispose();return Value::integer(1);}
    if(name=="SendMessage")return longValue(uint32_t(controlMessage(*this,c,u32(a(1).value),a(2),a(3),wide)));
    if(name=="PostMessage"){
      if(a(2).value.type!=Type::Long&&a(2).value.type!=Type::Integer||a(3).value.type!=Type::Long&&a(3).value.type!=Type::Integer)return bad(rt,87);auto weak=std::weak_ptr<int>(life);MacHost*host=this;Args copied{Arg(a(0).value),Arg(a(1).value),Arg(a(2).value),Arg(a(3).value)};auto entry=wide?std::string("user32.SendMessageW"):std::string("user32.SendMessage");dispatch_async(dispatch_get_main_queue(),^{if(!weak.expired())host->event([host,entry,copied]{host->api(*host->runtime,entry,copied);});});return Value::integer(1);
    }
    if(name=="GetDC"||name=="GetWindowDC"){
      auto context=std::make_shared<DeviceContext>(c);selectGdi(context->pen,stock(*this,7));selectGdi(context->brush,stock(*this,0));selectGdi(context->font,stock(*this,13));return Value::integer(handles.add(context,HandleKind::DC,true));
    }
    if(name=="ReleaseDC"){auto context=dc(*this,a(1).value);if(!context||context->target.lock()!=c)return bad(rt,6);return result(handles.remove(i32(a(1).value)));}
  }
  if(library=="gdi32"||library=="user32"&&(name=="FillRect"||name=="DrawText")){
    ensureApplication();
    if(name=="CreatePen"||name=="CreateSolidBrush"){
      auto kind=name=="CreatePen"?HandleKind::Pen:HandleKind::Brush;auto value=std::make_shared<GdiResource>(kind);value->color=i32(a(name=="CreatePen"?2:0).value);if(kind==HandleKind::Pen){value->style=int(n(0));value->width=std::abs(double(n(1)));if(value->style<0||value->style>6||value->width>65535)return bad(rt,87);if(value->width==0)value->width=1;}value->handle=handles.add(value,kind,true);return Value::integer(value->handle);
    }
    if(name=="GetStockObject"){auto value=stock(*this,int(n(0)));return value?Value::integer(value->handle):bad(rt,87);}
    if(name=="DeleteObject"){auto value=std::dynamic_pointer_cast<GdiResource>(handles.find(i32(a(0).value)));if(!value||value->stock||value->selections)return bad(rt,6);return result(handles.remove(value->handle));}
    if(name=="DeleteDC")return bad(rt,6); // GetDC contexts must be released with ReleaseDC.
    auto context=dc(*this,a(0).value);if(!context)return bad(rt,6);auto target=context->target.lock();if(!target||target->disposed)return bad(rt,6);
    if(name=="SelectObject"){
      auto value=std::dynamic_pointer_cast<GdiResource>(handles.find(i32(a(1).value)));if(!value)return bad(rt,6);auto slot=value->kind==HandleKind::Pen?&context->pen:value->kind==HandleKind::Brush?&context->brush:value->kind==HandleKind::Font?&context->font:nullptr;if(!slot)return bad(rt,6);int32_t previous=*slot?(*slot)->handle:0;selectGdi(*slot,value);return Value::integer(previous);
    }
    if(name=="SetTextColor"){auto previous=context->textColor;context->textColor=i32(a(1).value);return Value::integer(previous);}
    if(name=="SetBkColor"){auto previous=context->backgroundColor;context->backgroundColor=i32(a(1).value);return Value::integer(previous);}
    if(name=="SetBkMode"){auto value=n(1);if(value!=1&&value!=2)return bad(rt,87);auto previous=context->backgroundMode;context->backgroundMode=int(value);return Value::integer(previous);}
    if(name=="MoveToEx"){if(a(3).value.type==Type::Record||a(3).value.type==Type::Array)writeInts(a(3),{int32_t(bankers(context->position.x)),int32_t(bankers(context->position.y))});context->position=NSMakePoint(n(1),n(2));return Value::integer(1);}
    if(name=="LineTo"){auto command=dcCommand(context,*target,"line");command.coordinates={context->position.x,context->position.y,double(n(1)),double(n(2))};if(context->pen&&context->pen->style!=5){command.color=context->pen->color;command.width=context->pen->width;command.style=context->pen->style;appendCommand(*target,command);}context->position=NSMakePoint(n(1),n(2));return Value::integer(1);}
    if(name=="Rectangle"||name=="Ellipse"||name=="FillRect"){
      auto command=dcCommand(context,*target,name=="Ellipse"?"ellipse":"rect");std::shared_ptr<GdiResource>brush=context->brush;if(name=="FillRect"){auto rect=readInts(a(1),4);command.coordinates={double(rect[0]),double(rect[1]),double(rect[2]),double(rect[3])};brush=std::dynamic_pointer_cast<GdiResource>(handles.find(i32(a(2).value),HandleKind::Brush));if(!brush)return bad(rt,6);}else command.coordinates={double(n(1)),double(n(2)),double(n(3)),double(n(4))};
      if(brush&&brush->style!=5){command.fill=true;command.color=brush->color;appendCommand(*target,command);}if(name!="FillRect"&&context->pen&&context->pen->style!=5){command.fill=false;command.color=context->pen->color;command.width=context->pen->width;command.style=context->pen->style;appendCommand(*target,command);}return Value::integer(1);
    }
    if(name=="SetPixel"){auto command=dcCommand(context,*target,"pixel");command.coordinates={double(n(1)),double(n(2))};command.color=i32(a(3).value);appendCommand(*target,command);return Value::integer(command.color);}
    if(name=="GetPixel"){
      double x=n(1),y=n(2);auto bounds=target->view.bounds;if(x<0||y<0||x>=bounds.size.width||y>=bounds.size.height)return Value::integer(-1);NSBitmapImageRep*bitmap=[target->view bitmapImageRepForCachingDisplayInRect:bounds];if(!bitmap)return bad(rt,8,-1);[target->view cacheDisplayInRect:bounds toBitmapImageRep:bitmap];NSInteger px=NSInteger(x*bitmap.pixelsWide/bounds.size.width),py=NSInteger(y*bitmap.pixelsHigh/bounds.size.height);return Value::integer(nativeBitmapColor(bitmap,px,py));
    }
    if(name=="TextOut"||name=="DrawText"||name=="GetTextExtentPoint32"){
      size_t textIndex=name=="TextOut"?3:1,countIndex=name=="TextOut"?4:2;int64_t count=n(countIndex);if(count<0&&(name!="DrawText"||count!= -1))return bad(rt,87);auto string=readText(a(textIndex),wide,count<0,count);auto command=dcCommand(context,*target,name=="DrawText"?"textrect":"text");command.text=string;command.color=context->textColor;
      NSFont*font=[NSFont fontWithName:ns(command.fontName)size:command.fontSize]?:[NSFont systemFontOfSize:command.fontSize];NSFontTraitMask traits=0;if(command.bold)traits|=NSBoldFontMask;if(command.italic)traits|=NSItalicFontMask;if(traits)font=[NSFontManager.sharedFontManager convertFont:font toHaveTrait:traits];NSDictionary*attributes=@{NSFontAttributeName:font};NSSize size=[ns(string)sizeWithAttributes:attributes];
      if(name=="GetTextExtentPoint32"){writeInts(a(3),{int32_t(std::ceil(size.width)),int32_t(std::ceil(size.height))});return Value::integer(1);}
      if(name=="DrawText"){
        auto rect=readInts(a(3),4);auto flags=u32(a(4).value);command.flags=flags;if(flags&0x10000)return bad(rt,50);double width=std::max(0.0,double(rect[2]-rect[0]));if(!(flags&0x20)){auto measured=[ns(string)boundingRectWithSize:NSMakeSize(width,CGFLOAT_MAX)options:NSStringDrawingUsesLineFragmentOrigin attributes:attributes];size=measured.size;}
        if(flags&0x400){rect[2]=rect[0]+int32_t(std::ceil(size.width));rect[3]=rect[1]+int32_t(std::ceil(size.height));writeInts(a(3),rect);}else{command.coordinates={double(rect[0]),double(rect[1]),double(rect[2]),double(rect[3])};appendCommand(*target,command);}return Value::integer(std::ceil(size.height));
      }
      command.coordinates={double(n(1)),double(n(2))};if(context->backgroundMode==2){auto background=command;background.kind="rect";background.fill=true;background.color=context->backgroundColor;background.coordinates={double(n(1)),double(n(2)),double(n(1))+size.width,double(n(2))+size.height};appendCommand(*target,background);}appendCommand(*target,command);return Value::integer(1);
    }
  }
  fail(453,"No native macOS adapter for "+raw);
}
} // namespace vb6
