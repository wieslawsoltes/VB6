#include "appkit-collections.hpp"
#include "appkit-appearance.hpp"
#include "appkit-edit.hpp"

namespace vb6 {
namespace {
struct Mutation { MacControl& c;explicit Mutation(MacControl&value):c(value){++c.eventSuppression;}~Mutation(){--c.eventSuppression;} };
Value itemValue(const MacItem&item,const std::string&key,Value fallback={}) {
  auto found=item.properties.find(key);return found==item.properties.end()?fallback:found->second;
}
bool itemFlag(const MacItem&item,const std::string&key,bool fallback=true) {return itemValue(item,key,Value::boolean(fallback)).truth();}
bool itemHasImage(const Value&value) {
  if(value.type==Type::Empty||value.type==Type::Null)return false;
  if(value.type==Type::String)return !value.string().empty()&&value.string()!=u"0";
  return value.type==Type::Boolean||value.isNumeric()?value.floating()!=0:true;
}
int itemStyle(const MacItem&item) {return int(itemValue(item,"style",Value::integer(0)).integral());}
NSString* identifier(const MacItem&item) {return [NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(item.identity)];}
std::shared_ptr<MacItem> makeItem(MacControl&c,const std::shared_ptr<MacItems>&collection) {
  auto item=std::make_shared<MacItem>();item->owner=c.self();item->collection=collection;item->kind=collection->kind;item->identity=collection->nextIdentity++;
  item->properties={{"key",Value::string(u"")},{"text",Value::string(u"")},{"enabled",Value::boolean(true)},{"visible",Value::boolean(true)},{"tag",Value::string(u"")}};
  if(collection->kind=="buttons"){item->properties["style"]=Value::integer(0,Type::Integer);item->properties["value"]=Value::integer(0,Type::Integer);}
  return item;
}
std::map<std::string,Value> decodeItem(const Value&input) {
  if(input.type!=Type::String)fail(380,"Native collection entries must be object records");
  const auto encoded=input.string();if(encoded.size()>1048576)fail(7,"Native collection entry exceeds 1048576 UTF-16 code units");
  NSError*error=nil;id object=[NSJSONSerialization JSONObjectWithData:[ns(encoded)dataUsingEncoding:NSUTF8StringEncoding]options:0 error:&error];
  if(![object isKindOfClass:NSDictionary.class])fail(380,"Invalid native collection record");
  std::map<std::string,Value> result;std::set<std::string>members;
  for(id rawKey in (NSDictionary*)object) {
    if(![rawKey isKindOfClass:NSString.class])fail(380,"Invalid native collection key");
    auto key=lower(toUTF8(text((NSString*)rawKey)));if(key=="caption")key="text";
    if(!std::set<std::string>{"key","text","enabled","visible","style","value","tooltiptext","tag","width","image","picture"}.count(key))continue;
    if(!members.insert(key).second)fail(380,"Native item members must be unique, including case and Caption/Text aliases");
    id value=[(NSDictionary*)object objectForKey:rawKey];
    if([value isKindOfClass:NSString.class])result[key]=Value::string(text(value));
    else if([value isKindOfClass:NSNumber.class]) {
      double n=[(NSNumber*)value doubleValue];if(!std::isfinite(n))fail(380,"Non-finite native collection value");
      result[key]=std::trunc(n)==n&&n>=INT32_MIN&&n<=INT32_MAX?Value::integer(int64_t(n)):Value::real(n);
    }else if(value!=NSNull.null)fail(380,"Native collection values must be scalar");
  }
  return result;
}
std::shared_ptr<MacControl> focusedChild(MacControl&c,NSView*page) {
  auto responder=c.view.window.firstResponder;if(![responder isKindOfClass:NSView.class])return {};
  auto result=c.host->controlForView((NSView*)responder);
  return result&&result.get()!=&c&&[result->widget isDescendantOf:page]?result:nullptr;
}
enum class TabFocusResult {Ready,Composition,Veto,Disposed,Removed};
TabFocusResult handoffTabFocus(MacControl&c,NSTabView*tabs,NSTabViewItem*target) {
  auto child=focusedChild(c,tabs.selectedTabViewItem.view);if(!child)return TabFocusResult::Ready;
  NSWindow*window=c.view.window;const bool editing=isNativeEdit(*child);NSRange selection=NSMakeRange(0,0);
  auto state=[&]{return c.disposed||c.widget!=tabs?TabFocusResult::Disposed:[tabs indexOfTabViewItem:target]==NSNotFound?TabFocusResult::Removed:TabFocusResult::Ready;};
  if(editing) {
    auto editor=[child->widget isKindOfClass:NSTextView.class]?(NSTextView*)child->widget:[child->widget isKindOfClass:NSTextField.class]?(NSTextView*)((NSTextField*)child->widget).currentEditor:nil;
    if(editor.hasMarkedText)return TabFocusResult::Composition;
    selection=nativeEditSelection(*child);
    // NSControl asks its delegate to validate only an edited cell. A VB page
    // transition validates even an unchanged editor, before focus can leave.
    const bool accepted=nativeEditValidate(*child,editor);c.host->check();
    if(auto result=state();result!=TabFocusResult::Ready)return result;
    if(!accepted){if(!child->disposed)nativeEditSelect(*child,selection);return TabFocusResult::Veto;}
  }
  bool accepted;
  {
    // AppKit may also ask its delegate while resigning. This transaction has
    // already validated the editor; other focus notifications remain live.
    struct Validation {MacControl&control;explicit Validation(MacControl&value):control(value){++control.editValidationSuppression;}~Validation(){--control.editValidationSuppression;}} validation(*child);
    accepted=[window makeFirstResponder:nativeFocusView(c)];
  }
  c.host->check();
  if(auto result=state();result!=TabFocusResult::Ready)return result;
  if(!accepted){if(editing&&!child->disposed)nativeEditSelect(*child,selection);return TabFocusResult::Veto;}
  return TabFocusResult::Ready;
}
}

void validateNativeSegmentItems(const MacControl&c,const std::vector<std::shared_ptr<MacItem>>&items,const std::map<MacItem*,std::map<std::string,Value>>&overrides) {
  const bool toolbar=c.spec.type=="Toolbar",tabs=c.spec.type=="TabStrip"||c.spec.type=="SSTab";
  if(!toolbar&&!tabs)return;
  const bool segmented=c.property("macoscontrolstyle",Value::string(u"automatic")).string()==u"segmented";
  if(items.size()>32767)fail(380,"Native tabs and toolbars support at most 32767 items");
  int tracking=-1;size_t selected=0;
  for(const auto&item:items) {
    auto changed=overrides.find(item.get());const auto&properties=changed==overrides.end()?item->properties:changed->second;
    auto number=[&](const char*key){auto it=properties.find(key);return it==properties.end()?0.0:it->second.floating();};
    if(toolbar) {
      const double style=number("style"),value=number("value");
      if(!std::isfinite(style)||style<0||style>5||style!=std::trunc(style))fail(380,"Toolbar button Style must be an integer from 0 to 5");
      if(value!=0&&value!=1)fail(380,"Toolbar button Value must be 0 or 1");
      if(segmented) {
        if(style>2||(tracking>=0&&tracking!=int(style)))fail(380,"Segmented toolbar styles must all be 0, 1 or 2 with one tracking mode");
        tracking=int(style);selected+=value==1;
      }
    }
    if(tabs&&!segmented)if(auto value=properties.find("visible");value!=properties.end()&&!value->second.truth())fail(438,"Hidden native tabs require MacOSControlStyle=segmented");
    if(segmented)for(auto key:{"image","picture"})if(auto value=properties.find(key);value!=properties.end()) {
      if(itemHasImage(value->second))
        fail(438,"Native segmented items support text labels, not image-bearing segments");
    }
  }
  if(tracking==0&&selected||tracking==2&&selected>1)fail(380,"Invalid segmented toolbar selection");
}

void initializeNativeItems(MacControl&c,const std::string&kind) {
  auto collection=c.items(kind);const auto authored=c.property(kind);
  if(authored.type==Type::Array) {
    const auto&definitions=authored.asArray()->values;if(definitions.size()>32767)fail(380,"Native collection exceeds 32767 authored items");
    std::set<Text>keys;
    for(const auto&definition:definitions) {
      auto item=makeItem(c,collection);for(auto&entry:decodeItem(definition))item->properties[entry.first]=std::move(entry.second);
      auto key=changeCase(itemValue(*item,"key",Value::string(u"")).string(),false);
      if(!key.empty()&&!keys.insert(key).second)fail(35602,"Native collection keys must be unique");
      collection->items.push_back(std::move(item));
    }
  } else if(kind=="tabs") {
    int64_t count=authored.type==Type::Empty?(c.spec.type=="SSTab"?3:0):authored.integral();
    if(count<(c.spec.type=="SSTab"?1:0)||count>32767)fail(380,"Invalid native tab count");
    for(int64_t i=0;i<count;++i) {
      auto item=makeItem(c,collection);auto suffix=std::to_string(i);
      item->properties["text"]=c.property("tabcaption("+suffix+")",Value::string(u"Tab "+fromUTF8(suffix)));
      item->properties["enabled"]=c.property("tabenabled("+suffix+")",Value::boolean(true));
      item->properties["visible"]=c.property("tabvisible("+suffix+")",Value::boolean(true));
      collection->items.push_back(std::move(item));
    }
  }
  validateNativeSegmentItems(c,collection->items);
  const auto selected=c.property("tab",Value::integer(0)).integral();
  Mutation mutation(c);collection->changed();
  if(kind=="tabs"&&!collection->items.empty())selectNativeTab(c,selected);
}

void reconcileNativeTabs(MacControl&c) {
  auto tabs=(NSTabView*)c.widget;auto collection=c.items("tabs");validateNativeSegmentItems(c,collection->items);
  NSTabViewItem*selected=tabs.selectedTabViewItem;const NSInteger oldIndex=selected?[tabs indexOfTabViewItem:selected]:-1;
  std::set<std::string>desired;for(const auto&item:collection->items)desired.insert(toUTF8(text(identifier(*item))));
  // Retain every existing page that still has a model item. Caption/tooltip
  // changes never detach the active page or its shared field editor.
  Mutation mutation(c);
  for(NSTabViewItem*item in tabs.tabViewItems.copy)if(!desired.count(toUTF8(text(item.identifier))))[tabs removeTabViewItem:item];
  for(size_t i=0;i<collection->items.size();++i) {
    const auto&model=collection->items[i];NSString*key=identifier(*model);
    auto at=[tabs indexOfTabViewItemWithIdentifier:key];NSTabViewItem*item=at==NSNotFound?nil:[tabs tabViewItemAtIndex:at];
    if(!item) {item=[[NSTabViewItem alloc]initWithIdentifier:key];item.view=[VB6Canvas new];[tabs insertTabViewItem:item atIndex:NSInteger(i)];}
    // Public collection insertion/removal retains relative order. This path is
    // defensive for a future reorder and preserves the existing page object.
    else if(at!=NSInteger(i)) {[tabs removeTabViewItem:item];[tabs insertTabViewItem:item atIndex:NSInteger(i)];}
    NSString*caption=ns(captionText(itemValue(*model,"text",Value::string(u"")).string()));
    if(![item.label isEqualToString:caption])item.label=caption;
    item.view.toolTip=ns(itemValue(*model,"tooltiptext",Value::string(u"")).string());
  }
  if(selected&&[tabs indexOfTabViewItem:selected]!=NSNotFound) {
    if(tabs.selectedTabViewItem!=selected)[tabs selectTabViewItem:selected];
  } else if(tabs.numberOfTabViewItems) [tabs selectTabViewItemAtIndex:std::clamp(oldIndex,NSInteger(0),tabs.numberOfTabViewItems-1)];
  auto current=tabs.selectedTabViewItem?[tabs indexOfTabViewItem:tabs.selectedTabViewItem]:-1;
  c.properties["tab"]=Value::integer(current,Type::Integer);
  refreshNativeSegments(c);
  // AppKit need not lay out an inactive page on insertion. Establish its
  // content bounds now, before a child can capture its original parent size.
  layoutNativeTabPages(c);
}

void layoutNativeTabPages(MacControl&c) {
  auto tabs=(NSTabView*)c.widget;const NSRect content=tabs.contentRect;
  NSPoint origin=NSZeroPoint;
  if(c.spec.type=="SSTab") {
    // SSTab child coordinates use the full control's top-left origin. Convert
    // the page frame, never its already-translated bounds, into that space.
    NSView*layout=c.appearanceContent?:c.view;const NSRect area=[layout convertRect:content fromView:tabs];
    origin=NSMakePoint(NSMinX(area)-NSMinX(layout.bounds),layout.isFlipped?NSMinY(area)-NSMinY(layout.bounds):NSMaxY(layout.bounds)-NSMaxY(area));
  }
  const NSRect bounds=NSMakeRect(origin.x,origin.y,content.size.width,content.size.height);
  for(NSTabViewItem*item in tabs.tabViewItems) {
    if(!NSEqualRects(item.view.frame,content))item.view.frame=content;
    if(!NSEqualRects(item.view.bounds,bounds))item.view.bounds=bounds;
  }
}

bool nativeTabShouldSelect(MacControl&c,NSTabViewItem*item) {
  if(c.eventSuppression)return true;
  if(!c.flag("enabled",true)||!item)return false;
  auto tabs=(NSTabView*)c.widget;auto index=[tabs indexOfTabViewItem:item];auto collection=c.items("tabs");
  if(index<0||size_t(index)>=collection->items.size())return false;
  auto model=collection->items[size_t(index)];if(!itemFlag(*model,"enabled")||!itemFlag(*model,"visible"))return false;
  if(handoffTabFocus(c,tabs,item)!=TabFocusResult::Ready)return false;
  if(c.disposed||c.widget!=tabs||!c.flag("enabled",true))return false;
  index=[tabs indexOfTabViewItem:item];
  if(index==NSNotFound||index<0||size_t(index)>=collection->items.size())return false;
  model=collection->items[size_t(index)];return itemFlag(*model,"enabled")&&itemFlag(*model,"visible");
}
void nativeTabDidSelect(MacControl&c,NSTabViewItem*item) {
  if(c.disposed)return;
  auto tabs=(NSTabView*)c.widget;const auto previous=c.number("tab",0);const auto index=item?[tabs indexOfTabViewItem:item]:-1;
  c.properties["tab"]=Value::integer(index,Type::Integer);refreshNativeSegments(c);layoutNativeTabPages(c);
  if(previous!=index)c.event("click",c.spec.type=="SSTab"?Args{Arg(Value::integer(int64_t(previous),Type::Integer))}:Args{});
}
void selectNativeTab(MacControl&c,int64_t index) {
  auto tabs=(NSTabView*)c.widget;if(index<0||index>=tabs.numberOfTabViewItems)fail(380,"Invalid native tab index");
  auto target=[tabs tabViewItemAtIndex:NSInteger(index)];if(target==tabs.selectedTabViewItem)return;
  // Programmatic selection may address a disabled/hidden page, just like the
  // VB Tab property. It must still preserve validation and marked text.
  const auto focus=handoffTabFocus(c,tabs,target);
  if(focus==TabFocusResult::Composition)fail(380,"Cannot change pages during marked text composition");
  if(focus==TabFocusResult::Veto)fail(380,"The current editor rejected the page change");
  if(c.disposed||c.widget!=tabs)fail(91,"The tab control was disposed during focus validation");
  auto currentIndex=[tabs indexOfTabViewItem:target];if(currentIndex==NSNotFound)fail(380,"The destination tab was removed during focus validation");index=currentIndex;
  const auto previous=c.number("tab",0);{Mutation mutation(c);[tabs selectTabViewItem:target];}
  c.properties["tab"]=Value::integer(index,Type::Integer);refreshNativeSegments(c);
  if(previous!=index)c.event("click",c.spec.type=="SSTab"?Args{Arg(Value::integer(int64_t(previous),Type::Integer))}:Args{});
}
NSView* nativeTabContainer(MacControl&c,int64_t index) {
  auto tabs=(NSTabView*)c.widget;if(index<0||index>=tabs.numberOfTabViewItems)fail(380,"Invalid native TabPage");
  layoutNativeTabPages(c);
  return [tabs tabViewItemAtIndex:NSInteger(index)].view;
}
void setNativeTabCount(MacControl&c,int64_t count) {
  if(count<1||count>32767)fail(380,"Tabs must be between 1 and 32767");
  auto collection=c.items("tabs");auto tabs=(NSTabView*)c.widget;
  for(size_t i=size_t(count);i<collection->items.size();++i)if([tabs tabViewItemAtIndex:NSInteger(i)].view.subviews.count)fail(380,"Move or remove controls before removing their tab page");
  while(collection->items.size()>size_t(count)){collection->items.back()->owner.reset();collection->items.pop_back();}
  while(collection->items.size()<size_t(count)){auto item=makeItem(c,collection);item->properties["text"]=Value::string(u"Tab "+fromUTF8(std::to_string(collection->items.size())));collection->items.push_back(std::move(item));}
  collection->changed();
}
Value nativeIndexedTab(MacControl&c,const std::string&name,int64_t index,const Value*value) {
  auto collection=c.items("tabs");if(index<0||size_t(index)>=collection->items.size())fail(380,"Invalid native tab index");
  const auto key=name=="tabcaption"?"text":name=="tabenabled"?"enabled":"visible";auto item=collection->items[size_t(index)];
  if(value){setNativeItemProperty(*item,key,name=="tabcaption"?Value::string(value->string()):Value::boolean(value->truth()));return {};}
  auto result=itemValue(*item,key,name=="tabcaption"?Value::string(u""):Value::boolean(true));return name=="tabcaption"?result:Value::boolean(result.truth());
}

void setNativeItemProperty(MacItem&item,const std::string&key,Value value) {
  auto c=item.owner.lock();if(!c||c->disposed)fail(91);auto collection=item.collection.lock();if(!collection)fail(91);
  std::map<MacItem*,std::map<std::string,Value>>changes;changes[&item]=item.properties;
  if(key=="style"&&item.kind=="buttons") {const auto n=value.floating();if(n<0||n>5||n!=std::trunc(n))fail(380,"Toolbar button Style must be an integer from 0 to 5");value=Value::integer(int64_t(n),Type::Integer);}
  if(key=="value"&&item.kind=="buttons") {
    const auto n=value.floating();if(n!=0&&n!=1)fail(380,"Toolbar button Value must be 0 or 1");value=Value::integer(int64_t(n),Type::Integer);
    if(n==1&&itemStyle(item)==2) {
      auto at=std::find_if(collection->items.begin(),collection->items.end(),[&](const auto&candidate){return candidate.get()==&item;});
      auto first=at,last=at;while(first!=collection->items.begin()&&itemStyle(**(first-1))==2)--first;while(last!=collection->items.end()&&itemStyle(**last)==2)++last;
      for(auto it=first;it!=last;++it)if(it->get()!=&item){changes[it->get()]=(*it)->properties;changes[it->get()]["value"]=Value::integer(0,Type::Integer);}
    }
  }
  changes[&item][key]=std::move(value);validateNativeSegmentItems(*c,collection->items,changes);
  for(auto&change:changes)change.first->properties=std::move(change.second);
  collection->changed();
}
void activateNativeToolbarItem(MacControl&c,const std::shared_ptr<MacItem>&item,bool selected) {
  if(c.disposed||c.eventSuppression||!c.flag("enabled",true)||!itemFlag(*item,"enabled")||!itemFlag(*item,"visible"))return;
  const int style=itemStyle(*item);
  if(style==1)setNativeItemProperty(*item,"value",Value::integer(selected?1:0,Type::Integer));
  else if(style==2)setNativeItemProperty(*item,"value",Value::integer(1,Type::Integer));
  else if(style==0){item->properties["value"]=Value::integer(0,Type::Integer);refreshNativeSegments(c);}
  c.event("buttonclick",{Arg(Value::object(item))});
}
} // namespace vb6
