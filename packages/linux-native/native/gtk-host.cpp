// GTK application, window lifetime, native events and modal ownership. MIT.
#include "gtk.hpp"

namespace vb6 {
namespace {
struct Controls final : Object {
  std::weak_ptr<Instance> owner;
  explicit Controls(std::shared_ptr<Instance> value) : owner(value) {}
  std::string className() const override { return "Controls"; }
  std::vector<Value> enumerate(Runtime&) override {
    auto instance = owner.lock(); if (!instance) fail(91);
    std::vector<Value> result;
    for (auto& control : gtkFormControls(instance)) result.push_back(Value::object(control));
    return result;
  }
  Value get(Runtime& rt, const std::string& name) override {
    if (lower(name) == "count") return Value::integer(enumerate(rt).size());
    fail(438);
  }
  Value invoke(Runtime& rt, const std::string& raw, Args args) override {
    auto name = lower(raw);
    if ((name.empty() || name == "item") && args.size() == 1) {
      auto instance = owner.lock(); if (!instance) fail(91);
      if (args[0].value.type == Type::String) {
        auto it = instance->controls.find(lower(toUTF8(args[0].value.string())));
        if (it == instance->controls.end()) fail(9);
        return Value::object(it->second);
      }
      auto values = enumerate(rt); auto index = args[0].value.integral();
      if (index < 0 || size_t(index) >= values.size()) fail(9);
      return values[size_t(index)];
    }
    if (args.empty()) return get(rt, name);
    fail(438);
  }
};
int16_t modifiers(guint state) {
  return int16_t(((state & GDK_SHIFT_MASK) ? 1 : 0) |
    ((state & GDK_CONTROL_MASK) ? 2 : 0) | ((state & GDK_MOD1_MASK) ? 4 : 0));
}
int16_t virtualKey(guint key) {
  const std::map<guint,int16_t> special = {
    {GDK_KEY_BackSpace,8},{GDK_KEY_Tab,9},{GDK_KEY_ISO_Left_Tab,9},{GDK_KEY_Return,13},
    {GDK_KEY_KP_Enter,13},{GDK_KEY_Shift_L,16},{GDK_KEY_Shift_R,16},
    {GDK_KEY_Control_L,17},{GDK_KEY_Control_R,17},{GDK_KEY_Alt_L,18},{GDK_KEY_Alt_R,18},
    {GDK_KEY_Pause,19},{GDK_KEY_Caps_Lock,20},{GDK_KEY_Escape,27},{GDK_KEY_space,32},
    {GDK_KEY_Page_Up,33},{GDK_KEY_Page_Down,34},{GDK_KEY_End,35},{GDK_KEY_Home,36},
    {GDK_KEY_Left,37},{GDK_KEY_Up,38},{GDK_KEY_Right,39},{GDK_KEY_Down,40},
    {GDK_KEY_Insert,45},{GDK_KEY_Delete,46},{GDK_KEY_Num_Lock,144},{GDK_KEY_Scroll_Lock,145}};
  auto found = special.find(key); if (found != special.end()) return found->second;
  if (key >= GDK_KEY_F1 && key <= GDK_KEY_F24) return int16_t(112 + key - GDK_KEY_F1);
  auto value = gdk_keyval_to_unicode(gdk_keyval_to_upper(key));
  // A Unicode key has no legacy Windows virtual-key equivalent. Use VK_PACKET
  // so the usual ByRef KeyCode = 0 cancellation remains unambiguous, while GTK
  // can deliver non-Latin and supplementary characters through its input method.
  return value <= 255 ? int16_t(value) : 231;
}
Args mouseArgs(GtkControl& control, double x, double y, guint state, guint button) {
  int buttons = button == 1 ? 1 : button == 3 ? 2 : button == 2 ? 4 : 0;
  if (!button) buttons = ((state & GDK_BUTTON1_MASK) ? 1 : 0) |
    ((state & GDK_BUTTON3_MASK) ? 2 : 0) | ((state & GDK_BUTTON2_MASK) ? 4 : 0);
  return {Arg(Value::integer(buttons,Type::Integer)),Arg(Value::integer(modifiers(state),Type::Integer)),
    Arg(Value::real(x/control.unit(-1,true)+control.number("scaleleft"),Type::Single)),
    Arg(Value::real(y/control.unit(-1,false)+control.number("scaletop"),Type::Single))};
}
}

void gtkSignal(gpointer object, const char* signal, GCallback callback,
               const std::shared_ptr<GtkControl>& control) {
  g_signal_connect_data(object, signal, callback, new std::weak_ptr<GtkControl>(control),
    [](gpointer data,GClosure*) { delete static_cast<std::weak_ptr<GtkControl>*>(data); },GConnectFlags(0));
}
std::vector<std::shared_ptr<GtkControl>> gtkFormControls(const std::shared_ptr<Instance>& object) {
  std::vector<std::shared_ptr<GtkControl>> result;
  std::set<GtkControl*> seen;
  auto add = [&](const ObjectPtr& value) {
    if (auto control = std::dynamic_pointer_cast<GtkControl>(value)) {
      if (seen.insert(control.get()).second) result.push_back(control);
    } else if (auto array = std::dynamic_pointer_cast<GtkControlArray>(value)) {
      for (auto& entry : array->elements)
        if (seen.insert(entry.second.get()).second) result.push_back(entry.second);
    }
  };
  for (auto& spec : object->module->controls) {
    auto it = object->controls.find(lower(spec.name)); if (it != object->controls.end()) add(it->second);
  }
  for (auto& spec : object->module->menus) {
    auto it = object->controls.find(lower(spec.name)); if (it != object->controls.end()) add(it->second);
  }
  return result;
}
void GtkHost::attach(Runtime& rt) { runtime = &rt; thread = std::this_thread::get_id(); }
GtkHost::~GtkHost() { shutdown(); }
void GtkHost::ensureApplication() {
  if (std::this_thread::get_id() != thread) fail(5,"GTK must run on the native application's main thread");
  if (initialized) return;
  if (!gtk_init_check(nullptr,nullptr)) fail(453,"GTK could not open a display (check DISPLAY or WAYLAND_DISPLAY)");
  initialized = true;
  g_set_application_name(runtime->name.c_str());
}
void GtkHost::event(const std::function<void()>& function) noexcept {
  if (closing || pending) return;
  try { function(); }
  catch (...) { pending = std::current_exception(); stopLoops(); }
}
void GtkHost::check() {
  if (pending) { auto error = std::exchange(pending,nullptr); std::rethrow_exception(error); }
}
void GtkHost::stopLoops() {
  for (auto* loop : loops) if (g_main_loop_is_running(loop)) g_main_loop_quit(loop);
  for (auto& entry : forms)
    if (entry.second->modalLoop) g_main_loop_quit(entry.second->modalLoop);
  for (auto* dialog : dialogs) gtk_dialog_response(GTK_DIALOG(dialog),GTK_RESPONSE_CANCEL);
  if (initialized) g_main_context_wakeup(nullptr);
}
std::shared_ptr<GtkForm> GtkHost::form(const std::shared_ptr<Instance>& object) const {
  auto it = forms.find(object.get()); if (it == forms.end()) fail(91,"Form is not loaded");
  return it->second;
}
std::shared_ptr<GtkControl> GtkHost::control(int32_t handle) const {
  return std::dynamic_pointer_cast<GtkControl>(handles.find(handle));
}
std::shared_ptr<GtkControl> GtkHost::controlForWidget(GtkWidget* widget) const {
  for (auto* current = widget; current; current = gtk_widget_get_parent(current)) {
    auto* weak = static_cast<std::weak_ptr<GtkControl>*>(g_object_get_data(G_OBJECT(current),"vb6-control"));
    if (weak) if (auto value = weak->lock()) return value;
  }
  return nullptr;
}
GtkWindow* GtkHost::activeWindow() const {
  for (auto& entry : forms) if (gtk_window_is_active(GTK_WINDOW(entry.second->window)))
    return GTK_WINDOW(entry.second->window);
  for (auto& entry : forms) if (gtk_widget_get_visible(entry.second->window))
    return GTK_WINDOW(entry.second->window);
  return nullptr;
}
std::shared_ptr<GtkControl> GtkHost::createControl(const std::shared_ptr<Instance>& owner,
                                               ControlSpec spec, bool) {
  auto value = std::make_shared<GtkControl>(*this,owner,std::move(spec));
  value->initialize();
  if (!value->view || value->menu) return value;
  auto parent = form(owner)->surface;
  if (!value->spec.parent.empty()) {
    auto found = owner->controls.find(lower(value->spec.parent));
    if (found == owner->controls.end()) fail(424,"Control parent does not exist");
    parent = std::dynamic_pointer_cast<GtkControl>(found->second);
    if (!parent) if (auto array = std::dynamic_pointer_cast<GtkControlArray>(found->second))
      if (!array->elements.empty()) parent = array->elements.begin()->second;
    if (!parent) fail(424,"Control parent is not a native container");
  }
  auto* container = parent->container();
  if (!container || !GTK_IS_FIXED(container)) fail(5,"Parent control is not a container");
  gtk_fixed_put(GTK_FIXED(container),value->view,value->initialRect.x,value->initialRect.y);
  value->initialParentWidth = std::max(1,int(parent->number("clientwidth",parent->number("width",9000))/15));
  value->initialParentHeight = std::max(1,int(parent->number("clientheight",parent->number("height",6000))/15));
  value->applyFrame();
  return value;
}
void GtkHost::createForm(const std::shared_ptr<Instance>& owner) {
  ensureApplication(); if (forms.count(owner.get())) return;
  if (!owner->module->form) fail(5,"Form model is missing");
  auto value = std::make_shared<GtkForm>(); value->owner = owner; forms[owner.get()] = value;
  try {
    value->surface = std::make_shared<GtkControl>(*this,owner,*owner->module->form);
    auto surface = value->surface; surface->initialize();
    auto width = surface->number("clientwidth",9000)/15, height = surface->number("clientheight",6000)/15;
    if (!std::isfinite(width)||!std::isfinite(height)||width<0||height<0||width>20000||height>20000) fail(380);
    value->width = int(width); value->height = int(height);
    value->window = gtk_window_new(GTK_WINDOW_TOPLEVEL); g_object_ref_sink(value->window);
    value->box = gtk_box_new(GTK_ORIENTATION_VERTICAL,0);
    gtk_container_add(GTK_CONTAINER(value->window),value->box);
    gtk_box_pack_end(GTK_BOX(value->box),surface->view,TRUE,TRUE,0);
    gtk_widget_show(value->box); gtk_widget_show(surface->view);
    gtk_window_set_default_size(GTK_WINDOW(value->window),int(width),int(height));
    gtk_window_set_title(GTK_WINDOW(value->window),toUTF8(surface->property("caption",Value::string(fromUTF8(owner->module->name))).string()).c_str());
    const auto border = int(surface->number("borderstyle",2));
    gtk_window_set_decorated(GTK_WINDOW(value->window),border!=0);
    gtk_window_set_resizable(GTK_WINDOW(value->window),border==2||border==5);
    gtk_window_set_deletable(GTK_WINDOW(value->window),surface->flag("controlbox",true));
    if (border==3||border==4||border==5) gtk_window_set_type_hint(GTK_WINDOW(value->window),GDK_WINDOW_TYPE_HINT_DIALOG);
    gtk_window_move(GTK_WINDOW(value->window),int(surface->number("left",300)/15),int(surface->number("top",300)/15));
    if (surface->number("startupposition",2)!=0) gtk_window_set_position(GTK_WINDOW(value->window),GTK_WIN_POS_CENTER);
    value->accelerators = gtk_accel_group_new(); gtk_window_add_accel_group(GTK_WINDOW(value->window),value->accelerators);
    gtkSignal(value->window,"delete-event",G_CALLBACK(+[](GtkWidget*,GdkEvent*,gpointer data)->gboolean {
      gtkEvent(data,[](GtkControl& c) { c.host->closeForm(c.form()); }); return TRUE;
    }),surface);
    gtkSignal(value->window,"focus-in-event",G_CALLBACK(+[](GtkWidget*,GdkEventFocus*,gpointer data)->gboolean {
      gtkEvent(data,[](GtkControl& c) { c.event("activate"); }); return FALSE;
    }),surface);
    gtkSignal(value->window,"focus-out-event",G_CALLBACK(+[](GtkWidget*,GdkEventFocus*,gpointer data)->gboolean {
      gtkEvent(data,[](GtkControl& c) { c.event("deactivate"); }); return FALSE;
    }),surface);
    gtkSignal(surface->view,"size-allocate",G_CALLBACK(+[](GtkWidget*,GtkAllocation*,gpointer data) {
      gtkEvent(data,[](GtkControl& c) { c.host->resize(c.form()); });
    }),surface);
    std::vector<ControlSpec> remaining = owner->module->controls;
    remaining.insert(remaining.end(),owner->module->menus.begin(),owner->module->menus.end());
    while (!remaining.empty()) {
      bool progress = false;
      for (auto it=remaining.begin();it!=remaining.end();) {
        if (!it->parent.empty()&&!owner->controls.count(lower(it->parent))) { ++it; continue; }
        auto spec = *it; auto c = createControl(owner,spec); auto name = lower(spec.name);
        if (spec.index<0) owner->controls[name]=c;
        else {
          auto array = std::dynamic_pointer_cast<GtkControlArray>(owner->controls[name]);
          if (!array) { array=std::make_shared<GtkControlArray>(); array->host=this; array->owner=owner;
            array->prototype=spec; owner->controls[name]=array; }
          array->elements[spec.index]=c; array->designElements.insert(spec.index);
        }
        it=remaining.erase(it); progress=true;
      }
      if (!progress) fail(5,"Native control hierarchy contains an unresolved parent");
    }
    rebuildMenus(value);
    // Preserve VB TabIndex independently for each actual GTK container.
    auto controls = gtkFormControls(owner);
    std::stable_sort(controls.begin(),controls.end(),[](auto& a,auto& b) { return a->number("tabindex")<b->number("tabindex"); });
    std::map<GtkWidget*,GList*> chains;
    for (auto& c:controls) if(c->view && !c->menu && c->flag("tabstop",true) && gtk_widget_get_can_focus(c->widget)) {
      auto* parent=gtk_widget_get_parent(c->view); chains[parent]=g_list_append(chains[parent],c->view);
      if(c->spec.type=="CommandButton" && c->flag("default")) {
        gtk_widget_set_can_default(c->widget,TRUE); gtk_window_set_default(GTK_WINDOW(value->window),c->widget);
      }
    }
    for(auto& entry:chains) { gtk_container_set_focus_chain(GTK_CONTAINER(entry.first),entry.second); g_list_free(entry.second); }
  } catch (...) {
    for(auto& control:gtkFormControls(owner)) control->dispose();
    if(value->surface) value->surface->dispose();
    if(value->window) { gtk_widget_destroy(value->window); g_object_unref(value->window); value->window=nullptr; }
    if(value->accelerators) { g_object_unref(value->accelerators); value->accelerators=nullptr; }
    owner->controls.clear(); forms.erase(owner.get()); throw;
  }
}
Value GtkHost::formGet(const std::shared_ptr<Instance>& owner,const std::string& raw) {
  auto value=form(owner); auto name=lower(raw);
  if(name=="controls") return Value::object(std::make_shared<Controls>(owner));
  if(name=="caption") return Value::string(fromUTF8(gtk_window_get_title(GTK_WINDOW(value->window))));
  if(name=="visible") return Value::boolean(gtk_widget_get_visible(value->window));
  if(name=="enabled") return Value::boolean(value->enabled);
  if(name=="left"||name=="top") { int x,y; gtk_window_get_position(GTK_WINDOW(value->window),&x,&y); return Value::real((name=="left"?x:y)*15,Type::Single); }
  if(name=="width"||name=="height") { int w,h; gtk_window_get_size(GTK_WINDOW(value->window),&w,&h); return Value::real((name=="width"?w:h)*15,Type::Single); }
  if(name=="clientwidth"||name=="clientheight") return Value::real((name=="clientwidth"?value->width:value->height)*15,Type::Single);
  if(name=="windowstate") { auto* window=gtk_widget_get_window(value->window); auto state=window?gdk_window_get_state(window):GdkWindowState(0); return Value::integer(state&GDK_WINDOW_STATE_ICONIFIED?1:state&GDK_WINDOW_STATE_MAXIMIZED?2:0,Type::Integer); }
  if(name=="activecontrol") return Value::object(controlForWidget(gtk_window_get_focus(GTK_WINDOW(value->window))));
  return value->surface->get(*runtime,name);
}
void GtkHost::formSet(const std::shared_ptr<Instance>& owner,const std::string& raw,Value input) {
  auto value=form(owner); auto name=lower(raw);
  if(name=="caption") { gtk_window_set_title(GTK_WINDOW(value->window),toUTF8(input.string()).c_str()); value->surface->properties[name]=coerce(input,"string"); return; }
  if(name=="visible") { formCall(owner,input.truth()?"show":"hide",{}); return; }
  if(name=="enabled") { value->enabled=input.truth(); gtk_widget_set_sensitive(value->window,value->enabled); return; }
  if(name=="windowstate") { auto n=input.integral(); if(n<0||n>2)fail(380); if(n==1)gtk_window_iconify(GTK_WINDOW(value->window)); else { gtk_window_deiconify(GTK_WINDOW(value->window)); if(n==2)gtk_window_maximize(GTK_WINDOW(value->window));else gtk_window_unmaximize(GTK_WINDOW(value->window)); } return; }
  if(name=="left"||name=="top"||name=="width"||name=="height"||name=="clientwidth"||name=="clientheight") {
    auto n=input.floating()/15; bool position=name=="left"||name=="top";
    if(!std::isfinite(n)||std::abs(n)>20000||(!position&&n<0))fail(380);
    int x,y; if(position) { gtk_window_get_position(GTK_WINDOW(value->window),&x,&y); gtk_window_move(GTK_WINDOW(value->window),name=="left"?int(n):x,name=="top"?int(n):y); }
    else { gtk_window_get_size(GTK_WINDOW(value->window),&x,&y); gtk_window_resize(GTK_WINDOW(value->window),name=="width"||name=="clientwidth"?std::max(1,int(n)):x,name=="height"||name=="clientheight"?std::max(1,int(n)):y); }
    value->surface->properties[name]=input; return;
  }
  value->surface->set(*runtime,name,std::move(input));
}
Value GtkHost::formCall(const std::shared_ptr<Instance>& owner,const std::string& raw,Args args) {
  auto value=form(owner); auto name=lower(raw);
  if(name=="__unload") {
    value->closing=true; cancelTimers(value->surface->handle);
    if(value->modalLoop)g_main_loop_quit(value->modalLoop);
    for(auto& control:gtkFormControls(owner))control->dispose();
    value->surface->dispose(); gtk_widget_destroy(value->window); g_object_unref(value->window); value->window=nullptr;
    g_object_unref(value->accelerators);value->accelerators=nullptr;
    forms.erase(owner.get());if(forms.empty())stopLoops();return {};
  }
  if(name=="show") {
    auto modal=integerArgument(args,0,0);if((modal!=0&&modal!=1)||args.size()>2)fail(5);
    if(value->modalLoop && !modal)fail(400,"Form already displayed modally");
    if(args.size()>1&&args[1].value.type==Type::Object&&std::get<ObjectPtr>(args[1].value.payload)) {
      auto parent=std::dynamic_pointer_cast<Instance>(args[1].value.asObject());if(!parent||parent==owner)fail(424);
      runtime->load(parent);gtk_window_set_transient_for(GTK_WINDOW(value->window),GTK_WINDOW(form(parent)->window));
    } else if(modal) { auto* parent=activeWindow();if(parent!=GTK_WINDOW(value->window))gtk_window_set_transient_for(GTK_WINDOW(value->window),parent); }
    gtk_window_set_modal(GTK_WINDOW(value->window),modal!=0);
    value->surface->properties["visible"]=Value::boolean(true);gtk_widget_show(value->window);gtk_window_present(GTK_WINDOW(value->window));
    if(modal&&!value->modalLoop) {
      auto* loop=g_main_loop_new(nullptr,FALSE);value->modalLoop=loop;
      if(!pending&&!value->closing&&gtk_widget_get_visible(value->window))g_main_loop_run(loop);
      value->modalLoop=nullptr;g_main_loop_unref(loop);
      if(value->window)gtk_window_set_modal(GTK_WINDOW(value->window),FALSE);check();
    }
    return {};
  }
  if(name=="hide") { gtk_widget_hide(value->window);value->surface->properties["visible"]=Value::boolean(false);if(value->modalLoop)g_main_loop_quit(value->modalLoop);return {}; }
  if(name=="move") { if(args.size()<2||args.size()>4)fail(450);const char* properties[]={"left","top","width","height"};for(size_t i=0;i<args.size();++i)if(args[i].value.type!=Type::Missing)formSet(owner,properties[i],args[i].value);return {}; }
  if(name=="setfocus") { gtk_window_present(GTK_WINDOW(value->window));return {}; }
  if(name=="zorder") { auto n=integerArgument(args,0);if(n<0||n>1)fail(5);auto* window=gtk_widget_get_window(value->window);if(window){if(n)gdk_window_lower(window);else gdk_window_raise(window);}return {}; }
  if(name=="popupmenu") { auto c=std::dynamic_pointer_cast<GtkControl>(argument(args,0).asObject());if(!c||!c->menu)fail(424);auto* menu=gtk_menu_item_get_submenu(GTK_MENU_ITEM(c->menu));if(!menu)fail(5,"PopupMenu requires child items");gtk_menu_popup_at_pointer(GTK_MENU(menu),nullptr);return {}; }
  if(name=="printform")return gtkPrintForm(*this,value);
  return value->surface->invoke(*runtime,name,std::move(args));
}
void GtkHost::rebuildMenus(const std::shared_ptr<GtkForm>& value) {
  if(!value->menuBar) {value->menuBar=gtk_menu_bar_new();gtk_box_pack_start(GTK_BOX(value->box),value->menuBar,FALSE,FALSE,0);}
  bool any=false;
  for(auto& c:gtkFormControls(value->owner))if(c->menu) {
    GtkWidget* parent=value->menuBar;
    if(!c->spec.parent.empty()) {
      auto it=value->owner->controls.find(lower(c->spec.parent));auto root=it==value->owner->controls.end()?nullptr:std::dynamic_pointer_cast<GtkControl>(it->second);
      if(!root||!root->menu)fail(5,"Menu parent is not a menu");
      parent=gtk_menu_item_get_submenu(GTK_MENU_ITEM(root->menu));if(!parent){parent=gtk_menu_new();gtk_menu_item_set_submenu(GTK_MENU_ITEM(root->menu),parent);}
    }else any=true;
    auto* old=gtk_widget_get_parent(c->menu);if(old!=parent){if(old)gtk_container_remove(GTK_CONTAINER(old),c->menu);gtk_menu_shell_append(GTK_MENU_SHELL(parent),c->menu);}
    auto shortcut=lower(toUTF8(c->property("shortcut",Value::string(u"")).string()));
    if(!shortcut.empty()) {guint key=0;GdkModifierType modifiers=GdkModifierType(0);std::string accel;
      if(shortcut.find("ctrl")!=std::string::npos||shortcut[0]=='^')accel+="<Control>";
      if(shortcut.find("alt")!=std::string::npos)accel+="<Alt>";if(shortcut.find("shift")!=std::string::npos)accel+="<Shift>";
      auto at=shortcut.find_last_of('+');accel+=at!=std::string::npos?shortcut.substr(at+1):shortcut[0]=='^'?shortcut.substr(1):shortcut;
      gtk_accelerator_parse(accel.c_str(),&key,&modifiers);if(key)gtk_widget_add_accelerator(c->menu,"activate",value->accelerators,key,modifiers,GTK_ACCEL_VISIBLE);
    }
    c->refresh();
  }
  gtk_widget_set_visible(value->menuBar,any);
}
void GtkHost::resize(const std::shared_ptr<GtkForm>& value) {
  if(value->closing||value->sizing)return;
  int width=gtk_widget_get_allocated_width(value->surface->view),height=gtk_widget_get_allocated_height(value->surface->view);
  if(width==value->width&&height==value->height)return;
  value->width=width;value->height=height;value->sizing=true;
  try {
    for(auto& c:gtkFormControls(value->owner))if(c->view&&!c->menu) {
      auto* parent=gtk_widget_get_parent(c->view);if(!parent||!GTK_IS_FIXED(parent))continue;
      int w=gtk_widget_get_allocated_width(parent),h=gtk_widget_get_allocated_height(parent);auto rect=c->initialRect;
      auto anchor=int(c->number("anchor",5)),dock=int(c->number("dock",0));
      int dx=w-c->initialParentWidth,dy=h-c->initialParentHeight;
      if(!dock){if((anchor&3)==3)rect.width=std::max(0,rect.width+dx);else if(anchor&2)rect.x+=dx;else if(!(anchor&1))rect.x+=dx/2;
        if((anchor&12)==12)rect.height=std::max(0,rect.height+dy);else if(anchor&8)rect.y+=dy;else if(!(anchor&4))rect.y+=dy/2;}
      else if(dock==5){rect={0,0,w,h};}else if(dock==1||dock==2){rect.x=0;rect.width=w;rect.y=dock==1?0:h-rect.height;}else if(dock==3||dock==4){rect.y=0;rect.height=h;rect.x=dock==3?0:w-rect.width;}
      gtk_fixed_move(GTK_FIXED(parent),c->view,rect.x,rect.y);gtk_widget_set_size_request(c->view,rect.width,rect.height);
      c->properties["left"]=Value::real(rect.x*15);c->properties["top"]=Value::real(rect.y*15);c->properties["width"]=Value::real(rect.width*15);c->properties["height"]=Value::real(rect.height*15);
    }
    value->sizing=false;value->surface->event("resize");
  }catch(...){value->sizing=false;throw;}
}
bool GtkHost::closeForm(const std::shared_ptr<GtkForm>& value) {
  if(value->closing)return true;runtime->unload(value->owner,0);return !value->owner->loaded;
}
gboolean GtkHost::keyEvent(GtkControl& control,GdkEventKey* input,bool down) {
  auto value=control.form();auto originalCode=virtualKey(input->keyval);auto code=std::make_shared<Cell>(Value::integer(originalCode,Type::Integer),"integer");
  Args args{Arg(cellRef(code)),Arg(Value::integer(modifiers(input->state),Type::Integer))};
  if(value->surface->flag("keypreview")&&value->surface.get()!=&control)value->surface->event(down?"keydown":"keyup",args);
  if(code->get().integral()||!originalCode)control.event(down?"keydown":"keyup",args);
  if(originalCode&&!code->get().integral())return TRUE;
  if(down) {
    auto unicode=gdk_keyval_to_unicode(input->keyval);
    if(unicode && unicode<=0xffff && !(input->state&(GDK_CONTROL_MASK|GDK_MOD1_MASK))) {
      auto ascii=std::make_shared<Cell>(Value::integer(int16_t(unicode),Type::Integer),"integer");Args pressed{Arg(cellRef(ascii))};
      if(value->surface->flag("keypreview")&&value->surface.get()!=&control)value->surface->event("keypress",pressed);
      if(ascii->get().integral())control.event("keypress",pressed);
      auto next=uint16_t(ascii->get().integral());if(!next)return TRUE;
      if(next!=unicode){input->keyval=gdk_unicode_to_keyval(next);gchar buffer[8]={};input->length=g_unichar_to_utf8(next,buffer);g_free(input->string);input->string=g_strndup(buffer,input->length);}
    }
    if(input->keyval==GDK_KEY_Escape)for(auto& c:gtkFormControls(value->owner))if(c->spec.type=="CommandButton"&&c->flag("cancel")&&c->flag("enabled",true)&&c->flag("visible",true)){c->event("click");return TRUE;}
  }
  return FALSE;
}
void gtkConnectInput(GtkControl& c) {
  if(!c.widget)return;auto self=c.self();auto* target=c.view&&GTK_IS_EVENT_BOX(c.view)?c.view:c.widget;
  gtk_widget_add_events(target,GDK_KEY_PRESS_MASK|GDK_KEY_RELEASE_MASK|GDK_BUTTON_PRESS_MASK|GDK_BUTTON_RELEASE_MASK|GDK_POINTER_MOTION_MASK|GDK_FOCUS_CHANGE_MASK);
  gtkSignal(target,"key-press-event",G_CALLBACK(+[](GtkWidget*,GdkEventKey* e,gpointer d)->gboolean {gboolean result=FALSE;gtkEvent(d,[&](GtkControl& c){result=c.host->keyEvent(c,e,true);});return result;}),self);
  gtkSignal(target,"key-release-event",G_CALLBACK(+[](GtkWidget*,GdkEventKey* e,gpointer d)->gboolean {gboolean result=FALSE;gtkEvent(d,[&](GtkControl& c){result=c.host->keyEvent(c,e,false);});return result;}),self);
  gtkSignal(target,"button-press-event",G_CALLBACK(+[](GtkWidget*,GdkEventButton* e,gpointer d)->gboolean {gtkEvent(d,[&](GtkControl& c){c.event(e->type==GDK_2BUTTON_PRESS?"dblclick":"mousedown",e->type==GDK_2BUTTON_PRESS?Args{}:mouseArgs(c,e->x,e->y,e->state,e->button));});return FALSE;}),self);
  gtkSignal(target,"button-release-event",G_CALLBACK(+[](GtkWidget*,GdkEventButton* e,gpointer d)->gboolean {gtkEvent(d,[&](GtkControl& c){c.event("mouseup",mouseArgs(c,e->x,e->y,e->state,e->button));if(!GTK_IS_BUTTON(c.widget)&&!GTK_IS_TREE_VIEW(c.widget)&&!GTK_IS_COMBO_BOX(c.widget)&&e->button==1)c.event("click");});return FALSE;}),self);
  gtkSignal(target,"motion-notify-event",G_CALLBACK(+[](GtkWidget*,GdkEventMotion* e,gpointer d)->gboolean {gtkEvent(d,[&](GtkControl& c){c.event("mousemove",mouseArgs(c,e->x,e->y,e->state,0));});return FALSE;}),self);
  gtkSignal(target,"focus-in-event",G_CALLBACK(+[](GtkWidget*,GdkEventFocus*,gpointer d)->gboolean {gtkEvent(d,[](GtkControl& c){c.event("gotfocus");});return FALSE;}),self);
  gtkSignal(target,"focus-out-event",G_CALLBACK(+[](GtkWidget*,GdkEventFocus*,gpointer d)->gboolean {gtkEvent(d,[](GtkControl& c){c.event("lostfocus");});return FALSE;}),self);
}
int GtkHost::run(Runtime&) {
  check();if(!initialized||forms.empty())return 0;
  auto* loop=g_main_loop_new(nullptr,FALSE);loops.push_back(loop);g_main_loop_run(loop);
  loops.erase(std::find(loops.begin(),loops.end(),loop));g_main_loop_unref(loop);check();return 0;
}
void GtkHost::pump() {
  if(!initialized)return;for(size_t i=0;i<1000&&g_main_context_pending(nullptr);++i){g_main_context_iteration(nullptr,FALSE);check();}check();
}
void GtkHost::cancelTimers(int32_t handle) {
  for(auto it=apiTimers.begin();it!=apiTimers.end();)if(it->first.first==handle){g_source_remove(it->second);it=apiTimers.erase(it);}else ++it;
}
void GtkHost::shutdown() {
  if(closing)return;closing=true;life.reset();stopLoops();systemObjects.clear();
  for(auto& timer:apiTimers)g_source_remove(timer.second);apiTimers.clear();
  for(auto& entry:forms){auto value=entry.second;value->closing=true;
    for(auto& c:gtkFormControls(value->owner))c->dispose();value->surface->dispose();
    gtk_widget_destroy(value->window);g_object_unref(value->window);value->window=nullptr;
    g_object_unref(value->accelerators);value->accelerators=nullptr;
    value->owner->controls.clear();value->owner->loaded=false;}
  forms.clear();handles.clear();
}
std::unique_ptr<NativeHost> makeNativeHost() { return std::make_unique<GtkHost>(); }
}
