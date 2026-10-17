// GTK dialogs, screen/clipboard, POSIX launch and XDG persistent settings. MIT.
#include "gtk.hpp"
#include <cerrno>
#include <cstring>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>
extern char** environ;

namespace vb6 {
namespace {
struct Dialog {
  GtkWidget* widget;
  explicit Dialog(GtkWidget* value):widget(value){g_object_ref_sink(widget);}
  ~Dialog(){gtk_widget_destroy(widget);g_object_unref(widget);}
};
std::vector<Text> fonts() {
  PangoFontFamily** families=nullptr;int count=0;pango_font_map_list_families(pango_cairo_font_map_get_default(),&families,&count);
  std::vector<Text> result;for(int i=0;i<count;++i)result.push_back(fromUTF8(pango_font_family_get_name(families[i])));g_free(families);std::sort(result.begin(),result.end());return result;
}
struct HostObject final:Object {
  GtkHost* host;std::weak_ptr<int> life;std::string kind;
  HostObject(GtkHost& value,std::string name):host(&value),life(value.life),kind(std::move(name)){}
  void check(){if(life.expired())fail(91,"Native application has shut down");}
  std::string className()const override{return kind;}
  std::vector<Value> enumerate(Runtime&)override{check();if(kind!="forms")fail(451);std::vector<Value> values;for(auto& entry:host->forms)values.push_back(Value::object(entry.second->owner));return values;}
  Value get(Runtime& rt,const std::string& raw)override{
    check();auto name=lower(raw);host->ensureApplication();
    if(kind=="forms"&&name=="count")return Value::integer(host->forms.size());
    if(kind=="screen") {
      if(name=="width"||name=="height"){auto* display=gdk_display_get_default();auto* monitor=gdk_display_get_primary_monitor(display);if(!monitor)monitor=gdk_display_get_monitor(display,0);GdkRectangle rect{0,0,0,0};if(monitor)gdk_monitor_get_geometry(monitor,&rect);return Value::integer((name=="width"?rect.width:rect.height)*15);}
      if(name=="twipsperpixelx"||name=="twipsperpixely")return Value::integer(15,Type::Integer);
      if(name=="activeform"){for(auto& entry:host->forms)if(gtk_window_is_active(GTK_WINDOW(entry.second->window)))return Value::object(entry.second->owner);return Value::object(nullptr);}
      if(name=="activecontrol"){auto* window=host->activeWindow();return Value::object(window?host->controlForWidget(gtk_window_get_focus(window)):nullptr);}
      if(name=="fontcount")return Value::integer(fonts().size());
      if(name=="fonts"){std::vector<Value> values;for(auto& font:fonts())values.push_back(Value::string(font));return arrayValue(values,0,"string");}
      if(name=="mousepointer")return Value::integer(0,Type::Integer);
    }
    return Object::get(rt,raw);
  }
  void set(Runtime& rt,const std::string& raw,Value value,bool)override{check();auto name=lower(raw);if(kind=="screen"&&name=="mousepointer"){for(auto& entry:host->forms)entry.second->surface->set(rt,"mousepointer",value);return;}fail(438);}
  Value invoke(Runtime& rt,const std::string& raw,Args args)override{
    check();auto name=lower(raw);host->ensureApplication();
    if(kind=="forms"&&(name.empty()||name=="item")){if(args.size()!=1)fail(450);auto values=enumerate(rt);auto index=args[0].value.integral();if(index<0||size_t(index)>=values.size())fail(9);return values[size_t(index)];}
    if(kind=="screen"&&name=="fonts"){if(args.size()!=1)fail(450);auto values=fonts();auto index=args[0].value.integral();if(index<0||size_t(index)>=values.size())fail(9);return Value::string(values[size_t(index)]);}
    if(kind=="clipboard") {
      auto* clipboard=gtk_clipboard_get(GDK_SELECTION_CLIPBOARD);
      if(name=="clear"){gtk_clipboard_clear(clipboard);return {};}
      if(name=="settext"){if(args.empty()||args.size()>2)fail(450);if(integerArgument(args,1,1)!=1)fail(5);auto text=toUTF8(args[0].value.string());gtk_clipboard_set_text(clipboard,text.c_str(),int(text.size()));gtk_clipboard_store(clipboard);return {};}
      if(name=="gettext"){if(integerArgument(args,0,1)!=1)fail(5);auto* text=gtk_clipboard_wait_for_text(clipboard);auto result=Value::string(text?fromUTF8(text):Text());g_free(text);host->check();return result;}
      if(name=="getformat"){auto format=integerArgument(args,0,1);return Value::boolean(format==1?gtk_clipboard_wait_is_text_available(clipboard):(format==2||format==8)?gtk_clipboard_wait_is_image_available(clipboard):false);}
      if(name=="setdata"){auto format=integerArgument(args,1,2);if(format!=2&&format!=8)fail(5);auto picture=std::dynamic_pointer_cast<GtkPicture>(argument(args,0).asObject());if(!picture||!picture->pixels)fail(5);gtk_clipboard_set_image(clipboard,picture->pixels);gtk_clipboard_store(clipboard);return {};}
      if(name=="getdata"){auto format=integerArgument(args,0,2);if(format!=2&&format!=8)fail(5);auto* pixels=gtk_clipboard_wait_for_image(clipboard);host->check();if(!pixels)return Value::object(nullptr);auto image=std::make_shared<GtkPicture>(pixels);g_object_unref(pixels);image->ownerLife=host->life;image->registry=&host->handles;image->handle=host->handles.add(image,HandleKind::Image);return Value::object(image);}
    }
    if(args.empty())return get(rt,name);fail(438);
  }
};
std::vector<std::string> commandArguments(const Text& text) {
  auto input=toUTF8(text);if(input.empty()||input.size()>32768||input.find('\0')!=std::string::npos)fail(5);
  std::vector<std::string> values;std::string current;bool quoted=false,active=false;
  for(size_t i=0;i<input.size();++i){auto ch=input[i];if(ch=='"'){quoted=!quoted;active=true;}else if((ch==' '||ch=='\t')&&!quoted){if(active){values.push_back(current);current.clear();active=false;}}else if(ch=='\\'&&i+1<input.size()&&input[i+1]=='"'){current+='"';++i;active=true;}else{current+=ch;active=true;}}
  if(quoted)fail(5,"Unterminated Shell argument");if(active)values.push_back(current);if(values.empty()||values[0].empty())fail(5);return values;
}
struct Settings {
  GKeyFile* keyfile=g_key_file_new();std::filesystem::path path;
  Settings(){path=std::filesystem::path(g_get_user_config_dir())/"vb6-native"/"settings.ini";GError* error=nullptr;if(!g_key_file_load_from_file(keyfile,path.c_str(),G_KEY_FILE_NONE,&error)){if(error&&!g_error_matches(error,G_FILE_ERROR,G_FILE_ERROR_NOENT)){std::string text=error->message;g_error_free(error);g_key_file_unref(keyfile);fail(75,text);}if(error)g_error_free(error);}}
  ~Settings(){g_key_file_unref(keyfile);}
  void save(){std::error_code error;std::filesystem::create_directories(path.parent_path(),error);if(error)fail(75,error.message());GError* failure=nullptr;if(!g_key_file_save_to_file(keyfile,path.c_str(),&failure)){auto message=std::string(failure?failure->message:"Settings write failed");if(failure)g_error_free(failure);fail(75,message);}}
};
std::string settingPart(const Value& value){auto name=toUTF8(changeCase(value.string(),false));if(name.empty()||name.find_first_of("\r\n[]=")!=std::string::npos||name.find('\0')!=std::string::npos)fail(5,"Invalid settings name");return name;}
}
Value gtkHostObject(GtkHost& host,const std::string& name){return Value::object(std::make_shared<HostObject>(host,name));}
Value GtkHost::createObject(Runtime&,const std::string& raw) {
  auto name=lower(raw);if(name=="screen"||name=="clipboard"||name=="forms")return gtkHostObject(*this,name);
  if(name=="printer"||name=="printers")return gtkPrinter(*this,name);
  if(name=="stdpicture"||name=="stdole.stdpicture")return Value::object(std::make_shared<GtkPicture>());
  if(name=="stdfont"||name=="stdole.stdfont")return gtkFont();fail(429,"No native Linux object factory for "+raw);
}
Value GtkHost::appProperty(Runtime& rt,const std::string& raw) {
  auto name=lower(raw);if(name=="taskvisible")return Value::boolean(true);if(name=="startmode")return Value::integer(0,Type::Integer);if(name=="nonmodalallowed")return Value::boolean(true);if(name=="hinstance")return api(rt,"kernel32.GetModuleHandle",{Arg(Value::integer(0))});
  if(name=="previnstance")fail(453,"App.PrevInstance has no registered application identifier on Linux");fail(438);
}
int GtkHost::runDialog(GtkWidget* dialog) {
  dialogs.push_back(dialog);int result=gtk_dialog_run(GTK_DIALOG(dialog));dialogs.erase(std::find(dialogs.begin(),dialogs.end(),dialog));check();return result;
}
Value GtkHost::messageBox(const Text& prompt,int64_t flags,const Text& title) {
  ensureApplication();auto icon=flags&0xf0;auto type=icon==16?GTK_MESSAGE_ERROR:icon==32?GTK_MESSAGE_QUESTION:icon==48?GTK_MESSAGE_WARNING:GTK_MESSAGE_INFO;
  Dialog dialog(gtk_message_dialog_new(activeWindow(),GTK_DIALOG_MODAL,type,GTK_BUTTONS_NONE,"%s",toUTF8(prompt).c_str()));
  gtk_window_set_title(GTK_WINDOW(dialog.widget),toUTF8(title.empty()?fromUTF8(runtime->name):title).c_str());
  std::vector<std::pair<const char*,int>> buttons;
  switch(flags&15){case 0:buttons={{"_OK",1}};break;case 1:buttons={{"_OK",1},{"_Cancel",2}};break;case 2:buttons={{"_Abort",3},{"_Retry",4},{"_Ignore",5}};break;case 3:buttons={{"_Yes",6},{"_No",7},{"_Cancel",2}};break;case 4:buttons={{"_Yes",6},{"_No",7}};break;case 5:buttons={{"_Retry",4},{"_Cancel",2}};break;default:fail(5,"Invalid MsgBox style");}
  for(auto& button:buttons)gtk_dialog_add_button(GTK_DIALOG(dialog.widget),button.first,button.second);
  auto index=std::min(size_t((flags>>8)&3),buttons.size()-1);gtk_dialog_set_default_response(GTK_DIALOG(dialog.widget),buttons[index].second);
  auto response=runDialog(dialog.widget);return Value::integer(response>0?response:buttons.size()==1?buttons[0].second:2,Type::Integer);
}
Value GtkHost::inputBox(const Text& prompt,const Text& title,const Text& initial) {
  ensureApplication();Dialog dialog(gtk_dialog_new_with_buttons(toUTF8(title.empty()?fromUTF8(runtime->name):title).c_str(),activeWindow(),GTK_DIALOG_MODAL,"_Cancel",GTK_RESPONSE_CANCEL,"_OK",GTK_RESPONSE_OK,nullptr));
  auto* content=gtk_dialog_get_content_area(GTK_DIALOG(dialog.widget));auto* label=gtk_label_new(toUTF8(prompt).c_str());gtk_label_set_line_wrap(GTK_LABEL(label),TRUE);auto* entry=gtk_entry_new();gtk_entry_set_text(GTK_ENTRY(entry),toUTF8(initial).c_str());gtk_entry_set_activates_default(GTK_ENTRY(entry),TRUE);gtk_widget_set_size_request(entry,360,-1);gtk_box_pack_start(GTK_BOX(content),label,FALSE,FALSE,8);gtk_box_pack_start(GTK_BOX(content),entry,FALSE,FALSE,8);gtk_widget_show_all(content);gtk_dialog_set_default_response(GTK_DIALOG(dialog.widget),GTK_RESPONSE_OK);gtk_widget_grab_focus(entry);
  auto response=runDialog(dialog.widget);return Value::string(response==GTK_RESPONSE_OK?fromUTF8(gtk_entry_get_text(GTK_ENTRY(entry))):Text());
}
Value GtkHost::dialog(GtkControl& control,const std::string& name) {
  ensureApplication();
  if(name=="showopen"||name=="showsave") {
    bool save=name=="showsave";auto title=control.property("dialogtitle",Value::string(save?u"Save":u"Open")).string();
    Dialog dialog(gtk_file_chooser_dialog_new(toUTF8(title).c_str(),activeWindow(),save?GTK_FILE_CHOOSER_ACTION_SAVE:GTK_FILE_CHOOSER_ACTION_OPEN,"_Cancel",GTK_RESPONSE_CANCEL,save?"_Save":"_Open",GTK_RESPONSE_ACCEPT,nullptr));
    auto* chooser=GTK_FILE_CHOOSER(dialog.widget);auto flags=int64_t(control.number("flags"));gtk_file_chooser_set_select_multiple(chooser,!save&&(flags&0x200)!=0);if(save)gtk_file_chooser_set_do_overwrite_confirmation(chooser,(flags&2)!=0);
    auto folder=toUTF8(control.property("initdir",Value::string(u"")).string());if(!folder.empty())gtk_file_chooser_set_current_folder(chooser,folder.c_str());
    auto filename=toUTF8(control.property("filename",Value::string(u"")).string());if(!filename.empty()){if(save)gtk_file_chooser_set_current_name(chooser,std::filesystem::path(filename).filename().c_str());else gtk_file_chooser_set_filename(chooser,filename.c_str());}
    auto filter=toUTF8(control.property("filter",Value::string(u"")).string());std::vector<std::string> parts;size_t begin=0;while(begin<filter.size()){auto end=filter.find('|',begin);parts.push_back(filter.substr(begin,end==std::string::npos?end:end-begin));if(end==std::string::npos)break;begin=end+1;}
    for(size_t i=0;i+1<parts.size();i+=2){auto* value=gtk_file_filter_new();gtk_file_filter_set_name(value,parts[i].c_str());size_t start=0;while(start<=parts[i+1].size()){auto end=parts[i+1].find(';',start);auto pattern=parts[i+1].substr(start,end==std::string::npos?end:end-start);gtk_file_filter_add_pattern(value,pattern=="*.*"?"*":pattern.c_str());if(end==std::string::npos)break;start=end+1;}gtk_file_chooser_add_filter(chooser,value);if(int64_t(i/2+1)==int64_t(control.number("filterindex",1)))gtk_file_chooser_set_filter(chooser,value);}
    if(runDialog(dialog.widget)!=GTK_RESPONSE_ACCEPT){if(control.flag("cancelerror"))fail(32755,"Dialog cancelled");return {};}
    auto* result=gtk_file_chooser_get_filename(chooser);if(!result)fail(75,"No local filename was selected");std::filesystem::path path(result);Text output=fromUTF8(result);g_free(result);
    if(!save&&(flags&0x200)){auto* files=gtk_file_chooser_get_filenames(chooser);if(g_slist_length(files)>1){output=fromUTF8(path.parent_path().string());for(auto* it=files;it;it=it->next){output+=u'\0';output+=fromUTF8(std::filesystem::path(static_cast<char*>(it->data)).filename().string());}}g_slist_free_full(files,g_free);}
    if(save&&!path.has_extension()){auto extension=control.property("defaultext",Value::string(u"")).string();if(!extension.empty()){output+=u'.';output+=extension;path=toUTF8(output);}}
    control.properties["filename"]=Value::string(output);control.properties["filetitle"]=Value::string(fromUTF8(path.filename().string()));
    auto* selected=gtk_file_chooser_get_filter(chooser);auto* available=gtk_file_chooser_list_filters(chooser);int index=1;for(auto* it=available;it;it=it->next,++index)if(it->data==selected){control.properties["filterindex"]=Value::integer(index);break;}g_slist_free(available);return {};
  }
  if(name=="showcolor") {
    Dialog dialog(gtk_color_chooser_dialog_new("Color",activeWindow()));auto color=gtkColor(control.number("color"));gtk_color_chooser_set_rgba(GTK_COLOR_CHOOSER(dialog.widget),&color);
    if(runDialog(dialog.widget)!=GTK_RESPONSE_OK){if(control.flag("cancelerror"))fail(32755);return {};}
    gtk_color_chooser_get_rgba(GTK_COLOR_CHOOSER(dialog.widget),&color);control.properties["color"]=Value::integer(gtkColorValue(color));return {};
  }
  if(name=="showfont") {
    Dialog dialog(gtk_font_chooser_dialog_new("Font",activeWindow()));auto* font=pango_font_description_new();pango_font_description_set_family(font,toUTF8(control.property("fontname",Value::string(u"Sans")).string()).c_str());pango_font_description_set_size(font,int(control.number("fontsize",8.25)*PANGO_SCALE));pango_font_description_set_weight(font,control.flag("fontbold")?PANGO_WEIGHT_BOLD:PANGO_WEIGHT_NORMAL);pango_font_description_set_style(font,control.flag("fontitalic")?PANGO_STYLE_ITALIC:PANGO_STYLE_NORMAL);gtk_font_chooser_set_font_desc(GTK_FONT_CHOOSER(dialog.widget),font);pango_font_description_free(font);
    if(runDialog(dialog.widget)!=GTK_RESPONSE_OK){if(control.flag("cancelerror"))fail(32755);return {};}
    font=gtk_font_chooser_get_font_desc(GTK_FONT_CHOOSER(dialog.widget));control.properties["fontname"]=Value::string(fromUTF8(pango_font_description_get_family(font)));control.properties["fontsize"]=Value::real(double(pango_font_description_get_size(font))/PANGO_SCALE);control.properties["fontbold"]=Value::boolean(pango_font_description_get_weight(font)>=PANGO_WEIGHT_BOLD);control.properties["fontitalic"]=Value::boolean(pango_font_description_get_style(font)!=PANGO_STYLE_NORMAL);pango_font_description_free(font);return {};
  }
  if(name=="showprinter") {
    auto* operation=gtk_print_operation_new();gtk_print_operation_set_n_pages(operation,1);
    // The common dialog chooses settings; it must not submit an empty print job.
    g_signal_connect(operation,"begin-print",G_CALLBACK(+[](GtkPrintOperation* operation,GtkPrintContext*,gpointer){gtk_print_operation_cancel(operation);}),nullptr);
    GError* error=nullptr;auto result=gtk_print_operation_run(operation,GTK_PRINT_OPERATION_ACTION_PRINT_DIALOG,activeWindow(),&error);g_object_unref(operation);check();if(error){auto text=std::string(error->message);g_error_free(error);fail(482,text);}if(result==GTK_PRINT_OPERATION_RESULT_CANCEL&&control.flag("cancelerror"))fail(32755);return {};
  }
  fail(438);
}
Value GtkHost::builtin(Frame& frame,const std::string& raw,Args args) {
  auto name=lower(raw);
  if(name=="msgbox")return messageBox(stringArgument(args,0),integerArgument(args,1,0),stringArgument(args,2,fromUTF8(runtime->name)));
  if(name=="inputbox")return inputBox(stringArgument(args,0),stringArgument(args,1,fromUTF8(runtime->name)),stringArgument(args,2));
  if(name=="beep"){ensureApplication();gdk_display_beep(gdk_display_get_default());return {};}
  if(name=="shell"){auto values=commandArguments(stringArgument(args,0));std::vector<char*> pointers;for(auto& value:values)pointers.push_back(value.data());pointers.push_back(nullptr);pid_t pid=0;int error=posix_spawnp(&pid,pointers[0],nullptr,nullptr,pointers.data(),environ);if(error)fail(error==ENOENT?53:error==EACCES?70:5,std::strerror(error));std::thread([pid]{int status;while(waitpid(pid,&status,0)<0&&errno==EINTR){}}).detach();return Value::real(double(pid));}
  if(name=="loadpicture"){auto path=stringArgument(args,0);if(path.empty())return Value::object(std::make_shared<GtkPicture>());if(path.find(u'\0')!=Text::npos)fail(52);return gtkLoadPicture(*this,readNativeResourceFile(std::filesystem::path(toUTF8(path))));}
  if(name=="loadrespicture"){auto format=integerArgument(args,1);if(format<0||format>2)fail(5);return gtkLoadPicture(*this,nativeResources(*runtime).picture(argument(args,0),int(format)));}
  if(name=="savepicture") {
    auto picture=std::dynamic_pointer_cast<GtkPicture>(argument(args,0).asObject());if(!picture||!picture->pixels)fail(5);
    auto filename=toUTF8(stringArgument(args,1));if(filename.find('\0')!=std::string::npos)fail(52);
    GError* error=nullptr;gboolean saved;
    if(picture->pictureType==3&&!picture->encoded.empty()) {
      // Like the other native host, preserve the complete validated ICO/CUR,
      // including every frame and cursor hotspot, regardless of its filename.
      const auto& bytes=picture->encoded;
      saved=g_file_set_contents(filename.c_str(),reinterpret_cast<const gchar*>(bytes.data()),gssize(bytes.size()),&error);
    } else {
      auto extension=lower(std::filesystem::path(filename).extension().string());
      const std::map<std::string,const char*> formats={{"","png"},{".png","png"},{".jpg","jpeg"},{".jpeg","jpeg"},{".bmp","bmp"},{".tif","tiff"},{".tiff","tiff"}};
      auto found=formats.find(extension);
      if(found==formats.end())fail(5,"SavePicture requires PNG, JPEG, BMP, TIFF, or an original ICO/CUR picture");
      saved=gdk_pixbuf_save(picture->pixels,filename.c_str(),found->second,&error,nullptr);
    }
    if(!saved){auto message=std::string(error?error->message:"Picture save failed");if(error)g_error_free(error);fail(75,message);}return {};
  }
  if(name=="savesetting"||name=="getsetting"||name=="deletesetting"||name=="getallsettings") {
    Settings settings;auto app=settingPart(argument(args,0)),section=settingPart(argument(args,1)),group=app+"/"+section;
    if(name=="getallsettings"){gsize count=0;auto** keys=g_key_file_get_keys(settings.keyfile,group.c_str(),&count,nullptr);if(!keys||!count){g_strfreev(keys);return {};}auto array=std::make_shared<Array>("variant",Bounds{{0,int32_t(count)-1},{0,1}},true,runtime->maxArrayElements);for(size_t i=0;i<count;++i){auto* value=g_key_file_get_string(settings.keyfile,group.c_str(),keys[i],nullptr);array->values[i]=Value::string(fromUTF8(keys[i]));array->values[i+count]=Value::string(value?fromUTF8(value):Text());g_free(value);}g_strfreev(keys);return Value::array(array);}
    if(name=="deletesetting"){bool success;auto key=argument(args,2);if(key.type==Type::Missing)success=g_key_file_remove_group(settings.keyfile,group.c_str(),nullptr);else success=g_key_file_remove_key(settings.keyfile,group.c_str(),settingPart(key).c_str(),nullptr);if(!success)fail(5);settings.save();return {};}
    auto key=settingPart(argument(args,2));if(name=="getsetting"){auto* value=g_key_file_get_string(settings.keyfile,group.c_str(),key.c_str(),nullptr);auto result=Value::string(value?fromUTF8(value):stringArgument(args,3));g_free(value);return result;}
    g_key_file_set_string(settings.keyfile,group.c_str(),key.c_str(),toUTF8(stringArgument(args,3)).c_str());settings.save();return {};
  }
  return NativeHost::builtin(frame,raw,std::move(args));
}
}
