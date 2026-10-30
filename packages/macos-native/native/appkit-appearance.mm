// Native Tahoe appearance with availability-checked public AppKit APIs. MIT.
#include "appkit-appearance.hpp"
#include "appkit-edit.hpp"
#include "appkit-pictures.hpp"
#include "appkit-collections.hpp"

// Do not subclass NSGlassEffectView: a superclass must exist when the image is
// loaded, even on a pre-26 system. Instantiate it only inside @available below.
@interface VB6MaterialView : NSVisualEffectView { @public std::weak_ptr<vb6::MacControl> model; } @end
@implementation VB6MaterialView
-(BOOL)isFlipped { return YES; }
-(void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; self.needsDisplay=YES; }
-(void)drawRect:(NSRect)dirty {
  [super drawRect:dirty];
  if(auto c=model.lock()) if(!c->property("macosbackgroundrole",vb6::Value::string(u"")).string().empty()) {
    // Pre-26 visual effects have no tintColor API. A translucent semantic wash
    // preserves their native material while keeping the authored role live.
    [[vb6::nativeBackgroundColor(*c) colorWithAlphaComponent:.12]setFill];
    NSRectFillUsingOperation(self.bounds,NSCompositingOperationSourceOver);
  }
}
@end
@interface VB6PlaceholderLabel : NSTextField @end
@implementation VB6PlaceholderLabel
-(NSView*)hitTest:(NSPoint)point { (void)point; return nil; }
-(BOOL)isAccessibilityElement { return NO; }
@end
// Keep placeholder layout coupled to the real editor's text-container geometry.
// This view retains AppKit's text system, marked text, undo and delegate paths.
@interface VB6AppearanceTextView : NSTextView { @public std::weak_ptr<vb6::MacControl> model; } @end
@implementation VB6AppearanceTextView
-(void)setFrameSize:(NSSize)size { [super setFrameSize:size];if(auto c=model.lock())vb6::refreshNativePlaceholder(*c); }
-(void)setBoundsSize:(NSSize)size { [super setBoundsSize:size];if(auto c=model.lock())vb6::refreshNativePlaceholder(*c); }
-(void)setTextContainerInset:(NSSize)inset { [super setTextContainerInset:inset];if(auto c=model.lock())vb6::refreshNativePlaceholder(*c); }
-(void)setAlignment:(NSTextAlignment)alignment { [super setAlignment:alignment];if(auto c=model.lock())vb6::refreshNativePlaceholder(*c); }
-(void)setMarkedText:(id)value selectedRange:(NSRange)selection replacementRange:(NSRange)replacement {
  [super setMarkedText:value selectedRange:selection replacementRange:replacement];
  if(auto c=model.lock())vb6::refreshNativePlaceholder(*c);
}
-(void)unmarkText { [super unmarkText];if(auto c=model.lock())vb6::refreshNativePlaceholder(*c); }
@end
@interface VB6SegmentedContainer : NSView { @public std::weak_ptr<vb6::MacControl> model; } @end
@implementation VB6SegmentedContainer
-(BOOL)isFlipped { return YES; }
-(BOOL)isAccessibilityElement { return NO; }
-(void)resizeSubviewsWithOldSize:(NSSize)size { [super resizeSubviewsWithOldSize:size];if(auto c=model.lock())vb6::layoutNativeAppearance(*c); }
@end
@interface VB6SegmentedControl : NSSegmentedControl { @public std::weak_ptr<vb6::MacControl> model; }
-(void)activateSegment:(id)sender;
@end
@implementation VB6SegmentedControl
-(void)activateSegment:(id)sender {
  (void)sender;if(auto c=model.lock())c->host->event([c]{
    auto segments=c->appearanceSegments;if(!segments||c->disposed||c->eventSuppression||!c->flag("enabled",true))return;
    auto segment=segments.selectedSegment;if(segment<0||size_t(segment)>=c->appearanceSegmentItems.size())return;
    auto identity=c->appearanceSegmentItems[size_t(segment)];auto collection=c->items(c->spec.type=="Toolbar"?"buttons":"tabs");
    auto found=std::find_if(collection->items.begin(),collection->items.end(),[&](const auto&item){return item->identity==identity;});
    if(found==collection->items.end()){vb6::refreshNativeSegments(*c);return;}
    if(c->spec.type=="Toolbar")vb6::activateNativeToolbarItem(*c,*found,[segments isSelectedForSegment:segment]);
    else {auto item=[(NSTabView*)c->widget tabViewItemAtIndex:NSInteger(found-collection->items.begin())];if(vb6::nativeTabShouldSelect(*c,item))[(NSTabView*)c->widget selectTabViewItem:item];}
    vb6::refreshNativeSegments(*c);
  });
}
@end
@interface VB6SwitchContainer : NSView { @public std::weak_ptr<vb6::MacControl> model; } @end
@implementation VB6SwitchContainer
-(BOOL)isFlipped { return YES; }
-(BOOL)isAccessibilityElement { return NO; }
-(void)resizeSubviewsWithOldSize:(NSSize)size {
  [super resizeSubviewsWithOldSize:size];if(auto c=model.lock())vb6::layoutNativeAppearance(*c);
}
-(void)mouseDown:(NSEvent*)event {
  (void)event;if(auto c=model.lock())c->host->event([c]{
    if(c->flag("enabled",true)){[c->view.window makeFirstResponder:c->widget];vb6::clickNativeSwitch(*c);}
  });
}
@end
@interface VB6AppearanceBox : NSBox { @public std::weak_ptr<vb6::MacControl> model; } @end
@implementation VB6AppearanceBox
-(void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; self.needsDisplay=YES; }
-(void)drawRect:(NSRect)dirty {
  if(auto c=model.lock()) if(!vb6::nativeMaterialActive(*c)&&(c->properties.count("backcolor")||!c->property("macosbackgroundrole",vb6::Value::string(u"")).string().empty())) {
    [vb6::nativeBackgroundColor(*c) setFill]; NSRectFill(self.bounds);
  }
  [super drawRect:dirty];
}
@end
@interface VB6AppearanceImage : NSImageView { @public std::weak_ptr<vb6::MacControl> model; } @end
@implementation VB6AppearanceImage
-(void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; self.needsDisplay=YES; }
-(void)drawRect:(NSRect)dirty {
  if(auto c=model.lock()) if(c->properties.count("backcolor")||!c->property("macosbackgroundrole",vb6::Value::string(u"")).string().empty()) {
    [vb6::nativeBackgroundColor(*c) setFill]; NSRectFill(self.bounds);
  }
  [super drawRect:dirty];
}
@end

