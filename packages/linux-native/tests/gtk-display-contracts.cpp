// Real X11 window-manager and Wayland widget/lifetime qualification. MIT.
#include "gtk.hpp"
#include "gtk-richtext.hpp"
#include <iostream>
#if GTK_MAJOR_VERSION >= 4
#include <gdk/x11/gdkx.h>
#include <gdk/wayland/gdkwayland.h>
#include <X11/Xatom.h>
#else
#include <gdk/gdkx.h>
#include <gdk/gdkwayland.h>
#endif

using namespace vb6;
namespace {
void require(bool value,const char* message){if(!value)throw std::runtime_error(message);}
void rejected(const std::function<void()>& action){try{action();}catch(const Error& error){require(error.number==453,"Unexpected display-boundary error number");return;}throw std::runtime_error("Unsupported global display operation was silently accepted");}
void until(GtkHost& host,const char* phase,const std::function<bool()>& ready,const std::function<std::string()>& state){
  const auto deadline=g_get_monotonic_time()+15*G_TIME_SPAN_SECOND;
  while(!ready()){
    try{require(g_get_monotonic_time()<deadline,"Native display transition did not finish");}
    catch(...){
      std::cerr<<"Native display timeout phase: "<<phase<<"\n";
      // Observe state only after failure, and retain the original timeout even
      // if a diagnostic getter is no longer available.
      try{const auto detail=state();std::cerr<<"Native display last state: "<<detail<<"\n";}
      catch(const std::exception& error){std::cerr<<"Native display state unavailable: "<<error.what()<<"\n";}
      catch(...){std::cerr<<"Native display state unavailable: unknown diagnostic error\n";}
      throw;
    }
    host.pump();g_usleep(5000);
  }
  host.check();
}
ControlSpec spec(const char* type,const char* name,int x,int y,int width,int height){ControlSpec value;value.type=type;value.name=name;value.properties={{"left",Value::integer(x*15)},{"top",Value::integer(y*15)},{"width",Value::integer(width*15)},{"height",Value::integer(height*15)}};return value;}
std::shared_ptr<GtkControl> control(const std::shared_ptr<Instance>& owner,const char* name){auto value=std::dynamic_pointer_cast<GtkControl>(owner->controls.at(lower(name)));require(bool(value),"Display fixture control is missing");return value;}
}
int main(int argc,char** argv){
  try{
    require(argc==2&&(std::string(argv[1])=="--x11"||std::string(argv[1])=="--wayland"),"Expected --x11 or --wayland");const bool wayland=std::string(argv[1])=="--wayland";
    Runtime runtime(makeNativeHost());runtime.name="GTK Display Contracts";auto& host=static_cast<GtkHost&>(*runtime.host);
    Module module;module.name="DisplayForm";module.kind="form";module.form=spec("Form","DisplayForm",20,20,640,420);module.form->properties.push_back({"clientwidth",Value::integer(9600)});module.form->properties.push_back({"clientheight",Value::integer(6300)});
    module.controls.push_back(spec("CommandButton","Button",20,20,120,35));module.controls.push_back(spec("TextBox","Plain",160,20,280,35));module.controls.push_back(spec("RichTextBox","Rich",20,80,550,240));
    auto timer=spec("Timer","Pulse",0,0,0,0);timer.properties.push_back({"enabled",Value::boolean(false)});timer.properties.push_back({"interval",Value::integer(20)});module.controls.push_back(timer);
    int clicks=0,ticks=0;Procedure clicked;clicked.name="button_click";clicked.code=[&](Frame&){++clicks;return Value{};};module.procedures[clicked.name]=clicked;
    Procedure pulse;pulse.name="pulse_timer";pulse.code=[&](Frame& frame){if(++ticks==3)runtime.unload(frame.self);return Value{};};module.procedures[pulse.name]=pulse;
    runtime.modules["displayform"]=module;auto owner=runtime.instance("DisplayForm");runtime.load(owner);auto form=host.form(owner);host.formCall(owner,"show",{});
    require(wayland?GDK_IS_WAYLAND_DISPLAY(gtk_widget_get_display(form->window)):gtkNativeX11Display(form->window),"Fixture used the wrong native display backend");
    auto button=control(owner,"Button"),plain=control(owner,"Plain"),rich=control(owner,"Rich");
    until(host,wayland?"Wayland widget mapping":"X11 widget mapping",[&]{return gtk_widget_get_mapped(form->window)&&gtk_widget_get_mapped(rich->widget);},[&]{
      return "formMapped="+std::to_string(gtk_widget_get_mapped(form->window))+", richMapped="+std::to_string(gtk_widget_get_mapped(rich->widget))+", formVisible="+std::to_string(gtk_widget_get_visible(form->window))+", richVisible="+std::to_string(gtk_widget_get_visible(rich->widget));
    });
    gtk_button_clicked(GTK_BUTTON(button->widget));host.check();require(clicks==1,"Native display did not dispatch the button signal");plain->set(runtime,"text",Value::string(u"Native Ω😀"));require(plain->editText()==u"Native Ω😀","Native display editor lost Unicode");
    const std::string red="89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082";
    rich->set(runtime,"textrtf",Value::string(fromUTF8("{\\rtf1\\ansi {\\b Native} \\u937?\\u-10179?\\u-8704?{\\pict\\pngblip\\picwgoal300\\pichgoal300 "+red+"}{\\trowd\\cellx1800\\cellx3600\\intbl Left\\cell Right\\cell\\row}}")));
    auto document=gtkRichSnapshot(*rich);require(document.text.find(u"Native Ω😀")!=Text::npos&&document.objects.size()==2&&document.objects[1].cells.size()==2,"Native display lost rich text, embedded pixels or editable table cells");require(rich->editText()==document.text,"Native display rich-text UTF-16 object anchors differ from the document");
    rich->editSelect(0,6);require(rich->get(runtime,"selbold").truth(),"Native display lost rich-text character formatting");host.pump();
    auto* pixels=gdk_pixbuf_new(GDK_COLORSPACE_RGB,TRUE,8,1000,400);gdk_pixbuf_fill(pixels,0xff0000ff);auto picture=std::make_shared<vb6::GtkPicture>(pixels);g_object_unref(pixels);
    if(wayland){
      const auto before=form->surface->properties;rejected([&]{host.formGet(owner,"left");});rejected([&]{host.formGet(owner,"top");});
      rejected([&]{host.formSet(owner,"left",Value::integer(4500));});rejected([&]{host.formSet(owner,"top",Value::integer(4500));});
      rejected([&]{host.formCall(owner,"move",{Arg(Value::integer(4500)),Arg(Value::integer(4500)),Arg(Value::integer(6000)),Arg(Value::integer(6000))});});
      rejected([&]{host.formCall(owner,"zorder",{Arg(Value::integer(0))});});rejected([&]{host.formCall(owner,"zorder",{Arg(Value::integer(1))});});rejected([&]{form->surface->set(runtime,"icon",Value::object(picture));});
      for(const auto& name:{"left","top","width","height","icon"}){auto a=before.find(name);auto b=form->surface->properties.find(name);require((a==before.end())==(b==form->surface->properties.end()),"Rejected display operation changed stored properties");if(a!=before.end())require(a->second.type==b->second.type&&a->second.string()==b->second.string(),"Rejected display operation changed its previous value");}
      auto buffer=std::make_shared<Cell>(Value::string(u"################"),"string");rejected([&]{host.api(runtime,"user32.GetWindowRect",{Arg(Value::integer(form->surface->handle)),Arg(cellRef(buffer))});});require(buffer->get().string()==u"################","Rejected GetWindowRect changed output storage");
      rejected([&]{host.api(runtime,"user32.MoveWindow",{Arg(Value::integer(form->surface->handle)),Arg(Value::integer(10)),Arg(Value::integer(20)),Arg(Value::integer(300)),Arg(Value::integer(200)),Arg(Value::integer(1))});});
      // Local child geometry remains meaningful without global coordinates.
      host.api(runtime,"user32.MoveWindow",{Arg(Value::integer(plain->handle)),Arg(Value::integer(170)),Arg(Value::integer(25)),Arg(Value::integer(260)),Arg(Value::integer(35)),Arg(Value::integer(1))});require(plain->number("left")==2550&&plain->number("top")==375,"Wayland rejected local child layout");
      host.formSet(owner,"width",Value::integer(9900));host.formSet(owner,"height",Value::integer(6600));
    }else{
#if GTK_MAJOR_VERSION >= 4
      until(host,"X11 EWMH capability",[&]{return gdk_x11_screen_supports_net_wm_hint(gdk_x11_display_get_screen(gtk_widget_get_display(form->window)),"_NET_MOVERESIZE_WINDOW");},[&]{
        return "_NET_MOVERESIZE_WINDOW="+std::to_string(gdk_x11_screen_supports_net_wm_hint(gdk_x11_display_get_screen(gtk_widget_get_display(form->window)),"_NET_MOVERESIZE_WINDOW"))+", formMapped="+std::to_string(gtk_widget_get_mapped(form->window));
      });
#else
      until(host,"X11 EWMH capability",[&]{return gdk_x11_screen_supports_net_wm_hint(gdk_screen_get_default(),gdk_atom_intern_static_string("_NET_MOVERESIZE_WINDOW"));},[&]{
        return "_NET_MOVERESIZE_WINDOW="+std::to_string(gdk_x11_screen_supports_net_wm_hint(gdk_screen_get_default(),gdk_atom_intern_static_string("_NET_MOVERESIZE_WINDOW")))+", formMapped="+std::to_string(gtk_widget_get_mapped(form->window));
      });
#endif
      host.formCall(owner,"move",{Arg(Value::integer(2100)),Arg(Value::integer(1800)),Arg(Value::integer(9600)),Arg(Value::integer(6300))});
      until(host,"X11 Form.Move position",[&]{return host.formGet(owner,"left").integral()==2100&&host.formGet(owner,"top").integral()==1800;},[&]{
        return "leftTwips="+std::to_string(host.formGet(owner,"left").integral())+", topTwips="+std::to_string(host.formGet(owner,"top").integral())+", expectedLeftTwips=2100, expectedTopTwips=1800, formMapped="+std::to_string(gtk_widget_get_mapped(form->window));
      });
      form->surface->set(runtime,"icon",Value::object(picture));host.pump();require(host.formGet(owner,"left").integral()==2100&&host.formGet(owner,"top").integral()==1800,"Updating the native icon moved the window");
#if GTK_MAJOR_VERSION >= 4
      auto* surface=gtk_widget_get_window(form->window);auto* display=gdk_x11_display_get_xdisplay(gdk_surface_get_display(surface));Atom type=None;int format=0;unsigned long count=0,remaining=0;unsigned char* bytes=nullptr;
      const auto status=XGetWindowProperty(display,gdk_x11_surface_get_xid(surface),XInternAtom(display,"_NET_WM_ICON",False),0,262146,False,XA_CARDINAL,&type,&format,&count,&remaining,&bytes);auto* icon=reinterpret_cast<unsigned long*>(bytes);const bool valid=status==Success&&type==XA_CARDINAL&&format==32&&count>=3&&icon[0]==256&&icon[1]==102&&count==2+icon[0]*icon[1]&&uint32_t(icon[2])==0xffff0000U;if(!valid)std::cerr<<"Native icon property: status="<<status<<" type="<<type<<" format="<<format<<" count="<<count<<" width="<<(count>0?icon[0]:0)<<" height="<<(count>1?icon[1]:0)<<" first="<<(count>2?icon[2]:0)<<"\n";if(bytes)XFree(bytes);require(valid,"GTK4 did not publish bounded ARGB window icon pixels");
#else
      require(gtk_window_get_icon(GTK_WINDOW(form->window))!=nullptr,"GTK3 did not retain the actual window icon");
#endif
      host.formCall(owner,"zorder",{Arg(Value::integer(1))});host.formCall(owner,"zorder",{Arg(Value::integer(0))});host.pump();
    }
    auto pulseControl=control(owner,"Pulse");pulseControl->set(runtime,"enabled",Value::boolean(true));
    until(host,wayland?"Wayland timer/unload":"X11 timer/unload",[&]{return host.forms.empty();},[&]{
      return "forms="+std::to_string(host.forms.size())+", ticks="+std::to_string(ticks)+", ownerLoaded="+std::to_string(owner->loaded)+", plainDisposed="+std::to_string(plain->disposed)+", richDisposed="+std::to_string(rich->disposed)+", timerSource="+std::to_string(pulseControl->timer);
    });
    require(ticks==3&&!owner->loaded&&plain->disposed&&rich->disposed&&!pulseControl->timer,"Native display timer/unload retained widgets or sources");
    std::cout<<(wayland?"LINUX_GTK_WAYLAND_OK":"LINUX_GTK_X11_WM_OK")<<"\n";
  }catch(const std::exception& error){std::cerr<<"GTK display contract failure: "<<error.what()<<"\n";return 1;}
}
