// Checked source-level Win32 adapters for GTK/POSIX; no pointer truncation or DLL loader. MIT.
#include "gtk.hpp"
#include "file-codec.hpp"
#include <cerrno>
#include <cstring>
#include <sys/syscall.h>
#include <unistd.h>

namespace vb6 {
namespace {
Value longValue(uint32_t value){return Value::integer(value<=INT32_MAX?int64_t(value):int64_t(value)-4294967296LL);}
Value bad(Runtime&rt,int code,int64_t result=0){rt.error.lastDllError=code;return Value::integer(result);}
[[maybe_unused]] int osError(int code){switch(code){case ENOENT:return 2;case ENOTDIR:return 3;case EACCES:case EPERM:return 5;case EBADF:return 6;case ENOMEM:return 8;case EEXIST:return 183;case ENOSPC:return 112;case ENAMETOOLONG:return 206;case EINVAL:return 87;default:return 31;}}
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
[[maybe_unused]] void writeLong(const Arg&arg,int64_t value){if(!arg.reference||!arg.nativeByRef)fail(13,"API output must be ByRef");arg.reference.set(Value::integer(value));}
[[maybe_unused]] void write64(const Arg&arg,uint64_t value){Bytes bytes(8);for(size_t i=0;i<8;i++)bytes[i]=uint8_t(value>>(8*i));writeBytes(arg,bytes);}
std::vector<int32_t>readInts(const Arg&arg,size_t count){auto bytes=rawBytes(arg);if(bytes.size()<count*4)fail(5,"API record is too small");std::vector<int32_t>values;for(size_t i=0;i<count;i++){uint32_t n=0;for(size_t j=0;j<4;j++)n|=uint32_t(bytes[i*4+j])<<(j*8);values.push_back(int32_t(n<=INT32_MAX?int64_t(n):int64_t(n)-4294967296LL));}return values;}
void writeInts(const Arg&arg,const std::vector<int32_t>&values){Bytes bytes(values.size()*4);for(size_t i=0;i<values.size();i++)for(size_t j=0;j<4;j++)bytes[i*4+j]=uint8_t(uint32_t(values[i])>>(8*j));writeBytes(arg,bytes);}
Text readText(const Arg&arg,bool wide,bool terminated=true,int64_t count=-1){
  Text result;const auto&value=arg.value;
  if(value.type==Type::String){result=value.string();if(!wide){auto bytes=encodeANSI(result);if(count>=0){if(uint64_t(count)>bytes.size())fail(5,"API input length exceeds String capacity");bytes.resize(size_t(count));}result=decodeANSI(bytes);}}
  else if(value.type==Type::Array){auto bytes=rawBytes(arg);if(wide){if(bytes.size()%2)fail(5,"Wide buffer has an odd byte length");for(size_t i=0;i<bytes.size();i+=2)result.push_back(char16_t(uint16_t(bytes[i])|(uint16_t(bytes[i+1])<<8)));}else{if(count>=0){if(uint64_t(count)>bytes.size())fail(5);bytes.resize(size_t(count));}result=decodeANSI(bytes);}}
  else if(value.type==Type::Empty||(value.type==Type::Long&&value.integral()==0)||(value.type==Type::Integer&&value.integral()==0))return {};
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
struct ApiTimer final:Object {
  GtkHost* host=nullptr;std::weak_ptr<int> life;int32_t window=0,id=0;Value callback;bool allocated=false,active=false;
  ~ApiTimer()override{if(allocated&&!life.expired())host->handles.remove(id);}
};
struct NativeModule final:Object {int32_t handle=0;};
struct GdiObject final:Object {
  HandleKind kind;int32_t handle=0,color=0;double width=1;int style=0;bool stock=false;size_t selections=0;
  explicit GdiObject(HandleKind value):kind(value){}
};
struct GtkDC final:Object {
  std::weak_ptr<GtkControl> target;std::shared_ptr<GdiObject> pen,brush;double x=0,y=0;int32_t textColor=0,backColor=0xffffff;int backMode=2;
  ~GtkDC()override{if(pen&&pen->selections)--pen->selections;if(brush&&brush->selections)--brush->selections;}
};
std::shared_ptr<GdiObject> stock(GtkHost& host,int index) {
  auto key="stock-"+std::to_string(index);auto found=host.systemObjects.find(key);if(found!=host.systemObjects.end())return std::dynamic_pointer_cast<GdiObject>(found->second);
  std::shared_ptr<GdiObject> object;
  if(index>=0&&index<=5){object=std::make_shared<GdiObject>(HandleKind::Brush);const int colors[]={0xffffff,0xc0c0c0,0x808080,0x404040,0,0};object->color=colors[index];object->style=index==5?5:0;}
  else if(index>=6&&index<=8){object=std::make_shared<GdiObject>(HandleKind::Pen);object->color=index==6?0xffffff:0;object->style=index==8?5:0;}else return nullptr;
  object->stock=true;object->handle=host.handles.add(object,object->kind,true);host.systemObjects[key]=object;return object;
}
Text windowText(GtkHost& host,const std::shared_ptr<GtkControl>& c) {
  if(c->spec.type=="Form"||c->spec.type=="MDIForm")return host.formGet(c->owner.lock(),"caption").string();
  return c->editor()?c->editText():c->property("caption",Value::string(u"")).string();
}
bool isForm(const GtkControl& c){return c.spec.type=="Form"||c.spec.type=="MDIForm";}
}

Value GtkHost::api(Runtime& rt,const std::string& raw,Args args) {
  auto dot=raw.find('.');if(dot==std::string::npos)fail(453,"Invalid native API identifier");auto library=lower(raw.substr(0,dot)),name=lower(raw.substr(dot+1));
  bool wide=false;const std::set<std::string> textNames={"getmodulehandle","setwindowtext","getwindowtext","getwindowtextlength","messagebox","textout"};
  if(name.size()>1&&(name.back()=='a'||name.back()=='w')&&textNames.count(name.substr(0,name.size()-1))){wide=name.back()=='w';name.pop_back();}
  auto a=[&](size_t index)->const Arg&{if(index>=args.size())fail(450);return args[index];};auto n=[&](size_t index){return a(index).value.integral();};
  auto result=[](bool value){return Value::integer(value?1:0);};
  if(library=="kernel32") {
    if(name=="gettickcount"||name=="gettickcount64"){auto millis=uint64_t(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());return name=="gettickcount"?longValue(uint32_t(millis)):Value::integer(int64_t(millis));}
    if(name=="sleep"){auto duration=n(0);if(duration<0||duration>0x7fffffff)return bad(rt,87);std::this_thread::sleep_for(std::chrono::milliseconds(duration));return {};}
    if(name=="getcurrentprocessid")return Value::integer(getpid());
    if(name=="getcurrentthreadid")return Value::integer(syscall(SYS_gettid));
    if(name=="getlasterror")return Value::integer(rt.error.lastDllError);
    if(name=="setlasterror"){rt.error.lastDllError=i32(a(0).value);return {};}
    if(name=="muldiv"){int64_t left=i32(a(0).value),right=i32(a(1).value),denominator=i32(a(2).value);if(!denominator)return Value::integer(-1);auto product=left*right;bool negative=(product<0)!=(denominator<0);auto numerator=uint64_t(product<0?-product:product),divisor=uint64_t(denominator<0?-denominator:denominator);auto quotient=numerator/divisor;if(numerator%divisor>=(divisor+1)/2)++quotient;if(quotient>uint64_t(negative?2147483648LL:2147483647LL))return Value::integer(-1);return Value::integer(negative?-int64_t(quotient):int64_t(quotient));}
    if(name=="getmodulehandle") {auto requested=readText(a(0),wide);if(!requested.empty()&&lower(toUTF8(requested))!=lower(rt.executablePath.filename().string()))return bad(rt,126);auto found=systemObjects.find("module");if(found!=systemObjects.end())return Value::integer(std::static_pointer_cast<NativeModule>(found->second)->handle);auto value=std::make_shared<NativeModule>();value->handle=handles.add(value,HandleKind::Module,true);systemObjects["module"]=value;return Value::integer(value->handle);}
  }
  if(library=="user32") {
    ensureApplication();
    if(name=="messagebox")return messageBox(readText(a(1),wide),n(3),readText(a(2),wide));
    if(name=="messagebeep"){gdk_display_beep(gdk_display_get_default());return Value::integer(1);}
    if(name=="getsyscolor")return Value::integer(gtkColorValue(gtkColor(uint32_t(0x80000000u|uint32_t(n(0))))));
    if(name=="getsystemmetrics") {
      auto* display=gdk_display_get_default();auto* monitor=gdk_display_get_primary_monitor(display);if(!monitor)monitor=gdk_display_get_monitor(display,0);GdkRectangle rect{0,0,0,0},all{0,0,0,0};if(monitor)gdk_monitor_get_geometry(monitor,&rect);
      for(int i=0;i<gdk_display_get_n_monitors(display);++i){GdkRectangle bounds;gdk_monitor_get_geometry(gdk_display_get_monitor(display,i),&bounds);if(!i)all=bounds;else{int right=std::max(all.x+all.width,bounds.x+bounds.width),bottom=std::max(all.y+all.height,bounds.y+bounds.height);all.x=std::min(all.x,bounds.x);all.y=std::min(all.y,bounds.y);all.width=right-all.x;all.height=bottom-all.y;}}
      switch(n(0)){case 0:return Value::integer(rect.width);case 1:return Value::integer(rect.height);case 2:case 3:return Value::integer(16);case 4:return Value::integer(28);case 5:case 6:return Value::integer(1);case 7:case 8:return Value::integer(4);case 11:case 12:return Value::integer(32);case 13:case 14:return Value::integer(16);case 19:return Value::integer(1);case 21:return Value::integer(3);case 43:return Value::integer(3);case 76:return Value::integer(all.x);case 77:return Value::integer(all.y);case 78:return Value::integer(all.width);case 79:return Value::integer(all.height);case 80:return Value::integer(gdk_display_get_n_monitors(display));default:return bad(rt,50);}
    }
    if(name=="getfocus"||name=="getactivewindow"){auto* window=activeWindow();if(!window)return Value::integer(0);if(name=="getfocus"){auto c=controlForWidget(gtk_window_get_focus(window));return Value::integer(c?c->handle:0);}for(auto& entry:forms)if(entry.second->window==GTK_WIDGET(window))return Value::integer(entry.second->surface->handle);return Value::integer(0);}
    if(name=="settimer") {
      int32_t window=i32(a(0).value),id=i32(a(1).value);if(window&&!control(window))return bad(rt,1400);auto interval=std::clamp(uint32_t(n(2)),uint32_t(10),uint32_t(0x7fffffff));
      auto timer=std::make_shared<ApiTimer>();timer->host=this;timer->life=life;timer->window=window;timer->callback=a(3).value;
      if(timer->callback.type==Type::Object){auto callback=std::dynamic_pointer_cast<NativeCallback>(std::get<ObjectPtr>(timer->callback.payload));if(!callback)return bad(rt,87);auto owner=callback->owner.lock();if(!owner)return bad(rt,6);auto procedure=owner->module->procedures.find(callback->procedure);if(procedure==owner->module->procedures.end()||procedure->second.parameters.size()!=4)return bad(rt,87);for(auto& p:procedure->second.parameters)if(p.byRef||p.optional||p.paramArray||p.array||lower(p.type)!="long")return bad(rt,87);}
      else if(timer->callback.integral()!=0)return bad(rt,87);
      if(!window||!id){id=handles.add(timer,HandleKind::Timer);timer->allocated=true;}timer->id=id;auto key=std::make_pair(window,id);
      auto existing=apiTimers.find(key);if(existing!=apiTimers.end()){g_source_remove(existing->second);apiTimers.erase(existing);}
      auto* holder=new std::shared_ptr<ApiTimer>(timer);auto source=g_timeout_add_full(G_PRIORITY_DEFAULT,interval,+[](gpointer data)->gboolean {
        auto timer=*static_cast<std::shared_ptr<ApiTimer>*>(data);if(timer->life.expired())return G_SOURCE_REMOVE;if(timer->active)return G_SOURCE_CONTINUE;
        timer->host->event([&]{timer->active=true;try{if(timer->callback.type==Type::Object)timer->callback.asObject()->invoke(*timer->host->runtime,"",{Arg(Value::integer(timer->window)),Arg(Value::integer(0x113)),Arg(Value::integer(timer->id)),Arg(timer->host->api(*timer->host->runtime,"kernel32.GetTickCount",{}))});timer->active=false;}catch(...){timer->active=false;throw;}});return G_SOURCE_CONTINUE;
      },holder,+[](gpointer data){delete static_cast<std::shared_ptr<ApiTimer>*>(data);});apiTimers[key]=source;return Value::integer(id);
    }
    if(name=="killtimer"){auto key=std::make_pair(i32(a(0).value),i32(a(1).value));auto found=apiTimers.find(key);if(found==apiTimers.end())return bad(rt,87);g_source_remove(found->second);apiTimers.erase(found);return Value::integer(1);}
    if(name=="releasedc"){auto context=std::dynamic_pointer_cast<GtkDC>(handles.find(i32(a(1).value),HandleKind::DC));if(!context||context->target.lock()!=control(i32(a(0).value)))return bad(rt,6);handles.remove(i32(a(1).value));return Value::integer(1);}
    auto c=control(i32(a(0).value));if(name=="iswindow")return result(c&&!c->disposed);if(!c||c->disposed)return bad(rt,1400);
    if(name=="iswindowvisible")return result(isForm(*c)?gtk_widget_get_visible(c->form()->window):c->view&&gtk_widget_get_visible(c->view));
    if(name=="iswindowenabled")return result(isForm(*c)?c->form()->enabled:c->get(rt,"enabled").truth());
    if(name=="enablewindow"){auto previous=api(rt,"user32.IsWindowEnabled",{a(0)}).truth();if(isForm(*c))formSet(c->owner.lock(),"enabled",Value::boolean(n(1)!=0));else c->set(rt,"enabled",Value::boolean(n(1)!=0));return result(!previous);}
    if(name=="showwindow"){auto previous=api(rt,"user32.IsWindowVisible",{a(0)}).truth();auto command=n(1);if(command<0||command>11)return bad(rt,87);if(isForm(*c)){formCall(c->owner.lock(),command==0?"hide":"show",{});if(command==2||command==6||command==7||command==11)formSet(c->owner.lock(),"windowstate",Value::integer(1));else if(command==3)formSet(c->owner.lock(),"windowstate",Value::integer(2));else if(command==1||command==9)formSet(c->owner.lock(),"windowstate",Value::integer(0));}else c->set(rt,"visible",Value::boolean(command!=0));return result(previous);}
    if(name=="setwindowtext"){auto text=readText(a(1),wide);if(isForm(*c))formSet(c->owner.lock(),"caption",Value::string(text));else c->set(rt,c->editor()?"text":"caption",Value::string(text));return Value::integer(1);}
    if(name=="getwindowtextlength")return Value::integer(textUnits(windowText(*this,c),wide));
    if(name=="getwindowtext"){auto capacity=n(2);if(capacity<0)return bad(rt,87);return Value::integer(writeText(a(1),windowText(*this,c),wide,size_t(capacity)));}
    if(name=="setfocus"){auto previous=api(rt,"user32.GetFocus",{});if(isForm(*c))formCall(c->owner.lock(),"setfocus",{});else c->invoke(rt,"setfocus",{});return previous;}
    if(name=="setactivewindow"){auto previous=api(rt,"user32.GetActiveWindow",{});gtk_window_present(GTK_WINDOW(c->form()->window));return previous;}
    if(name=="getclientrect"){if(!c->view)return bad(rt,87);writeInts(a(1),{0,0,gtk_widget_get_allocated_width(c->view),gtk_widget_get_allocated_height(c->view)});return Value::integer(1);}
    if(name=="getwindowrect"){if(!c->view)return bad(rt,87);auto f=c->form();int x=0,y=0,w=0,h=0;gtk_window_get_position(GTK_WINDOW(f->window),&x,&y);if(isForm(*c))gtk_window_get_size(GTK_WINDOW(f->window),&w,&h);else{int cx=0,cy=0;gtk_widget_translate_coordinates(c->view,f->window,0,0,&cx,&cy);x+=cx;y+=cy;w=gtk_widget_get_allocated_width(c->view);h=gtk_widget_get_allocated_height(c->view);}writeInts(a(1),{x,y,x+w,y+h});return Value::integer(1);}
    if(name=="movewindow"){double x=n(1),y=n(2),w=n(3),h=n(4);if(w<0||h<0||std::max({std::abs(x),std::abs(y),w,h})>20000)return bad(rt,87);if(isForm(*c))formCall(c->owner.lock(),"move",{Arg(Value::real(x*15)),Arg(Value::real(y*15)),Arg(Value::real(w*15)),Arg(Value::real(h*15))});else c->invoke(rt,"move",{Arg(Value::real(x*15)),Arg(Value::real(y*15)),Arg(Value::real(w*15)),Arg(Value::real(h*15))});if(n(5)&&c->view)gtk_widget_queue_draw(c->view);return Value::integer(1);}
    if(name=="getparent"){if(isForm(*c)){auto* window=gtk_window_get_transient_for(GTK_WINDOW(c->form()->window));for(auto& f:forms)if(f.second->window==GTK_WIDGET(window))return Value::integer(f.second->surface->handle);return Value::integer(0);}auto parent=c->view?controlForWidget(gtk_widget_get_parent(c->view)):nullptr;return Value::integer(parent?parent->handle:0);}
    if(name=="destroywindow"){if(isForm(*c)){auto owner=c->owner.lock();rt.unload(owner);return result(!owner->loaded);}c->dispose();return Value::integer(1);}
    if(name=="invalidaterect"||name=="updatewindow"){if(!c->view)return bad(rt,87);if(name=="invalidaterect"&&(a(1).value.type==Type::Record||a(1).value.type==Type::Array)){auto rect=readInts(a(1),4);gtk_widget_queue_draw_area(c->view,rect[0],rect[1],std::max(0,rect[2]-rect[0]),std::max(0,rect[3]-rect[1]));}else gtk_widget_queue_draw(c->view);if(name=="updatewindow")pump();return Value::integer(1);}
    if(name=="getdc"){auto context=std::make_shared<GtkDC>();context->target=c;context->pen=stock(*this,7);context->brush=stock(*this,0);++context->pen->selections;++context->brush->selections;return Value::integer(handles.add(context,HandleKind::DC,true));}
  }
  if(library=="gdi32") {
    ensureApplication();
    if(name=="getstockobject"){auto object=stock(*this,int(n(0)));return object?Value::integer(object->handle):bad(rt,87);}
    if(name=="createpen"||name=="createsolidbrush"){auto object=std::make_shared<GdiObject>(name=="createpen"?HandleKind::Pen:HandleKind::Brush);if(name=="createpen"){object->style=int(n(0));object->width=n(1);object->color=i32(a(2).value);if(object->style<0||object->style>5||object->width<0||object->width>65535)return bad(rt,87);}else object->color=i32(a(0).value);object->handle=handles.add(object,object->kind,true);return Value::integer(object->handle);}
    if(name=="deleteobject"){auto object=std::dynamic_pointer_cast<GdiObject>(handles.find(i32(a(0).value)));if(!object||object->stock||object->selections)return bad(rt,6);handles.remove(object->handle);return Value::integer(1);}
    auto context=std::dynamic_pointer_cast<GtkDC>(handles.find(i32(a(0).value),HandleKind::DC));if(!context)return bad(rt,6);auto target=context->target.lock();if(!target||target->disposed)return bad(rt,6);
    if(name=="selectobject"){auto object=std::dynamic_pointer_cast<GdiObject>(handles.find(i32(a(1).value)));if(!object)return bad(rt,6);auto* slot=object->kind==HandleKind::Pen?&context->pen:object->kind==HandleKind::Brush?&context->brush:nullptr;if(!slot)return bad(rt,6);auto previous=*slot;if(previous)--previous->selections;*slot=object;++object->selections;return Value::integer(previous?previous->handle:0);}
    if(name=="settextcolor"||name=="setbkcolor"){auto& field=name=="settextcolor"?context->textColor:context->backColor;auto previous=field;field=i32(a(1).value);return Value::integer(previous);}
    if(name=="setbkmode"){auto previous=context->backMode;auto next=n(1);if(next!=1&&next!=2)return bad(rt,87);context->backMode=int(next);return Value::integer(previous);}
    if(name=="movetoex"){if(a(3).value.type==Type::Record||a(3).value.type==Type::Array)writeInts(a(3),{int32_t(context->x),int32_t(context->y)});context->x=n(1);context->y=n(2);return Value::integer(1);}
    if(name=="lineto"){auto command=gtkDrawing(*target,"line");command.coordinates={context->x,context->y,double(n(1)),double(n(2))};context->x=n(1);context->y=n(2);if(context->pen){command.color=context->pen->color;command.style=context->pen->style;command.width=std::max(1.0,context->pen->width);}gtkAppendDrawing(*target,std::move(command));return Value::integer(1);}
    if(name=="rectangle"||name=="ellipse"){auto command=gtkDrawing(*target,name=="rectangle"?"rect":"ellipse");command.coordinates={double(n(1)),double(n(2)),double(n(3)),double(n(4))};if(context->brush&&context->brush->style!=5){command.fill=true;command.color=context->brush->color;gtkAppendDrawing(*target,command);}if(context->pen&&context->pen->style!=5){command.fill=false;command.color=context->pen->color;command.width=std::max(1.0,context->pen->width);command.style=context->pen->style;gtkAppendDrawing(*target,command);}return Value::integer(1);}
    if(name=="setpixel"){auto command=gtkDrawing(*target,"pixel");command.coordinates={double(n(1)),double(n(2))};command.color=i32(a(3).value);gtkAppendDrawing(*target,command);return Value::integer(command.color);}
    if(name=="textout"){auto command=gtkDrawing(*target,"text");command.coordinates={double(n(1)),double(n(2))};command.text=readText(a(3),wide,false,n(4));command.color=context->textColor;gtkAppendDrawing(*target,std::move(command));return Value::integer(1);}
  }
  fail(453,"No native Linux API adapter for "+raw);
}
}
