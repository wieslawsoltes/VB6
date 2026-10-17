// AppKit application lifetime, windows, event routing and platform services. MIT.
#include "appkit.hpp"
#include "appkit-pictures.hpp"
#include "appkit-appearance.hpp"
#include <spawn.h>
#include <cstring>
#include <cerrno>
#include <sys/wait.h>
#include <unistd.h>
#include <thread>
extern char** environ;

namespace vb6 {
namespace {
int16_t modifiers(NSEvent*event){auto f=event.modifierFlags;return int16_t(((f&NSEventModifierFlagShift)?1:0)|((f&(NSEventModifierFlagControl|NSEventModifierFlagCommand))?2:0)|((f&NSEventModifierFlagOption)?4:0));}
int16_t virtualKey(NSEvent*event){
  static const std::map<unsigned short,int16_t>special={{36,13},{48,9},{49,32},{51,8},{53,27},{71,144},{76,13},{114,45},{115,36},{116,33},{117,46},{119,35},{121,34},{123,37},{124,39},{125,40},{126,38},{122,112},{120,113},{99,114},{118,115},{96,116},{97,117},{98,118},{100,119},{101,120},{109,121},{103,122},{111,123}};
  if(auto it=special.find(event.keyCode);it!=special.end())return it->second;NSString*characters=event.charactersIgnoringModifiers.uppercaseString;if(characters.length){unichar c=[characters characterAtIndex:0];if(c<256)return int16_t(c);}return 0;
}
Args mouseArguments(MacControl&control,NSEvent*event){
  NSView*coordinates=control.appearanceContent?:control.view;
  NSPoint point=[coordinates convertPoint:event.locationInWindow fromView:nil];int16_t button=event.buttonNumber==0?1:event.buttonNumber==1?2:4;
  if(event.type==NSEventTypeMouseMoved)button=0;
  return {Arg(Value::integer(button,Type::Integer)),Arg(Value::integer(modifiers(event),Type::Integer)),Arg(Value::real(point.x/control.unit(-1,true)+control.number("scaleleft",0),Type::Single)),Arg(Value::real(point.y/control.unit(-1,false)+control.number("scaletop",0),Type::Single))};
}
void menuShortcut(NSMenuItem*item,const Text&shortcut){
  auto value=lower(toUTF8(shortcut));NSEventModifierFlags flags=0;
  if(value.find("ctrl")!=std::string::npos||value.find('^')!=std::string::npos)flags|=NSEventModifierFlagCommand;
  if(value.find("shift")!=std::string::npos)flags|=NSEventModifierFlagShift;if(value.find("alt")!=std::string::npos)flags|=NSEventModifierFlagOption;
  auto plus=value.find_last_of('+');auto key=plus==std::string::npos?value:value.substr(plus+1);if(!key.empty()&&key[0]=='^')key.erase(key.begin());
  if(key.size()>1&&key[0]=='f'){try{auto n=std::stoi(key.substr(1));if(n>=1&&n<=24){unichar c=unichar(NSF1FunctionKey+n-1);item.keyEquivalent=[NSString stringWithCharacters:&c length:1];item.keyEquivalentModifierMask=flags;return;}}catch(const std::exception&) {}}
  if(key.size()==1){item.keyEquivalent=ns(fromUTF8(key));item.keyEquivalentModifierMask=flags;}
}
std::vector<std::shared_ptr<MacControl>> formControls(const std::shared_ptr<Instance>&object){
  std::vector<std::shared_ptr<MacControl>>out;std::set<MacControl*>seen;
  auto add=[&](const ObjectPtr&entry){if(auto c=std::dynamic_pointer_cast<MacControl>(entry)){if(seen.insert(c.get()).second)out.push_back(c);}else if(auto array=std::dynamic_pointer_cast<MacControlArray>(entry))for(auto&child:array->elements)if(seen.insert(child.second.get()).second)out.push_back(child.second);};
  for(auto&spec:object->module->controls)if(auto it=object->controls.find(lower(spec.name));it!=object->controls.end())add(it->second);
  for(auto&spec:object->module->menus)if(auto it=object->controls.find(lower(spec.name));it!=object->controls.end())add(it->second);
  return out;
}
struct ControlsObject final:Object {
  std::weak_ptr<Instance>owner;explicit ControlsObject(std::shared_ptr<Instance>o):owner(o){}
  std::string className()const override{return "Controls";}
  std::vector<Value>enumerate(Runtime&)override{auto f=owner.lock();if(!f)fail(91);std::vector<Value>out;for(auto&c:formControls(f))out.push_back(Value::object(c));return out;}
  Value get(Runtime&rt,const std::string&raw)override{if(lower(raw)=="count")return Value::integer(enumerate(rt).size());fail(438);}
  Value invoke(Runtime&rt,const std::string&raw,Args args)override{auto f=owner.lock();if(!f)fail(91);auto name=lower(raw);if((name.empty()||name=="item")&&args.size()==1){if(args[0].value.type==Type::String){auto found=f->controls.find(lower(toUTF8(args[0].value.string())));if(found==f->controls.end())fail(9);return Value::object(found->second);}auto values=enumerate(rt);auto i=args[0].value.integral();if(i<0||size_t(i)>=values.size())fail(9);return values[size_t(i)];}if(args.empty())return get(rt,name);fail(438);}
};
struct HostObject final:Object {
  MacHost*host;std::string kind;HostObject(MacHost&h,std::string k):host(&h),kind(std::move(k)){}
  std::string className()const override{return kind;}
  std::vector<Value>enumerate(Runtime&)override{if(kind!="forms")fail(451);std::vector<Value>out;for(auto&entry:host->forms)out.push_back(Value::object(entry.second->owner));return out;}
  Value get(Runtime&rt,const std::string&raw)override{
    auto name=lower(raw);host->ensureApplication();
    if(kind=="forms"){if(name=="count")return Value::integer(host->forms.size());fail(438);}
    if(kind=="screen"){
      NSScreen*screen=NSApp.keyWindow.screen?:NSScreen.mainScreen;
      if(name=="width")return Value::integer(bankers(screen.frame.size.width*15));if(name=="height")return Value::integer(bankers(screen.frame.size.height*15));
      if(name=="twipsperpixelx"||name=="twipsperpixely")return Value::integer(15,Type::Integer);
      if(name=="activeform")for(auto&entry:host->forms)if(entry.second->window==NSApp.keyWindow)return Value::object(entry.second->owner);
      if(name=="activecontrol"){id responder=NSApp.keyWindow.firstResponder;auto c=[responder isKindOfClass:NSView.class]?host->controlForView((NSView*)responder):nullptr;return Value::object(c);}
      if(name=="activeform")return Value::object(nullptr);
      if(name=="fonts"){std::vector<Value>out;for(NSString*font in NSFontManager.sharedFontManager.availableFontFamilies)out.push_back(Value::string(text(font)));return arrayValue(out,0,"string");}
      if(name=="fontcount")return Value::integer(NSFontManager.sharedFontManager.availableFontFamilies.count);
      if(name=="mousepointer")return Value::integer(0,Type::Integer);
    }
    return Object::get(rt,raw);
  }
  void set(Runtime&,const std::string&raw,Value value,bool)override{
    if(kind=="screen"&&lower(raw)=="mousepointer"){auto n=value.integral();NSCursor*cursor=n==11?NSCursor.operationNotAllowedCursor:n==2?NSCursor.crosshairCursor:n==3?NSCursor.IBeamCursor:n==9?NSCursor.openHandCursor:NSCursor.arrowCursor;[cursor set];return;}fail(438);
  }
  Value invoke(Runtime&rt,const std::string&raw,Args args)override{
    auto name=lower(raw);host->ensureApplication();if(kind=="forms"&&(name.empty()||name=="item")){if(args.size()!=1)fail(450);auto values=enumerate(rt);auto n=args[0].value.integral();if(n<0||size_t(n)>=values.size())fail(9);return values[size_t(n)];}
    if(kind=="screen"&&name=="fonts"){if(args.size()!=1)fail(450);auto fonts=NSFontManager.sharedFontManager.availableFontFamilies;auto n=args[0].value.integral();if(n<0||size_t(n)>=fonts.count)fail(9);return Value::string(text(fonts[NSUInteger(n)]));}
    if(kind=="clipboard"){
      auto clipboard=NSPasteboard.generalPasteboard;
      if(name=="clear"){[clipboard clearContents];return {};}
      if(name=="settext"){if(args.empty()||args.size()>2)fail(450);if(integerArgument(args,1,1)!=1)fail(5);[clipboard clearContents];if(![clipboard setString:ns(args[0].value.string()) forType:NSPasteboardTypeString])fail(5);return {};}
      if(name=="gettext"){if(integerArgument(args,0,1)!=1)fail(5);return Value::string(text([clipboard stringForType:NSPasteboardTypeString]));}
      if(name=="getformat"){auto format=integerArgument(args,0,1);if(format==1)return Value::boolean([clipboard availableTypeFromArray:@[NSPasteboardTypeString]]!=nil);if(format==2||format==8)return Value::boolean([clipboard canReadObjectForClasses:@[NSImage.class]options:@{}]);return Value::boolean(false);}
      if(name=="setdata"){auto image=std::dynamic_pointer_cast<MacImage>(argument(args,0).asObject());if(!image||!image->image)fail(5);auto format=integerArgument(args,1,2);if(format!=2&&format!=8)fail(5);[clipboard clearContents];if(![clipboard writeObjects:@[image->image]])fail(5);return {};}
      if(name=="getdata"){auto format=integerArgument(args,0,2);if(format!=2&&format!=8)fail(5);NSArray*images=[clipboard readObjectsForClasses:@[NSImage.class] options:@{}];if(!images.count)return Value::object(nullptr);auto image=std::make_shared<MacImage>(images.firstObject);image->handle=host->handles.add(image,HandleKind::Image);return Value::object(image);}
    }
    if(args.empty())return get(rt,name);fail(438);
  }
};
std::vector<std::string> commandArguments(const Text&input){
  auto source=toUTF8(input);if(source.find('\0')!=std::string::npos||source.size()>32768)fail(5);std::vector<std::string>out;std::string value;bool quoted=false,active=false;
  for(size_t i=0;i<source.size();i++){char ch=source[i];if(ch=='"'){quoted=!quoted;active=true;}else if((ch==' '||ch=='\t')&&!quoted){if(active){out.push_back(value);value.clear();active=false;}}else if(ch=='\\'&&i+1<source.size()&&source[i+1]=='"'){value+='"';i++;active=true;}else{value+=ch;active=true;}}
  if(quoted)fail(5,"Unterminated command argument");if(active)out.push_back(value);if(out.empty()||out[0].empty())fail(5);return out;
}
NSMutableDictionary*settingsRoot(){NSDictionary*value=[NSUserDefaults.standardUserDefaults dictionaryForKey:@"VB6NativeSettings"];return value?[value mutableCopy]:[NSMutableDictionary dictionary];}
NSString*settingName(Value value){auto name=value.string();if(name.empty()||name.find(u'\0')!=Text::npos)fail(5);return ns(changeCase(name,false));}
}
void MacHost::attach(Runtime&rt){runtime=&rt;}
void MacHost::ensureApplication(){
  if(!NSThread.isMainThread)fail(5,"AppKit must be accessed on the main thread");if(initialized)return;
  [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];applicationDelegate=[VB6ApplicationDelegate new];applicationDelegate->host=this;NSApp.delegate=applicationDelegate;
  auto menu=[NSMenu new];auto root=[[NSMenuItem alloc]initWithTitle:@"" action:nil keyEquivalent:@""];auto app=[NSMenu new];
  auto quit=[[NSMenuItem alloc]initWithTitle:[@"Quit " stringByAppendingString:ns(fromUTF8(runtime->name))]action:@selector(terminate:)keyEquivalent:@"q"];[app addItem:quit];root.submenu=app;[menu addItem:root];NSApp.mainMenu=menu;
  initialized=true;MacHost*pointer=this;
  auto mask=NSEventMaskKeyDown|NSEventMaskKeyUp|NSEventMaskLeftMouseDown|NSEventMaskLeftMouseUp|NSEventMaskRightMouseDown|NSEventMaskRightMouseUp|NSEventMaskOtherMouseDown|NSEventMaskOtherMouseUp|NSEventMaskMouseMoved|NSEventMaskLeftMouseDragged|NSEventMaskRightMouseDragged|NSEventMaskOtherMouseDragged;
  monitor=[NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent*(NSEvent*input){NSEvent*output=input;pointer->event([&]{output=pointer->routeEvent(input);});return pointer->pending?nil:output;}];
  [NSApp finishLaunching];
}
void MacHost::event(const std::function<void()>&function){if(closing||pending)return;try{function();}catch(...){pending=std::current_exception();stopLoop();}}
void MacHost::check(){if(pending){auto error=pending;pending=nullptr;std::rethrow_exception(error);}}
void MacHost::stopLoop(){if(!initialized)return;[NSApp abortModal];[NSApp stop:nil];auto event=[NSEvent otherEventWithType:NSEventTypeApplicationDefined location:NSZeroPoint modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:0 context:nil subtype:0 data1:0 data2:0];[NSApp postEvent:event atStart:NO];}
std::shared_ptr<MacForm> MacHost::form(const std::shared_ptr<Instance>&object)const{auto it=forms.find(object.get());if(it==forms.end())fail(91,"Form is not loaded");return it->second;}
std::shared_ptr<MacControl> MacHost::control(int32_t handle)const{return std::dynamic_pointer_cast<MacControl>(handles.find(handle));}
std::shared_ptr<MacControl>MacHost::controlForView(NSView*view)const{
  if(!view)return nullptr;
  if([view isKindOfClass:NSTextView.class]&&((NSTextView*)view).isFieldEditor){id delegate=((NSTextView*)view).delegate;if([delegate isKindOfClass:NSView.class])view=(NSView*)delegate;}
  for(NSView*current=view;current;current=current.superview)for(auto&entry:forms){auto f=entry.second;if(current==f->surface->view)return f->surface;for(auto&c:formControls(f->owner))if(current==c->widget||current==c->view)return c;}
  return nullptr;
}
std::shared_ptr<MacControl>MacHost::createControl(const std::shared_ptr<Instance>&object,ControlSpec spec,bool){
  auto result=std::make_shared<MacControl>(*this,object,std::move(spec));result->initialize();auto parent=form(object)->surface;
  if(!result->spec.parent.empty()){
    auto found=object->controls.find(lower(result->spec.parent));if(found==object->controls.end())fail(5,"Native parent was not created: "+result->spec.parent);
    parent=std::dynamic_pointer_cast<MacControl>(found->second);if(!parent){auto array=std::dynamic_pointer_cast<MacControlArray>(found->second);if(array&&!array->elements.empty())parent=array->elements.begin()->second;}if(!parent)fail(424);
  }
  if(result->view){NSView*container=parent->container();if(!container)fail(5,"Parent does not contain native views");[container addSubview:result->view];result->originalParentSize=container.bounds.size;result->originalFrame=result->view.frame;}
  return result;
}
void MacHost::createForm(const std::shared_ptr<Instance>&object){
  ensureApplication();if(forms.count(object.get()))return;if(!object->module->form)fail(5,"Form model is missing");auto result=std::make_shared<MacForm>();result->owner=object;forms[object.get()]=result;
  try{
    auto surface=std::make_shared<MacControl>(*this,object,*object->module->form);result->surface=surface;surface->initialize();
    double width=surface->number("clientwidth",9000)/15,height=surface->number("clientheight",6000)/15;if(width<0||height<0||width>20000||height>20000)fail(380);
    auto border=surface->number("borderstyle",2);NSWindowStyleMask style=border==0?NSWindowStyleMaskBorderless:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable;
    if(border==2||border==5)style|=NSWindowStyleMaskResizable;if(surface->flag("minbutton",true))style|=NSWindowStyleMaskMiniaturizable;
    result->window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,width,height)styleMask:style backing:NSBackingStoreBuffered defer:NO];result->window.releasedWhenClosed=NO;result->window.contentView=surface->view;surface->view.frame=NSMakeRect(0,0,width,height);surface->view.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    result->window.title=ns(surface->property("caption",Value::string(fromUTF8(object->module->name))).string());result->window.backgroundColor=color(int64_t(surface->number("backcolor",0xffffff)));result->window.acceptsMouseMovedEvents=YES;refreshNativePictures(*surface);
    layoutNativeAppearance(*surface);applyNativeAppearance(*surface);
    result->delegate=[VB6WindowDelegate new];result->delegate->host=this;result->delegate->model=result;result->window.delegate=result->delegate;
    result->originalSize=surface->view.bounds.size;double left=surface->number("left",300)/15,top=surface->number("top",300)/15;NSRect frame=result->window.frame;frame.origin=NSMakePoint(left,NSMaxY(NSScreen.mainScreen.frame)-top-frame.size.height);[result->window setFrame:frame display:NO];
    if(surface->number("startupposition",2)!=0)[result->window center];
    std::vector<ControlSpec>remaining=object->module->controls;remaining.insert(remaining.end(),object->module->menus.begin(),object->module->menus.end());
    while(!remaining.empty()){
      bool progress=false;for(auto it=remaining.begin();it!=remaining.end();){if(!it->parent.empty()&&!object->controls.count(lower(it->parent))){++it;continue;}
        auto spec=*it;auto c=createControl(object,spec);auto name=lower(spec.name);
        if(spec.index<0)object->controls[name]=c;else{
          std::shared_ptr<MacControlArray>array;if(auto found=object->controls.find(name);found!=object->controls.end())array=std::dynamic_pointer_cast<MacControlArray>(found->second);
          if(!array){array=std::make_shared<MacControlArray>();array->host=this;array->owner=object;array->prototype=spec;object->controls[name]=array;}
          array->elements[spec.index]=c;array->designElements.insert(spec.index);
        }
        it=remaining.erase(it);progress=true;
      }if(!progress)fail(5,"Native control hierarchy contains an unresolved parent");
    }
    rebuildMenus(result);
    auto controls=formControls(object);std::stable_sort(controls.begin(),controls.end(),[](auto&a,auto&b){return a->number("tabindex",0)<b->number("tabindex",0);});NSView*first=nil,*previous=nil;for(auto&c:controls)if(c->view&&c->flag("tabstop",true)&&c->flag("enabled",true)){if(!first)first=c->widget;if(previous)previous.nextKeyView=c->widget;previous=c->widget;}if(previous)previous.nextKeyView=first;result->window.initialFirstResponder=first;
  }catch(...){auto found=forms.find(object.get());if(found!=forms.end()){found->second->window.delegate=nil;[found->second->window close];if(found->second->surface)found->second->surface->dispose();forms.erase(found);}for(auto&c:formControls(object))c->dispose();object->controls.clear();throw;}
}
Value MacHost::formGet(const std::shared_ptr<Instance>&object,const std::string&raw){
  auto f=form(object);auto name=lower(raw);if(name=="controls")return Value::object(std::make_shared<ControlsObject>(object));
  if(name=="caption")return Value::string(text(f->window.title));if(name=="visible")return Value::boolean(f->window.visible);if(name=="enabled")return Value::boolean(f->enabled);
  if(name=="width")return Value::real(f->window.frame.size.width*15,Type::Single);if(name=="height")return Value::real(f->window.frame.size.height*15,Type::Single);
  if(name=="left")return Value::real(f->window.frame.origin.x*15,Type::Single);if(name=="top")return Value::real((NSMaxY(NSScreen.mainScreen.frame)-NSMaxY(f->window.frame))*15,Type::Single);
  if(name=="clientwidth")return Value::real(f->surface->view.bounds.size.width*15,Type::Single);if(name=="clientheight")return Value::real(f->surface->view.bounds.size.height*15,Type::Single);
  if(name=="windowstate")return Value::integer(f->window.miniaturized?1:f->window.zoomed?2:0,Type::Integer);
  if(name=="activecontrol"){id responder=f->window.firstResponder;auto c=[responder isKindOfClass:NSView.class]?controlForView((NSView*)responder):nullptr;return Value::object(c==f->surface?nullptr:c);}
  return f->surface->get(*runtime,name);
}
void MacHost::formSet(const std::shared_ptr<Instance>&object,const std::string&raw,Value value){
  auto f=form(object);auto name=lower(raw);
  if(name=="caption"){f->window.title=ns(value.string());f->surface->properties[name]=coerce(value,"string");return;}
  if(name=="visible"){formCall(object,value.truth()?"show":"hide",{});return;}
  if(name=="enabled"){f->enabled=value.truth();f->surface->properties[name]=Value::boolean(f->enabled);f->window.ignoresMouseEvents=!f->enabled;return;}
  if(name=="windowstate"){auto n=value.integral();if(n<0||n>2)fail(380);if(n==1)[f->window miniaturize:nil];else{if(f->window.miniaturized)[f->window deminiaturize:nil];if((n==2)!=bool(f->window.zoomed))[f->window zoom:nil];}return;}
  if(name=="left"||name=="top"||name=="width"||name=="height"){
    double n=value.floating()/15;if(!std::isfinite(n)||std::abs(n)>20000||(name=="width"||name=="height")&&n<0)fail(380);auto frame=f->window.frame;
    if(name=="left")frame.origin.x=n;else if(name=="top")frame.origin.y=NSMaxY(NSScreen.mainScreen.frame)-n-frame.size.height;else if(name=="width")frame.size.width=n;else{frame.origin.y+=frame.size.height-n;frame.size.height=n;}[f->window setFrame:frame display:YES];return;
  }
  if(name=="clientwidth"||name=="clientheight"){auto n=value.floating()/15;if(n<0||n>20000)fail(380);auto size=f->surface->view.bounds.size;if(name=="clientwidth")size.width=n;else size.height=n;[f->window setContentSize:size];return;}
  if(name=="backcolor")f->window.backgroundColor=color(value.integral());
  f->surface->set(*runtime,name,value);
}
Value MacHost::formCall(const std::shared_ptr<Instance>&object,const std::string&raw,Args args){
  auto f=form(object);auto name=lower(raw);
  if(name=="__unload"){
    f->closing=true;cancelWindowTimers(f->surface->handle);if(f->modal){[NSApp stopModal];f->modal=false;}f->window.delegate=nil;for(auto&c:formControls(object))c->dispose();f->surface->dispose();[f->window orderOut:nil];[f->window close];forms.erase(object.get());if(forms.empty())stopLoop();return {};
  }
  if(name=="show"){
    auto modal=integerArgument(args,0,0);if(modal!=0&&modal!=1)fail(5);if(args.size()>2)fail(450);
    if(args.size()>1&&args[1].value.type==Type::Object&&std::get<ObjectPtr>(args[1].value.payload)){
      auto parent=std::dynamic_pointer_cast<Instance>(args[1].value.asObject());if(!parent)fail(424);runtime->load(parent);[form(parent)->window addChildWindow:f->window ordered:NSWindowAbove];
    }
    f->surface->properties["visible"]=Value::boolean(true);f->surface->view.hidden=NO;[f->window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
    if(modal&&!f->modal){f->modal=true;[NSApp runModalForWindow:f->window];f->modal=false;check();}return {};
  }
  if(name=="hide"){[f->window orderOut:nil];f->surface->properties["visible"]=Value::boolean(false);if(f->modal){[NSApp stopModal];f->modal=false;}return {};}
  if(name=="move"){const char*names[]={"left","top","width","height"};if(args.size()<2||args.size()>4)fail(450);for(size_t i=0;i<args.size();i++)if(args[i].value.type!=Type::Missing)formSet(object,names[i],args[i].value);return {};}
  if(name=="setfocus"){[f->window makeKeyAndOrderFront:nil];return {};}
  if(name=="zorder"){if(integerArgument(args,0,0)==0)[f->window orderFront:nil];else [f->window orderBack:nil];return {};}
  if(name=="popupmenu"){
    auto c=std::dynamic_pointer_cast<MacControl>(argument(args,0).asObject());if(!c||!c->menu)fail(424);NSMenu*menu=c->menu.submenu;if(!menu)fail(5,"PopupMenu needs child menu items");auto point=[f->surface->view convertPoint:f->window.mouseLocationOutsideOfEventStream fromView:nil];if(args.size()>2&&args[2].value.type!=Type::Missing)point.x=args[2].value.floating()*f->surface->unit(-1,true);if(args.size()>3&&args[3].value.type!=Type::Missing)point.y=args[3].value.floating()*f->surface->unit(-1,false);[menu popUpMenuPositioningItem:nil atLocation:point inView:f->surface->view];return {};
  }
  if(name=="printform"){auto operation=[NSPrintOperation printOperationWithView:f->surface->view];if(![operation runOperation])return Value::boolean(false);return Value::boolean(true);}
  return f->surface->invoke(*runtime,name,args);
}
void MacHost::rebuildMenus(const std::shared_ptr<MacForm>&f){
  auto menu=[NSMenu new];menu.autoenablesItems=NO;
  if(NSApp.mainMenu.numberOfItems>0)[menu addItem:[NSApp.mainMenu.itemArray.firstObject copy]];
  auto controls=formControls(f->owner);for(auto&c:controls)if(c->menu){if(c->menu.menu)[c->menu.menu removeItem:c->menu];if(c->spec.parent.empty())[menu addItem:c->menu];else{
      auto found=f->owner->controls.find(lower(c->spec.parent));auto parent=found==f->owner->controls.end()?nullptr:std::dynamic_pointer_cast<MacControl>(found->second);if(!parent||!parent->menu)fail(5,"Menu parent is not a menu");if(!parent->menu.submenu){parent->menu.submenu=[NSMenu new];parent->menu.submenu.autoenablesItems=NO;}[parent->menu.submenu addItem:c->menu];
    }menuShortcut(c->menu,c->property("shortcut",Value::string(u"")).string());}
  f->menu=menu;if(NSApp.keyWindow==f->window||forms.size()==1)NSApp.mainMenu=menu;
}
void MacHost::resize(const std::shared_ptr<MacForm>&f){
  if(f->closing)return;for(auto&c:formControls(f->owner))if(c->view){
    NSView*parent=c->view.superview;if(!parent)continue;auto size=parent.bounds.size,base=c->originalParentSize;auto rect=c->originalFrame;int anchor=int(c->number("anchor",5)),dock=int(c->number("dock",0));
    if(dock==0){double dx=size.width-base.width,dy=size.height-base.height;if((anchor&3)==3)rect.size.width=std::max(0.0,rect.size.width+dx);else if(anchor&2)rect.origin.x+=dx;else if(!(anchor&1))rect.origin.x+=dx/2;if((anchor&12)==12)rect.size.height=std::max(0.0,rect.size.height+dy);else if(anchor&8)rect.origin.y+=dy;else if(!(anchor&4))rect.origin.y+=dy/2;}
    else if(dock==1){rect.origin=NSZeroPoint;rect.size.width=size.width;}else if(dock==2){rect.origin=NSMakePoint(0,size.height-rect.size.height);rect.size.width=size.width;}else if(dock==3){rect.origin=NSZeroPoint;rect.size.height=size.height;}else if(dock==4){rect.origin=NSMakePoint(size.width-rect.size.width,0);rect.size.height=size.height;}else if(dock==5)rect=NSMakeRect(0,0,size.width,size.height);
    c->view.frame=rect;c->properties["left"]=Value::real(rect.origin.x*15);c->properties["top"]=Value::real(rect.origin.y*15);c->properties["width"]=Value::real(rect.size.width*15);c->properties["height"]=Value::real(rect.size.height*15);
  }
  f->surface->event("resize");
}
void MacHost::activate(const std::shared_ptr<MacForm>&f,bool active){if(f->closing)return;if(active&&f->menu)NSApp.mainMenu=f->menu;f->surface->event(active?"activate":"deactivate");}
bool MacHost::closeForm(const std::shared_ptr<MacForm>&f){if(f->closing)return true;runtime->unload(f->owner,0);return !forms.count(f->owner.get());}
bool MacHost::terminate(){std::vector<std::shared_ptr<MacForm>>copy;for(auto&entry:forms)copy.push_back(entry.second);for(auto&f:copy){runtime->unload(f->owner,1);if(forms.count(f->owner.get()))return false;}stopLoop();return true;}
NSEvent*MacHost::routeEvent(NSEvent*input){
  std::shared_ptr<MacForm>f;for(auto&entry:forms)if(entry.second->window==input.window){f=entry.second;break;}if(!f)return input;if(!f->enabled)return nil;
  bool key=input.type==NSEventTypeKeyDown||input.type==NSEventTypeKeyUp;std::shared_ptr<MacControl>c;
  if(key){id responder=f->window.firstResponder;if([responder isKindOfClass:NSView.class])c=controlForView((NSView*)responder);}
  else{NSPoint point=[f->surface->view convertPoint:input.locationInWindow fromView:nil];c=controlForView([f->surface->view hitTest:point]);}
  if(!c)c=f->surface;if(!c->flag("enabled",true))return nil;
  if(key){
    auto code=std::make_shared<Cell>(Value::integer(virtualKey(input),Type::Integer),"integer");Args args={Arg(cellRef(code)),Arg(Value::integer(modifiers(input),Type::Integer))};
    if(f->surface->flag("keypreview")&&c!=f->surface)f->surface->event(input.type==NSEventTypeKeyDown?"keydown":"keyup",args);
    if(code->get().integral()!=0)c->event(input.type==NSEventTypeKeyDown?"keydown":"keyup",args);if(code->get().integral()==0)return nil;
    if(input.type==NSEventTypeKeyDown&&input.characters.length){auto chars=text(input.characters);auto ascii=std::make_shared<Cell>(Value::integer(int16_t(chars[0]),Type::Integer),"integer");Args pressed{Arg(cellRef(ascii))};if(f->surface->flag("keypreview")&&c!=f->surface)f->surface->event("keypress",pressed);if(ascii->get().integral()!=0)c->event("keypress",pressed);if(ascii->get().integral()==0)return nil;if(char16_t(ascii->get().integral())!=chars[0]){chars[0]=char16_t(ascii->get().integral());return [NSEvent keyEventWithType:input.type location:input.locationInWindow modifierFlags:input.modifierFlags timestamp:input.timestamp windowNumber:input.windowNumber context:nil characters:ns(chars) charactersIgnoringModifiers:ns(chars) isARepeat:input.isARepeat keyCode:input.keyCode];}}
    return input;
  }
  auto type=input.type;bool down=type==NSEventTypeLeftMouseDown||type==NSEventTypeRightMouseDown||type==NSEventTypeOtherMouseDown,up=type==NSEventTypeLeftMouseUp||type==NSEventTypeRightMouseUp||type==NSEventTypeOtherMouseUp;
  if(c->number("mousepointer",0)==99)updateNativeCursor(*c);
  c->event(down?"mousedown":up?"mouseup":"mousemove",mouseArguments(*c,input));
  if(up&&![c->widget isKindOfClass:NSControl.class]&&![c->widget isKindOfClass:NSTextView.class])c->event(input.clickCount>1?"dblclick":"click");return input;
}
Value MacHost::createObject(Runtime&,const std::string&raw){
  auto name=lower(raw);if(name=="screen"||name=="clipboard"||name=="forms")return Value::object(std::make_shared<HostObject>(*this,name));
  if(name=="printer"||name=="printers")return createNativePrinter(*this,name);
  if(name=="stdpicture"||name=="stdole.stdpicture")return Value::object(std::make_shared<MacImage>(nil));
  if(name=="stdfont"||name=="stdole.stdfont")return createNativeFont();
  fail(429,"No native macOS object factory for "+raw);
}
Value MacHost::appProperty(Runtime&rt,const std::string&raw){
  auto name=lower(raw);if(name=="previnstance"){NSString*identifier=NSBundle.mainBundle.bundleIdentifier;return Value::boolean(identifier&&[NSRunningApplication runningApplicationsWithBundleIdentifier:identifier].count>1);}
  if(name=="taskvisible")return Value::boolean(true);if(name=="startmode")return Value::integer(0,Type::Integer);if(name=="nonmodalallowed")return Value::boolean(true);
  if(name=="hinstance")return api(rt,"kernel32.GetModuleHandle",{Arg(Value::integer(0))});fail(438);
}
Value MacHost::messageBox(const Text&prompt,int64_t flags,const Text&title){
  ensureApplication();auto alert=[NSAlert new];alert.messageText=ns(title.empty()?fromUTF8(runtime->name):title);alert.informativeText=ns(prompt);
  auto icon=flags&0xf0;alert.alertStyle=icon==16?NSAlertStyleCritical:icon==48?NSAlertStyleWarning:NSAlertStyleInformational;
  std::vector<std::pair<NSString*,int>>buttons;
  switch(flags&15){case 0:buttons={{@"OK",1}};break;case 1:buttons={{@"OK",1},{@"Cancel",2}};break;case 2:buttons={{@"Abort",3},{@"Retry",4},{@"Ignore",5}};break;case 3:buttons={{@"Yes",6},{@"No",7},{@"Cancel",2}};break;case 4:buttons={{@"Yes",6},{@"No",7}};break;case 5:buttons={{@"Retry",4},{@"Cancel",2}};break;default:fail(5,"Invalid MsgBox button style");}
  for(auto&button:buttons)[alert addButtonWithTitle:button.first];size_t defaultIndex=size_t((flags>>8)&3);if(defaultIndex>=buttons.size())defaultIndex=0;for(size_t i=0;i<buttons.size();i++)alert.buttons[i].keyEquivalent=i==defaultIndex?@"\r":buttons[i].second==2?@"\033":@"";
  auto result=[alert runModal]-NSAlertFirstButtonReturn;check();return Value::integer(result>=0&&size_t(result)<buttons.size()?buttons[size_t(result)].second:2,Type::Integer);
}
Value MacHost::inputBox(const Text&prompt,const Text&title,const Text&initial){
  ensureApplication();auto alert=[NSAlert new];alert.messageText=ns(title.empty()?fromUTF8(runtime->name):title);alert.informativeText=ns(prompt);[alert addButtonWithTitle:@"OK"];[alert addButtonWithTitle:@"Cancel"];
  auto field=[[NSTextField alloc]initWithFrame:NSMakeRect(0,0,320,24)];field.stringValue=ns(initial);alert.accessoryView=field;alert.window.initialFirstResponder=field;auto response=[alert runModal];check();return Value::string(response==NSAlertFirstButtonReturn?text(field.stringValue):Text());
}
Value MacHost::builtin(Frame&frame,const std::string&raw,Args args){
  auto name=lower(raw);
  if(name=="msgbox")return messageBox(stringArgument(args,0),integerArgument(args,1,0),stringArgument(args,2,fromUTF8(runtime->name)));
  if(name=="inputbox")return inputBox(stringArgument(args,0),stringArgument(args,1,fromUTF8(runtime->name)),stringArgument(args,2));
  if(name=="beep"){ensureApplication();NSBeep();return {};}
  if(name=="shell"){
    auto arguments=commandArguments(stringArgument(args,0));std::vector<char*>pointers;for(auto&value:arguments)pointers.push_back(value.data());pointers.push_back(nullptr);pid_t pid=0;int result=posix_spawnp(&pid,pointers[0],nullptr,nullptr,pointers.data(),environ);if(result)fail(result==ENOENT?53:result==EACCES?70:5,std::strerror(result));
    std::thread([pid]{int status;while(waitpid(pid,&status,0)<0&&errno==EINTR){}}).detach();return Value::real(double(pid));
  }
  if(name=="loadpicture"){
    auto path=stringArgument(args,0);if(path.empty())return Value::object(std::make_shared<MacImage>(nil));
    if(path.find(u'\0')!=Text::npos)fail(52);return loadNativeImage(*this,readNativeResourceFile(std::filesystem::path(toUTF8(path))));
  }
  if(name=="loadrespicture"){
    const auto format=integerArgument(args,1,0);if(format<0||format>2)fail(5,"Invalid resource picture format");
    return loadNativeImage(*this,nativeResources(*runtime).picture(argument(args,0),int(format)));
  }
  if(name=="savepicture"){
    auto image=std::dynamic_pointer_cast<MacImage>(argument(args,0).asObject());if(!image||!image->image)fail(5);auto path=stringArgument(args,1);if(path.find(u'\0')!=Text::npos)fail(52);auto extension=lower(std::filesystem::path(toUTF8(path)).extension().string());NSBitmapImageFileType type=extension==".jpg"||extension==".jpeg"?NSBitmapImageFileTypeJPEG:extension==".bmp"?NSBitmapImageFileTypeBMP:extension==".gif"?NSBitmapImageFileTypeGIF:extension==".tiff"||extension==".tif"?NSBitmapImageFileTypeTIFF:NSBitmapImageFileTypePNG;
    NSData*data=nil;
    if(image->pictureType==3&&!image->encoded.empty()){
      // Preserve the complete validated directory, payloads and per-frame hotspots.
      const auto& bytes=image->encoded;
      data=[NSData dataWithBytes:bytes.data() length:bytes.size()];
    }else {NSBitmapImageRep*rep=[NSBitmapImageRep imageRepWithData:image->image.TIFFRepresentation];data=[rep representationUsingType:type properties:@{}];}NSError*error=nil;if(!data||![data writeToFile:ns(path) options:NSDataWritingAtomic error:&error])fail(75,error?toUTF8(text(error.localizedDescription)):"Picture encoding failed");return {};
  }
  if(name=="savesetting"||name=="getsetting"||name=="deletesetting"||name=="getallsettings"){
    auto root=settingsRoot();NSString*app=settingName(argument(args,0)),*section=settingName(argument(args,1));NSMutableDictionary*application=[root[app]mutableCopy]?:[NSMutableDictionary dictionary];NSMutableDictionary*values=[application[section]mutableCopy]?:[NSMutableDictionary dictionary];
    if(name=="getallsettings"){if(!values.count)return {};auto array=std::make_shared<Array>("variant",Bounds{{0,int32_t(values.count)-1},{0,1}},true,runtime->maxArrayElements);size_t i=0;for(NSString*key in [values.allKeys sortedArrayUsingSelector:@selector(compare:)]){array->values[i]=Value::string(text(key));array->values[i+values.count]=Value::string(text(values[key]));++i;}return Value::array(array);}
    if(name=="deletesetting"){auto key=argument(args,2);if(key.type==Type::Missing){if(!application[section])fail(5);[application removeObjectForKey:section];}else{NSString*k=settingName(key);if(!values[k])fail(5);[values removeObjectForKey:k];application[section]=values;}root[app]=application;[NSUserDefaults.standardUserDefaults setObject:root forKey:@"VB6NativeSettings"];return {};}
    NSString*key=settingName(argument(args,2));if(name=="getsetting")return Value::string(values[key]?text(values[key]):stringArgument(args,3));
    values[key]=ns(stringArgument(args,3));application[section]=values;root[app]=application;[NSUserDefaults.standardUserDefaults setObject:root forKey:@"VB6NativeSettings"];return {};
  }
  return NativeHost::builtin(frame,raw,args);
}
Value MacHost::dialog(MacControl&control,const std::string&name){
  ensureApplication();if(name=="showopen"||name=="showsave"){
    NSSavePanel*panel=name=="showopen"?(NSSavePanel*)[NSOpenPanel openPanel]:[NSSavePanel savePanel];panel.title=ns(control.property("dialogtitle",Value::string(name=="showopen"?u"Open":u"Save")).string());panel.nameFieldStringValue=ns(control.property("filename",Value::string(u"")).string());auto directory=control.property("initdir",Value::string(u"")).string();if(!directory.empty())panel.directoryURL=[NSURL fileURLWithPath:ns(directory)];
    if(name=="showopen"){auto open=(NSOpenPanel*)panel;open.canChooseFiles=YES;open.canChooseDirectories=NO;open.allowsMultipleSelection=(int64_t(control.number("flags",0))&0x200)!=0;}
    auto response=[panel runModal];check();if(response!=NSModalResponseOK){if(control.flag("cancelerror"))fail(32755,"Dialog cancelled");return {};}
    Text filename=text(panel.URL.path);if(name=="showopen"&&((NSOpenPanel*)panel).allowsMultipleSelection&&((NSOpenPanel*)panel).URLs.count>1){auto urls=((NSOpenPanel*)panel).URLs;filename=text(((NSURL*)urls.firstObject).URLByDeletingLastPathComponent.path);for(NSURL*url in urls){filename+=u'\0';filename+=text(url.lastPathComponent);}}
    control.properties["filename"]=Value::string(filename);control.properties["filetitle"]=Value::string(text(panel.URL.lastPathComponent));return {};
  }
  if(name=="showprinter"){NSPrintInfo*info=[NSPrintInfo.sharedPrintInfo copy];auto result=[NSPrintPanel.printPanel runModalWithPrintInfo:info];check();if(result!=NSModalResponseOK&&control.flag("cancelerror"))fail(32755);return {};}
  if(name=="showcolor"){
    NSAlert*alert=[NSAlert new];alert.messageText=@"Color";[alert addButtonWithTitle:@"OK"];[alert addButtonWithTitle:@"Cancel"];
    NSColorWell*well=[[NSColorWell alloc]initWithFrame:NSMakeRect(0,0,240,80)];well.color=color(int64_t(control.number("color",0)));alert.accessoryView=well;
    auto result=[alert runModal];[well deactivate];[NSColorPanel.sharedColorPanel orderOut:nil];check();
    if(result!=NSAlertFirstButtonReturn){if(control.flag("cancelerror"))fail(32755,"Dialog cancelled");return {};}
    control.properties["color"]=Value::integer(colorValue(well.color));return {};
  }
  if(name=="showfont"){
    NSAlert*alert=[NSAlert new];alert.messageText=@"Font";[alert addButtonWithTitle:@"OK"];[alert addButtonWithTitle:@"Cancel"];
    NSView*view=[[NSView alloc]initWithFrame:NSMakeRect(0,0,340,112)];NSComboBox*family=[[NSComboBox alloc]initWithFrame:NSMakeRect(0,78,340,26)];
    [family addItemsWithObjectValues:[NSFontManager.sharedFontManager.availableFontFamilies sortedArrayUsingSelector:@selector(localizedCaseInsensitiveCompare:)]];family.stringValue=ns(control.property("fontname",Value::string(u"Helvetica")).string());[view addSubview:family];
    NSTextField*size=[[NSTextField alloc]initWithFrame:NSMakeRect(0,42,80,24)];size.doubleValue=control.number("fontsize",8.25);[view addSubview:size];
    NSButton*bold=[NSButton checkboxWithTitle:@"Bold" target:nil action:nil];bold.frame=NSMakeRect(96,42,100,24);bold.state=control.flag("fontbold")?NSControlStateValueOn:NSControlStateValueOff;[view addSubview:bold];
    NSButton*italic=[NSButton checkboxWithTitle:@"Italic" target:nil action:nil];italic.frame=NSMakeRect(220,42,100,24);italic.state=control.flag("fontitalic")?NSControlStateValueOn:NSControlStateValueOff;[view addSubview:italic];
    NSButton*underline=[NSButton checkboxWithTitle:@"Underline" target:nil action:nil];underline.frame=NSMakeRect(0,6,150,24);underline.state=control.flag("fontunderline")?NSControlStateValueOn:NSControlStateValueOff;[view addSubview:underline];
    NSButton*strike=[NSButton checkboxWithTitle:@"Strikethrough" target:nil action:nil];strike.frame=NSMakeRect(170,6,160,24);strike.state=control.flag("fontstrikethru")?NSControlStateValueOn:NSControlStateValueOff;[view addSubview:strike];alert.accessoryView=view;
    auto result=[alert runModal];check();if(result!=NSAlertFirstButtonReturn){if(control.flag("cancelerror"))fail(32755,"Dialog cancelled");return {};}
    double points=size.doubleValue;if(!std::isfinite(points)||points<=0||points>512||![NSFont fontWithName:family.stringValue size:points*4/3])fail(380,"Invalid font or size");
    control.properties["fontname"]=Value::string(text(family.stringValue));control.properties["fontsize"]=Value::real(points);control.properties["fontbold"]=Value::boolean(bold.state==NSControlStateValueOn);control.properties["fontitalic"]=Value::boolean(italic.state==NSControlStateValueOn);control.properties["fontunderline"]=Value::boolean(underline.state==NSControlStateValueOn);control.properties["fontstrikethru"]=Value::boolean(strike.state==NSControlStateValueOn);return {};
  }
  fail(438);
}
int MacHost::run(Runtime&){if(!initialized)return 0;check();if(forms.empty())return 0;running=true;[NSApp run];running=false;check();return 0;}
void MacHost::pump(){if(!initialized)return;for(size_t i=0;i<1000;i++){auto event=[NSApp nextEventMatchingMask:NSEventMaskAny untilDate:NSDate.distantPast inMode:NSDefaultRunLoopMode dequeue:YES];if(!event)break;[NSApp sendEvent:event];check();} [NSApp updateWindows];check();}
void MacHost::shutdown(){
  if(closing)return;closing=true;life.reset();printer.reset();systemObjects.clear();for(auto&timer:apiTimers)[timer.second invalidate];apiTimers.clear();apiTimerOwners.clear();if(monitor){[NSEvent removeMonitor:monitor];monitor=nil;}
  for(auto&entry:forms){auto f=entry.second;f->window.delegate=nil;for(auto&c:formControls(f->owner))c->dispose();f->surface->dispose();[f->window close];f->owner->controls.clear();f->owner->loaded=false;}forms.clear();handles.clear();if(initialized){NSApp.delegate=nil;stopLoop();}applicationDelegate=nil;
}
std::unique_ptr<NativeHost>makeNativeHost(){return std::make_unique<MacHost>();}
} // namespace vb6

