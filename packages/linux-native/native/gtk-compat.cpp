// GTK3/GTK4 widget composition, snapshots, display and clipboard adapters. MIT.
#include "gtk.hpp"
#include "gtk-richtext.hpp"
#include <cstring>
#if GTK_MAJOR_VERSION >= 4
#include <gdk/x11/gdkx.h>
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#else
#include <gdk/gdkx.h>
#endif

namespace vb6 {
bool gtkNativeX11Display(GtkWidget* widget) { return GDK_IS_X11_DISPLAY(gtk_widget_get_display(widget)); }
void gtkNativeRequireX11(GtkWidget* widget,const char* operation) { if(!gtkNativeX11Display(widget))fail(453,std::string(operation)+" requires X11; this display backend controls global window geometry, stacking and application icons"); }
void gtkRichDraw(GtkControl&,cairo_t*);
bool gtkNativeToggle(GtkWidget* widget) {
#if GTK_MAJOR_VERSION >= 4
  return GTK_IS_CHECK_BUTTON(widget)||GTK_IS_TOGGLE_BUTTON(widget);
#else
  return GTK_IS_TOGGLE_BUTTON(widget);
#endif
}
bool gtkNativeToggleActive(GtkWidget* widget) {
#if GTK_MAJOR_VERSION >= 4
  if(GTK_IS_CHECK_BUTTON(widget))return gtk_check_button_get_active(GTK_CHECK_BUTTON(widget));
#endif
  return gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(widget));
}
void gtkNativeToggleSet(GtkWidget* widget,bool active,bool inconsistent) {
#if GTK_MAJOR_VERSION >= 4
  if(GTK_IS_CHECK_BUTTON(widget)){gtk_check_button_set_active(GTK_CHECK_BUTTON(widget),active);gtk_check_button_set_inconsistent(GTK_CHECK_BUTTON(widget),inconsistent);return;}
  gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(widget),active);
#else
  gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(widget),active);gtk_toggle_button_set_inconsistent(GTK_TOGGLE_BUTTON(widget),inconsistent);
#endif
}
bool gtkNativeRange(GtkWidget* widget) {
#if GTK_MAJOR_VERSION >= 4
  return GTK_IS_RANGE(widget)||GTK_IS_SCROLLBAR(widget);
#else
  return GTK_IS_RANGE(widget);
#endif
}
double gtkNativeRangeValue(GtkWidget* widget) {
#if GTK_MAJOR_VERSION >= 4
  if(GTK_IS_SCROLLBAR(widget))return gtk_adjustment_get_value(gtk_scrollbar_get_adjustment(GTK_SCROLLBAR(widget)));
#endif
  return gtk_range_get_value(GTK_RANGE(widget));
}
void gtkNativeRangeSet(GtkWidget* widget,double minimum,double maximum,double value,double small,double large) {
#if GTK_MAJOR_VERSION >= 4
  if(GTK_IS_SCROLLBAR(widget)){gtk_adjustment_configure(gtk_scrollbar_get_adjustment(GTK_SCROLLBAR(widget)),value,minimum,maximum,small,large,0);return;}
#endif
  gtk_range_set_range(GTK_RANGE(widget),minimum,maximum);gtk_range_set_increments(GTK_RANGE(widget),small,large);gtk_range_set_value(GTK_RANGE(widget),value);
}

