// Real AppKit appearance, identity, editing and container acceptance. MIT.
#include "appkit-appearance.hpp"
#include "appkit-edit.hpp"
#include <cassert>
#include <iostream>
using namespace vb6;
namespace {
std::shared_ptr<MacControl> control(const std::shared_ptr<Instance>&form,const char*name) {
  auto result=std::dynamic_pointer_cast<MacControl>(form->controls.at(name));assert(result);return result;
}
void stringProperty(Runtime&rt,const std::shared_ptr<MacControl>&c,const char*name,const Text&value) {c->set(rt,name,Value::string(value));}
void rejected(Runtime&rt,const std::shared_ptr<MacControl>&c,const char*name,Value value,int number) {
  bool caught=false;try{c->set(rt,name,std::move(value));}catch(const Error&error){caught=true;assert(error.number==number);}assert(caught);
}
int switchClicks=0,editChanges=0;
std::vector<int64_t> screenPoint(Runtime&rt,MacHost&host,const std::shared_ptr<MacControl>&c) {
  std::vector<Value>bytes;for(int n:{4,0,0,0,6,0,0,0})bytes.push_back(Value::integer(n,Type::Byte));
  auto buffer=arrayValue(bytes,0,"byte");host.api(rt,"user32.ClientToScreen",{Arg(Value::integer(c->handle)),Arg(buffer)});
  std::vector<int64_t>result;for(auto&value:buffer.asArray()->values)result.push_back(value.integral());return result;
}
}
void checkNativeAppearance(Runtime&rt,MacHost&host,const std::shared_ptr<Instance>&form) {
  auto button=control(form,"c0"),label=control(form,"c1"),edit=control(form,"c2"),check=control(form,"c3"),frame=control(form,"c5"),picture=control(form,"c6"),list=control(form,"c10"),combo=control(form,"c11"),progress=control(form,"c15"),rich=control(form,"c18");
  auto window=host.form(form)->window;
  [window makeFirstResponder:nil];

  for(auto size:{u"mini",u"small",u"regular",u"large"}) {
    stringProperty(rt,button,"macoscontrolsize",size);
    assert(((NSButton*)button->widget).controlSize==nativeControlSize(*button));
  }
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
  if(@available(macOS 26.0,*)) {
    stringProperty(rt,button,"macoscontrolsize",u"extraLarge");
    assert(((NSButton*)button->widget).controlSize==NSControlSizeExtraLarge);
  }else rejected(rt,button,"macoscontrolsize",Value::string(u"extraLarge"),380);
#else
  rejected(rt,button,"macoscontrolsize",Value::string(u"extraLarge"),380);
#endif
  stringProperty(rt,button,"macoscontrolsize",u"regular");
  for(auto style:{u"automatic",u"push",u"default",u"destructive",u"borderless",u"inline",u"circular",u"help"}) {
    stringProperty(rt,button,"macoscontrolstyle",style);auto native=(NSButton*)button->widget;
    assert(native.bordered==(Text(style)!=u"borderless"));
    assert(native.hasDestructiveAction==(Text(style)==u"destructive"));
    if(Text(style)==u"default")assert([native.keyEquivalent isEqualToString:@"\r"]);
    if(Text(style)==u"inline")assert(native.bezelStyle==NSBezelStyleInline);
    if(Text(style)==u"circular")assert(native.bezelStyle==NSBezelStyleCircular);
    if(Text(style)==u"help")assert(native.bezelStyle==NSBezelStyleHelpButton);
  }
  stringProperty(rt,button,"macoscontrolstyle",u"automatic");

  const auto checkHandle=check->handle;
  Procedure click;click.name="C3_Click";click.code=[](Frame&)->Value{++switchClicks;return {};};form->module->procedures["c3_click"]=std::move(click);
  stringProperty(rt,check,"macoscontrolstyle",u"switch");
  assert([check->widget isKindOfClass:NSSwitch.class]);assert(check->handle==checkHandle&&host.control(checkHandle)==check);
  stringProperty(rt,check,"caption",u"Keep projects synced");
  assert(check->appearanceCaption&&[check->appearanceCaption.stringValue isEqualToString:@"Keep projects synced"]&&!check->appearanceCaption.hidden);
  assert(check->view!=check->widget&&check->appearanceCaption.superview==check->view&&check->widget.superview==check->view);
  auto nativeSwitch=(NSSwitch*)check->widget;nativeSwitch.state=NSControlStateValueOn;
  [nativeSwitch sendAction:nativeSwitch.action to:nativeSwitch.target];host.check();assert(switchClicks==1&&check->get(rt,"value").integral()==1);
  rejected(rt,check,"value",Value::integer(2),380);assert(check->get(rt,"value").integral()==1);
  rejected(rt,check,"value",Value::real(.5),380);
  stringProperty(rt,check,"macosforegroundrole",u"secondaryLabelColor");assert([check->appearanceCaption.textColor isEqual:NSColor.secondaryLabelColor]);
  host.api(rt,"user32.SendMessageW",{Arg(Value::integer(check->handle)),Arg(Value::integer(0xf5)),Arg(Value::integer(0)),Arg(Value::integer(0))});
  assert(switchClicks==2&&check->get(rt,"value").integral()==0&&nativeSwitch.state==NSControlStateValueOff);
  [check->view mouseDown:nil];host.check();assert(switchClicks==3&&check->get(rt,"value").integral()==1);
  stringProperty(rt,check,"macosaccessibilitylabel",u"Automatic updates");
  assert([nativeSwitch.accessibilityLabel isEqualToString:@"Automatic updates"]);
  stringProperty(rt,check,"macoscontrolstyle",u"automatic");
  assert([check->widget isKindOfClass:NSButton.class]);assert(((NSButton*)check->widget).state==NSControlStateValueOn&&check->handle==checkHandle&&!check->appearanceCaption);
  check->set(rt,"value",Value::integer(2));assert(((NSButton*)check->widget).state==NSControlStateValueMixed);
  rejected(rt,check,"macoscontrolstyle",Value::string(u"switch"),380);assert([check->widget isKindOfClass:NSButton.class]);
  check->set(rt,"value",Value::integer(0));form->module->procedures.erase("c3_click");

  stringProperty(rt,edit,"text",u"Find \u03a9");edit->set(rt,"selstart",Value::integer(1));edit->set(rt,"sellength",Value::integer(3));
  stringProperty(rt,edit,"placeholdertext",u"Search project");edit->invoke(rt,"setfocus",{});
  const auto editHandle=edit->handle;NSView*parent=edit->view.superview;
  Procedure changed;changed.name="C2_Change";changed.code=[](Frame&)->Value{++editChanges;return {};};form->module->procedures["c2_change"]=std::move(changed);
  stringProperty(rt,edit,"macoscontrolstyle",u"search");
  assert([edit->widget isKindOfClass:NSSearchField.class]);assert(edit->handle==editHandle&&edit->view.superview==parent);
  assert(edit->get(rt,"text").string()==u"Find \u03a9"&&edit->get(rt,"selstart").integral()==1&&edit->get(rt,"sellength").integral()==3);
  auto search=(NSSearchField*)edit->widget;assert(search.currentEditor&&window.firstResponder==search.currentEditor);
  assert([search.placeholderString isEqualToString:@"Search project"]&&editChanges==0);
  stringProperty(rt,edit,"macoscontrolstyle",u"automatic");
  assert(![edit->widget isKindOfClass:NSSearchField.class]);assert(edit->get(rt,"text").string()==u"Find \u03a9"&&edit->get(rt,"sellength").integral()==3&&editChanges==0);
  [window makeFirstResponder:nil];form->module->procedures.erase("c2_change");
  stringProperty(rt,combo,"placeholdertext",u"Choose or enter");assert([((NSComboBox*)combo->widget).placeholderString isEqualToString:@"Choose or enter"]);

  ControlSpec multilineSpec{"AppearanceNotes","TextBox","",{{"multiline",Value::boolean(true)},{"width",Value::integer(2400)},{"height",Value::integer(1200)},{"placeholdertext",Value::string(u"Notes")}}};
  auto multiline=std::make_shared<MacControl>(host,form,multilineSpec);multiline->initialize();
  assert(multiline->appearancePlaceholder&&!multiline->appearancePlaceholder.hidden);
  assert([multiline->appearancePlaceholder hitTest:NSMakePoint(1,1)]==nil);
  stringProperty(rt,multiline,"text",u"Actual notes");assert(multiline->appearancePlaceholder.hidden);
  stringProperty(rt,multiline,"text",u"");assert(!multiline->appearancePlaceholder.hidden);
  rejected(rt,multiline,"macoscontrolstyle",Value::string(u"search"),380);multiline->dispose();

  stringProperty(rt,edit,"macosbackgroundrole",u"textBackgroundColor");stringProperty(rt,edit,"macosforegroundrole",u"labelColor");
  assert([((NSTextField*)edit->widget).backgroundColor isEqual:NSColor.textBackgroundColor]);
  assert([((NSTextField*)edit->widget).textColor isEqual:NSColor.labelColor]);
  __block int32_t light=0,dark=0;
  [[NSAppearance appearanceNamed:NSAppearanceNameAqua]performAsCurrentDrawingAppearance:^{light=colorValue(nativeForegroundColor(*edit));}];
  [[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]performAsCurrentDrawingAppearance:^{dark=colorValue(nativeForegroundColor(*edit));}];
  assert(light!=dark);
  for(auto role:{u"windowBackgroundColor",u"controlBackgroundColor",u"textBackgroundColor",u"labelColor",u"secondaryLabelColor",u"tertiaryLabelColor",u"disabledControlTextColor",u"controlTextColor",u"textColor",u"controlAccentColor",u"selectedContentBackgroundColor",u"selectedTextBackgroundColor",u"selectedTextColor",u"unemphasizedSelectedContentBackgroundColor",u"unemphasizedSelectedTextColor",u"separatorColor",u"gridColor",u"linkColor",u"accentPressedColor",u"destructiveColor",u"destructivePressedColor",u"focusIndicatorColor"})assert(nativeSemanticColor(role));
  rejected(rt,edit,"macosforegroundrole",Value::string(u"madeUpColor"),380);assert(edit->get(rt,"macosforegroundrole").string()==u"labelColor");
  edit->set(rt,"forecolor",Value::integer(0xff));assert(edit->get(rt,"macosforegroundrole").string().empty());assert(colorValue(((NSTextField*)edit->widget).textColor)==0xff);
  stringProperty(rt,label,"macosbackgroundrole",u"windowBackgroundColor");assert(((NSTextField*)label->widget).drawsBackground);
  stringProperty(rt,frame,"macosforegroundrole",u"secondaryLabelColor");assert([((NSTextFieldCell*)((NSBox*)frame->widget).titleCell).textColor isEqual:NSColor.secondaryLabelColor]);
  stringProperty(rt,list,"macosbackgroundrole",u"textBackgroundColor");list->set(rt,"backcolor",Value::integer(0xff));assert(list->get(rt,"macosbackgroundrole").string().empty());assert(colorValue(((NSTableView*)list->widget).backgroundColor)==0xff);
  stringProperty(rt,list,"macosforegroundrole",u"secondaryLabelColor");list->set(rt,"forecolor",Value::integer(0xff00));assert(list->get(rt,"macosforegroundrole").string().empty());assert(colorValue([(NSTextFieldCell*)((NSTableView*)list->widget).tableColumns.firstObject.dataCell textColor])==0xff00);
  rejected(rt,progress,"macosforegroundrole",Value::string(u"labelColor"),438);

  stringProperty(rt,edit,"macosaccessibilitylabel",u"Project query");stringProperty(rt,edit,"macosaccessibilityhelp",u"Filter controls by name");stringProperty(rt,edit,"macosaccessibilityidentifier",u"project-query");
  assert([edit->widget.accessibilityLabel isEqualToString:@"Project query"]&&[edit->widget.accessibilityHelp isEqualToString:@"Filter controls by name"]&&[edit->widget.accessibilityIdentifier isEqualToString:@"project-query"]);
  stringProperty(rt,rich,"text",u"red BLUE");auto richEditor=(NSTextView*)rich->widget;
  [richEditor.textStorage addAttribute:NSForegroundColorAttributeName value:NSColor.redColor range:NSMakeRange(0,3)];
  [richEditor.textStorage addAttribute:NSFontAttributeName value:[NSFont boldSystemFontOfSize:22]range:NSMakeRange(4,4)];
  richEditor.selectedRange=NSMakeRange(4,4);auto richBefore=[richEditor.textStorage copy];
  stringProperty(rt,rich,"macosaccessibilityidentifier",u"rich-editor");stringProperty(rt,rich,"macosaccessibilityhelp",u"Rich notes");stringProperty(rt,rich,"macosaccessibilitylabel",u"Notes");
  assert([richEditor.textStorage isEqualToAttributedString:richBefore]&&richEditor.selectedRange.location==4&&richEditor.selectedRange.length==4);
  stringProperty(rt,host.form(form)->surface,"macosaccessibilitylabel",u"Project editor");assert([window.accessibilityLabel isEqualToString:@"Project editor"]);
  progress->set(rt,"macosindeterminate",Value::integer(-1));assert(((NSProgressIndicator*)progress->widget).indeterminate);
  progress->set(rt,"macosindeterminate",Value::integer(0));assert(!((NSProgressIndicator*)progress->widget).indeterminate);
  rejected(rt,progress,"macosindeterminate",Value::integer(1),380);rejected(rt,edit,"macosindeterminate",Value::integer(-1),380);
  rejected(rt,progress,"macosindeterminate",Value::real(.5),380);rejected(rt,progress,"macosindeterminate",Value::string(u"-1"),380);

  NSView*buttonParent=button->view.superview;NSRect buttonFrame=button->view.frame;NSView*content=picture->widget;
  NSView*editParent=edit->view.superview;NSRect editFrame=edit->view.frame;
  [content addSubview:button->view];[content addSubview:edit->view];const auto pictureHandle=picture->handle;
  const auto originalPoint=screenPoint(rt,host,picture);
  stringProperty(rt,edit,"text",u"Keep live selection");edit->set(rt,"selstart",Value::integer(5));edit->set(rt,"sellength",Value::integer(4));edit->invoke(rt,"setfocus",{});
  for(auto role:{u"content",u"sidebar",u"titlebar",u"toolbar",u"menu",u"popover",u"sheet",u"hud"}) {
    stringProperty(rt,picture,"macosmaterial",role);assert(nativeMaterialActive(*picture));
    assert(picture->widget==content&&picture->appearanceContent==content&&button->view.superview==content&&picture->handle==pictureHandle);
    assert(screenPoint(rt,host,picture)==originalPoint);
    assert(((NSTextField*)edit->widget).currentEditor&&window.firstResponder==((NSTextField*)edit->widget).currentEditor);
    assert(edit->get(rt,"text").string()==u"Keep live selection"&&edit->get(rt,"selstart").integral()==5&&edit->get(rt,"sellength").integral()==4);
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if(@available(macOS 26.0,*)) {
      if(Text(role)==u"content")assert([picture->view isKindOfClass:NSVisualEffectView.class]);
      else {assert([picture->view isKindOfClass:NSGlassEffectView.class]);assert(((NSGlassEffectView*)picture->view).contentView==content);}
    }else assert([picture->view isKindOfClass:NSVisualEffectView.class]);
#else
    assert([picture->view isKindOfClass:NSVisualEffectView.class]);
#endif
  }
  picture->set(rt,"width",Value::integer(3600));assert(picture->view.bounds.size.width==240&&content.frame.size.width==240);
  stringProperty(rt,picture,"macosmaterial",u"none");assert(picture->view==content&&!picture->appearanceContent&&button->view.superview==content);
  assert(edit->get(rt,"selstart").integral()==5&&edit->get(rt,"sellength").integral()==4);
  [window makeFirstResponder:nil];[buttonParent addSubview:button->view];button->view.frame=buttonFrame;[editParent addSubview:edit->view];edit->view.frame=editFrame;
  NSView*scroll=list->view;NSView*table=list->widget;
  stringProperty(rt,list,"macosmaterial",u"sidebar");list->set(rt,"width",Value::integer(3000));
  assert(list->appearanceContent==scroll&&((NSScrollView*)scroll).documentView==table&&scroll.frame.size.width==200);
  assert(!((NSScrollView*)scroll).drawsBackground);stringProperty(rt,list,"macosmaterial",u"none");assert(list->view==scroll&&((NSScrollView*)scroll).documentView==table);
  auto surface=host.form(form)->surface;NSView*surfaceContent=surface->widget;
  edit->invoke(rt,"setfocus",{});
  stringProperty(rt,surface,"macosmaterial",u"content");assert(window.contentView==surface->view&&surface->appearanceContent==surfaceContent);
  stringProperty(rt,surface,"macosmaterial",u"none");assert(window.contentView==surfaceContent&&surface->view==surfaceContent);
  assert(window.firstResponder==((NSTextField*)edit->widget).currentEditor&&edit->get(rt,"selstart").integral()==5&&edit->get(rt,"sellength").integral()==4);
  [window makeFirstResponder:nil];rejected(rt,control(form,"c21"),"macosmaterial",Value::string(u"sidebar"),438);
  host.check();std::cout<<"APPKIT_APPEARANCE_OK\n";
}