@implementation VB6WindowDelegate
-(BOOL)windowShouldClose:(NSWindow*)window{(void)window;if(auto f=model.lock())host->event([thisHost=host,f]{thisHost->closeForm(f);});return NO;}
-(void)windowDidResize:(NSNotification*)note{(void)note;if(auto f=model.lock())host->event([thisHost=host,f]{thisHost->resize(f);});}
-(void)windowDidChangeBackingProperties:(NSNotification*)note{
  (void)note;if(auto f=model.lock())host->event([thisHost=host,f]{
    if(f->window!=NSApp.keyWindow||f->closing)return;
    const auto point=[f->surface->view convertPoint:f->window.mouseLocationOutsideOfEventStream fromView:nil];
    if(!NSPointInRect(point,f->surface->view.bounds))return;
    auto control=thisHost->controlForView([f->surface->view hitTest:point]);
    if(control&&control->number("mousepointer",0)==99)updateNativeCursor(*control);
  });
}
-(void)windowDidBecomeKey:(NSNotification*)note{(void)note;if(auto f=model.lock())host->event([thisHost=host,f]{thisHost->activate(f,true);});}
-(void)windowDidResignKey:(NSNotification*)note{(void)note;if(auto f=model.lock())host->event([thisHost=host,f]{thisHost->activate(f,false);});}
@end
@implementation VB6ApplicationDelegate
-(NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication*)application{(void)application;host->event([thisHost=host]{thisHost->terminate();});return NSTerminateCancel;}
-(BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication*)sender{(void)sender;return NO;}
@end
