// Native cursor readback: global state, late forms, and per-control restoration.
#pragma once
#include "gtk.hpp"
#include <cstring>
#include <iostream>

namespace vb6_cursor_contracts {
inline void require(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
inline bool sameCursor(GdkWindow* window,const char* name){
  auto* actual=gdk_window_get_cursor(window);auto* expected=gdk_cursor_new_from_name(gdk_window_get_display(window),name);
  if(!actual||!expected){if(expected)g_object_unref(expected);return false;}
  if(actual==expected){g_object_unref(expected);return true;}
  auto* a=gdk_cursor_get_image(actual);auto* b=gdk_cursor_get_image(expected);g_object_unref(expected);
  bool same=a&&b&&gdk_pixbuf_get_width(a)==gdk_pixbuf_get_width(b)&&gdk_pixbuf_get_height(a)==gdk_pixbuf_get_height(b)&&gdk_pixbuf_get_n_channels(a)==gdk_pixbuf_get_n_channels(b);
  if(same)for(int row=0;row<gdk_pixbuf_get_height(a);++row)if(std::memcmp(gdk_pixbuf_get_pixels(a)+row*gdk_pixbuf_get_rowstride(a),gdk_pixbuf_get_pixels(b)+row*gdk_pixbuf_get_rowstride(b),size_t(gdk_pixbuf_get_width(a)*gdk_pixbuf_get_n_channels(a)))){same=false;break;}
  if(a)g_object_unref(a);if(b)g_object_unref(b);return same;
}
inline int checkEditorWindows(GdkWindow* window,GtkWidget* editor,const char* cursor){
  gpointer owner=nullptr;gdk_window_get_user_data(window,&owner);int count=0;
  if(owner==editor){if(!sameCursor(window,cursor))throw std::runtime_error(std::string("Screen cursor did not reach a native editor window: expected ")+cursor);++count;}
  auto* children=gdk_window_get_children(window);for(auto* child=children;child;child=child->next)count+=checkEditorWindows(GDK_WINDOW(child->data),editor,cursor);g_list_free(children);return count;
}
inline std::shared_ptr<vb6::Instance> form(vb6::Runtime& runtime,vb6::GtkHost& host,const std::string& name){
  vb6::Module module;module.name=name;module.kind="form";vb6::ControlSpec spec;spec.name=name;spec.type="Form";
  spec.properties={{"clientwidth",vb6::Value::integer(3600)},{"clientheight",vb6::Value::integer(1800)},{"mousepointer",vb6::Value::integer(2)}};module.form=spec;
  spec.name="Editor";spec.type="TextBox";spec.properties={{"width",vb6::Value::integer(1500)},{"height",vb6::Value::integer(450)},{"mousepointer",vb6::Value::integer(3)}};module.controls.push_back(spec);
  runtime.modules[vb6::lower(name)]=module;auto instance=runtime.instance(name);runtime.load(instance);host.formCall(instance,"show",{});host.pump();return instance;
}
}
inline void qualifyGtkScreenCursors(vb6::Runtime& runtime,vb6::GtkHost& host){
  using namespace vb6;using vb6_cursor_contracts::require;using vb6_cursor_contracts::sameCursor;
  auto screen=gtkHostObject(host,"screen").asObject();auto secondReference=gtkHostObject(host,"screen").asObject();
  require(screen->get(runtime,"MousePointer").integral()==0,"Screen cursor default is not zero");
  assign(runtime,screen->reference(runtime,"MousePointer"),Value::integer(11),false);
  require(secondReference->get(runtime,"MousePointer").integral()==11&&!host.initialized,"Screen cursor state is not shared or eagerly initialized GTK");
  for(int value:{-1,16,99}){bool rejected=false;try{screen->set(runtime,"MousePointer",Value::integer(value));}catch(const Error& error){if(error.number!=380)throw;rejected=true;}require(rejected&&screen->get(runtime,"MousePointer").integral()==11,"Invalid Screen.MousePointer changed the cursor state");}
  auto first=vb6_cursor_contracts::form(runtime,host,"CursorFirst");auto native=host.form(first);
  auto editor=std::dynamic_pointer_cast<GtkControl>(first->controls.at("editor"));
  auto* window=gtk_widget_get_window(native->window);
  require(sameCursor(window,"wait"),"A newly realized form did not inherit Screen.MousePointer");
  require(vb6_cursor_contracts::checkEditorWindows(window,editor->widget,"wait")>0,"Native GTK entry has no testable cursor window");
  std::cout<<"CURSOR_INITIAL_OK\n";
  require(native->surface->get(runtime,"MousePointer").integral()==2&&editor->get(runtime,"MousePointer").integral()==3,"Screen cursor changed individual control properties");
  auto later=vb6_cursor_contracts::form(runtime,host,"CursorLater");auto laterNative=host.form(later);
  require(sameCursor(gtk_widget_get_window(laterNative->window),"wait"),"A later form lost the application cursor override");
  editor->set(runtime,"MousePointer",Value::integer(2));host.pump();
  require(sameCursor(window,"wait")&&vb6_cursor_contracts::checkEditorWindows(window,editor->widget,"wait")>0,"Control refresh bypassed the application cursor override");
  std::cout<<"CURSOR_OVERRIDE_OK\n";
  secondReference->set(runtime,"MousePointer",Value::integer(0));host.pump();
  require(screen->get(runtime,"MousePointer").integral()==0&&sameCursor(window,"crosshair"),"Clearing Screen.MousePointer failed to restore the form cursor");
  require(vb6_cursor_contracts::checkEditorWindows(window,editor->widget,"crosshair")>0,"Clearing Screen.MousePointer lost a changed control cursor");
  std::cout<<"CURSOR_RESTORE_OK\n";
  editor->set(runtime,"MousePointer",Value::integer(0));host.pump();
  require(sameCursor(window,"crosshair"),"A windowless editor refresh changed the form cursor");
  require(vb6_cursor_contracts::checkEditorWindows(window,editor->widget,"text")>0,"Default MousePointer did not restore GTK's native text cursor");
  runtime.unload(later);runtime.unload(first);host.check();
  std::cout<<"LINUX_SCREEN_CURSORS_OK\n";
}