namespace vb6 {
namespace {
const std::map<std::string,Text> defaults={
  {"macoscontrolsize",u"regular"},{"macoscontrolstyle",u"automatic"},{"macosmaterial",u"none"},
  {"macosbackgroundrole",u""},{"macosforegroundrole",u""},{"macosaccessibilitylabel",u""},
  {"macosaccessibilityhelp",u""},{"macosaccessibilityidentifier",u""},{"placeholdertext",u""}
};
Text setting(const MacControl&c,const std::string&name) { return c.property(name,nativeAppearanceDefault(name)).string(); }
bool oneOf(const Text&value,std::initializer_list<const char16_t*>choices) {
  return std::any_of(choices.begin(),choices.end(),[&](const char16_t*choice){return value==choice;});
}
bool oneOfType(const std::string&type,std::initializer_list<const char*>choices) {
  return std::any_of(choices.begin(),choices.end(),[&](const char*choice){return type==choice;});
}
struct Applying {
  MacControl&c;explicit Applying(MacControl&value):c(value){c.applyingAppearance=true;}
  ~Applying(){c.applyingAppearance=false;}
};
struct Mutation {
  MacControl&c;explicit Mutation(MacControl&value):c(value){++c.eventSuppression;}
  ~Mutation(){--c.eventSuppression;}
};
struct MaterialFocus {
  std::shared_ptr<MacControl> control;NSWindow*window=nil;NSRange selection=NSMakeRange(0,0);bool edit=false;
  explicit MaterialFocus(MacControl&owner) {
    window=owner.view.window;id responder=window.firstResponder;
    if(![responder isKindOfClass:NSView.class])return;
    auto candidate=owner.host->controlForView((NSView*)responder);
    if(!candidate||![candidate->widget isDescendantOf:owner.view])return;
    edit=isNativeEdit(*candidate);
    if(edit) {
      NSText*editor=[candidate->widget isKindOfClass:NSTextField.class]?((NSTextField*)candidate->widget).currentEditor:[candidate->widget isKindOfClass:NSTextView.class]?(NSTextView*)candidate->widget:nil;
      if([editor isKindOfClass:NSTextView.class]&&((NSTextView*)editor).hasMarkedText)fail(380,"Cannot replace a material container during marked text composition");
      selection=nativeEditSelection(*candidate);candidate->properties["text"]=Value::string(nativeEditText(*candidate));
    }
    control=candidate;++control->eventSuppression;
    [window makeFirstResponder:nil];
  }
  void restore() {
    if(!control||control->disposed)return;
    [window makeFirstResponder:nativeFocusView(*control)];if(edit)nativeEditSelect(*control,selection);
  }
  ~MaterialFocus(){if(control)--control->eventSuppression;}
};
void removeTracking(MacControl&c) {
  if(c.cursorTracking){[c.view removeTrackingArea:c.cursorTracking];c.cursorTracking=nil;}
}
// Replace the view without changing VB identity, handles, ordering or tab links.
void installView(MacControl&c,NSView*replacement) {
  NSView*old=c.view;NSView*parent=old.superview;NSWindow*window=old.window;
  const bool root=window&&window.contentView==old;
  replacement.frame=old.frame;replacement.autoresizingMask=old.autoresizingMask;
  replacement.hidden=old.hidden;replacement.identifier=old.identifier;replacement.toolTip=old.toolTip;
  removeTracking(c);
  if(root)window.contentView=replacement;
  else if(parent)[parent replaceSubview:old with:replacement];
  c.view=replacement;
}
void replaceWidget(MacControl&c,NSView*replacement) {
  NSView*old=c.widget;NSWindow*window=old.window;
  NSView*previous=old.previousKeyView;NSView*next=old.nextKeyView;
  bool focus=window.firstResponder==old;
  NSRange selection=NSMakeRange(0,0);
  if([old isKindOfClass:NSTextField.class]) {
    auto field=(NSTextField*)old;
    if([field.currentEditor isKindOfClass:NSTextView.class]&&((NSTextView*)field.currentEditor).hasMarkedText)fail(380,"Cannot replace a field during marked text composition");
    focus=focus||(field.currentEditor&&window.firstResponder==field.currentEditor);
    c.properties["text"]=Value::string(nativeEditText(c));selection=nativeEditSelection(c);
    // End the old editor without invoking user validation or Change handlers.
    field.delegate=nil;
  }
  Mutation mutation(c);
  if(focus)[window makeFirstResponder:nil];
  const bool initial=window.initialFirstResponder==old;
  NSView*replacementView=replacement;
  if([replacement isKindOfClass:NSSwitch.class])replacementView=nativeSwitchView(c,(NSSwitch*)replacement);
  else c.appearanceCaption=nil;
  installView(c,replacementView);c.widget=replacement;
  if(previous&&previous!=old)previous.nextKeyView=replacement;
  replacement.nextKeyView=next==old?replacement:next;
  if(initial)window.initialFirstResponder=replacement;
  if([replacement isKindOfClass:NSTextField.class]) {
    auto field=(NSTextField*)replacement;field.delegate=c.delegate;field.target=c.delegate;field.action=@selector(action:);
    field.editable=!c.flag("locked");field.selectable=YES;field.bezeled=YES;field.drawsBackground=YES;
    field.stringValue=ns(c.property("text",Value::string(u"")).string());
    nativeEditSelect(c,selection);
  }
  c.applyFont();layoutNativeAppearance(c);
  if(focus){[window makeFirstResponder:replacement];if(isNativeEdit(c))nativeEditSelect(c,selection);}
}
NSVisualEffectMaterial effectMaterial(const Text&role) {
  if(role==u"sidebar")return NSVisualEffectMaterialSidebar;
  if(role==u"titlebar"||role==u"toolbar")return NSVisualEffectMaterialTitlebar;
  if(role==u"menu")return NSVisualEffectMaterialMenu;
  if(role==u"popover")return NSVisualEffectMaterialPopover;
  if(role==u"sheet")return NSVisualEffectMaterialSheet;
  if(role==u"hud")return NSVisualEffectMaterialHUDWindow;
  return NSVisualEffectMaterialContentBackground;
}
void material(MacControl&c) {
  auto role=setting(c,"macosmaterial");auto key=toUTF8(role);
  if(c.appliedMaterial==key)return;
  MaterialFocus focus(c);
  NSView*base=c.appearanceContent?:c.view;
  if(role==u"none") {
    // Detach first so replacing the effect cannot leave the content retained by
    // both the effect's contentView and its former parent.
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if(@available(macOS 26.0,*))if([c.view isKindOfClass:NSGlassEffectView.class])((NSGlassEffectView*)c.view).contentView=nil;
#endif
    [base removeFromSuperview];installView(c,base);c.appearanceContent=nil;
  } else {
    NSView*effect=nil;
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if(@available(macOS 26.0,*))if(role!=u"content") {
      auto glass=[NSGlassEffectView new];glass.cornerRadius=16;effect=glass;
    }
#endif
    if(!effect){auto visual=[VB6MaterialView new];visual->model=c.self();visual.material=effectMaterial(role);visual.blendingMode=NSVisualEffectBlendingModeWithinWindow;visual.state=NSVisualEffectStateFollowsWindowActiveState;effect=visual;}
    installView(c,effect);[base removeFromSuperview];c.appearanceContent=base;
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if(@available(macOS 26.0,*)) {
      if([effect isKindOfClass:NSGlassEffectView.class])((NSGlassEffectView*)effect).contentView=base;
      else [effect addSubview:base];
    }else [effect addSubview:base];
#else
    [effect addSubview:base];
#endif
    base.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;base.frame=effect.bounds;
  }
  c.appliedMaterial=key;
  focus.restore();
}
void accessibility(MacControl&c,id target) {
  if(!target)return;
  for(const auto&entry:std::map<std::string,SEL>{{"macosaccessibilitylabel",@selector(setAccessibilityLabel:)},{"macosaccessibilityhelp",@selector(setAccessibilityHelp:)},{"macosaccessibilityidentifier",@selector(setAccessibilityIdentifier:)}}) {
    if(!c.properties.count(entry.first))continue;
    NSString*value=ns(setting(c,entry.first));if(!value.length)value=nil;
    // NSView and NSWindow both implement the NSAccessibility protocol. Keep the
    // explicit methods so selectors and argument types remain SDK checked.
    if(entry.first=="macosaccessibilitylabel") {
      if(!value&&[target isKindOfClass:NSSwitch.class])value=ns(captionText(c.property("caption",Value::string(fromUTF8(c.spec.name))).string()));
      [(NSView*)target setAccessibilityLabel:value];
    }
    else if(entry.first=="macosaccessibilityhelp")[(NSView*)target setAccessibilityHelp:value];
    else [(NSView*)target setAccessibilityIdentifier:value];
  }
}
void buttonForeground(NSButton*b,NSColor*foreground) {
  b.contentTintColor=foreground;
  NSMutableAttributedString*title=[b.attributedTitle mutableCopy];NSRange range=NSMakeRange(0,title.length);
  [title removeAttribute:NSForegroundColorAttributeName range:range];
  if(foreground)[title addAttribute:NSForegroundColorAttributeName value:foreground range:range];
  b.attributedTitle=title;
}
void redirectKeyView(NSView*old,NSView*replacement,NSWindow*window) {
  auto previous=old.previousKeyView,next=old.nextKeyView;
  if(previous&&previous!=old)previous.nextKeyView=replacement;
  replacement.nextKeyView=next==old?replacement:next;
  if(window.initialFirstResponder==old)window.initialFirstResponder=replacement;
}
void prepareSegments(MacControl&c) {
  if(c.spec.type!="Toolbar"&&c.spec.type!="TabStrip"&&c.spec.type!="SSTab")return;
  const bool desired=setting(c,"macoscontrolstyle")==u"segmented";
  if(desired==bool(c.appearanceSegments))return;
  MaterialFocus focus(c);NSWindow*window=c.view.window;
  if(desired) {
    auto segments=[VB6SegmentedControl new];segments->model=c.self();segments.target=segments;segments.action=@selector(activateSegment:);
    segments.segmentStyle=NSSegmentStyleRounded;segments.segmentDistribution=NSSegmentDistributionFillEqually;
    if(c.spec.type=="Toolbar") {
      for(NSView*child in c.widget.subviews.copy)if([child isKindOfClass:NSButton.class]&&((NSButton*)child).target==c.delegate&&((NSButton*)child).action==@selector(itemAction:))[child removeFromSuperview];
      [c.widget addSubview:segments];
    }else {
      auto tabs=(NSTabView*)c.widget;c.appearanceTabType=tabs.tabViewType;c.appearanceTabsDrawBackground=tabs.drawsBackground;
      auto container=[VB6SegmentedContainer new];container->model=c.self();installView(c,container);
      tabs.tabViewType=NSNoTabsNoBorder;tabs.drawsBackground=NO;[container addSubview:tabs];[container addSubview:segments];
    }
    c.appearanceSegments=segments;redirectKeyView(c.widget,segments,window);refreshNativeSegments(c);
  }else {
    auto segments=c.appearanceSegments;redirectKeyView(segments,c.widget,window);
    [segments removeFromSuperview];c.appearanceSegments=nil;c.appearanceSegmentItems.clear();
    if(c.spec.type=="Toolbar")c.items("buttons")->changed();
    else {auto tabs=(NSTabView*)c.widget;[tabs removeFromSuperview];installView(c,tabs);tabs.tabViewType=NSTabViewType(c.appearanceTabType);tabs.drawsBackground=c.appearanceTabsDrawBackground;}
  }
  focus.restore();
}
void layoutSegments(MacControl&c,NSView*layout) {
  auto segments=c.appearanceSegments;if(!segments)return;
  auto bounds=layout.bounds;auto size=segments.intrinsicContentSize;
  CGFloat height=std::min(bounds.size.height,std::max(CGFloat(0),size.height));
  CGFloat inset=std::min(CGFloat(4),bounds.size.width/2),width=std::max(CGFloat(0),bounds.size.width-2*inset);
  if(c.spec.type=="Toolbar")segments.frame=NSMakeRect(inset,(bounds.size.height-height)/2,width,height);
  else {
    CGFloat band=std::min(bounds.size.height,height+8);bool bottom=c.number("taborientation",0)==1;
    segments.frame=NSMakeRect(inset,bottom?bounds.size.height-band+(band-height)/2:(band-height)/2,width,height);
    c.widget.frame=NSMakeRect(0,bottom?0:band,bounds.size.width,std::max(CGFloat(0),bounds.size.height-band));
  }
}
}
NSView* nativeFocusView(const MacControl&c) {return c.appearanceSegments?:c.widget;}
void refreshNativeSegments(MacControl&c) {
  auto segments=c.appearanceSegments;if(!segments||c.disposed)return;
  const bool toolbar=c.spec.type=="Toolbar";auto collection=c.items(toolbar?"buttons":"tabs");validateNativeSegmentItems(c,collection->items);
  std::vector<std::shared_ptr<MacItem>>visible;for(const auto&item:collection->items)if(!item->properties.count("visible")||item->properties.at("visible").truth())visible.push_back(item);
  if(segments.segmentCount!=NSInteger(visible.size()))segments.segmentCount=NSInteger(visible.size());
  segments.hidden=visible.empty();segments.enabled=c.flag("enabled",true);segments.controlSize=nativeControlSize(c);
  int style=toolbar&&!collection->items.empty()&&collection->items.front()->properties.count("style")?int(collection->items.front()->properties.at("style").integral()):2;
  auto tracking=!toolbar||style==2?NSSegmentSwitchTrackingSelectOne:style==1?NSSegmentSwitchTrackingSelectAny:NSSegmentSwitchTrackingMomentary;
  if(segments.trackingMode!=tracking)segments.trackingMode=tracking;
  c.appearanceSegmentItems.clear();auto tabs=toolbar?nil:(NSTabView*)c.widget;NSInteger selectedSegment=-1;
  for(size_t i=0;i<visible.size();++i) {
    const auto&item=visible[i];auto property=[&](const char*key,Value fallback){auto found=item->properties.find(key);return found==item->properties.end()?fallback:found->second;};
    NSString*label=ns(captionText(property("text",Value::string(u"")).string()));if(![[segments labelForSegment:NSInteger(i)]isEqualToString:label])[segments setLabel:label forSegment:NSInteger(i)];
    [segments setEnabled:property("enabled",Value::boolean(true)).truth() forSegment:NSInteger(i)];
    [(NSSegmentedCell*)segments.cell setToolTip:ns(property("tooltiptext",Value::string(u"")).string())forSegment:NSInteger(i)];
    auto selected=toolbar?property("value",Value::integer(0)).truth():[tabs.selectedTabViewItem.identifier isEqual:[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(item->identity)]];
    if(tracking==NSSegmentSwitchTrackingSelectOne){if(selected)selectedSegment=NSInteger(i);}
    else [segments setSelected:selected forSegment:NSInteger(i)];
    c.appearanceSegmentItems.push_back(item->identity);
  }
  // SelectOne has one control-level selection. Apply it once after resolving
  // visible identities, including -1 when the selected model item is hidden.
  if(tracking==NSSegmentSwitchTrackingSelectOne)segments.selectedSegment=selectedSegment;
  if(!toolbar)tabs.drawsBackground=NO;
  layoutSegments(c,c.appearanceContent?:c.view);
}
bool nativeAppearanceProperty(const std::string&name) {return name=="macosindeterminate"||defaults.count(name);}
Value nativeAppearanceDefault(const std::string&name) {
  if(name=="macosindeterminate")return Value::integer(0,Type::Integer);
  auto it=defaults.find(name);if(it==defaults.end())fail(438,"Unknown native appearance property "+name);
  return Value::string(it->second);
}
NSColor* nativeSemanticColor(const Text&role) {
  if(role.empty())return nil;
  const std::map<Text,NSColor*>colors={
    {u"windowBackgroundColor",NSColor.windowBackgroundColor},{u"controlBackgroundColor",NSColor.controlBackgroundColor},{u"textBackgroundColor",NSColor.textBackgroundColor},
    {u"labelColor",NSColor.labelColor},{u"secondaryLabelColor",NSColor.secondaryLabelColor},{u"tertiaryLabelColor",NSColor.tertiaryLabelColor},
    {u"disabledControlTextColor",NSColor.disabledControlTextColor},{u"controlTextColor",NSColor.controlTextColor},{u"textColor",NSColor.textColor},
    {u"controlAccentColor",NSColor.controlAccentColor},{u"selectedContentBackgroundColor",NSColor.selectedContentBackgroundColor},{u"selectedTextBackgroundColor",NSColor.selectedTextBackgroundColor},
    {u"selectedTextColor",NSColor.selectedTextColor},{u"unemphasizedSelectedContentBackgroundColor",NSColor.unemphasizedSelectedContentBackgroundColor},
    {u"unemphasizedSelectedTextColor",NSColor.unemphasizedSelectedTextColor},{u"separatorColor",NSColor.separatorColor},{u"gridColor",NSColor.gridColor},{u"linkColor",NSColor.linkColor},
    {u"destructiveColor",NSColor.systemRedColor},{u"focusIndicatorColor",NSColor.keyboardFocusIndicatorColor}
  };
  if(auto it=colors.find(role);it!=colors.end())return it->second;
  if(role==u"accentPressedColor"||role==u"destructivePressedColor") {
    const bool destructive=role==u"destructivePressedColor";
    return [NSColor colorWithName:ns(role) dynamicProvider:^NSColor*(NSAppearance*appearance) {
      __block NSColor*resolved=nil;
      [appearance performAsCurrentDrawingAppearance:^{resolved=[(destructive?NSColor.systemRedColor:NSColor.controlAccentColor) shadowWithLevel:.15];}];
      return resolved;
    }];
  }
  fail(380,"Unknown native semantic color role "+toUTF8(role));
}
NSColor* nativeBackgroundColor(const MacControl&c) {return nativeSemanticColor(setting(c,"macosbackgroundrole"))?:color(int64_t(c.number("backcolor",0xffffff)));}
NSColor* nativeForegroundColor(const MacControl&c) {return nativeSemanticColor(setting(c,"macosforegroundrole"))?:color(int64_t(c.number("forecolor",0)));}
bool nativeMaterialActive(const MacControl&c) {return c.appliedMaterial!="none";}
NSControlSize nativeControlSize(const MacControl&c) {
  auto size=setting(c,"macoscontrolsize");
  if(size==u"mini")return NSControlSizeMini;if(size==u"small")return NSControlSizeSmall;if(size==u"large")return NSControlSizeLarge;
  if(size==u"extraLarge") {
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if(@available(macOS 26.0,*))return NSControlSizeExtraLarge;
#endif
    fail(380,"extraLarge requires macOS 26 and a runtime built with SDK 26 or later");
  }
  return NSControlSizeRegular;
}
void validateNativeAppearance(const MacControl&c) {
  const auto&type=c.spec.type;auto style=setting(c,"macoscontrolstyle");
  for(const auto&entry:c.properties) {
    const auto&key=entry.first;const auto&value=entry.second;
    if(key.rfind("macos",0)==0&&!nativeAppearanceProperty(key))fail(438,"Unsupported native appearance property "+key);
    if(!nativeAppearanceProperty(key))continue;
    if(key=="macosindeterminate") {
      if(value.type==Type::String||value.type==Type::Null||value.type==Type::Empty)fail(380,"MacOSIndeterminate requires a numeric 0/-1 Boolean");
      auto n=value.floating();if(type!="ProgressBar"||(n!=0&&n!=-1))fail(380,"MacOSIndeterminate requires ProgressBar and a 0/-1 Boolean");
      continue;
    }
    if(value.type!=Type::String)fail(380,"Native appearance values must be strings");
    auto v=value.string();if(v.find(u'\0')!=Text::npos||v.size()>(key=="macosaccessibilityidentifier"?1024:16384))fail(380,"Invalid native appearance text");
    if(key=="macoscontrolsize"&&!oneOf(v,{u"mini",u"small",u"regular",u"large",u"extraLarge"}))fail(380,"Unknown native control size");
    if(key=="macoscontrolstyle"&&!(v==u"automatic"||type=="CommandButton"&&oneOf(v,{u"push",u"default",u"destructive",u"borderless",u"inline",u"circular",u"help"})||type=="CheckBox"&&v==u"switch"||type=="TextBox"&&v==u"search"||oneOfType(type,{"Toolbar","TabStrip","SSTab"})&&v==u"segmented"))fail(380,"Native control style is unsupported for "+type);
    if(key=="macosmaterial"&&!oneOf(v,{u"none",u"content",u"sidebar",u"titlebar",u"toolbar",u"menu",u"popover",u"sheet",u"hud"}))fail(380,"Unknown native material");
    if(key=="placeholdertext"&&!oneOfType(type,{"TextBox","ComboBox"}))fail(380,"PlaceholderText requires TextBox or ComboBox");
    if(v==nativeAppearanceDefault(key).string())continue;
    if(oneOfType(type,{"Timer","ImageList","CommonDialog","Menu","Data","Adodc"}))fail(438,"Nonvisual object does not expose native appearance");
    if(key=="macosmaterial"&&!oneOfType(type,{"Form","MDIForm","PictureBox","Frame","Toolbar","StatusBar","ListBox","TreeView","ListView","TabStrip","SSTab"}))fail(438,"Native material is unsupported for "+type);
    if(key=="macosmaterial"&&oneOfType(type,{"TabStrip","SSTab"})&&style!=u"segmented")fail(438,"Native tab materials require MacOSControlStyle=segmented");
    if(key=="macoscontrolsize") {
      if(!oneOfType(type,{"CommandButton","Label","TextBox","CheckBox","OptionButton","ComboBox","DriveListBox","ListBox","FileListBox","DirListBox","TreeView","ListView","MSFlexGrid","MSHFlexGrid","DataGrid","HScrollBar","VScrollBar","Slider","UpDown","ProgressBar","DTPicker","MonthView","TabStrip","SSTab","Toolbar","StatusBar"})||type=="TextBox"&&c.flag("multiline"))fail(438,"Native control size is unsupported for "+type);
      (void)nativeControlSize(c);
    }
    if(key=="macosbackgroundrole") {
      (void)nativeSemanticColor(v);
      if(!oneOfType(type,{"Form","MDIForm","Label","TextBox","RichTextBox","ComboBox","DriveListBox","Frame","PictureBox","Image","ListBox","FileListBox","DirListBox","TreeView","ListView","MSFlexGrid","MSHFlexGrid","DataGrid","Toolbar","StatusBar","MSChart","CommandButton"})||type=="CommandButton"&&!oneOf(style,{u"automatic",u"push",u"default",u"destructive"}))fail(438,"Native widget/style has no independently colorable background");
    }
    if(key=="macosforegroundrole") {
      (void)nativeSemanticColor(v);
      if(!oneOfType(type,{"Form","MDIForm","CommandButton","CheckBox","OptionButton","Label","TextBox","RichTextBox","ComboBox","DriveListBox","Frame","PictureBox","ListBox","FileListBox","DirListBox","TreeView","ListView","MSFlexGrid","MSHFlexGrid","DataGrid","Toolbar","StatusBar","MSChart"}))fail(438,"Native widget/style has no independently colorable foreground");
    }
  }
  if(style==u"search"&&(c.flag("multiline")||!c.property("passwordchar",Value::string(u"")).string().empty()))fail(380,"Search requires a single-line, non-password TextBox");
  if(style==u"switch"&&c.number("value",0)!=0&&c.number("value",0)!=1)fail(380,"Native switches require a binary CheckBox Value of 0 or 1");
  if(style==u"segmented"&&oneOfType(type,{"TabStrip","SSTab"})&&c.number("taborientation",0)!=0&&c.number("taborientation",0)!=1)fail(380,"Segmented tabs require top or bottom orientation");
  if(auto found=c.collections.find("buttons");found!=c.collections.end())validateNativeSegmentItems(c,found->second->items);
  if(auto found=c.collections.find("tabs");found!=c.collections.end())validateNativeSegmentItems(c,found->second->items);
}
void setNativeAppearance(MacControl&c,const std::string&name,Value value) {
  auto before=c.properties;c.properties[name]=std::move(value);
  try {
    validateNativeAppearance(c);
    // Metadata must not replace attributed RichTextBox runs, reset a caret or
    // create synthetic edit events. Apply only the facet being assigned.
    if(name.rfind("macosaccessibility",0)==0) {
      accessibility(c,c.widget);if(c.view!=c.widget)accessibility(c,c.view);
      if(c.appearanceSegments)accessibility(c,c.appearanceSegments);
      if(c.spec.type=="Form"||c.spec.type=="MDIForm")if(auto owner=c.owner.lock())accessibility(c,c.host->form(owner)->window);
      return;
    }
    if(name=="placeholdertext"){refreshNativePlaceholder(c);return;}
    if(c.spec.type=="RichTextBox") {
      auto editor=(NSTextView*)c.widget;
      if(name=="macosforegroundrole")editor.textColor=nativeForegroundColor(c);
      if(name=="macosbackgroundrole"){editor.backgroundColor=nativeBackgroundColor(c);((NSScrollView*)c.view).backgroundColor=editor.backgroundColor;}
      return;
    }
    c.refresh();c.applyFont();c.applyFrame();
  }
  catch(...){c.properties=std::move(before);throw;}
}
void prepareNativeAppearance(MacControl&c) {
  if(!c.view||c.disposed)return;
  const auto style=setting(c,"macoscontrolstyle");
  if(c.spec.type=="CheckBox") {
    const bool nativeSwitch=[c.widget isKindOfClass:NSSwitch.class];
    if(style==u"switch"&&!nativeSwitch){auto control=[NSSwitch new];control.target=c.delegate;control.action=@selector(action:);replaceWidget(c,control);}
    else if(style!=u"switch"&&nativeSwitch){auto button=[NSButton new];[button setButtonType:NSButtonTypeSwitch];button.allowsMixedState=YES;button.target=c.delegate;button.action=@selector(action:);replaceWidget(c,button);}
  }
  if(c.spec.type=="TextBox"&&!c.flag("multiline")) {
    const bool search=[c.widget isKindOfClass:NSSearchField.class];
    if((style==u"search")!=search)replaceWidget(c,style==u"search"?nativeSearchField():nativeTextField(!c.property("passwordchar",Value::string(u"")).string().empty()));
  }
  prepareSegments(c);
  material(c);
}
void refreshNativePlaceholder(MacControl&c) {
  auto value=setting(c,"placeholdertext");
  if([c.widget isKindOfClass:NSTextField.class]){((NSTextField*)c.widget).placeholderString=ns(value);return;}
  if(![c.widget isKindOfClass:NSTextView.class])return;
  auto editor=(NSTextView*)c.widget;
  if(!c.appearancePlaceholder&&!value.empty()) {
    auto label=[[VB6PlaceholderLabel alloc]initWithFrame:NSZeroRect];label.editable=NO;label.selectable=NO;label.bezeled=NO;label.drawsBackground=NO;
    label.maximumNumberOfLines=0;label.lineBreakMode=NSLineBreakByWordWrapping;
    auto cell=(NSTextFieldCell*)label.cell;cell.wraps=YES;cell.scrollable=NO;cell.usesSingleLineMode=NO;
    label.textColor=NSColor.placeholderTextColor;c.appearancePlaceholder=label;[editor addSubview:label];
  }
  auto label=c.appearancePlaceholder;if(!label)return;
  label.stringValue=ns(value);label.font=editor.font?:[NSFont systemFontOfSize:NSFont.systemFontSize];label.alignment=editor.alignment;
  label.hidden=value.empty()||editor.string.length!=0||editor.hasMarkedText;
  auto origin=editor.textContainerOrigin;auto inset=editor.textContainerInset;auto padding=editor.textContainer.lineFragmentPadding;
  CGFloat width=std::max(CGFloat(0),editor.bounds.size.width-origin.x-inset.width-2*padding);
  CGFloat available=std::max(CGFloat(0),editor.bounds.size.height-origin.y-inset.height);
  auto measured=[label.cell cellSizeForBounds:NSMakeRect(0,0,width,CGFLOAT_MAX)];
  label.frame=NSMakeRect(origin.x+padding,origin.y,width,std::min(available,std::ceil(measured.height)));
}
void layoutNativeAppearance(MacControl&c) {
  NSView*layout=c.appearanceContent?:c.view;
  if(c.appearanceContent)c.appearanceContent.frame=c.view.bounds;
  if(c.appearanceCaption&&[c.widget isKindOfClass:NSSwitch.class]) {
    auto control=(NSSwitch*)c.widget;NSSize size=control.intrinsicContentSize;
    if(size.width<0||size.height<0){[control sizeToFit];size=control.frame.size;}
    auto bounds=layout.bounds;CGFloat width=std::min(size.width,bounds.size.width),height=std::min(size.height,bounds.size.height);
    bool rtl=layout.userInterfaceLayoutDirection==NSUserInterfaceLayoutDirectionRightToLeft;
    control.frame=NSMakeRect(rtl?bounds.size.width-width:0,(bounds.size.height-height)/2,width,height);
    c.appearanceCaption.frame=NSMakeRect(rtl?0:width+8,0,std::max(CGFloat(0),bounds.size.width-width-8),bounds.size.height);
    return;
  }
  if(c.widget!=layout&&![layout isKindOfClass:NSScrollView.class])c.widget.frame=layout.bounds;
  layoutSegments(c,layout);
  if([c.widget isKindOfClass:NSTabView.class])layoutNativeTabPages(c);
  refreshNativePlaceholder(c);
}
void applyNativeItemAppearance(MacControl&c,NSButton*button) {
  button.controlSize=nativeControlSize(c);
  button.font=[NSFont systemFontOfSize:[NSFont systemFontSizeForControlSize:button.controlSize]];
  auto foreground=nativeSemanticColor(setting(c,"macosforegroundrole"));buttonForeground(button,foreground);
}
void applyNativeAppearance(MacControl&c) {
  if(!c.view||c.disposed||c.applyingAppearance)return;Applying applying(c);
  auto size=nativeControlSize(c);auto style=setting(c,"macoscontrolstyle");
  if([c.widget respondsToSelector:@selector(setControlSize:)])[(id)c.widget setControlSize:size];
  if([c.widget isKindOfClass:NSTabView.class]&&!c.appearanceSegments) {
    auto tabs=(NSTabView*)c.widget;const NSTabViewType orientations[]={NSTopTabsBezelBorder,NSBottomTabsBezelBorder,NSLeftTabsBezelBorder,NSRightTabsBezelBorder};
    tabs.tabViewType=orientations[std::clamp(int(c.number("taborientation",0)),0,3)];
  }
  NSColor*background=nativeSemanticColor(setting(c,"macosbackgroundrole"));NSColor*foreground=nativeSemanticColor(setting(c,"macosforegroundrole"));
  if(!background&&c.properties.count("backcolor"))background=nativeBackgroundColor(c);
  if(!foreground&&c.properties.count("forecolor"))foreground=nativeForegroundColor(c);
  if([c.widget isKindOfClass:NSButton.class]) {
    auto button=(NSButton*)c.widget;
    if(c.spec.type=="CommandButton") {
      button.bordered=style!=u"borderless";
      button.bezelStyle=style==u"inline"?NSBezelStyleInline:style==u"circular"?NSBezelStyleCircular:style==u"help"?NSBezelStyleHelpButton:NSBezelStyleRounded;
      button.keyEquivalent=style==u"default"||c.flag("default")?@"\r":c.flag("cancel")?@"\033":@"";
      button.hasDestructiveAction=style==u"destructive";button.bezelColor=background;
      if(style==u"destructive"&&!foreground)foreground=NSColor.systemRedColor;
    }
    buttonForeground(button,foreground);
  }
  if([c.widget isKindOfClass:NSSwitch.class]) {
    auto control=(NSSwitch*)c.widget;control.state=c.flag("value")?NSControlStateValueOn:NSControlStateValueOff;
    auto caption=ns(captionText(c.property("caption",Value::string(fromUTF8(c.spec.name))).string()));
    if(setting(c,"macosaccessibilitylabel").empty())control.accessibilityLabel=caption;
    c.appearanceCaption.stringValue=caption;c.appearanceCaption.hidden=!caption.length;
    c.appearanceCaption.textColor=c.flag("enabled",true)?foreground?:NSColor.labelColor:NSColor.disabledControlTextColor;
  }
  if([c.widget isKindOfClass:NSTextField.class]) {
    auto field=(NSTextField*)c.widget;if(foreground)field.textColor=foreground;if(background){field.backgroundColor=background;field.drawsBackground=YES;}
    else if(c.spec.type=="Label")field.drawsBackground=c.flag("backstyle");
  }
  if([c.widget isKindOfClass:NSTextView.class]){auto editor=(NSTextView*)c.widget;if(foreground)editor.textColor=foreground;if(background)editor.backgroundColor=background;}
  if([c.widget isKindOfClass:NSBox.class]) {
    auto box=(NSBox*)c.widget;box.transparent=nativeMaterialActive(c)||background!=nil;
    ((NSTextFieldCell*)box.titleCell).textColor=foreground?:NSColor.labelColor;
  }
  if([c.widget isKindOfClass:NSTableView.class]) {
    auto table=(NSTableView*)c.widget;table.backgroundColor=nativeMaterialActive(c)?NSColor.clearColor:background?:NSColor.controlBackgroundColor;
    for(NSTableColumn*column in table.tableColumns){[(NSCell*)column.dataCell setControlSize:size];if([column.dataCell respondsToSelector:@selector(setTextColor:)])[(id)column.dataCell setTextColor:foreground?:NSColor.controlTextColor];}
  }
  NSView*base=c.appearanceContent?:c.view;
  if([base isKindOfClass:NSScrollView.class]){auto scroll=(NSScrollView*)base;scroll.drawsBackground=!nativeMaterialActive(c);if(background)scroll.backgroundColor=background;}
  if([c.widget isKindOfClass:NSProgressIndicator.class]) {
    auto progress=(NSProgressIndicator*)c.widget;bool active=c.flag("macosindeterminate");
    progress.indeterminate=active;
    if(active&&c.flag("visible",true)&&c.flag("enabled",true))[progress startAnimation:nil];else [progress stopAnimation:nil];
  }
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
  if(@available(macOS 26.0,*))if([c.view isKindOfClass:NSGlassEffectView.class])((NSGlassEffectView*)c.view).tintColor=background;
#endif
  if(c.spec.type=="Toolbar"||c.spec.type=="StatusBar")for(NSView*child in c.widget.subviews)if([child isKindOfClass:NSButton.class])applyNativeItemAppearance(c,(NSButton*)child);
  refreshNativeSegments(c);if(c.appearanceSegments)accessibility(c,c.appearanceSegments);
  accessibility(c,c.widget);if(c.view!=c.widget)accessibility(c,c.view);
  if(c.spec.type=="Form"||c.spec.type=="MDIForm") {
    if(auto object=c.owner.lock()){auto found=c.host->forms.find(object.get());if(found!=c.host->forms.end()){auto window=found->second->window;if(window){window.backgroundColor=background?:nativeBackgroundColor(c);accessibility(c,window);}}}
  }
  layoutNativeAppearance(c);refreshNativePlaceholder(c);c.view.needsDisplay=YES;c.widget.needsDisplay=YES;
}
NSBox* nativeAppearanceBox(const std::shared_ptr<MacControl>&c) {auto box=[VB6AppearanceBox new];box->model=c;return box;}
NSImageView* nativeAppearanceImage(const std::shared_ptr<MacControl>&c) {auto image=[VB6AppearanceImage new];image->model=c;return image;}
NSTextView* nativeAppearanceTextView(const std::shared_ptr<MacControl>&c) {auto editor=[[VB6AppearanceTextView alloc]initWithFrame:NSMakeRect(0,0,120,80)];editor->model=c;return editor;}
NSView* nativeSwitchView(MacControl&c,NSSwitch*control) {
  auto container=[VB6SwitchContainer new];container->model=c.self();
  auto label=[[VB6PlaceholderLabel alloc]initWithFrame:NSZeroRect];label.editable=NO;label.selectable=NO;label.bezeled=NO;label.bordered=NO;label.drawsBackground=NO;label.lineBreakMode=NSLineBreakByTruncatingTail;
  c.appearanceCaption=label;[container addSubview:control];[container addSubview:label];return container;
}
void clickNativeSwitch(MacControl&c) {
  if(c.disposed||![c.widget isKindOfClass:NSSwitch.class])return;
  auto control=(NSSwitch*)c.widget;if(!control.enabled)return;
  control.state=control.state==NSControlStateValueOn?NSControlStateValueOff:NSControlStateValueOn;
  [control sendAction:control.action to:control.target];
}
} // namespace vb6
