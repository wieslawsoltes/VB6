// Actual AppKit object creation, events, controls and wide-buffer adapters.
#include "appkit.hpp"
#include <cassert>
#include <iostream>
using namespace vb6;
static int clicks=0;
void checkNativeRecordsetsAppKit(Runtime&, MacHost&, const std::shared_ptr<Instance>&);
void checkNativePictures(Runtime&, MacHost&, const std::shared_ptr<Instance>&);
void checkNativeEditing(Runtime&, MacHost&, const std::shared_ptr<Instance>&);
void checkNativeAppearance(Runtime&, MacHost&, const std::shared_ptr<Instance>&);
int main(){@autoreleasepool {
  Runtime rt(makeNativeHost());auto&host=dynamic_cast<MacHost&>(*rt.host);
  Module m;m.name="NativeForm";m.kind="form";m.optionExplicit=true;
  m.form=ControlSpec{"NativeForm","Form","",{{"caption",Value::string(u"Native test")},{"clientwidth",Value::integer(9000)},{"clientheight",Value::integer(6000)}}};
  const std::vector<std::string> types={"CommandButton","Label","TextBox","CheckBox","OptionButton","Frame","PictureBox","Image","Shape","Line","ListBox","ComboBox","Timer","HScrollBar","VScrollBar","ProgressBar","Slider","UpDown","RichTextBox","DTPicker","MonthView","TabStrip","SSTab","StatusBar","Toolbar","TreeView","ListView","MSFlexGrid","MSHFlexGrid","DataGrid","CommonDialog","ImageList","MSChart"};
  for(size_t i=0;i<types.size();++i){ControlSpec s;s.name="C"+std::to_string(i);s.type=types[i];s.properties={{"left",Value::integer(0)},{"top",Value::integer(0)},{"width",Value::integer(1800)},{"height",Value::integer(600)},{"enabled",Value::boolean(true)},{"visible",Value::boolean(true)}};m.controls.push_back(s);}
  Procedure click;click.name="C0_Click";click.code=[](Frame&)->Value{++clicks;return {};};m.procedures["c0_click"]=click;
  rt.modules["nativeform"]=std::move(m);auto form=rt.instance("nativeform");rt.load(form);
  assert(form->controls.size()==types.size());auto button=std::dynamic_pointer_cast<MacControl>(form->controls.at("c0"));
  assert([button->widget isKindOfClass:NSButton.class]);[(NSButton*)button->widget performClick:nil];host.check();assert(clicks==1);
  auto edit=std::dynamic_pointer_cast<MacControl>(form->controls.at("c2"));edit->set(rt,"text",Value::string(u"Apple \u03a9"));assert(edit->get(rt,"text").string()==u"Apple \u03a9");
  auto buffer=std::make_shared<Cell>(Value::string(Text(64,0)),"string");Arg output(cellRef(buffer));
  auto count=host.api(rt,"user32.GetWindowTextW",{Arg(Value::integer(edit->handle)),output,Arg(Value::integer(64))});
  assert(count.integral()==7);assert(buffer->get().string().substr(0,7)==u"Apple \u03a9");
  auto list=std::dynamic_pointer_cast<MacControl>(form->controls.at("c10"));list->invoke(rt,"additem",{Arg(Value::string(u"Alpha"))});assert(list->get(rt,"listcount").integral()==1);
  auto tree=std::dynamic_pointer_cast<MacControl>(form->controls.at("c25"));auto nodes=tree->items("nodes");auto root=nodes->invoke(rt,"add",{Arg(Value::missing()),Arg(Value::missing()),Arg(Value::string(u"root")),Arg(Value::string(u"Root"))});assert(nodes->items.size()==1);assert(root.asObject()->get(rt,"text").string()==u"Root");
  auto grid=std::dynamic_pointer_cast<MacControl>(form->controls.at("c27"));grid->invoke(rt,"let:textmatrix",{Arg(Value::integer(1)),Arg(Value::integer(1)),Arg(Value::string(u"Cell"))});assert(grid->invoke(rt,"textmatrix",{Arg(Value::integer(1)),Arg(Value::integer(1))}).string()==u"Cell");
  auto tab=std::dynamic_pointer_cast<MacControl>(form->controls.at("c21"));tab->items("tabs")->invoke(rt,"add",{Arg(Value::missing()),Arg(Value::string(u"one")),Arg(Value::string(u"One"))});assert([(NSTabView*)tab->widget numberOfTabViewItems]==1);
  checkNativeEditing(rt,host,form);
  checkNativePictures(rt,host,form);
  checkNativeRecordsetsAppKit(rt,host,form);
  checkNativeAppearance(rt,host,form);
  int32_t old=edit->handle;rt.unload(form);assert(!host.handles.find(old));
  std::cout<<"APPKIT_CONFORMANCE_OK controls="<<types.size()<<"\n";
}}
