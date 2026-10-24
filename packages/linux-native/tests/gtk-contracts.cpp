// Execute real GTK signals against the exact exported AOT runtime. MIT.
#include "gtk.hpp"
#include <iostream>
#include <cstring>

using namespace vb6;
namespace {
void require(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
void expectError(int number,const std::function<void()>& action) {
  try{action();}catch(const Error& error){require(error.number==number,"Unexpected VB error number");return;}
  throw std::runtime_error("Expected VB error was not raised");
}
ControlSpec spec(const std::string& type,const std::string& name,std::vector<Property> properties={}) {
  ControlSpec result;result.type=type;result.name=name;result.properties={{"width",Value::integer(1500)},{"height",Value::integer(450)}};
  result.properties.insert(result.properties.end(),properties.begin(),properties.end());return result;
}
Procedure procedure(const std::string& name,std::function<Value(Frame&)> code,std::vector<Parameter> parameters={}) {
  Procedure result;result.name=name;result.scope="private";result.code=std::move(code);result.parameters=std::move(parameters);return result;
}
std::shared_ptr<GtkControl> control(const std::shared_ptr<Instance>& form,const std::string& name) {
  auto found=form->controls.find(lower(name));require(found!=form->controls.end(),"Missing native fixture control");
  auto c=std::dynamic_pointer_cast<GtkControl>(found->second);require(bool(c),"Invalid native control type");return c;
}
Parameter param(const std::string& name,const std::string& type,bool byRef=true){Parameter value;value.name=name;value.type=type;value.byRef=byRef;return value;}
void checkNativeTree(GtkControl& tree,const std::vector<std::shared_ptr<GtkItem>>& expected){
  auto* model=gtk_tree_view_get_model(GTK_TREE_VIEW(tree.widget));
  require(model&&model==tree.model&&GTK_IS_TREE_STORE(model),"TreeView is not displaying its native GtkTreeStore");
  require(gtk_tree_model_iter_n_children(model,nullptr)==(expected.empty()?0:1),"Native tree has an unexpected root count");
  require(tree.treePaths.size()==expected.size(),"Native tree path identities differ from the node collection");
  if(expected.empty())return;
  GtkTreeIter iter;require(gtk_tree_model_get_iter_first(model,&iter),"Native tree root is missing");
  for(size_t depth=0;depth<expected.size();++depth){
    guint64 identity=0;gchar* text=nullptr;
    gtk_tree_model_get(model,&iter,0,&text,gtk_tree_model_get_n_columns(model)-1,&identity,-1);
    const bool matches=text&&toUTF8(expected[depth]->properties.at("text").string())==text;g_free(text);
    require(matches&&identity==expected[depth]->identity,"Native tree row lost its text or node identity");
    GtkTreeIter sibling=iter;require(!gtk_tree_model_iter_next(model,&sibling),"Native boundary tree has an unexpected sibling");
    const bool child=depth+1<expected.size();
    require(gtk_tree_model_iter_n_children(model,&iter)==(child?1:0),"Native tree has the wrong depth or child count");
    if(child){GtkTreeIter next;require(gtk_tree_model_iter_children(model,&next,&iter),"Native tree descendant is missing");iter=next;}
  }
}
}
int main() {
  try {
    Runtime runtime(makeNativeHost());runtime.name="GTK Native Contract Tests";
    auto& host=static_cast<GtkHost&>(*runtime.host);
    require(!host.initialized,"Runtime construction initialized GTK eagerly");
    require(host.api(runtime,"kernel32.GetCurrentProcessId",{}).integral()>0,"POSIX API failed before GTK initialization");
    require(!host.initialized,"Console API initialized GTK eagerly");
    Module module;module.name="NativeSignals";module.kind="form";
    module.form=spec("Form",module.name,{{"clientwidth",Value::integer(15000)},{"clientheight",Value::integer(10000)},{"keypreview",Value::boolean(true)}});
    const std::vector<std::string> types={"CommandButton","CheckBox","OptionButton","Label","TextBox","RichTextBox","Frame","PictureBox","Image","Line","Shape","ComboBox","ListBox","DriveListBox","DirListBox","FileListBox","HScrollBar","VScrollBar","Slider","UpDown","ProgressBar","DTPicker","MonthView","TreeView","ListView","MSFlexGrid","MSHFlexGrid","DataGrid","TabStrip","SSTab","Toolbar","StatusBar","ImageList","CommonDialog","Timer","MSChart"};
    for(size_t i=0;i<types.size();++i)module.controls.push_back(spec(types[i],"C"+types[i],{{"left",Value::integer((i%8)*1800)},{"top",Value::integer((i/8)*1400)},{"interval",Value::integer(0)}}));
    auto child=spec("TextBox","Nested",{{"left",Value::integer(75)},{"top",Value::integer(150)}});child.parent="CFrame";module.controls.insert(module.controls.begin(),child);
    auto tabbed=spec("TextBox","TabbedEditor",{{"multiline",Value::boolean(true)}});tabbed.parent="CTabStrip";module.controls.push_back(tabbed);
    auto menu=spec("Menu","FileMenu",{{"caption",Value::string(u"&File")}});module.menus.push_back(menu);
    auto exitMenu=spec("Menu","ExitMenu",{{"caption",Value::string(u"E&xit")}});exitMenu.parent="FileMenu";module.menus.push_back(exitMenu);
    int buttonClicks=0,textChanges=0,checkClicks=0,labelClicks=0,menuClicks=0,keyDown=0,lastKeyPress=0,arrayIndex=-1,queryCount=0,unloadCount=0,modalTicks=0,timerTicks=0,apiTicks=0;
    bool cancelNext=true,cancelKeys=true,unloadTimer=false;
    module.procedures["ccommandbutton_click"]=procedure("ccommandbutton_click",[&](Frame&){++buttonClicks;return Value{};});
    module.procedures["ctextbox_change"]=procedure("ctextbox_change",[&](Frame&){++textChanges;return Value{};});
    module.procedures["ccheckbox_click"]=procedure("ccheckbox_click",[&](Frame&){++checkClicks;return Value{};});
    module.procedures["clabel_click"]=procedure("clabel_click",[&](Frame&){++labelClicks;return Value{};});
    module.procedures["exitmenu_click"]=procedure("exitmenu_click",[&](Frame&){++menuClicks;return Value{};});
    module.procedures["form_keydown"]=procedure("form_keydown",[&](Frame& frame){++keyDown;if(cancelKeys)frame.ref("keycode").set(Value::integer(0,Type::Integer));return Value{};},{param("keycode","integer"),param("shift","integer")});
    module.procedures["form_keypress"]=procedure("form_keypress",[&](Frame& frame){lastKeyPress=int(frame.get("keyascii").integral());return Value{};},{param("keyascii","integer")});
    module.procedures["form_queryunload"]=procedure("form_queryunload",[&](Frame& frame){++queryCount;if(cancelNext){cancelNext=false;frame.ref("cancel").set(Value::integer(1,Type::Integer));}return Value{};},{param("cancel","integer"),param("unloadmode","integer")});
    module.procedures["form_unload"]=procedure("form_unload",[&](Frame&){++unloadCount;return Value{};},{param("cancel","integer")});
    module.procedures["ctimer_timer"]=procedure("ctimer_timer",[&](Frame& frame){++timerTicks;control(frame.self,"CTimer")->set(runtime,"enabled",Value::boolean(false));if(unloadTimer)runtime.unload(frame.self);return Value{};});
    auto arraySpec=spec("CommandButton","Buttons");arraySpec.index=0;module.controls.push_back(arraySpec);
    module.procedures["buttons_click"]=procedure("buttons_click",[&](Frame& frame){arrayIndex=int(frame.get("index").integral());return Value{};},{param("index","integer")});
    runtime.modules[lower(module.name)]=module;
    Module modal;modal.name="ModalNative";modal.kind="form";modal.form=spec("Form",modal.name,{{"clientwidth",Value::integer(4500)},{"clientheight",Value::integer(1800)}});
    modal.controls.push_back(spec("Timer","CloseTimer",{{"enabled",Value::boolean(true)},{"interval",Value::integer(20)}}));
    modal.procedures["closetimer_timer"]=procedure("closetimer_timer",[&](Frame& frame){++modalTicks;require(host.forms.size()==2,"Modal form did not retain owner window");auto native=host.form(frame.self);require(gtk_window_get_modal(GTK_WINDOW(native->window)),"GTK modal flag missing");require(gtk_window_get_transient_for(GTK_WINDOW(native->window))!=nullptr,"GTK modal owner is missing");runtime.unload(frame.self);return Value{};});
    runtime.modules[lower(modal.name)]=modal;
    Module callbacks;callbacks.name="Callbacks";callbacks.kind="module";
    callbacks.procedures["ontimer"]=procedure("ontimer",[&](Frame& frame){++apiTicks;host.api(runtime,"user32.KillTimer",{Arg(frame.get("window")),Arg(frame.get("id"))});return Value{};},{param("window","long",false),param("message","long",false),param("id","long",false),param("tick","long",false)});
    runtime.modules[lower(callbacks.name)]=callbacks;
    auto instance=runtime.instance(module.name);runtime.load(instance);host.formCall(instance,"show",{});host.pump();
    auto form=host.form(instance);
    require(GTK_IS_WINDOW(form->window),"VB Form is not a native GtkWindow");
    require(GTK_IS_BUTTON(control(instance,"CCommandButton")->widget),"Button is not native GTK");
    require(GTK_IS_TEXT_VIEW(control(instance,"CRichTextBox")->widget),"RichTextBox is not native GTK");
    require(GTK_IS_TREE_VIEW(control(instance,"CTreeView")->widget),"TreeView is not native GTK");
    require(GTK_IS_NOTEBOOK(control(instance,"CSSTab")->widget),"SSTab is not native GTK");
    require(GTK_IS_TOOLBAR(control(instance,"CToolbar")->widget),"Toolbar is not native GTK");
    require(gtk_widget_get_parent(control(instance,"Nested")->view)==control(instance,"CFrame")->content,"Nested control is not contained in its GTK frame");
    for(auto& type:types){auto c=control(instance,"C"+type);require(!c->disposed&&c->handle>0,"Native control type was not initialized");}
    gtk_button_clicked(GTK_BUTTON(control(instance,"CCommandButton")->widget));host.check();require(buttonClicks==1,"Native GTK clicked did not dispatch VB Click");
    gtk_menu_item_activate(GTK_MENU_ITEM(control(instance,"ExitMenu")->menu));host.check();require(menuClicks==1,"Native menu did not dispatch VB Click");
    auto entry=control(instance,"CTextBox");gtk_entry_set_text(GTK_ENTRY(entry->widget),"A😀ŻZ");host.check();require(textChanges==1,"Native edit did not dispatch VB Change");
    entry->editSelect(1,2);require(entry->get(runtime,"seltext").string()==u"😀","GTK selection lost VB UTF-16 offsets");
    entry->set(runtime,"seltext",Value::string(u"Ω"));require(entry->editText()==u"AΩŻZ","UTF-16 edit replacement is incorrect");
    gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(control(instance,"CCheckBox")->widget),TRUE);host.check();require(checkClicks==1,"GTK check toggling did not dispatch VB Click");
    control(instance,"CCheckBox")->set(runtime,"value",Value::integer(0));require(checkClicks==2,"Programmatic Value assignment did not dispatch VB Click");
    auto* key=gdk_event_new(GDK_KEY_PRESS);key->key.keyval=GDK_KEY_x;key->key.state=GdkModifierType(0);key->key.string=g_strdup("x");key->key.length=1;key->key.window=gtk_widget_get_window(entry->widget);if(key->key.window)g_object_ref(key->key.window);
    gboolean handled=FALSE;g_signal_emit_by_name(entry->widget,"key-press-event",&key->key,&handled);gdk_event_free(key);host.check();require(handled&&keyDown==1,"KeyPreview cancellation did not stop native GTK key handling");
    cancelKeys=false;GdkEventKey unicodeKey{};unicodeKey.type=GDK_KEY_PRESS;unicodeKey.keyval=gdk_unicode_to_keyval(0x4e2d);
    require(!host.keyEvent(*entry,&unicodeKey,true)&&lastKeyPress==0x4e2d,"Non-Latin key input was swallowed or omitted KeyPress");
    unicodeKey.keyval=gdk_unicode_to_keyval(0x1f600);require(!host.keyEvent(*entry,&unicodeKey,true),"Supplementary Unicode key input was swallowed");
    unicodeKey.keyval=GDK_KEY_AudioRaiseVolume;require(!host.keyEvent(*entry,&unicodeKey,true),"Unmapped native key was swallowed");
    auto label=control(instance,"CLabel");GdkEventButton release{};release.type=GDK_BUTTON_RELEASE;release.button=1;
    g_signal_emit_by_name(label->view,"button-release-event",&release,&handled);host.check();require(labelClicks==1,"Native label event box did not dispatch VB Click");
    auto array=std::dynamic_pointer_cast<GtkControlArray>(instance->controls.at("buttons"));array->invoke(runtime,"load",{Arg(Value::integer(5))});gtk_button_clicked(GTK_BUTTON(array->elements.at(5)->widget));host.check();require(arrayIndex==5,"Native control array event omitted Index");auto unloaded=array->elements.at(5);auto staleHandle=unloaded->handle;array->invoke(runtime,"unload",{Arg(Value::integer(5))});require(unloaded->disposed&&!host.control(staleHandle),"Control array unload retained live native handle");expectError(91,[&]{unloaded->get(runtime,"caption");});
    auto canvas=control(instance,"CPictureBox");auto* pixels=cairo_image_surface_create(CAIRO_FORMAT_ARGB32,64,64);auto* cr=cairo_create(pixels);canvas->set(runtime,"backcolor",Value::integer(0xffffff));GtkDrawing pixel=gtkDrawing(*canvas,"pixel");pixel.color=0xff;pixel.coordinates={10,10};gtkAppendDrawing(*canvas,pixel);gtkDraw(*canvas,cr);cairo_surface_flush(pixels);uint32_t actual=0;std::memcpy(&actual,cairo_image_surface_get_data(pixels)+10*cairo_image_surface_get_stride(pixels)+40,4);require(actual==0xffff0000u,"Cairo PSet did not render OLE red correctly");cairo_destroy(cr);cairo_surface_destroy(pixels);
    auto dc=host.api(runtime,"user32.GetDC",{Arg(Value::integer(canvas->handle))});auto pen=host.api(runtime,"gdi32.CreatePen",{Arg(Value::integer(0)),Arg(Value::integer(2)),Arg(Value::integer(0xff))});auto old=host.api(runtime,"gdi32.SelectObject",{Arg(dc),Arg(pen)});require(host.api(runtime,"gdi32.DeleteObject",{Arg(pen)}).integral()==0,"Selected GDI pen was deleted");host.api(runtime,"gdi32.MoveToEx",{Arg(dc),Arg(Value::integer(2)),Arg(Value::integer(2)),Arg(Value::integer(0))});host.api(runtime,"gdi32.LineTo",{Arg(dc),Arg(Value::integer(20)),Arg(Value::integer(20))});host.api(runtime,"gdi32.SelectObject",{Arg(dc),Arg(old)});require(host.api(runtime,"gdi32.DeleteObject",{Arg(pen)}).integral()==1,"Unselected GDI pen did not release");require(host.api(runtime,"user32.ReleaseDC",{Arg(Value::integer(canvas->handle)),Arg(dc)}).integral()==1,"GDI context did not release");require(!host.handles.find(int32_t(dc.integral())),"Released DC handle remained live");
    auto persistent=canvas->get(runtime,"hdc");for(int i=0;i<1000;++i)require(canvas->get(runtime,"hdc").integral()==persistent.integral(),"Repeated hDC reads allocated different device contexts");
    auto persistentPen=host.api(runtime,"gdi32.CreatePen",{Arg(Value::integer(0)),Arg(Value::integer(3)),Arg(Value::integer(0x123456))});
    auto oldPersistentPen=host.api(runtime,"gdi32.SelectObject",{Arg(canvas->get(runtime,"hdc")),Arg(persistentPen)});
    host.api(runtime,"gdi32.MoveToEx",{Arg(canvas->get(runtime,"hdc")),Arg(Value::integer(7)),Arg(Value::integer(9)),Arg(Value::integer(0))});
    host.api(runtime,"gdi32.LineTo",{Arg(canvas->get(runtime,"hdc")),Arg(Value::integer(11)),Arg(Value::integer(13))});
    require(canvas->drawings.back().coordinates==std::vector<double>({7,9,11,13})&&canvas->drawings.back().color==0x123456,"hDC property did not retain GDI position and selection");
    host.api(runtime,"gdi32.SelectObject",{Arg(persistent),Arg(oldPersistentPen)});host.api(runtime,"gdi32.DeleteObject",{Arg(persistentPen)});
    auto* pixbuf=gdk_pixbuf_new(GDK_COLORSPACE_RGB,TRUE,8,8,8);gdk_pixbuf_fill(pixbuf,0xff0000ff);gchar* encoded=nullptr;gsize length=0;GError* error=nullptr;require(gdk_pixbuf_save_to_buffer(pixbuf,&encoded,&length,"png",&error,nullptr),"Fixture image encoding failed");auto picture=gtkLoadPicture(host,std::vector<uint8_t>(encoded,encoded+length));g_free(encoded);g_object_unref(pixbuf);control(instance,"CImage")->set(runtime,"picture",picture);require(picture.asObject()->get(runtime,"width").integral()>0,"GdkPixbuf picture dimensions missing");
    {
      Frame frame(runtime,instance);std::vector<uint8_t> bitmap(40+8*8*4+8*4,0);
      bitmap[0]=40;bitmap[4]=8;bitmap[8]=16;bitmap[12]=1;bitmap[14]=32;
      for(size_t i=40;i<40+8*8*4;i+=4){bitmap[i+2]=255;bitmap[i+3]=255;}
      for(bool cursor:{false,true}) {
        std::vector<uint8_t> bytes(38,0);bytes[2]=cursor?2:1;bytes[4]=2;
        auto put32=[&](size_t offset,uint32_t value){for(int i=0;i<4;++i)bytes[offset+size_t(i)]=uint8_t(value>>(8*i));};
        for(size_t i=0;i<2;++i){auto at=6+16*i;bytes[at]=8;bytes[at+1]=8;bytes[at+4]=cursor?3:1;bytes[at+6]=cursor?4:32;put32(at+8,uint32_t(bitmap.size()));put32(at+12,uint32_t(38+bitmap.size()*i));}
        bytes.insert(bytes.end(),bitmap.begin(),bitmap.end());bytes.insert(bytes.end(),bitmap.begin(),bitmap.end());
        auto original=gtkLoadPicture(host,bytes);auto filename=cursor?u"gtk-resource-roundtrip.cur":u"gtk-resource-roundtrip.ico";
        host.builtin(frame,"savepicture",{Arg(original),Arg(Value::string(filename))});
        require(readNativeResourceFile(toUTF8(filename))==bytes,"SavePicture changed ICO/CUR frames or hotspot bytes");
        auto reloaded=std::static_pointer_cast<GtkPicture>(host.builtin(frame,"loadpicture",{Arg(Value::string(filename))}).asObject());
        require(reloaded->pictureType==3&&reloaded->cursor==cursor&&(!cursor||(reloaded->hotspotX==3&&reloaded->hotspotY==4)),"ICO/CUR roundtrip lost native picture metadata");
        std::filesystem::remove(toUTF8(filename));
      }
      expectError(5,[&]{host.builtin(frame,"savepicture",{Arg(picture),Arg(Value::string(u"gtk-unsupported-raster.invalid"))});});
    }
    auto rs=NativeRecordset::create();rs->appendColumn(u"Name",202,64);rs->open();rs->add({});rs->field(0,Value::string(u"before"));rs->update();auto grid=control(instance,"CDataGrid");grid->set(runtime,"datasource",Value::object(rs));require(grid->invoke(runtime,"textmatrix",{Arg(Value::integer(1)),Arg(Value::integer(0))}).string()==u"before","Recordset grid did not publish source cells");auto ref=grid->reference(runtime,"textmatrix",{Arg(Value::integer(1)),Arg(Value::integer(0))});grid->writeCell(1,0,Value::string(u"after"));expectError(3218,[&]{ref.set(Value::string(u"stale"));});require(rs->field(0).string()==u"after","Grid edit did not write native Recordset");
    auto removedEditor=control(instance,"TabbedEditor");auto removedHandle=removedEditor->handle;
    auto removedTimer=host.api(runtime,"user32.SetTimer",{Arg(Value::integer(removedHandle)),Arg(Value::integer(0)),Arg(Value::integer(60000)),Arg(Value::integer(0))});
    control(instance,"CTabStrip")->items("tabs")->invoke(runtime,"remove",{Arg(Value::integer(1))});
    require(removedEditor->disposed&&!removedEditor->view&&!removedEditor->widget&&!host.control(removedHandle),"Removing a tab left its nested editor alive");
    require(!host.apiTimers.count({removedHandle,int32_t(removedTimer.integral())}),"Destroying a native child retained its API timer");
    expectError(91,[&]{removedEditor->get(runtime,"text");});expectError(91,[&]{removedEditor->set(runtime,"text",Value::string(u"stale"));});
    auto tree=control(instance,"CTreeView");auto nodes=tree->items("nodes");
    for(int depth=0;depth<2;++depth)nodes->invoke(runtime,"add",{Arg(depth?Value::integer(depth):Value::missing()),Arg(Value::integer(4)),Arg(Value::string(u"")),Arg(Value::string(u"node"))});
    checkNativeTree(*tree,nodes->values);
    // Seed only the intermediate fixture data in linear time. Rebuilding every
    // progressively deeper GtkTreeStore and every row's full GtkTreePath makes
    // setup cubic under QEMU. Public Add still creates the ordinary nodes and
    // the exact depth-limit node, publishing the complete real native model.
    for(int depth=2;depth<1024;++depth){
      auto ancestor=std::make_shared<GtkItem>();ancestor->owner=tree;ancestor->collection=nodes;ancestor->kind="nodes";
      ancestor->identity=nodes->nextIdentity++;ancestor->properties=nodes->values.front()->properties;
      ancestor->parent=nodes->values.back();nodes->values.back()->children.push_back(ancestor);nodes->values.push_back(std::move(ancestor));
    }
    nodes->invoke(runtime,"add",{Arg(Value::integer(1024)),Arg(Value::integer(4)),Arg(Value::string(u"")),Arg(Value::string(u"boundary node"))});
    require(nodes->values.size()==1025,"Public TreeView Add did not accept the exact supported depth");checkNativeTree(*tree,nodes->values);
    auto* boundaryModel=tree->model;
    for(int attempt=0;attempt<3;++attempt)expectError(7,[&]{nodes->invoke(runtime,"add",{Arg(Value::integer(1025)),Arg(Value::integer(4)),Arg(Value::string(u"")),Arg(Value::string(u"too deep"))});});
    require(nodes->values.size()==1025&&nodes->values.back()->children.empty()&&tree->model==boundaryModel,"Rejected TreeView Add mutated the node collection or native model");checkNativeTree(*tree,nodes->values);
    nodes->invoke(runtime,"remove",{Arg(Value::integer(1))});require(nodes->values.empty(),"Removing a deep tree retained descendants");checkNativeTree(*tree,nodes->values);
    gboolean cancelled=FALSE;g_signal_emit_by_name(form->window,"delete-event",nullptr,&cancelled);host.check();require(cancelled&&instance->loaded&&queryCount==1&&unloadCount==0,"QueryUnload cancellation destroyed the GTK form");
    auto modalInstance=runtime.instance(modal.name);runtime.load(modalInstance);host.formCall(modalInstance,"show",{Arg(Value::integer(1)),Arg(Value::object(instance))});require(!modalInstance->loaded&&modalTicks==1&&instance->loaded,"Modal nested loop failed to unwind after timer unload");
    auto moduleInstance=runtime.instance(callbacks.name);auto callback=Value::object(std::make_shared<NativeCallback>(moduleInstance,"ontimer"));
    auto nativeTimer=host.api(runtime,"user32.SetTimer",{Arg(Value::integer(form->surface->handle)),Arg(Value::integer(0)),Arg(Value::integer(10)),Arg(callback)});require(nativeTimer.integral()>0,"SetTimer did not register native callback");
    auto timer=control(instance,"CTimer");timer->set(runtime,"enabled",Value::boolean(false));timer->set(runtime,"interval",Value::integer(20));require(timer->timer==0,"Disabled Timer registered a GLib source");
    auto watchdog=g_timeout_add_full(G_PRIORITY_DEFAULT,5000,+[](gpointer data)->gboolean{static_cast<GtkHost*>(data)->event([]{fail(5,"Native GTK fixture timer timeout");});return G_SOURCE_REMOVE;},&host,nullptr);
    unloadTimer=true;timer->set(runtime,"enabled",Value::boolean(true));host.run(runtime);g_source_remove(watchdog);
    require(timerTicks==1&&apiTicks==1,"GLib/Declare timers failed or re-entered after disable");require(!instance->loaded&&queryCount==2&&unloadCount==1,"Final unload did not close native form exactly once");require(host.forms.empty()&&host.apiTimers.empty(),"Native unload leaked windows or API timers");
    runtime.stop();require(!host.handles.find(staleHandle)&&!host.handles.find(int32_t(persistent.integral())),"Native shutdown retained handles");
    std::cout<<"LINUX_GTK_NATIVE_SIGNALS_OK\n";return 0;
  }catch(const Error& error){std::cerr<<"GTK native VB error "<<error.number<<": "<<error.what()<<"\n";return 1;}
  catch(const std::exception& error){std::cerr<<"GTK native contract failure: "<<error.what()<<"\n";return 1;}
}
