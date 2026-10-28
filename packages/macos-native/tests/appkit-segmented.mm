// Real segmented widgets, persistent pages, native editing and collection ABI.
#include "appkit-appearance.hpp"
#include "appkit-collections.hpp"
#include "appkit-edit.hpp"
#include <cassert>
#include <iostream>
#include <sstream>
using namespace vb6;
namespace {
std::shared_ptr<MacControl> control(const std::shared_ptr<Instance>&form,const char*name) {
  auto result=std::dynamic_pointer_cast<MacControl>(form->controls.at(name));assert(result);return result;
}
void setting(Runtime&rt,const std::shared_ptr<MacControl>&c,const char*key,const Text&value) {c->set(rt,key,Value::string(value));}
template<class F>void rejected(F action,int number,int line=__builtin_LINE()) {
  bool caught=false;try{action();}catch(const Error&error){caught=true;if(error.number!=number)std::cerr<<"Expected VB error "<<number<<", received "<<error.number<<" at appkit-segmented.mm:"<<line<<'\n';assert(error.number==number);}
  if(!caught)std::cerr<<"Expected VB error "<<number<<", no error received at appkit-segmented.mm:"<<line<<'\n';assert(caught);
}
std::shared_ptr<MacItem> add(Runtime&rt,const std::shared_ptr<MacItems>&items,const Text&key,const Text&caption,int style=0) {
  return std::dynamic_pointer_cast<MacItem>(items->invoke(rt,"add",{Arg(Value::missing()),Arg(Value::string(key)),Arg(Value::string(caption)),Arg(Value::integer(style,Type::Integer))}).asObject());
}
bool pressSegment(NSSegmentedControl*control,NSInteger index) {
  // Momentary controls ignore programmatic selected-state assignments. Ask
  // AppKit's real accessibility segment to click through its native action.
  assert(index>=0&&index<control.segmentCount);NSString*caption=[control labelForSegment:index];assert(caption.length);
  struct Node {id element;size_t depth;};std::vector<Node>pending{{control,0}};std::vector<id>matches;std::set<const void*>seen;
  std::ostringstream hierarchy;bool truncated=false;
  for(size_t cursor=0;cursor<pending.size();++cursor) {
    if(cursor>=64){truncated=true;break;}const auto node=pending[cursor];id element=node.element;
    if(!seen.insert((__bridge const void*)element).second)continue;
    NSString*role=[element respondsToSelector:@selector(accessibilityRole)]?[element accessibilityRole]:@"";
    NSString*label=[element respondsToSelector:@selector(accessibilityLabel)]?[element accessibilityLabel]:@"";
    NSString*title=[element respondsToSelector:@selector(accessibilityTitle)]?[element accessibilityTitle]:@"";
    const bool press=[element respondsToSelector:@selector(accessibilityPerformPress)];
    const bool button=[role isEqualToString:NSAccessibilityButtonRole]||[role isEqualToString:NSAccessibilityRadioButtonRole]||[role isEqualToString:NSAccessibilityCheckBoxRole];
    hierarchy<<"depth "<<node.depth<<", role "<<(role.UTF8String?:"")<<", label "<<(label.UTF8String?:"")<<", title "<<(title.UTF8String?:"")<<", press "<<press<<'\n';
    if(button&&press&&([label isEqualToString:caption]||[title isEqualToString:caption]))matches.push_back(element);
    NSArray*children=[element respondsToSelector:@selector(accessibilityChildren)]?[element accessibilityChildren]:nil;
    for(id child in children) {
      if(node.depth>=8||pending.size()>=64){truncated=true;break;}
      pending.push_back({child,node.depth+1});
    }
  }
  if(truncated||matches.size()!=1)std::cerr<<"Segment accessibility matches "<<matches.size()<<", caption "<<caption.UTF8String<<", tracking "<<control.trackingMode<<", truncated "<<truncated<<'\n'<<hierarchy.str();
  assert(!truncated&&matches.size()==1);
  return [matches.front() accessibilityPerformPress];
}
}
void checkNativeSegmented(Runtime&rt,MacHost&host,const std::shared_ptr<Instance>&form) {
  auto tab=control(form,"c21"),pages=control(form,"c22"),toolbar=control(form,"c24"),edit=control(form,"c2");
  auto window=host.form(form)->window;[window makeFirstResponder:nil];
  const auto tabHandle=tab->handle,toolbarHandle=toolbar->handle;auto tabs=(NSTabView*)tab->widget;
  tab->set(rt,"width",Value::integer(6000));tab->set(rt,"height",Value::integer(2400));
  auto items=tab->items("tabs");auto first=items->items.front();auto second=add(rt,items,u"second",u"Second");auto third=add(rt,items,u"third",u"Third");
  assert(tab->invoke(rt,"Tabs",{}).asObject()==items);
  assert(tab->invoke(rt,"Tabs",{Arg(Value::integer(2))}).asObject()==second);
  assert(tab->invoke(rt,"tabs",{Arg(Value::string(u"SECOND"))}).asObject()==second);
  NSTabViewItem*firstPage=[tabs tabViewItemAtIndex:0];NSView*originalParent=edit->view.superview;const auto originalFrame=edit->view.frame;
  [firstPage.view addSubview:edit->view];edit->view.frame=NSMakeRect(8,8,200,28);
  setting(rt,edit,"text",u"Keep selection Ω");edit->set(rt,"selstart",Value::integer(2));edit->set(rt,"sellength",Value::integer(4));edit->invoke(rt,"setfocus",{});
  int tabClicks=0,changes=0;
  Procedure clicked;clicked.name="C21_Click";clicked.code=[&](Frame&)->Value{++tabClicks;return {};};form->module->procedures["c21_click"]=std::move(clicked);
  Procedure changed;changed.name="C2_Change";changed.code=[&](Frame&)->Value{++changes;return {};};form->module->procedures["c2_change"]=std::move(changed);
  auto assertEditor=[&]{auto field=(NSTextField*)edit->widget;assert(field.currentEditor&&window.firstResponder==field.currentEditor);assert(edit->get(rt,"text").string()==u"Keep selection Ω"&&edit->get(rt,"selstart").integral()==2&&edit->get(rt,"sellength").integral()==4);assert(changes==0);};
  auto assertInactiveInsertion=[&] {
    const auto pageIndex=items->items.size();NSResponder*editor=window.firstResponder;
    auto inserted=add(rt,items,u"dynamic",u"Dynamic page");auto page=[tabs tabViewItemAtIndex:NSInteger(pageIndex)];const NSRect content=tabs.contentRect;
    assert(content.size.width>0&&content.size.height>0&&NSEqualRects(page.view.frame,content));
    assert(tabs.selectedTabViewItem==firstPage&&window.firstResponder==editor&&tabClicks==0);assertEditor();
    ControlSpec spec{"AppearanceInsertedChild","TextBox",tab->spec.name,{{"tabpage",Value::integer(int64_t(pageIndex))},{"width",Value::integer(1200)},{"height",Value::integer(300)}}};
    auto child=host.createControl(form,spec);assert(child->view.superview==page.view&&NSEqualSizes(child->originalParentSize,content.size));
    assert(tabs.selectedTabViewItem==firstPage&&window.firstResponder==editor&&tabClicks==0);assertEditor();
    child->dispose();items->invoke(rt,"remove",{Arg(Value::string(u"dynamic"))});assert(items->items.size()==pageIndex&&tabs.selectedTabViewItem==firstPage&&window.firstResponder==editor&&tabClicks==0);assertEditor();
  };
  assertInactiveInsertion();
  first->set(rt,"caption",Value::string(u"Renamed without reattachment"));assertEditor();assert(tabs.selectedTabViewItem==firstPage&&tabClicks==0);
  auto inserted=items->invoke(rt,"add",{Arg(Value::integer(1)),Arg(Value::string(u"before")),Arg(Value::string(u"Before"))});
  assertEditor();assert(tabs.selectedTabViewItem==firstPage&&tab->get(rt,"tab").integral()==1&&tabClicks==0);
  items->invoke(rt,"remove",{Arg(Value::string(u"before"))});assertEditor();assert(tab->get(rt,"tab").integral()==0&&tabClicks==0);
  rejected([&]{items->invoke(rt,"remove",{Arg(Value::integer(1))});},380);
  rejected([&]{items->invoke(rt,"clear",{});},380);assertEditor();assert(items->items.size()==3);

  setting(rt,tab,"macoscontrolstyle",u"segmented");assertEditor();
  auto segments=tab->appearanceSegments;assert(segments&&[segments isKindOfClass:NSSegmentedControl.class]);
  assert(tab->widget==tabs&&tab->handle==tabHandle&&tabs.tabViewType==NSNoTabsNoBorder&&!tabs.drawsBackground&&segments.segmentCount==3);
  assert(segments.trackingMode==NSSegmentSwitchTrackingSelectOne&&segments.segmentDistribution==NSSegmentDistributionFillEqually);
  assert(segments.selectedSegment==0&&[segments isSelectedForSegment:0]&&![segments isSelectedForSegment:1]&&![segments isSelectedForSegment:2]);
  assert(host.control(tabHandle)==tab&&host.controlForView(segments)==tab&&tabClicks==0);
  assertInactiveInsertion();
  // A VB validation handler can remove the destination while AppKit hands off
  // the source field editor. Both activation paths must recheck membership.
  for(bool activate:{false,true}) {
    auto destination=add(rt,items,u"transient",u"Transient");int validations=0;
    Procedure validate;validate.name="C2_Validate";validate.parameters={{"Cancel","boolean",true}};
    validate.code=[&](Frame&)->Value{if(++validations==1)items->invoke(rt,"remove",{Arg(Value::string(u"transient"))});return {};};
    form->module->procedures["c2_validate"]=std::move(validate);
    if(activate){segments.selectedSegment=3;[segments sendAction:segments.action to:segments.target];host.check();}
    else rejected([&]{tab->set(rt,"tab",Value::integer(3));},380);
    form->module->procedures.erase("c2_validate");assert(validations==1&&items->items.size()==3&&tabs.selectedTabViewItem==firstPage&&tabClicks==0);
    edit->invoke(rt,"setfocus",{});assertEditor();
  }
  auto beforeImage=items->items.size();rejected([&]{items->invoke(rt,"add",{Arg(Value::missing()),Arg(Value::string(u"image")),Arg(Value::string(u"Image")),Arg(Value::integer(1))});},438);assert(items->items.size()==beforeImage);
  rejected([&]{first->set(rt,"picture",Value::string(u"image.png"));},438);assert(tabs.selectedTabViewItem==firstPage);
  first->set(rt,"tooltiptext",Value::string(u"First page help"));assertEditor();assert(tabs.selectedTabViewItem==firstPage);
  second->set(rt,"enabled",Value::boolean(false));assert(![segments isEnabledForSegment:1]);
  [tabs selectTabViewItemAtIndex:1];host.check();assert(tabs.selectedTabViewItem==firstPage&&tabClicks==0);assertEditor();
  second->set(rt,"enabled",Value::boolean(true));second->set(rt,"visible",Value::boolean(false));
  assert(segments.segmentCount==2&&tab->appearanceSegmentItems[1]==third->identity);assertEditor();
  rejected([&]{setting(rt,tab,"macoscontrolstyle",u"automatic");},438);assert(tab->appearanceSegments==segments);
  tab->set(rt,"tab",Value::integer(1));assert(tabs.selectedTabViewItem==[tabs tabViewItemAtIndex:1]);
  assert(segments.selectedSegment==-1);assert(![segments isSelectedForSegment:0]&&![segments isSelectedForSegment:1]);assert(tabClicks==1);
  assert(window.firstResponder==segments);tab->set(rt,"tab",Value::integer(0));assert(tabClicks==2);
  assert(segments.selectedSegment==0&&[segments isSelectedForSegment:0]&&![segments isSelectedForSegment:1]);
  segments.selectedSegment=1;[segments sendAction:segments.action to:segments.target];host.check();assert(tab->get(rt,"tab").integral()==2&&tabClicks==3);
  assert(tab->get(rt,"selecteditem").asObject()==third);
  tab->set(rt,"enabled",Value::boolean(false));assert(!segments.enabled);segments.selectedSegment=0;[segments sendAction:segments.action to:segments.target];host.check();assert(tabClicks==3&&tab->get(rt,"tab").integral()==2);
  tab->set(rt,"enabled",Value::boolean(true));second->set(rt,"visible",Value::boolean(true));tab->set(rt,"tab",Value::integer(0));
  edit->invoke(rt,"setfocus",{});assertEditor();
  setting(rt,tab,"macosmaterial",u"sidebar");assertEditor();assert(tab->widget==tabs&&tab->appearanceContent==segments.superview&&tabs.selectedTabViewItem==firstPage);
  tab->set(rt,"width",Value::integer(6600));assert(tab->view.bounds.size.width==440&&segments.frame.size.width>420);
  tab->set(rt,"taborientation",Value::integer(1));assert(NSMinY(segments.frame)>NSMaxY(tabs.frame));
  rejected([&]{tab->set(rt,"taborientation",Value::integer(2));},380);assert(tab->get(rt,"taborientation").integral()==1);
  setting(rt,tab,"macosmaterial",u"none");setting(rt,tab,"macoscontrolstyle",u"automatic");assertEditor();
  assert(!tab->appearanceSegments&&tab->view==tabs&&tabs.tabViewType==NSBottomTabsBezelBorder&&tabs.selectedTabViewItem==firstPage);
  rejected([&]{second->set(rt,"visible",Value::boolean(false));},438);assert(second->get(rt,"visible").truth());
  [window makeFirstResponder:nil];[originalParent addSubview:edit->view];edit->view.frame=originalFrame;
  form->module->procedures.erase("c21_click");form->module->procedures.erase("c2_change");

  // A canonical TabPage belongs to its persistent item even when initially
  // inactive. Removing the page cannot silently orphan the child control.
  pages->set(rt,"width",Value::integer(6000));pages->set(rt,"height",Value::integer(2400));
  ControlSpec viewSpec{"AppearancePageView","PictureBox",pages->spec.name,{{"tabpage",Value::integer(1)},{"left",Value::integer(0)},{"top",Value::integer(0)},{"width",Value::integer(6000)},{"height",Value::integer(2400)}}};
  auto pageView=host.createControl(form,viewSpec);form->module->controls.push_back(viewSpec);form->controls["appearancepageview"]=pageView;
  assert(pageView->view.superview==nativeTabContainer(*pages,1));
  ControlSpec childSpec{"AppearancePageChild","TextBox",viewSpec.name,{{"left",Value::integer(450)},{"top",Value::integer(900)},{"width",Value::integer(1200)},{"height",Value::integer(360)},{"text",Value::string(u"Page two")}}};
  auto child=host.createControl(form,childSpec);form->module->controls.push_back(childSpec);form->controls["appearancepagechild"]=child;
  pages->set(rt,"tab",Value::integer(1));assert(child->view.window==window);const auto childHandle=child->handle;auto retainedPage=[(NSTabView*)pages->widget tabViewItemAtIndex:1];
  child->set(rt,"selstart",Value::integer(1));child->set(rt,"sellength",Value::integer(3));child->invoke(rt,"setfocus",{});
  auto assertPageCoordinates=[&] {
    NSView*layout=pages->appearanceContent?:pages->view;const NSRect rect=[layout convertRect:child->view.bounds fromView:child->view];
    const double x=NSMinX(rect)-NSMinX(layout.bounds),y=layout.isFlipped?NSMinY(rect)-NSMinY(layout.bounds):NSMaxY(layout.bounds)-NSMaxY(rect);
    assert(std::abs(x-30)<.001&&std::abs(y-60)<.001&&std::abs(rect.size.width-80)<.001&&std::abs(rect.size.height-24)<.001);
    assert(pageView->get(rt,"left").integral()==0&&pageView->get(rt,"top").integral()==0&&child->get(rt,"left").integral()==450&&child->get(rt,"top").integral()==900);
    assert(child->handle==childHandle&&[(NSTabView*)pages->widget tabViewItemAtIndex:1]==retainedPage&&child->view.superview==pageView->widget);
    assert(window.firstResponder==((NSTextField*)child->widget).currentEditor&&child->get(rt,"text").string()==u"Page two"&&child->get(rt,"selstart").integral()==1&&child->get(rt,"sellength").integral()==3);
  };
  for(const Text&style:{u"automatic",u"segmented"}) {
    setting(rt,pages,"macoscontrolstyle",style);
    for(int orientation:{0,1}){pages->set(rt,"taborientation",Value::integer(orientation));assertPageCoordinates();}
    if(style==u"segmented"){setting(rt,pages,"macosmaterial",u"sidebar");assertPageCoordinates();setting(rt,pages,"macosmaterial",u"none");assertPageCoordinates();}
  }
  setting(rt,pages,"macoscontrolstyle",u"automatic");assertPageCoordinates();
  pages->invoke(rt,"let:tabcaption",{Arg(Value::integer(1)),Arg(Value::string(u"Second page"))});assert(pages->invoke(rt,"tabcaption",{Arg(Value::integer(1))}).string()==u"Second page");
  rejected([&]{pages->set(rt,"tabs",Value::integer(1));},380);assert(pages->get(rt,"tabs").integral()==3);[window makeFirstResponder:nil];child->dispose();pageView->dispose();
  form->controls.erase("appearancepagechild");form->controls.erase("appearancepageview");form->module->controls.pop_back();form->module->controls.pop_back();
  pages->set(rt,"tabs",Value::integer(2));assert(pages->get(rt,"tabs").integral()==2);
  assert(pages->invoke(rt,"Tabs",{}).integral()==2);
  rejected([&]{pages->invoke(rt,"Tabs",{Arg(Value::integer(1))});},438);

  // Multiline editors use NSTextDelegate, not the NSTextField delegate path.
  // Cancellation must retain the active page, focus, selection and rich runs.
  for(const std::string&type:{"TextBox","RichTextBox"}) {
    ControlSpec spec{"AppearanceMultilineChild",type,pages->spec.name,{{"tabpage",Value::integer(1)},{"multiline",Value::boolean(true)},{"width",Value::integer(3000)},{"height",Value::integer(1200)},{"text",Value::string(u"Multiple lines\nKeep this selection")}}};
    auto child=host.createControl(form,spec);form->module->controls.push_back(spec);form->controls["appearancemultilinechild"]=child;
    pages->set(rt,"tab",Value::integer(1));child->invoke(rt,"setfocus",{});auto editor=(NSTextView*)child->widget;
    [editor insertText:@"!" replacementRange:NSMakeRange(editor.string.length,0)];host.check();
    child->set(rt,"selstart",Value::integer(2));child->set(rt,"sellength",Value::integer(4));
    NSAttributedString*before=[editor.textStorage copy];int validations=0,lostFocus=0;bool cancel=true;
    Procedure validate;validate.name="AppearanceMultilineChild_Validate";validate.parameters={{"Cancel","boolean",true}};
    validate.code=[&](Frame&frame)->Value{++validations;frame.ref("cancel").set(Value::boolean(cancel));return {};};form->module->procedures["appearancemultilinechild_validate"]=std::move(validate);
    Procedure lost;lost.name="AppearanceMultilineChild_LostFocus";lost.code=[&](Frame&)->Value{++lostFocus;return {};};form->module->procedures["appearancemultilinechild_lostfocus"]=std::move(lost);
    rejected([&]{pages->set(rt,"tab",Value::integer(0));},380);assert(validations==1&&lostFocus==0&&pages->get(rt,"tab").integral()==1&&window.firstResponder==editor);
    assert(NSEqualRanges(editor.selectedRange,NSMakeRange(2,4))&&[editor.textStorage isEqualToAttributedString:before]);
    cancel=false;pages->set(rt,"tab",Value::integer(0));host.check();assert(validations==2&&lostFocus==1&&[editor.textStorage isEqualToAttributedString:before]);
    form->module->procedures.erase("appearancemultilinechild_validate");form->module->procedures.erase("appearancemultilinechild_lostfocus");
    child->dispose();form->controls.erase("appearancemultilinechild");form->module->controls.pop_back();
  }

  int buttonClicks=0;ObjectPtr observedButton;
  Procedure buttonClick;buttonClick.name="C24_ButtonClick";buttonClick.parameters={{"Button","object",false}};
  buttonClick.code=[&](Frame&f)->Value{++buttonClicks;observedButton=f.get("button").asObject();return {};};form->module->procedures["c24_buttonclick"]=std::move(buttonClick);
  auto buttons=toolbar->items("buttons");NSView*toolbarWidget=toolbar->widget;NSView*ownedToolbarChild=[NSView new];[toolbarWidget addSubview:ownedToolbarChild];
  for(int mode:{0,1,2}) {
    setting(rt,toolbar,"macoscontrolstyle",u"automatic");buttons->invoke(rt,"clear",{});
    auto a=add(rt,buttons,u"a",u"First",mode),b=add(rt,buttons,u"b",u"Second",mode);
    assert(toolbar->invoke(rt,"Buttons",{}).asObject()==buttons);
    assert(toolbar->invoke(rt,"Buttons",{Arg(Value::integer(1))}).asObject()==a);
    assert(toolbar->invoke(rt,"buttons",{Arg(Value::string(u"B"))}).asObject()==b);
    assert(toolbar->invoke(rt,"Buttons",{Arg(Value::integer(2),"index")}).asObject()==b);
    rejected([&]{toolbar->invoke(rt,"Buttons",{Arg(Value::integer(0))});},35600);
    rejected([&]{toolbar->invoke(rt,"Buttons",{Arg(Value::integer(3))});},35600);
    rejected([&]{toolbar->invoke(rt,"Buttons",{Arg(Value::string(u"missing"))});},35601);
    rejected([&]{toolbar->invoke(rt,"Buttons",{Arg(Value::integer(1)),Arg(Value::integer(2))});},450);
    assert(a->get(rt,"value").integral()==0&&b->get(rt,"value").integral()==0);
    if(mode!=0)a->set(rt,"value",Value::integer(1));
    setting(rt,toolbar,"macoscontrolstyle",u"segmented");auto native=toolbar->appearanceSegments;
    assert(native&&native.segmentCount==2&&toolbar->widget==toolbarWidget&&toolbar->handle==toolbarHandle);
    assert(native.trackingMode==(mode==0?NSSegmentSwitchTrackingMomentary:mode==1?NSSegmentSwitchTrackingSelectAny:NSSegmentSwitchTrackingSelectOne));
    int before=buttonClicks;const bool pressed=pressSegment(native,1);host.check();
    if(buttonClicks!=before+1||observedButton!=b)std::cerr<<"Segment action mode "<<mode<<", pressed "<<pressed<<", selected "<<native.selectedSegment<<", clicks "<<buttonClicks-before<<", expected item "<<(observedButton==b)<<'\n';
    // AppKit can return NO after a momentary press has already sent its action.
    // Prove delivery through the real VB event and original item, then state.
    assert(buttonClicks==before+1);assert(observedButton==b);
    assert(b->get(rt,"value").integral()==(mode==0?0:1));assert(a->get(rt,"value").integral()==(mode==1?1:0));
    if(mode==0)assert(![native isSelectedForSegment:0]&&![native isSelectedForSegment:1]);
    b->set(rt,"enabled",Value::boolean(false));before=buttonClicks;pressSegment(native,1);host.check();assert(buttonClicks==before);
    b->set(rt,"enabled",Value::boolean(true));a->set(rt,"visible",Value::boolean(false));assert(native.segmentCount==1&&toolbar->appearanceSegmentItems.front()==b->identity);
    if(mode==2){
      a->set(rt,"value",Value::integer(1));assert(b->get(rt,"value").integral()==0);assert(native.selectedSegment==-1);assert(![native isSelectedForSegment:0]);
      b->set(rt,"value",Value::integer(1));assert(a->get(rt,"value").integral()==0);assert(native.selectedSegment==0&&[native isSelectedForSegment:0]);
    }
    auto count=buttons->items.size();rejected([&]{add(rt,buttons,u"invalid",u"Invalid",(mode+1)%3);},380);assert(buttons->items.size()==count);
    rejected([&]{buttons->invoke(rt,"add",{Arg(Value::missing()),Arg(Value::string(u"image")),Arg(Value::string(u"Image")),Arg(Value::integer(mode)),Arg(Value::integer(1))});},438);assert(buttons->items.size()==count);
    rejected([&]{b->set(rt,"style",Value::integer((mode+1)%3));},380);assert(b->get(rt,"style").integral()==mode);
    rejected([&]{b->set(rt,"value",Value::real(.5));},380);
    setting(rt,toolbar,"macosaccessibilitylabel",u"Page selection");assert([native.accessibilityLabel isEqualToString:@"Page selection"]);
  }
  setting(rt,toolbar,"macoscontrolstyle",u"automatic");assert(!toolbar->appearanceSegments&&toolbar->widget==toolbarWidget&&ownedToolbarChild.superview==toolbarWidget);[ownedToolbarChild removeFromSuperview];
  form->module->procedures.erase("c24_buttonclick");

  // Exercise the exact object-record ABI emitted by both native compilers.
  ControlSpec authoredTabs{"AuthoredTabs","SSTab","",{{"macoscontrolstyle",Value::string(u"segmented")},{"tab",Value::integer(1)},
    {"tabs",arrayValue({Value::string(u"{\"Key\":\"first\",\"Caption\":\"First\",\"Enabled\":-1,\"Visible\":-1}"),Value::string(u"{\"Key\":\"second\",\"Caption\":\"Second\",\"Enabled\":-1,\"Visible\":-1}")})}}};
  auto authored=std::make_shared<MacControl>(host,form,authoredTabs);authored->initialize();
  assert(authored->get(rt,"tabs").integral()==2&&authored->get(rt,"tab").integral()==1&&authored->appearanceSegments.selectedSegment==1);
  assert([[(NSTabView*)authored->widget selectedTabViewItem].label isEqualToString:@"Second"]);authored->dispose();
  ControlSpec authoredToolbar{"AuthoredSegments","Toolbar","",{{"macoscontrolstyle",Value::string(u"segmented")},
    {"buttons",arrayValue({Value::string(u"{\"Key\":\"run\",\"Caption\":\"Run\"}")})}}};
  auto decoded=std::make_shared<MacControl>(host,form,authoredToolbar);decoded->initialize();
  assert(decoded->items("buttons")->items.front()->get(rt,"value").integral()==0&&decoded->appearanceSegments.segmentCount==1);decoded->dispose();
  for(const Text&record:{u"{\"Caption\":\"One\",\"Text\":\"Two\"}",u"{\"Style\":1,\"style\":2}",u"{\"Style\":6}",u"{\"Value\":-1}"}) {
    ControlSpec invalidSpec{"InvalidToolbar","Toolbar","",{{"buttons",arrayValue({Value::string(record)})}}};
    auto invalid=std::make_shared<MacControl>(host,form,invalidSpec);rejected([&]{invalid->initialize();},380);invalid->dispose();
  }
  ControlSpec invalidTabs{"InvalidTabs","TabStrip","",{{"macoscontrolstyle",Value::string(u"segmented")},{"tabs",arrayValue({Value::string(u"{\"Caption\":\"Image\",\"Image\":1}")})}}};
  auto invalid=std::make_shared<MacControl>(host,form,invalidTabs);rejected([&]{invalid->initialize();},438);invalid->dispose();
  host.check();std::cout<<"APPKIT_SEGMENTED_OK\n";
}