#if GTK_MAJOR_VERSION >= 4
namespace {
// A retained Cairo node is composed with GTK4's normal child snapshots. The
// GtkFixed model and coordinates stay shared with GTK3 and the VB designer.
struct NativeFixed { GtkFixed parent; };
struct NativeFixedClass { GtkFixedClass parent; };
G_DEFINE_TYPE(NativeFixed,native_fixed,GTK_TYPE_FIXED)
void native_fixed_snapshot(GtkWidget* widget,GtkSnapshot* snapshot) {
  auto* weak=static_cast<std::weak_ptr<GtkControl>*>(g_object_get_data(G_OBJECT(widget),"vb6-control"));
  if(weak)if(auto control=weak->lock();control&&!control->disposed){
    const graphene_rect_t bounds=GRAPHENE_RECT_INIT(0,0,float(gtk_widget_get_width(widget)),float(gtk_widget_get_height(widget)));
    auto* context=gtk_snapshot_append_cairo(snapshot,&bounds);
    control->host->event([&]{gtkDraw(*control,context);});cairo_destroy(context);
  }
  GTK_WIDGET_CLASS(native_fixed_parent_class)->snapshot(widget,snapshot);
}
gboolean native_fixed_focus_impl(GtkWidget* widget,GtkDirectionType direction) {
  if(direction!=GTK_DIR_TAB_FORWARD&&direction!=GTK_DIR_TAB_BACKWARD)return GTK_WIDGET_CLASS(native_fixed_parent_class)->focus(widget,direction);
  std::vector<GtkWidget*> children;for(auto* child=gtk_widget_get_first_child(widget);child;child=gtk_widget_get_next_sibling(child))children.push_back(child);
  std::stable_sort(children.begin(),children.end(),[](GtkWidget* a,GtkWidget* b){
    auto* left=static_cast<std::weak_ptr<GtkControl>*>(g_object_get_data(G_OBJECT(a),"vb6-control"));auto* right=static_cast<std::weak_ptr<GtkControl>*>(g_object_get_data(G_OBJECT(b),"vb6-control"));auto x=left?left->lock():nullptr,y=right?right->lock():nullptr;
    return (x?x->number("tabindex"):0)<(y?y->number("tabindex"):0);
  });
  if(direction==GTK_DIR_TAB_BACKWARD)std::reverse(children.begin(),children.end());
  auto* root=gtk_widget_get_root(widget);auto* focused=root?gtk_root_get_focus(root):nullptr;bool following=!focused||!gtk_widget_is_ancestor(focused,widget);
  for(auto* child:children){
    const bool current=focused&&(focused==child||gtk_widget_is_ancestor(focused,child));
    if(!following){if(current){following=true;if(gtk_widget_child_focus(child,direction))return TRUE;}continue;}
    if(!gtk_widget_get_visible(child)||!gtk_widget_is_sensitive(child))continue;
    auto* weak=static_cast<std::weak_ptr<GtkControl>*>(g_object_get_data(G_OBJECT(child),"vb6-control"));auto control=weak?weak->lock():nullptr;
    if(control&&!control->flag("tabstop",true)&&!control->content)continue;
    if(gtk_widget_child_focus(child,direction))return TRUE;
  }
  return FALSE;
}
gboolean native_fixed_focus(GtkWidget* widget,GtkDirectionType direction) noexcept {
  for(auto* current=widget;current;current=gtk_widget_get_parent(current)){
    auto* weak=static_cast<std::weak_ptr<GtkControl>*>(g_object_get_data(G_OBJECT(current),"vb6-control"));
    if(weak)if(auto control=weak->lock()){gboolean result=FALSE;control->host->event([&]{result=native_fixed_focus_impl(widget,direction);});return result;}
  }
  return FALSE;
}
void native_fixed_class_init(NativeFixedClass* klass) { GTK_WIDGET_CLASS(klass)->snapshot=native_fixed_snapshot;GTK_WIDGET_CLASS(klass)->focus=native_fixed_focus; }
void native_fixed_init(NativeFixed*) {}
struct NativeTextView { GtkTextView parent; };
struct NativeTextViewClass { GtkTextViewClass parent; };
G_DEFINE_TYPE(NativeTextView,native_text_view,GTK_TYPE_TEXT_VIEW)
void native_text_view_snapshot(GtkWidget* widget,GtkSnapshot* snapshot) {
  GTK_WIDGET_CLASS(native_text_view_parent_class)->snapshot(widget,snapshot);
  auto* weak=static_cast<std::weak_ptr<GtkControl>*>(g_object_get_data(G_OBJECT(widget),"vb6-control"));
  if(weak)if(auto control=weak->lock();control&&!control->disposed&&control->richText){
    const graphene_rect_t bounds=GRAPHENE_RECT_INIT(0,0,float(gtk_widget_get_width(widget)),float(gtk_widget_get_height(widget)));
    auto* context=gtk_snapshot_append_cairo(snapshot,&bounds);
    control->host->event([&]{gtkRichDraw(*control,context);});cairo_destroy(context);
  }
}
void native_text_view_class_init(NativeTextViewClass* klass) { GTK_WIDGET_CLASS(klass)->snapshot=native_text_view_snapshot; }
void native_text_view_init(NativeTextView*) {}

struct Style { GtkCssProvider* provider=gtk_css_provider_new();std::map<std::string,std::string> declarations;~Style(){g_object_unref(provider);} };
void style(GtkWidget* widget,const std::string& name,const std::string& value) {
  constexpr const char* key="vb6-widget-style";auto* state=static_cast<Style*>(g_object_get_data(G_OBJECT(widget),key));
  if(!state){state=new Style;g_object_set_data_full(G_OBJECT(widget),key,state,+[](gpointer data){delete static_cast<Style*>(data);});gtk_style_context_add_provider(gtk_widget_get_style_context(widget),GTK_STYLE_PROVIDER(state->provider),GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);}
  state->declarations[name]=value;std::string css="* {";for(auto& entry:state->declarations)css+=entry.first+":"+entry.second+";";css+="}";
  gtk_css_provider_load_from_data(state->provider,css.c_str(),gssize(css.size()));
}
std::string cssString(const char* input) {
  std::string output="\"";for(const unsigned char value:std::string(input?input:"Sans")){
    if(value=='"'||value=='\\')output+='\\';if(value<' '||value==127){char hex[16];std::snprintf(hex,sizeof(hex),"\\%x ",value);output+=hex;}else output+=char(value);
  }return output+'"';
}
struct Geometry { int x=0,y=0;bool positioned=false,dialog=false;GdkPixbuf* icon=nullptr;~Geometry(){if(icon)g_object_unref(icon);} };
void moveX11Window(GdkSurface* surface,int x,int y) {
  auto* gdkDisplay=gdk_surface_get_display(surface);auto* display=gdk_x11_display_get_xdisplay(gdkDisplay);auto window=gdk_x11_surface_get_xid(surface);
  // The window manager owns a reparented frame. Send root coordinates through
  // EWMH when available, retaining ordinary ConfigureRequest for older WMs.
  if(gdk_x11_screen_supports_net_wm_hint(gdk_x11_display_get_screen(gdkDisplay),"_NET_MOVERESIZE_WINDOW")){
    XEvent event{};event.xclient.type=ClientMessage;event.xclient.display=display;event.xclient.window=window;event.xclient.message_type=XInternAtom(display,"_NET_MOVERESIZE_WINDOW",False);event.xclient.format=32;
    event.xclient.data.l[0]=NorthWestGravity|(1<<8)|(1<<9)|(1<<12);event.xclient.data.l[1]=x;event.xclient.data.l[2]=y;
    XSendEvent(display,DefaultRootWindow(display),False,SubstructureRedirectMask|SubstructureNotifyMask,&event);
  }else XMoveWindow(display,window,x,y);
}
void x11WindowPosition(GdkSurface* surface,int* x,int* y) {
  auto* display=gdk_x11_display_get_xdisplay(gdk_surface_get_display(surface));auto window=gdk_x11_surface_get_xid(surface);Window child=None;
  XTranslateCoordinates(display,window,DefaultRootWindow(display),0,0,x,y,&child);
  Atom actual=None;int format=0;unsigned long count=0,remaining=0;unsigned char* bytes=nullptr;
  if(XGetWindowProperty(display,window,XInternAtom(display,"_NET_FRAME_EXTENTS",False),0,4,False,XA_CARDINAL,&actual,&format,&count,&remaining,&bytes)==Success&&actual==XA_CARDINAL&&format==32&&count==4){
    auto* extents=reinterpret_cast<unsigned long*>(bytes);if(extents[0]<=65535&&extents[2]<=65535){*x-=int(extents[0]);*y-=int(extents[2]);}XFree(bytes);return;
  }
  if(bytes)XFree(bytes);
  Window frame=window;for(unsigned depth=0;depth<128;++depth){Window root=None,parent=None,*children=nullptr;unsigned count=0;const auto ok=XQueryTree(display,frame,&root,&parent,&children,&count);if(children)XFree(children);if(!ok||parent==None||parent==root)break;frame=parent;}
  if(frame!=window)XTranslateCoordinates(display,frame,DefaultRootWindow(display),0,0,x,y,&child);
}
void applyGeometry(GtkWidget* widget,bool move=false) {
  auto* state=static_cast<Geometry*>(g_object_get_data(G_OBJECT(widget),"vb6-window-geometry"));if(!state)return;
  auto* surface=gtk_widget_get_window(widget);if(!surface||!GDK_IS_X11_SURFACE(surface))return;
  auto* display=gdk_x11_display_get_xdisplay(gdk_surface_get_display(surface));auto window=gdk_x11_surface_get_xid(surface);
  if(move&&state->positioned)moveX11Window(surface,state->x,state->y);
  if(state->dialog){auto atom=XInternAtom(display,"_NET_WM_WINDOW_TYPE_DIALOG",False);XChangeProperty(display,window,XInternAtom(display,"_NET_WM_WINDOW_TYPE",False),XA_ATOM,32,PropModeReplace,reinterpret_cast<unsigned char*>(&atom),1);}
  if(state->icon){
    auto width=gdk_pixbuf_get_width(state->icon),height=gdk_pixbuf_get_height(state->icon),channels=gdk_pixbuf_get_n_channels(state->icon),stride=gdk_pixbuf_get_rowstride(state->icon);auto* pixels=gdk_pixbuf_get_pixels(state->icon);
    if(width>0&&height>0&&width<=4096&&height<=4096){std::vector<unsigned long> data(size_t(width)*size_t(height)+2);data[0]=width;data[1]=height;
      for(int y=0;y<height;++y)for(int x=0;x<width;++x){auto* pixel=pixels+y*stride+x*channels;data[size_t(y)*width+x+2]=(static_cast<unsigned long>(channels==4?pixel[3]:255)<<24)|(static_cast<unsigned long>(pixel[0])<<16)|(static_cast<unsigned long>(pixel[1])<<8)|pixel[2];}
      XChangeProperty(display,window,XInternAtom(display,"_NET_WM_ICON",False),XA_CARDINAL,32,PropModeReplace,reinterpret_cast<unsigned char*>(data.data()),int(data.size()));
    }
  }else XDeleteProperty(display,window,XInternAtom(display,"_NET_WM_ICON",False));
  XFlush(display);
}
Geometry& geometry(GtkWindow* window) {
  auto* state=static_cast<Geometry*>(g_object_get_data(G_OBJECT(window),"vb6-window-geometry"));
  if(!state){state=new Geometry;g_object_set_data_full(G_OBJECT(window),"vb6-window-geometry",state,+[](gpointer data){delete static_cast<Geometry*>(data);});g_signal_connect(window,"map",G_CALLBACK(+[](GtkWidget* widget,gpointer){applyGeometry(widget,true);}),nullptr);}
  return *state;
}
template<class T> struct ClipboardResult { bool done=false;T* value=nullptr;GError* error=nullptr; };
template<class T> void waitClipboard(ClipboardResult<T>& result) { while(!result.done)g_main_context_iteration(nullptr,TRUE);if(result.error)g_error_free(result.error); }
void disposeDescendantControls(GtkWidget* widget) {
  std::vector<GtkWidget*> children;for(auto* child=gtk_widget_get_first_child(widget);child;child=gtk_widget_get_next_sibling(child))children.push_back(GTK_WIDGET(g_object_ref(child)));
  for(auto* child:children){
    auto* weak=static_cast<std::weak_ptr<GtkControl>*>(g_object_get_data(G_OBJECT(child),"vb6-control"));auto control=weak?weak->lock():nullptr;
    if(control&&!control->disposed&&control->view==child)control->dispose();else disposeDescendantControls(child);
    g_object_unref(child);
  }
}
}

