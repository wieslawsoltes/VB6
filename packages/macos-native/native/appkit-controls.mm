// Native AppKit widgets and the VB property/event boundary. MIT.
#include "appkit.hpp"
#include "appkit-pictures.hpp"
#include "appkit-edit.hpp"
#include "appkit-control-utils.hpp"
#include "appkit-appearance.hpp"
#include <cfloat>

namespace vb6 {
NSString* ns(const Text& value) {
  return [[NSString alloc] initWithCharacters:reinterpret_cast<const unichar*>(value.data()) length:value.size()];
}
Text text(NSString* value) {
  if(!value)return {};Text result([value length],u'\0');
  if(!result.empty())[value getCharacters:reinterpret_cast<unichar*>(result.data()) range:NSMakeRange(0,result.size())];
  return result;
}
NSColor* color(int64_t value) {
  const auto n=static_cast<uint32_t>(value);
  if(n&0x80000000u){
    switch(n&255u){
      case 0:return NSColor.scrollBarColor;case 1:return NSColor.windowBackgroundColor;
      case 2:case 9:return NSColor.windowFrameTextColor;case 3:return NSColor.disabledControlTextColor;
      case 4:return NSColor.controlBackgroundColor;case 5:return NSColor.textBackgroundColor;
      case 6:case 18:return NSColor.windowFrameColor;case 7:return NSColor.labelColor;
      case 8:return NSColor.textColor;case 10:case 11:case 12:return NSColor.separatorColor;
      case 13:return NSColor.selectedContentBackgroundColor;case 14:return NSColor.selectedTextColor;
      case 15:return NSColor.controlColor;case 16:return NSColor.shadowColor;case 17:return NSColor.disabledControlTextColor;
      case 20:return NSColor.highlightColor;case 21:return NSColor.darkGrayColor;
      case 22:return NSColor.lightGrayColor;case 23:return NSColor.textColor;case 24:return NSColor.controlBackgroundColor;
      default:return NSColor.controlColor;
    }
  }
  return [NSColor colorWithSRGBRed:(n&255)/255.0 green:((n>>8)&255)/255.0 blue:((n>>16)&255)/255.0 alpha:1];
}
int32_t colorValue(NSColor* value){
  NSColor*c=[value colorUsingColorSpace:NSColorSpace.sRGBColorSpace];if(!c)return 0;
  auto channel=[](CGFloat n){return uint32_t(std::lround(std::clamp(double(n),0.0,1.0)*255));};
  return int32_t(channel(c.redComponent)|(channel(c.greenComponent)<<8)|(channel(c.blueComponent)<<16));
}
Text captionText(const Text& value){Text out;for(size_t i=0;i<value.size();i++){if(value[i]==u'&'){if(i+1<value.size()&&value[i+1]==u'&')++i;else continue;}out.push_back(value[i]);}return out;}
Value MacImage::get(Runtime&,const std::string&raw){auto n=lower(raw);if(n=="handle")return Value::integer(handle);if(n=="type")return Value::integer(image?pictureType:0,Type::Integer);if(n=="width")return Value::integer(image?bankers(image.size.width*2540.0/96.0):0);if(n=="height")return Value::integer(image?bankers(image.size.height*2540.0/96.0):0);fail(438);}
Value MacControl::property(const std::string& name,Value fallback)const{auto it=properties.find(lower(name));return it==properties.end()?fallback:it->second;}
double MacControl::number(const std::string&name,double fallback)const{return property(name,Value::real(fallback)).floating();}
bool MacControl::flag(const std::string&name,bool fallback)const{return property(name,Value::boolean(fallback)).truth();}
std::shared_ptr<MacControl> MacControl::self(){return std::static_pointer_cast<MacControl>(shared_from_this());}
std::shared_ptr<MacForm> MacControl::form()const{auto object=owner.lock();if(!object)fail(91);return host->form(object);}
NSView* MacControl::container()const{if([widget isKindOfClass:NSBox.class])return [(NSBox*)widget contentView];if([widget isKindOfClass:NSTabView.class])return [(NSTabView*)widget selectedTabViewItem].view;return widget?:view;}
double MacControl::unit(int mode,bool horizontal)const{
  if(mode<0)mode=int(number("scalemode",1));
  switch(mode){case 1:return 1.0/15;case 2:return 96.0/72;case 3:return 1;case 4:return horizontal?8:16;case 5:return 96;case 6:return 96.0/25.4;case 7:return 96.0/2.54;case 0:{double size=horizontal?view.bounds.size.width:view.bounds.size.height,span=number(horizontal?"scalewidth":"scaleheight",size);if(span==0)fail(5);return size/span;}default:fail(380,"Unsupported ScaleMode");}
}
NSPoint MacControl::point(double x,double y)const{return NSMakePoint((x-number("scaleleft",0))*unit(-1,true),(y-number("scaletop",0))*unit(-1,false));}
std::string MacControl::defaultMember()const{
  const auto&t=spec.type;if(t=="TextBox"||t=="RichTextBox"||t=="ComboBox"||t=="ListBox")return "text";
  if(t=="Label"||t=="Frame"||t=="CommandButton"||t=="Form"||t=="MDIForm")return "caption";
  if(t=="FileListBox")return "filename";if(t=="DirListBox")return "path";if(t=="DriveListBox")return "drive";
  return "value";
}
void MacControl::applyFrame(){
  if(!view)return;double x=number("left",0)/15,y=number("top",0)/15,w=number("width",1800)/15,h=number("height",450)/15;
  if(!std::isfinite(x)||!std::isfinite(y)||!std::isfinite(w)||!std::isfinite(h)||w<0||h<0||std::max({std::abs(x),std::abs(y),w,h})>20000)fail(380,"Control geometry exceeds native limits");
  if(spec.type=="Form"||spec.type=="MDIForm")return;
  view.frame=NSMakeRect(x,y,w,h);
  layoutNativeAppearance(*this);
}
void MacControl::applyFont(){
  const auto name=property("fontname",Value::string(u"Helvetica")).string();double size=number("fontsize",8.25)*4.0/3.0;
  if(!std::isfinite(size)||size<1||size>4096)fail(380,"Invalid font size");
  NSFont*font=[NSFont fontWithName:ns(name) size:size]?:[NSFont systemFontOfSize:size];
  NSFontTraitMask traits=0;if(flag("fontbold"))traits|=NSBoldFontMask;if(flag("fontitalic"))traits|=NSItalicFontMask;
  if(traits)font=[NSFontManager.sharedFontManager convertFont:font toHaveTrait:traits];
  if([widget respondsToSelector:@selector(setFont:)])[(id)widget setFont:font];
  if(appearanceCaption)appearanceCaption.font=font;
  if([widget isKindOfClass:NSTableView.class]){auto table=(NSTableView*)widget;for(NSTableColumn*c in table.tableColumns)[(NSCell*)c.dataCell setFont:font];auto size=property("macoscontrolsize",Value::string(u"regular")).string();double preferred=size==u"mini"?16:size==u"small"?20:size==u"large"?32:size==u"extraLarge"?40:24;table.rowHeight=std::max(preferred,std::ceil(font.ascender-font.descender+5));}
  refreshNativePlaceholder(*this);
}
void MacControl::initialize(){
  if(initialized)return;initialized=true;for(auto&p:spec.properties)properties[lower(p.name)]=p.value;
  properties["name"]=Value::string(fromUTF8(spec.name));if(spec.index>=0)properties["index"]=Value::integer(spec.index,Type::Integer);
  validateNativeAppearance(*this);
  delegate=[VB6ControlDelegate new];delegate->model=self();
  initializeNativePictures(*this);
  const std::string&t=spec.type;
  if(t=="Menu"){
    auto caption=captionText(property("caption",Value::string(fromUTF8(spec.name))).string());
    menu=caption==u"-"?[NSMenuItem separatorItem]:[[NSMenuItem alloc] initWithTitle:ns(caption) action:@selector(action:) keyEquivalent:@""];
    menu.target=delegate;menu.enabled=flag("enabled",true);menu.hidden=!flag("visible",true);menu.state=flag("checked")?NSControlStateValueOn:NSControlStateValueOff;
    handle=host->handles.add(self(),HandleKind::Menu);return;
  }
  if(t=="Timer"||t=="CommonDialog"||t=="ImageList"){handle=host->handles.add(self(),HandleKind::Control);if(t=="Timer")timerChanged();if(t=="ImageList")items("listimages");return;}
  if(t=="CheckBox"&&property("macoscontrolstyle",Value::string(u"automatic")).string()==u"switch"){
    auto control=[NSSwitch new];control.target=delegate;control.action=@selector(action:);widget=control;view=nativeSwitchView(*this,control);
  }else if(t=="CommandButton"||t=="CheckBox"||t=="OptionButton"){
    NSButton*b=[[NSButton alloc]initWithFrame:NSZeroRect];[b setButtonType:t=="CheckBox"?NSButtonTypeSwitch:t=="OptionButton"?NSButtonTypeRadio:NSButtonTypeMomentaryPushIn];
    b.bezelStyle=NSBezelStyleRounded;b.target=delegate;b.action=@selector(action:);b.allowsMixedState=t=="CheckBox";widget=b;view=b;
    if(flag("default"))b.keyEquivalent=@"\r";else if(flag("cancel"))b.keyEquivalent=@"\033";
  }else if(t=="Label"||t=="TextBox"&&!flag("multiline")){
    NSTextField*f=t=="Label"?[NSTextField new]:property("macoscontrolstyle",Value::string(u"automatic")).string()==u"search"?nativeSearchField():nativeTextField(!property("passwordchar",Value::string(u"")).string().empty());
    f.editable=t!="Label"&&!flag("locked");f.selectable=t!="Label";f.bezeled=t!="Label";f.drawsBackground=t!="Label"||flag("backstyle");f.delegate=delegate;f.target=delegate;f.action=@selector(action:);widget=f;view=f;
  }else if(t=="TextBox"||t=="RichTextBox"){
    auto scroll=[NSScrollView new];auto editor=[[NSTextView alloc]initWithFrame:NSMakeRect(0,0,120,80)];editor.delegate=delegate;editor.richText=t=="RichTextBox";editor.importsGraphics=t=="RichTextBox";editor.editable=!flag("locked");editor.verticallyResizable=YES;editor.horizontallyResizable=(int(number("scrollbars",3))&1)!=0;
    editor.autoresizingMask=NSViewWidthSizable;editor.textContainer.widthTracksTextView=YES;scroll.documentView=editor;scroll.hasVerticalScroller=(int(number("scrollbars",3))&2)!=0;scroll.hasHorizontalScroller=(int(number("scrollbars",3))&1)!=0;scroll.borderType=NSBezelBorder;widget=editor;view=scroll;
  }else if(t=="ComboBox"||t=="DriveListBox"){
    auto combo=nativeComboBox();combo.editable=number("style",0)!=2;combo.delegate=delegate;combo.target=delegate;combo.action=@selector(action:);widget=combo;view=combo;
  }else if(t=="Frame"){
    auto box=nativeAppearanceBox(self());box.boxType=NSBoxPrimary;box.contentView=[VB6Canvas new];widget=box;view=box;
  }else if(t=="Image"){
    auto image=nativeAppearanceImage(self());image.imageScaling=flag("stretch",true)?NSImageScaleAxesIndependently:NSImageScaleNone;widget=image;view=image;
  }else if(t=="ListBox"||t=="ListView"||t=="FileListBox"||t=="DirListBox"||t=="TreeView"||t=="MSFlexGrid"||t=="MSHFlexGrid"||t=="DataGrid"){
    auto scroll=[NSScrollView new];NSTableView*table;
    if(t=="TreeView"){
      auto outline=[NSOutlineView new];outlineDelegate=[VB6OutlineDelegate new];outlineDelegate->model=self();outline.delegate=outlineDelegate;outline.dataSource=outlineDelegate;table=outline;items("nodes");
    }else{table=[NSTableView new];tableDelegate=[VB6TableDelegate new];tableDelegate->model=self();table.delegate=tableDelegate;table.dataSource=tableDelegate;}
    table.target=delegate;table.action=@selector(action:);table.doubleAction=@selector(doubleAction:);table.allowsMultipleSelection=flag("multiselect");
    table.gridStyleMask=flag("gridlines")?NSTableViewSolidHorizontalGridLineMask|NSTableViewSolidVerticalGridLineMask:0;
    if(t=="ListView"){items("listitems");items("columnheaders");}
    if(t=="MSFlexGrid"||t=="MSHFlexGrid"||t=="DataGrid")resizeGrid(size_t(number("rows",5)),size_t(number("cols",3)));
    widget=table;view=scroll;scroll.documentView=table;scroll.hasVerticalScroller=YES;scroll.hasHorizontalScroller=YES;scroll.borderType=NSBezelBorder;updateColumns();
  }else if(t=="HScrollBar"||t=="VScrollBar"||t=="Slider"){
    auto slider=[NSSlider new];slider.target=delegate;slider.action=@selector(action:);slider.continuous=YES;widget=slider;view=slider;
  }else if(t=="UpDown"){
    auto stepper=[NSStepper new];stepper.target=delegate;stepper.action=@selector(action:);stepper.valueWraps=flag("wrap");stepper.increment=number("increment",1);widget=stepper;view=stepper;
  }else if(t=="ProgressBar"){
    auto progress=[NSProgressIndicator new];progress.indeterminate=NO;progress.style=NSProgressIndicatorStyleBar;widget=progress;view=progress;
  }else if(t=="DTPicker"||t=="MonthView"){
    auto picker=[NSDatePicker new];picker.datePickerStyle=t=="MonthView"?NSDatePickerStyleClockAndCalendar:NSDatePickerStyleTextFieldAndStepper;picker.datePickerElements=int(number("format",0))==2?NSHourMinuteSecondDatePickerElementFlag:NSYearMonthDayDatePickerElementFlag;picker.target=delegate;picker.action=@selector(action:);widget=picker;view=picker;
  }else if(t=="TabStrip"||t=="SSTab"){
    auto tabs=[NSTabView new];tabs.delegate=delegate;widget=tabs;view=tabs;auto collection=items("tabs");int count=t=="SSTab"?int(number("tabs",3)):0;if(count<0||count>1000)fail(380);for(int i=0;i<count;i++)collection->invoke(*host->runtime,"add",{Arg(Value::missing()),Arg(Value::string(u"")),Arg(Value::string(u"Tab "+fromUTF8(std::to_string(i))))});
  }else{
    auto canvas=[VB6Canvas new];canvas->model=self();widget=canvas;view=canvas;
    if(t=="StatusBar")items("panels");if(t=="Toolbar")items("buttons");if(t=="MSChart")resizeGrid(size_t(number("rowcount",5)),size_t(number("columncount",1)));
  }
  if(auto canvas=[view isKindOfClass:VB6Canvas.class]?(VB6Canvas*)view:nil)canvas->model=self();
  view.identifier=ns(fromUTF8(spec.name));view.toolTip=ns(property("tooltiptext",Value::string(u"")).string());
  handle=host->handles.add(self(),t=="Form"||t=="MDIForm"?HandleKind::Window:HandleKind::Control);
  auto initial=property("list");if(initial.type==Type::Array)for(auto&v:initial.asArray()->values)list.push_back(v.string());itemData.resize(list.size());
  if(t=="DriveListBox"||t=="DirListBox"||t=="FileListBox")reloadFiles();
  refresh();applyFrame();applyFont();if(properties.count("picture"))setNativePicture(*this,"picture",properties.at("picture"));originalFrame=view.frame;
}
void MacControl::refresh(){
  if(disposed)return;if(menu){menu.title=ns(captionText(property("caption",Value::string(u"")).string()));menu.enabled=flag("enabled",true);menu.hidden=!flag("visible",true);menu.state=flag("checked")?NSControlStateValueOn:NSControlStateValueOff;return;}
  prepareNativeAppearance(*this);
  view.hidden=!flag("visible",true);if([widget respondsToSelector:@selector(setEnabled:)])[(id)widget setEnabled:flag("enabled",true)];
  Text caption=captionText(property("caption",Value::string(fromUTF8(spec.name))).string());
  if([widget isKindOfClass:NSButton.class]){auto b=(NSButton*)widget;b.title=ns(caption);int n=int(number("value",0));b.state=n==2?NSControlStateValueMixed:n?NSControlStateValueOn:NSControlStateValueOff;}
  else if([widget isKindOfClass:NSBox.class])[(NSBox*)widget setTitle:ns(caption)];
  else if(auto f=textField(*this)){
    NSString*desired=ns(spec.type=="Label"?caption:(f.currentEditor?nativeEditText(*this):property("text",Value::string(u"")).string()));if(![f.stringValue isEqualToString:desired])f.stringValue=desired;
    f.textColor=color(int64_t(number("forecolor",0)));f.backgroundColor=color(int64_t(number("backcolor",0xffffff)));f.alignment=number("alignment",0)==1?NSTextAlignmentRight:number("alignment",0)==2?NSTextAlignmentCenter:NSTextAlignmentLeft;f.editable=spec.type!="Label"&&!flag("locked");
  }else if(auto e=textView(*this)){NSString*desired=e.hasMarkedText?e.string:ns(property("text",Value::string(u"")).string());if(![e.string isEqualToString:desired])e.string=desired;e.textColor=color(int64_t(number("forecolor",0)));e.backgroundColor=color(int64_t(number("backcolor",0xffffff)));e.editable=!flag("locked");}
  if([widget isKindOfClass:NSSlider.class]||[widget isKindOfClass:NSStepper.class]||[widget isKindOfClass:NSProgressIndicator.class]){
    double minimum=number("min",0),maximum=number("max",100),value=number("value",minimum);if(minimum>maximum||value<minimum||value>maximum)fail(380,"Value is outside Min/Max");
    [(id)widget setMinValue:minimum];[(id)widget setMaxValue:maximum];[(id)widget setDoubleValue:value];
  }
  if([widget isKindOfClass:NSDatePicker.class]){auto date=property("value",Value::string(u"2000-01-01"));auto c=civilTime(parseDate(date));NSDateComponents*components=[NSDateComponents new];components.year=c.year;components.month=c.month;components.day=c.day;components.hour=c.hour;components.minute=c.minute;components.second=c.second;((NSDatePicker*)widget).dateValue=[[NSCalendar currentCalendar]dateFromComponents:components];}
  if(spec.type=="ComboBox"||spec.type=="ListBox"||spec.type=="DriveListBox"||spec.type=="FileListBox"||spec.type=="DirListBox")reloadList();
  refreshNativePictures(*this);
  applyNativeAppearance(*this);
  view.needsDisplay=YES;
}
void MacControl::dispose(){if(disposed)return;disposed=true;if(dataBinding){dataBinding->detach();dataBinding.reset();}boundEdit.reset();if(cursorTracking){[view removeTrackingArea:cursorTracking];cursorTracking=nil;}if([widget isKindOfClass:NSProgressIndicator.class])[(NSProgressIndicator*)widget stopAnimation:nil];[timer invalidate];timer=nil;[view removeFromSuperview];[menu.menu removeItem:menu];host->handles.remove(handle);for(auto&entry:collections)entry.second->owner.reset();if(delegate)delegate->model.reset();if(tableDelegate)tableDelegate->model.reset();if(outlineDelegate)outlineDelegate->model.reset();}
void MacControl::event(const std::string&name,Args args){
  if(disposed||eventSuppression)return;auto object=owner.lock();if(!object||!object->loaded)return;
  std::string prefix=spec.type=="Form"?"form":spec.type=="MDIForm"?"mdiform":lower(spec.name);
  if(spec.index>=0)args.insert(args.begin(),Arg(Value::integer(spec.index,Type::Integer)));
  host->runtime->dispatch(object,prefix+"_"+lower(name),std::move(args));
}
void MacControl::timerChanged(){
  [timer invalidate];timer=nil;double interval=number("interval",0);if(interval<0||interval>65535||std::floor(interval)!=interval)fail(380,"Timer Interval must be 0..65535 milliseconds");
  if(!flag("enabled",true)||interval==0||disposed)return;std::weak_ptr<MacControl> weak=self();
  timer=[NSTimer timerWithTimeInterval:interval/1000 repeats:YES block:^(NSTimer*){if(auto c=weak.lock())if(!c->eventActive&&!c->disposed){c->host->event([c]{c->eventActive=true;try{c->event("timer");c->eventActive=false;}catch(...){c->eventActive=false;throw;}});}}];
  [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
}
void MacControl::changed(const std::string& name){
  if(name=="text"){nativeEditChanged(*this);return;}
  if(name=="value"){
    if([widget isKindOfClass:NSButton.class]){
      auto b=(NSButton*)widget;int value=b.state==NSControlStateValueMixed?2:b.state==NSControlStateValueOn?1:0;
      if(spec.type=="OptionButton"){value=1;if(auto object=owner.lock())for(auto&entry:object->controls)if(auto peer=std::dynamic_pointer_cast<MacControl>(entry.second))if(peer.get()!=this&&peer->spec.type=="OptionButton"&&peer->spec.parent==spec.parent){peer->properties["value"]=Value::integer(0,Type::Integer);((NSButton*)peer->widget).state=NSControlStateValueOff;}}
      properties["value"]=Value::integer(value,Type::Integer);
    }else if([widget isKindOfClass:NSSwitch.class])properties["value"]=Value::integer(((NSSwitch*)widget).state==NSControlStateValueOn?1:0,Type::Integer);
    else if([widget isKindOfClass:NSDatePicker.class]){auto c=[[NSCalendar currentCalendar]components:NSCalendarUnitYear|NSCalendarUnitMonth|NSCalendarUnitDay|NSCalendarUnitHour|NSCalendarUnitMinute|NSCalendarUnitSecond fromDate:((NSDatePicker*)widget).dateValue];properties["value"]=civilDate({int(c.year),int(c.month),int(c.day),int(c.hour),int(c.minute),int(c.second)});}
    else if([widget respondsToSelector:@selector(doubleValue)])properties["value"]=Value::integer(bankers([(id)widget doubleValue]));
    event(spec.type=="CheckBox"||spec.type=="OptionButton"?"click":"change");return;
  }
  event(name);
}
} // namespace vb6
