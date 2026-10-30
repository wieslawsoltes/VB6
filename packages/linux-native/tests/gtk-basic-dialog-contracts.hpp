// Native common-dialog response, ownership, settings and clipboard contracts. MIT.
#pragma once
#include "gtk.hpp"
#include <fstream>

namespace vb6_basic_dialog_contracts {
using namespace vb6;
inline void require(bool value,const char* message){if(!value)throw std::runtime_error(message);}
struct Interaction {
  GtkHost& host;std::function<bool(GtkWidget*)> interact;guint source=0;bool completed=false;std::exception_ptr failure;
  gint64 deadline=g_get_monotonic_time()+30*G_TIME_SPAN_SECOND;
  Interaction(GtkHost& host,std::function<bool(GtkWidget*)> fn):host(host),interact(std::move(fn)){
    // GTK4 populates chooser models from frame/idle callbacks. A frequent
    // default-priority poll can starve those callbacks under CPU emulation.
    source=g_timeout_add_full(G_PRIORITY_LOW,10,+[](gpointer data)->gboolean{
      auto& state=*static_cast<Interaction*>(data);
      try{
        if(g_get_monotonic_time()>=state.deadline){auto* title=state.host.dialogs.empty()?nullptr:gtk_window_get_title(GTK_WINDOW(state.host.dialogs.back()));throw std::runtime_error(std::string("Native common dialog did not complete: ")+(title?title:"not opened"));}
        if(state.host.dialogs.empty())return G_SOURCE_CONTINUE;
        auto* dialog=state.host.dialogs.back();if(!gtk_widget_get_visible(dialog))return G_SOURCE_CONTINUE;
        require(GTK_IS_DIALOG(dialog),"Common dialog is not a native GtkDialog");
        require(gtk_window_get_modal(GTK_WINDOW(dialog)),"Common dialog is not modal");
        require(gtk_window_get_transient_for(GTK_WINDOW(dialog))!=nullptr,"Common dialog lost its native owner");
        if(!state.interact(dialog))return G_SOURCE_CONTINUE;
        state.completed=true;state.source=0;return G_SOURCE_REMOVE;
      }catch(...){state.failure=std::current_exception();state.source=0;if(!state.host.dialogs.empty())gtk_dialog_response(GTK_DIALOG(state.host.dialogs.back()),GTK_RESPONSE_CANCEL);return G_SOURCE_REMOVE;}
    },this,nullptr);
  }
  ~Interaction(){if(source)g_source_remove(source);}
  void check(){if(failure)std::rethrow_exception(failure);require(completed&&host.dialogs.empty(),"Common dialog returned without its native response or retained a live dialog");}
};
inline GtkWidget* descendant(GtkWidget* widget,GType type){
  if(G_TYPE_CHECK_INSTANCE_TYPE(widget,type))return widget;
#if GTK_MAJOR_VERSION < 4
  if(!GTK_IS_CONTAINER(widget))return nullptr;
#endif
  auto* children=gtk_container_get_children(GTK_CONTAINER(widget));GtkWidget* found=nullptr;
  for(auto* child=children;child&&!found;child=child->next)found=descendant(GTK_WIDGET(child->data),type);g_list_free(children);return found;
}
inline void respond(GtkWidget* dialog,int response){auto* button=gtk_dialog_get_widget_for_response(GTK_DIALOG(dialog),response);require(button&&GTK_IS_BUTTON(button),"Native dialog response button is missing");require(gtk_widget_is_sensitive(button),"Native dialog response button is disabled");gtk_button_clicked(GTK_BUTTON(button));}
#if GTK_MAJOR_VERSION >= 4
inline bool selectFontRow(GtkWidget* widget){
  if(GTK_IS_LIST_VIEW(widget)){
    auto* model=gtk_list_view_get_model(GTK_LIST_VIEW(widget));
    for(guint i=0;model&&i<g_list_model_get_n_items(G_LIST_MODEL(model));++i){
      auto* item=g_list_model_get_item(G_LIST_MODEL(model),i);bool selected=false;
      if(PANGO_IS_FONT_FACE(item)){auto* font=pango_font_face_describe(PANGO_FONT_FACE(item));selected=pango_font_description_get_weight(font)>=PANGO_WEIGHT_BOLD&&pango_font_description_get_style(font)!=PANGO_STYLE_NORMAL;pango_font_description_free(font);}
      g_object_unref(item);if(selected){gtk_selection_model_select_item(model,i,TRUE);return true;}
    }
  }
  for(auto* child=gtk_widget_get_first_child(widget);child;child=gtk_widget_get_next_sibling(child))if(selectFontRow(child))return true;return false;
}
#endif
}
inline void qualifyGtkBasicDialogs(vb6::Runtime& runtime,vb6::GtkHost& host){
  using namespace vb6;using namespace vb6_basic_dialog_contracts;
  {
    // Exercise the same implicit application command used by GtkRecentManager,
    // without depending on or modifying the user's recent-file database.
    const auto* program=g_get_prgname();const auto* application=g_get_application_name();
    require(program&&*program&&application&&*application,"Native GTK application has no executable identity");
    constexpr auto* uri="file:///tmp/vb6-native-program-name.txt";
    auto bookmarks=std::unique_ptr<GBookmarkFile,decltype(&g_bookmark_file_free)>(g_bookmark_file_new(),g_bookmark_file_free);
    g_bookmark_file_set_mime_type(bookmarks.get(),uri,"text/plain");g_bookmark_file_add_application(bookmarks.get(),uri,nullptr,nullptr);
    gsize length=0;auto* serialized=g_bookmark_file_to_data(bookmarks.get(),&length,nullptr);require(serialized&&length,"Native recent-file launch metadata could not be serialized");
    auto restored=std::unique_ptr<GBookmarkFile,decltype(&g_bookmark_file_free)>(g_bookmark_file_new(),g_bookmark_file_free);
    const auto loaded=g_bookmark_file_load_from_data(restored.get(),serialized,length,nullptr);g_free(serialized);require(loaded,"Native recent-file launch metadata did not round trip");
    gchar* command=nullptr;guint count=0;const auto found=g_bookmark_file_get_application_info(restored.get(),uri,application,&command,&count,nullptr,nullptr);
    const bool valid=found&&count==1&&command&&std::string(command)==std::string(program)+" "+uri;g_free(command);require(valid,"Native recent-file metadata lost the executable or document URI");
  }
  {
    Interaction interaction(host,[](GtkWidget* dialog){require(GTK_IS_MESSAGE_DIALOG(dialog),"MsgBox is not a native message dialog");respond(dialog,6);return true;});
    auto result=host.messageBox(u"Native GTK question Ω",3,u"Question");interaction.check();require(result.integral()==6,"MsgBox did not return the native Yes result");
  }
  {
    Interaction interaction(host,[](GtkWidget* dialog){auto* entry=descendant(gtk_dialog_get_content_area(GTK_DIALOG(dialog)),GTK_TYPE_ENTRY);require(entry&&std::string(gtk_entry_get_text(GTK_ENTRY(entry)))=="Initial","InputBox lost its initial text");gtk_entry_set_text(GTK_ENTRY(entry),"Edited Ω😀");respond(dialog,GTK_RESPONSE_OK);return true;});
    auto result=host.inputBox(u"Enter text",u"Input",u"Initial");interaction.check();require(result.string()==u"Edited Ω😀","InputBox lost native UTF-8 text input");
  }
  auto native=host.forms.begin()->second;ControlSpec spec;spec.name="CommonDialogContract";spec.type="CommonDialog";
  auto control=std::make_shared<GtkControl>(host,native->owner,spec);control->initialize();struct Guard{std::shared_ptr<GtkControl> control;~Guard(){control->dispose();}}guard{control};
  {
    Interaction interaction(host,[](GtkWidget* dialog){require(GTK_IS_COLOR_CHOOSER(dialog),"ShowColor did not open a native color chooser");GdkRGBA color{};color.red=.2;color.green=.4;color.blue=.6;color.alpha=1;gtk_color_chooser_set_rgba(GTK_COLOR_CHOOSER(dialog),&color);respond(dialog,GTK_RESPONSE_OK);return true;});
    host.dialog(*control,"showcolor");interaction.check();require(control->get(runtime,"Color").integral()==0x996633,"ShowColor did not preserve OLE color channel order");
  }
  {
    bool selected=false;Interaction interaction(host,[&](GtkWidget* dialog){
      require(GTK_IS_FONT_CHOOSER(dialog),"ShowFont did not open a native font chooser");
      if(!selected){
#if GTK_MAJOR_VERSION >= 4
        // Select a real native row, as a user does, after GTK's incremental
        // font model exposes it. A size-only update retains that exact face.
        if(!selectFontRow(dialog))return false;auto* font=pango_font_description_new();
#else
        // Pango can synthesize faces that a native chooser does not offer.
        PangoFontFamily** families=nullptr;int count=0;pango_font_map_list_families(pango_cairo_font_map_get_default(),&families,&count);PangoFontDescription* font=nullptr;
        for(int i=0;i<count&&!font;++i){PangoFontFace** faces=nullptr;int length=0;pango_font_family_list_faces(families[i],&faces,&length);for(int j=0;j<length&&!font;++j){if(pango_font_face_is_synthesized(faces[j]))continue;auto* candidate=pango_font_face_describe(faces[j]);if(pango_font_description_get_weight(candidate)>=PANGO_WEIGHT_BOLD&&pango_font_description_get_style(candidate)!=PANGO_STYLE_NORMAL)font=candidate;else pango_font_description_free(candidate);}g_free(faces);}g_free(families);require(font!=nullptr,"Native fixture needs an installed bold italic font face");
#endif
        pango_font_description_set_size(font,12*PANGO_SCALE);gtk_font_chooser_set_font_desc(GTK_FONT_CHOOSER(dialog),font);pango_font_description_free(font);selected=true;return false;
      }
      auto* font=gtk_font_chooser_get_font_desc(GTK_FONT_CHOOSER(dialog));if(!font)return false;
      const bool ready=pango_font_description_get_size(font)==12*PANGO_SCALE&&pango_font_description_get_weight(font)>=PANGO_WEIGHT_BOLD&&pango_font_description_get_style(font)!=PANGO_STYLE_NORMAL;pango_font_description_free(font);if(!ready)return false;
      respond(dialog,GTK_RESPONSE_OK);return true;
    });
    host.dialog(*control,"showfont");interaction.check();require(control->get(runtime,"FontSize").floating()==12&&control->get(runtime,"FontBold").truth()&&control->get(runtime,"FontItalic").truth(),"ShowFont did not preserve native font settings");
  }
  auto filename=std::filesystem::absolute("gtk-dialog-Ω.txt");{std::ofstream file(filename);file<<"Native chooser fixture";}
  struct FileGuard{std::filesystem::path path;~FileGuard(){std::error_code error;std::filesystem::remove(path,error);}}fileGuard{filename};
  control->set(runtime,"Filter",Value::string(u"Text|*.txt|All|*.*"));control->set(runtime,"FilterIndex",Value::integer(2));
  {
    bool selected=false;Interaction interaction(host,[&](GtkWidget* dialog){require(GTK_IS_FILE_CHOOSER(dialog),"ShowOpen did not open a native file chooser");auto* chooser=GTK_FILE_CHOOSER(dialog);if(!selected){gtk_file_chooser_set_filename(chooser,filename.c_str());selected=true;return false;}auto* result=gtk_file_chooser_get_filename(chooser);bool ready=result&&std::filesystem::path(result)==filename;g_free(result);if(!ready)return false;respond(dialog,GTK_RESPONSE_ACCEPT);return true;});
    host.dialog(*control,"showopen");interaction.check();require(control->get(runtime,"FileName").string()==fromUTF8(filename.string())&&control->get(runtime,"FileTitle").string()==u"gtk-dialog-Ω.txt"&&control->get(runtime,"FilterIndex").integral()==2,"ShowOpen lost the Unicode filename or selected filter");
  }
  const auto previous=control->get(runtime,"FileName").string();control->set(runtime,"CancelError",Value::boolean(true));
  {
    Interaction interaction(host,[](GtkWidget* dialog){respond(dialog,GTK_RESPONSE_CANCEL);return true;});int number=0;try{host.dialog(*control,"showsave");}catch(const Error& error){number=error.number;}interaction.check();require(number==32755&&control->get(runtime,"FileName").string()==previous,"Cancelling ShowSave changed the filename or omitted CancelError");
  }
  auto clipboard=gtkHostObject(host,"clipboard").asObject();clipboard->invoke(runtime,"SetText",{Arg(Value::string(u"Clipboard Ω😀"))});
  require(clipboard->invoke(runtime,"GetFormat",{Arg(Value::integer(1))}).truth()&&clipboard->invoke(runtime,"GetText",{}).string()==u"Clipboard Ω😀","Native clipboard text transfer failed");
  auto* pixels=gdk_pixbuf_new(GDK_COLORSPACE_RGB,TRUE,8,3,2);gdk_pixbuf_fill(pixels,0xff0000ff);auto picture=std::make_shared<vb6::GtkPicture>(pixels);g_object_unref(pixels);
  clipboard->invoke(runtime,"SetData",{Arg(Value::object(picture))});require(clipboard->invoke(runtime,"GetFormat",{Arg(Value::integer(2))}).truth(),"Native clipboard omitted its picture format");
  auto copied=std::dynamic_pointer_cast<vb6::GtkPicture>(clipboard->invoke(runtime,"GetData",{}).asObject());require(copied&&copied->pixels&&gdk_pixbuf_get_width(copied->pixels)==3&&gdk_pixbuf_get_height(copied->pixels)==2&&gdk_pixbuf_get_pixels(copied->pixels)[0]==255,"Native clipboard picture transfer lost its pixels");
  clipboard->invoke(runtime,"Clear",{});require(!clipboard->invoke(runtime,"GetFormat",{Arg(Value::integer(1))}).truth(),"Clipboard.Clear retained native text");
  std::cout<<"LINUX_GTK_BASIC_DIALOGS_OK\n";
}