GtkWidget* gtkNativeFixedNew() { return GTK_WIDGET(g_object_new(native_fixed_get_type(),nullptr)); }
GtkWidget* gtkNativeTextViewNew() { return GTK_WIDGET(g_object_new(native_text_view_get_type(),nullptr)); }
void gtkNativeConnectDrawing(GtkControl& control) {
  if(!GTK_IS_DRAWING_AREA(control.widget))return;
  gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(control.widget),+[](GtkDrawingArea*,cairo_t* context,int,int,gpointer data){gtkEvent(data,[&](GtkControl& c){gtkDraw(c,context);});},new std::weak_ptr<GtkControl>(control.self()),+[](gpointer data){delete static_cast<std::weak_ptr<GtkControl>*>(data);});
}
GList* gtk_container_get_children(GtkContainer* container) { GList* result=nullptr;for(auto* child=gtk_widget_get_first_child(container);child;child=gtk_widget_get_next_sibling(child))result=g_list_append(result,child);return result; }
GtkWidget* gtk_bin_get_child(GtkBin* bin) {
  if(GTK_IS_COMBO_BOX(bin))return gtk_combo_box_get_child(GTK_COMBO_BOX(bin));
  if(GTK_IS_WINDOW(bin))return gtk_window_get_child(GTK_WINDOW(bin));
  if(GTK_IS_FRAME(bin))return gtk_frame_get_child(GTK_FRAME(bin));
  if(GTK_IS_SCROLLED_WINDOW(bin))return gtk_scrolled_window_get_child(GTK_SCROLLED_WINDOW(bin));
  return gtk_widget_get_first_child(bin);
}
void gtk_container_add(GtkContainer* container,GtkWidget* child) {
  if(GTK_IS_WINDOW(container))gtk_window_set_child(GTK_WINDOW(container),child);
  else if(GTK_IS_FRAME(container))gtk_frame_set_child(GTK_FRAME(container),child);
  else if(GTK_IS_SCROLLED_WINDOW(container))gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(container),child);
  else if(GTK_IS_BOX(container))gtk_box_append(GTK_BOX(container),child);
  else if(GTK_IS_FIXED(container))gtk_fixed_put(GTK_FIXED(container),child,0,0);
  else if(GTK_IS_VIEWPORT(container))gtk_viewport_set_child(GTK_VIEWPORT(container),child);
  else fail(5,"GTK4 container does not accept a child");
}
void gtk_container_remove(GtkContainer* container,GtkWidget* child) {
  if(gtk_widget_get_parent(child)!=container)return;
  if(GTK_IS_WINDOW(container))gtk_window_set_child(GTK_WINDOW(container),nullptr);
  else if(GTK_IS_FRAME(container))gtk_frame_set_child(GTK_FRAME(container),nullptr);
  else if(GTK_IS_SCROLLED_WINDOW(container))gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(container),nullptr);
  else if(GTK_IS_BOX(container))gtk_box_remove(GTK_BOX(container),child);
  else if(GTK_IS_FIXED(container))gtk_fixed_remove(GTK_FIXED(container),child);
  else if(GTK_IS_VIEWPORT(container))gtk_viewport_set_child(GTK_VIEWPORT(container),nullptr);
  else gtk_widget_unparent(child);
}
void gtk_widget_destroy(GtkWidget* widget) {
  if(!widget||g_object_get_data(G_OBJECT(widget),"vb6-destroying"))return;g_object_ref(widget);g_object_set_data(G_OBJECT(widget),"vb6-destroying",GINT_TO_POINTER(1));
  // VB owns references independently from the native parent. Explicitly dispose
  // descendants before unparenting them so removed tabs cannot retain controls.
  disposeDescendantControls(widget);
  auto* weak=static_cast<std::weak_ptr<GtkControl>*>(g_object_get_data(G_OBJECT(widget),"vb6-control"));
  if(weak)if(auto control=weak->lock();control&&!control->disposed)control->dispose();
  if(GTK_IS_WINDOW(widget))gtk_window_destroy(GTK_WINDOW(widget));
  else if(auto* parent=gtk_widget_get_parent(widget))gtk_container_remove(parent,widget);
  g_object_unref(widget);
}
void gtk_widget_show_all(GtkWidget* widget) { gtk_widget_set_visible(widget,TRUE);for(auto* child=gtk_widget_get_first_child(widget);child;child=gtk_widget_get_next_sibling(child))gtk_widget_show_all(child); }
void gtk_box_pack_start(GtkBox* box,GtkWidget* child,gboolean expand,gboolean fill,guint padding) {
  auto vertical=gtk_orientable_get_orientation(GTK_ORIENTABLE(box))==GTK_ORIENTATION_VERTICAL;
  if(vertical){gtk_widget_set_vexpand(child,expand);gtk_widget_set_valign(child,fill?GTK_ALIGN_FILL:GTK_ALIGN_START);gtk_widget_set_margin_top(child,padding);gtk_widget_set_margin_bottom(child,padding);}
  else{gtk_widget_set_hexpand(child,expand);gtk_widget_set_halign(child,fill?GTK_ALIGN_FILL:GTK_ALIGN_START);gtk_widget_set_margin_start(child,padding);gtk_widget_set_margin_end(child,padding);}
  gtk_box_append(box,child);
}
void gtk_box_pack_end(GtkBox* box,GtkWidget* child,gboolean expand,gboolean fill,guint padding) { gtk_box_pack_start(box,child,expand,fill,padding); }
gboolean gtk_widget_translate_coordinates(GtkWidget* source,GtkWidget* target,int x,int y,int* outX,int* outY) { double a=0,b=0;auto result=::gtk_widget_translate_coordinates(source,target,double(x),double(y),&a,&b);*outX=int(std::lround(a));*outY=int(std::lround(b));return result; }
void gtk_widget_override_font(GtkWidget* widget,const PangoFontDescription* font) {
  style(widget,"font-family",cssString(pango_font_description_get_family(font)));style(widget,"font-size",std::to_string(double(pango_font_description_get_size(font))/PANGO_SCALE)+(pango_font_description_get_size_is_absolute(font)?"px":"pt"));
  style(widget,"font-weight",std::to_string(int(pango_font_description_get_weight(font))));style(widget,"font-style",pango_font_description_get_style(font)==PANGO_STYLE_NORMAL?"normal":pango_font_description_get_style(font)==PANGO_STYLE_ITALIC?"italic":"oblique");
}
void gtk_widget_override_color(GtkWidget* widget,GtkStateFlags,const GdkRGBA* color) { auto* value=gdk_rgba_to_string(color);style(widget,"color",value);g_free(value); }
void gtk_widget_override_background_color(GtkWidget* widget,GtkStateFlags,const GdkRGBA* color) { auto* value=gdk_rgba_to_string(color);style(widget,"background-color",value);g_free(value); }
void gtk_button_set_image(GtkButton* button,GtkWidget* image) { if(!image)return;auto* caption=gtk_button_get_label(button);auto* box=gtk_box_new(GTK_ORIENTATION_HORIZONTAL,4);gtk_box_append(GTK_BOX(box),image);if(caption&&*caption)gtk_box_append(GTK_BOX(box),gtk_label_new_with_mnemonic(caption));gtk_button_set_child(button,box); }
void gtk_calendar_get_date(GtkCalendar* calendar,guint* year,guint* month,guint* day) { auto* date=::gtk_calendar_get_date(calendar);*year=g_date_time_get_year(date);*month=g_date_time_get_month(date)-1;*day=g_date_time_get_day_of_month(date);g_date_time_unref(date); }
void gtk_calendar_select_month(GtkCalendar* calendar,guint month,guint year) { guint y,m,d;gtk_calendar_get_date(calendar,&y,&m,&d);auto* date=g_date_time_new_local(int(year),int(month)+1,1,0,0,0);if(!date)fail(380);::gtk_calendar_select_day(calendar,date);g_date_time_unref(date); }
void gtk_calendar_select_day(GtkCalendar* calendar,guint day) { guint y,m,d;gtk_calendar_get_date(calendar,&y,&m,&d);auto* date=g_date_time_new_local(int(y),int(m)+1,int(day),0,0,0);if(!date)fail(380);::gtk_calendar_select_day(calendar,date);g_date_time_unref(date); }
int gdk_display_get_n_monitors(GdkDisplay* display) { return int(g_list_model_get_n_items(gdk_display_get_monitors(display))); }
GdkMonitor* gdk_display_get_monitor(GdkDisplay* display,int index) { if(index<0)return nullptr;auto* monitor=GDK_MONITOR(g_list_model_get_item(gdk_display_get_monitors(display),guint(index)));if(monitor)g_object_unref(monitor);return monitor; }
GdkMonitor* gdk_display_get_primary_monitor(GdkDisplay* display) { if(GDK_IS_X11_DISPLAY(display))if(auto* monitor=gdk_x11_display_get_primary_monitor(display))return monitor;return gdk_display_get_monitor(display,0); }
GdkSurface* gtk_widget_get_window(GtkWidget* widget) { auto* native=gtk_widget_get_native(widget);return native?gtk_native_get_surface(native):nullptr; }
void gtk_window_get_position(GtkWindow* window,int* x,int* y) {
  *x=*y=0;auto* surface=gtk_widget_get_window(GTK_WIDGET(window));if(surface&&GDK_IS_X11_SURFACE(surface))x11WindowPosition(surface,x,y);
  else if(!surface){auto& state=geometry(window);*x=state.x;*y=state.y;}
  else gtkNativeRequireX11(GTK_WIDGET(window),"Global window coordinates");
}
void gtk_window_move(GtkWindow* window,int x,int y) { if(gtk_widget_get_window(GTK_WIDGET(window)))gtkNativeRequireX11(GTK_WIDGET(window),"Global window positioning");auto& state=geometry(window);state.x=x;state.y=y;state.positioned=true;applyGeometry(GTK_WIDGET(window),true); }
void gtk_window_get_size(GtkWindow* window,int* width,int* height) { *width=gtk_widget_get_width(GTK_WIDGET(window));*height=gtk_widget_get_height(GTK_WIDGET(window));if(*width<=0||*height<=0)gtk_window_get_default_size(window,width,height); }
void gtk_window_set_position(GtkWindow* window,int) { int width,height;gtk_window_get_size(window,&width,&height);auto* monitor=gdk_display_get_primary_monitor(gtk_widget_get_display(GTK_WIDGET(window)));if(monitor){GdkRectangle rect;gdk_monitor_get_geometry(monitor,&rect);gtk_window_move(window,rect.x+(rect.width-width)/2,rect.y+(rect.height-height)/2);} }
void gtk_window_set_type_hint(GtkWindow* window,int) { geometry(window).dialog=true;applyGeometry(GTK_WIDGET(window)); }
void gtk_window_set_icon(GtkWindow* window,GdkPixbuf* icon) {
  gtkNativeRequireX11(GTK_WIDGET(window),"Per-window pixel icons");auto& state=geometry(window);GdkPixbuf* next=nullptr;
  if(icon){const auto width=gdk_pixbuf_get_width(icon),height=gdk_pixbuf_get_height(icon);const auto factor=std::min(1.0,256.0/std::max(width,height));next=factor<1?gdk_pixbuf_scale_simple(icon,std::max(1,int(width*factor)),std::max(1,int(height*factor)),GDK_INTERP_BILINEAR):GDK_PIXBUF(g_object_ref(icon));}
  if(state.icon)g_object_unref(state.icon);state.icon=next;applyGeometry(GTK_WIDGET(window));
}
void gdk_window_raise(GdkSurface* surface) { if(!GDK_IS_X11_SURFACE(surface))fail(453,"This display backend controls global window stacking; use X11 for Form.ZOrder");auto* display=gdk_x11_display_get_xdisplay(gdk_surface_get_display(surface));XRaiseWindow(display,gdk_x11_surface_get_xid(surface));XFlush(display); }
void gdk_window_lower(GdkSurface* surface) { if(!GDK_IS_X11_SURFACE(surface))fail(453,"This display backend controls global window stacking; use X11 for Form.ZOrder");auto* display=gdk_x11_display_get_xdisplay(gdk_surface_get_display(surface));XLowerWindow(display,gdk_x11_surface_get_xid(surface));XFlush(display); }
void gtk_widget_draw(GtkWidget* widget,cairo_t* context) {
  auto* paintable=gtk_widget_paintable_new(widget);auto* snapshot=gtk_snapshot_new();gdk_paintable_snapshot(paintable,GDK_SNAPSHOT(snapshot),gtk_widget_get_width(widget),gtk_widget_get_height(widget));auto* node=gtk_snapshot_free_to_node(snapshot);
  if(node){gsk_render_node_draw(node,context);gsk_render_node_unref(node);}g_object_unref(paintable);
}
gint gtk_dialog_run(GtkDialog* dialog) {
  struct State{GMainLoop* loop;int response=GTK_RESPONSE_NONE;bool done=false;};State state{g_main_loop_new(nullptr,FALSE)};
  auto response=g_signal_connect(dialog,"response",G_CALLBACK(+[](GtkDialog*,int id,gpointer data){auto* state=static_cast<State*>(data);state->response=id;state->done=true;g_main_loop_quit(state->loop);}),&state);
  auto closing=g_signal_connect(dialog,"close-request",G_CALLBACK(+[](GtkWindow* window,gpointer)->gboolean{gtk_dialog_response(GTK_DIALOG(window),GTK_RESPONSE_DELETE_EVENT);return TRUE;}),nullptr);
  gtk_window_set_modal(GTK_WINDOW(dialog),TRUE);gtk_window_present(GTK_WINDOW(dialog));if(!state.done)g_main_loop_run(state.loop);g_signal_handler_disconnect(dialog,response);g_signal_handler_disconnect(dialog,closing);g_main_loop_unref(state.loop);return state.response;
}
void gtk_file_chooser_set_current_folder(GtkFileChooser* chooser,const char* filename) { auto* file=g_file_new_for_path(filename);GError* error=nullptr;::gtk_file_chooser_set_current_folder(chooser,file,&error);g_object_unref(file);if(error)g_error_free(error); }
void gtk_file_chooser_set_filename(GtkFileChooser* chooser,const char* filename) { auto* file=g_file_new_for_path(filename);GError* error=nullptr;gtk_file_chooser_set_file(chooser,file,&error);g_object_unref(file);if(error)g_error_free(error); }
char* gtk_file_chooser_get_filename(GtkFileChooser* chooser) { auto* file=gtk_file_chooser_get_file(chooser);if(!file)return nullptr;auto* result=g_file_get_path(file);g_object_unref(file);return result; }
GSList* gtk_file_chooser_get_filenames(GtkFileChooser* chooser) { auto* files=gtk_file_chooser_get_files(chooser);GSList* result=nullptr;for(guint i=0;i<g_list_model_get_n_items(files);++i){auto* file=G_FILE(g_list_model_get_item(files,i));auto* path=g_file_get_path(file);g_object_unref(file);if(path)result=g_slist_append(result,path);}g_object_unref(files);return result; }
GSList* gtk_file_chooser_list_filters(GtkFileChooser* chooser) { auto* filters=gtk_file_chooser_get_filters(chooser);GSList* result=nullptr;for(guint i=0;i<g_list_model_get_n_items(filters);++i){auto* filter=g_list_model_get_item(filters,i);result=g_slist_append(result,filter);g_object_unref(filter);}g_object_unref(filters);return result; }
void gtk_clipboard_set_text(GtkClipboard* clipboard,const char* text,int length) { std::string value(text,length<0?std::strlen(text):size_t(length));gdk_clipboard_set_text(clipboard,value.c_str()); }
void gtk_clipboard_store(GtkClipboard* clipboard) { gdk_clipboard_store_async(clipboard,G_PRIORITY_DEFAULT,nullptr,+[](GObject* object,GAsyncResult* result,gpointer){GError* error=nullptr;gdk_clipboard_store_finish(GDK_CLIPBOARD(object),result,&error);if(error)g_error_free(error);},nullptr); }
char* gtk_clipboard_wait_for_text(GtkClipboard* clipboard) { ClipboardResult<char> state;gdk_clipboard_read_text_async(clipboard,nullptr,+[](GObject* object,GAsyncResult* result,gpointer data){auto* state=static_cast<ClipboardResult<char>*>(data);state->value=gdk_clipboard_read_text_finish(GDK_CLIPBOARD(object),result,&state->error);state->done=true;},&state);waitClipboard(state);return state.value; }
gboolean gtk_clipboard_wait_is_text_available(GtkClipboard* clipboard) { auto* formats=gdk_clipboard_get_formats(clipboard);return gdk_content_formats_contain_gtype(formats,G_TYPE_STRING)||gdk_content_formats_contain_mime_type(formats,"text/plain")||gdk_content_formats_contain_mime_type(formats,"text/plain;charset=utf-8"); }
gboolean gtk_clipboard_wait_is_image_available(GtkClipboard* clipboard) { auto* formats=gdk_clipboard_get_formats(clipboard);if(gdk_content_formats_contain_gtype(formats,GDK_TYPE_TEXTURE)||gdk_content_formats_contain_gtype(formats,GDK_TYPE_PIXBUF))return TRUE;for(auto* mime:{"image/png","image/jpeg","image/bmp","image/tiff"})if(gdk_content_formats_contain_mime_type(formats,mime))return TRUE;return FALSE; }
void gtk_clipboard_set_image(GtkClipboard* clipboard,GdkPixbuf* image) { auto* texture=gdk_texture_new_for_pixbuf(image);gdk_clipboard_set_texture(clipboard,texture);g_object_unref(texture); }
GdkPixbuf* gtk_clipboard_wait_for_image(GtkClipboard* clipboard) { ClipboardResult<GdkTexture> state;gdk_clipboard_read_texture_async(clipboard,nullptr,+[](GObject* object,GAsyncResult* result,gpointer data){auto* state=static_cast<ClipboardResult<GdkTexture>*>(data);state->value=gdk_clipboard_read_texture_finish(GDK_CLIPBOARD(object),result,&state->error);state->done=true;},&state);waitClipboard(state);if(!state.value)return nullptr;auto* pixels=gdk_pixbuf_get_from_texture(state.value);g_object_unref(state.value);return pixels; }
#else
GtkWidget* gtkNativeFixedNew() { return gtk_fixed_new(); }
GtkWidget* gtkNativeTextViewNew() { return gtk_text_view_new(); }
void gtkNativeConnectDrawing(GtkControl& control) { gtkSignal(control.widget,"draw",G_CALLBACK(+[](GtkWidget*,cairo_t* context,gpointer data)->gboolean{gtkEvent(data,[&](GtkControl& c){gtkDraw(c,context);});return FALSE;}),control.self()); }
#endif
}
