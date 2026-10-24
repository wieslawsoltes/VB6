// Cairo/Pango/GdkPixbuf rendering and native GTK printing. MIT.
#include "gtk.hpp"
#include "gtk-printers.hpp"
#include <gtk/gtkunixprint.h>
#include <cups/cups.h>
#include <cups/pwg.h>
#include <cstdlib>

namespace vb6 {
namespace {
constexpr double Pi=3.14159265358979323846;
void source(cairo_t* cr,int32_t value){auto color=gtkColor(value);cairo_set_source_rgba(cr,color.red,color.green,color.blue,color.alpha);}
PangoFontDescription* drawingFont(const GtkDrawing& command) {
  auto* font=pango_font_description_new();pango_font_description_set_family(font,toUTF8(command.fontName).c_str());
  pango_font_description_set_size(font,int(command.fontSize*PANGO_SCALE));pango_font_description_set_weight(font,command.bold?PANGO_WEIGHT_BOLD:PANGO_WEIGHT_NORMAL);pango_font_description_set_style(font,command.italic?PANGO_STYLE_ITALIC:PANGO_STYLE_NORMAL);return font;
}
void drawCommands(cairo_t* cr,const std::vector<GtkDrawing>& commands) {
  for(auto& command:commands) {
    auto& v=command.coordinates;cairo_save(cr);source(cr,command.color);cairo_set_line_width(cr,command.width);
    const double dash[]={4,2},dot[]={1,2},dashDot[]={4,2,1,2},dashDotDot[]={4,2,1,2,1,2};
    if(command.style==1)cairo_set_dash(cr,dash,2,0);else if(command.style==2)cairo_set_dash(cr,dot,2,0);else if(command.style==3)cairo_set_dash(cr,dashDot,4,0);else if(command.style==4)cairo_set_dash(cr,dashDotDot,6,0);
    if(command.style==5){cairo_restore(cr);continue;}
    if(command.kind=="line"&&v.size()>=4){cairo_move_to(cr,v[0],v[1]);cairo_line_to(cr,v[2],v[3]);cairo_stroke(cr);}
    else if((command.kind=="rect"||command.kind=="ellipse")&&v.size()>=4){double x=std::min(v[0],v[2]),y=std::min(v[1],v[3]),w=std::abs(v[2]-v[0]),h=std::abs(v[3]-v[1]);if(command.kind=="ellipse"){if(w>0&&h>0){cairo_save(cr);cairo_translate(cr,x+w/2,y+h/2);cairo_scale(cr,w/2,h/2);cairo_arc(cr,0,0,1,0,2*Pi);cairo_restore(cr);}}else cairo_rectangle(cr,x,y,w,h);if(command.fill)cairo_fill(cr);else cairo_stroke(cr);}
    else if(command.kind=="pixel"&&v.size()>=2){cairo_rectangle(cr,v[0],v[1],1,1);cairo_fill(cr);}
    else if(command.kind=="text"&&v.size()>=2){auto* layout=pango_cairo_create_layout(cr);auto* font=drawingFont(command);pango_layout_set_font_description(layout,font);pango_font_description_free(font);auto utf8=toUTF8(command.text);pango_layout_set_text(layout,utf8.c_str(),int(utf8.size()));auto* attrs=pango_attr_list_new();if(command.underline)pango_attr_list_insert(attrs,pango_attr_underline_new(PANGO_UNDERLINE_SINGLE));if(command.strikeout)pango_attr_list_insert(attrs,pango_attr_strikethrough_new(TRUE));pango_layout_set_attributes(layout,attrs);pango_attr_list_unref(attrs);cairo_move_to(cr,v[0],v[1]);pango_cairo_show_layout(cr,layout);g_object_unref(layout);}
    else if(command.kind=="image"&&command.picture&&command.picture->pixels&&v.size()>=4){auto* pixels=command.picture->pixels;double sx=v.size()>=8?v[4]:0,sy=v.size()>=8?v[5]:0,sw=v.size()>=8?v[6]:gdk_pixbuf_get_width(pixels),sh=v.size()>=8?v[7]:gdk_pixbuf_get_height(pixels);if(sw!=0&&sh!=0&&v[2]!=0&&v[3]!=0){cairo_translate(cr,v[0],v[1]);cairo_scale(cr,v[2]/sw,v[3]/sh);cairo_rectangle(cr,0,0,sw,sh);cairo_clip(cr);gdk_cairo_set_source_pixbuf(cr,pixels,-sx,-sy);cairo_paint(cr);}}
    cairo_restore(cr);
  }
}
struct GtkFontObject final:Object {
  std::weak_ptr<GtkControl> owner;std::map<std::string,Value> properties;
  explicit GtkFontObject(std::weak_ptr<GtkControl> value):owner(value),properties{{"name",Value::string(u"Sans")},{"size",Value::currency(u"8.25")},{"bold",Value::boolean(false)},{"italic",Value::boolean(false)},{"underline",Value::boolean(false)},{"strikethrough",Value::boolean(false)},{"charset",Value::integer(0)}}{}
  std::string className()const override{return "StdFont";}
  Value get(Runtime&,const std::string& raw)override{auto name=lower(raw.empty()?"name":raw);if(name=="weight"){auto c=owner.lock();return Value::integer((c?c->flag("fontbold"):properties["bold"].truth())?700:400,Type::Integer);}auto found=properties.find(name);if(found==properties.end())fail(438);auto c=owner.lock();auto result=c?c->property(name=="strikethrough"?"fontstrikethru":"font"+name,found->second):found->second;return name=="size"?coerce(result,"currency"):result;}
  void set(Runtime& rt,const std::string& raw,Value value,bool)override{auto name=lower(raw.empty()?"name":raw);if(name=="weight"){auto n=value.integral();if(n<0||n>1000)fail(380);name="bold";value=Value::boolean(n>=600);}if(!properties.count(name))fail(438);value=coerce(value,name=="name"?"string":name=="size"?"currency":name=="charset"?"integer":"boolean");if(name=="size"&&(value.number()<=0||value.number()>3072))fail(380);if(auto c=owner.lock())c->set(rt,name=="strikethrough"?"fontstrikethru":"font"+name,value);properties[name]=value;}
};
const std::map<int,const char*> printerPaperSizes={
  {1,"na_letter_8.5x11in"},{3,"na_ledger_11x17in"},{4,"na_ledger_11x17in"},
  {5,"na_legal_8.5x14in"},{6,"na_invoice_5.5x8.5in"},{7,"na_executive_7.25x10.5in"},
  {8,"iso_a3_297x420mm"},{9,"iso_a4_210x297mm"},{11,"iso_a5_148x210mm"},
  {12,"jis_b4_257x364mm"},{13,"jis_b5_182x257mm"},{17,"na_ledger_11x17in"},
  {19,"na_number-9_3.875x8.875in"},{20,"na_number-10_4.125x9.5in"},
  {27,"iso_dl_110x220mm"},{28,"iso_c5_162x229mm"},{29,"iso_c3_324x458mm"},
  {30,"iso_c4_229x324mm"},{31,"iso_c6_114x162mm"},{32,"iso_c6c5_114x229mm"},
  {37,"na_monarch_3.875x7.5in"}
};
int printerInteger(const std::string& value,int fallback,int minimum,int maximum){
  if(value.empty())return fallback;char* end=nullptr;auto number=std::strtol(value.c_str(),&end,10);
  return end==value.c_str()||number<minimum||number>maximum?fallback:int(number);
}
GtkPaperSize* printerPaper(const std::string& raw){
  auto name=raw.substr(0,raw.find(','));auto* media=pwgMediaForPWG(name.c_str());
  if(!media)media=pwgMediaForPPD(name.c_str());if(!media)media=pwgMediaForLegacy(name.c_str());
  if(!media)return nullptr;
  return gtk_paper_size_new_custom(media->pwg,media->pwg,media->width/100.0,media->length/100.0,GTK_UNIT_MM);
}
struct GtkPrinterObject final:Object {
  GtkHost* host;std::weak_ptr<int> life;GtkPrinterDestination destination;
  Module module;std::shared_ptr<Instance> context;std::shared_ptr<GtkControl> canvas;
  GtkPrintSettings* settings=nullptr;GtkPageSetup* setup=nullptr;
  std::vector<std::vector<GtkDrawing>> pages;
  bool trackDefault=false,printing=false;int paperCode=0,quality=-3;
  explicit GtkPrinterObject(GtkHost& value,GtkPrinterDestination selected={},bool followDefault=false)
    :host(&value),life(value.life),destination(gtkPrinterDetails(std::move(selected))),trackDefault(followDefault){
    settings=gtk_print_settings_new();setup=gtk_page_setup_new();defaults();
  }
  ~GtkPrinterObject()override{if(canvas)canvas->dispose();g_object_unref(settings);g_object_unref(setup);}
  void check()const{if(life.expired())fail(91,"Native application has shut down");}
  bool active()const{return !pages.empty()||(canvas&&!canvas->drawings.empty());}
  void editable()const{check();if(printing)fail(482,"A print job is being submitted");}
  void identifyPaper(){
    auto* paper=gtk_page_setup_get_paper_size(setup);double width=gtk_paper_size_get_width(paper,GTK_UNIT_MM),height=gtk_paper_size_get_height(paper,GTK_UNIT_MM);paperCode=0;
    for(auto& entry:printerPaperSizes){auto* media=pwgMediaForPWG(entry.second);if(media&&std::abs(width-media->width/100.0)<0.2&&std::abs(height-media->length/100.0)<0.2){paperCode=entry.first;break;}}
  }
  void defaults(){
    gtk_print_settings_set_printer(settings,destination.queue.empty()?nullptr:destination.queue.c_str());
    gtk_print_settings_set_n_copies(settings,printerInteger(destination.option("copies"),1,1,32767));
    auto orientation=printerInteger(destination.option("orientation-requested"),3,3,6);
    auto nativeOrientation=orientation==4||orientation==5?GTK_PAGE_ORIENTATION_LANDSCAPE:GTK_PAGE_ORIENTATION_PORTRAIT;
    gtk_print_settings_set_orientation(settings,nativeOrientation);gtk_page_setup_set_orientation(setup,nativeOrientation);
    auto sides=destination.option("sides","one-sided");
    gtk_print_settings_set_duplex(settings,sides=="two-sided-long-edge"?GTK_PRINT_DUPLEX_VERTICAL:sides=="two-sided-short-edge"?GTK_PRINT_DUPLEX_HORIZONTAL:GTK_PRINT_DUPLEX_SIMPLEX);
    auto color=destination.option("print-color-mode",destination.option("ColorModel","color"));
    gtk_print_settings_set_use_color(settings,color!="monochrome"&&color!="Gray"&&color!="Black");
    gtk_print_settings_set_collate(settings,destination.option("multiple-document-handling")=="separate-documents-collated-copies");
    gtk_print_settings_set_scale(settings,100);
    auto resolution=printerInteger(destination.option("printer-resolution"),0,1,9600);
    if(resolution){gtk_print_settings_set_resolution(settings,resolution);quality=resolution;}
    else{auto q=printerInteger(destination.option("print-quality"),4,3,5);gtk_print_settings_set_quality(settings,q==3?GTK_PRINT_QUALITY_DRAFT:q==5?GTK_PRINT_QUALITY_HIGH:GTK_PRINT_QUALITY_NORMAL);quality=q==3?-1:q==5?-4:-3;}
    if(auto* paper=printerPaper(destination.option("media"))){gtk_page_setup_set_paper_size(setup,paper);gtk_print_settings_set_paper_size(settings,paper);gtk_paper_size_free(paper);}
    identifyPaper();size();
  }
  void refreshDefault(){
    check();if(!trackDefault||active()||printing)return;
    auto printers=gtkPrinterDestinations();GtkPrinterDestination current;
    for(auto& printer:printers)if(printer.isDefault){current=std::move(printer);break;}
    if(current.name!=destination.name){destination=gtkPrinterDetails(std::move(current));g_object_unref(settings);g_object_unref(setup);settings=gtk_print_settings_new();setup=gtk_page_setup_new();defaults();}
  }
  void size(){
    if(!canvas)return;
    const double width=gtk_page_setup_get_page_width(setup,GTK_UNIT_POINTS)/0.75,height=gtk_page_setup_get_page_height(setup,GTK_UNIT_POINTS)/0.75;
    gtk_widget_set_size_request(canvas->view,int(std::ceil(width)),int(std::ceil(height)));
    GtkAllocation allocation{0,0,int(std::ceil(width)),int(std::ceil(height))};gtk_widget_size_allocate(canvas->view,&allocation);
    canvas->properties["width"]=Value::real(width*15);canvas->properties["height"]=Value::real(height*15);
  }
  std::shared_ptr<GtkControl> drawing(){
    editable();refreshDefault();
    if(!canvas){
      host->ensureApplication();module.name="GtkPrinter";context=std::make_shared<Instance>(*host->runtime,module);
      ControlSpec spec;spec.name="Printer";spec.type="PictureBox";
      spec.properties={{"backcolor",Value::integer(0xffffff)},{"forecolor",Value::integer(0)},{"fontsize",Value::real(10)}};
      canvas=std::make_shared<GtkControl>(*host,context,spec);canvas->initialize();size();
    }
    return canvas;
  }
  void select(const std::shared_ptr<GtkPrinterObject>& selected){
    editable();if(!selected)fail(13,"Set Printer requires an element of the Printers collection");
    selected->check();if(selected->host!=host)fail(13,"Printer belongs to a different application");
    if(selected.get()==this)return;if(active())fail(482,"Finish or cancel the current document before changing printers");
    auto verified=gtkFindPrinterDestination(selected->destination.name);
    auto* newSettings=gtk_print_settings_copy(selected->settings);auto* newSetup=gtk_page_setup_copy(selected->setup);
    destination=std::move(verified);g_object_unref(settings);g_object_unref(setup);settings=newSettings;setup=newSetup;
    gtk_print_settings_set_printer(settings,destination.queue.c_str());quality=selected->quality;paperCode=selected->paperCode;trackDefault=false;size();
  }
  std::string className()const override{return "Printer";}
  Value get(Runtime& rt,const std::string& raw)override{
    check();refreshDefault();auto name=lower(raw);
    if(name=="devicename")return Value::string(fromUTF8(destination.name));
    if(name=="drivername")return Value::string(fromUTF8(destination.name.empty()?"":destination.option("printer-make-and-model","CUPS")));
    if(name=="port")return Value::string(fromUTF8(destination.option("device-uri",destination.option("printer-uri-supported"))));
    if(name=="width"||name=="height")return Value::real((name=="width"?gtk_page_setup_get_paper_width(setup,GTK_UNIT_POINTS):gtk_page_setup_get_paper_height(setup,GTK_UNIT_POINTS))*20);
    if(name=="orientation"){auto orientation=gtk_page_setup_get_orientation(setup);return Value::integer(orientation==GTK_PAGE_ORIENTATION_LANDSCAPE||orientation==GTK_PAGE_ORIENTATION_REVERSE_LANDSCAPE?2:1,Type::Integer);}
    if(name=="copies")return Value::integer(gtk_print_settings_get_n_copies(settings),Type::Integer);
    if(name=="duplex"){auto duplex=gtk_print_settings_get_duplex(settings);return Value::integer(duplex==GTK_PRINT_DUPLEX_VERTICAL?2:duplex==GTK_PRINT_DUPLEX_HORIZONTAL?3:1,Type::Integer);}
    if(name=="colormode")return Value::integer(gtk_print_settings_get_use_color(settings)?2:1,Type::Integer);
    if(name=="collate")return Value::boolean(gtk_print_settings_get_collate(settings));
    if(name=="printquality")return Value::integer(quality,Type::Integer);
    if(name=="papersize")return Value::integer(paperCode,Type::Integer);
    if(name=="zoom")return Value::integer(bankers(gtk_print_settings_get_scale(settings)),Type::Integer);
    if(name=="trackdefault")return Value::boolean(trackDefault);
    if(name=="page")return Value::integer(pages.size()+1);
    if(name=="twipsperpixelx"||name=="twipsperpixely")return Value::integer(15,Type::Integer);
    return drawing()->get(rt,raw);
  }
  void set(Runtime& rt,const std::string& raw,Value value,bool objectSet)override{
    editable();auto name=lower(raw);
    if(name=="devicename"){
      if(active())fail(482,"Finish or cancel the current document before changing printers");
      auto selected=std::make_shared<GtkPrinterObject>(*host,gtkFindPrinterDestination(toUTF8(value.string())));select(selected);return;
    }
    if(name=="trackdefault"){trackDefault=value.truth();refreshDefault();return;}
    if(name=="orientation"){
      auto n=value.integral();if(n!=1&&n!=2)fail(380);
      if(active())fail(482,"Change page orientation before starting the document");
      auto orientation=n==1?GTK_PAGE_ORIENTATION_PORTRAIT:GTK_PAGE_ORIENTATION_LANDSCAPE;
      gtk_page_setup_set_orientation(setup,orientation);gtk_print_settings_set_orientation(settings,orientation);size();return;
    }
    if(name=="copies"){auto n=value.integral();if(n<1||n>32767)fail(380);gtk_print_settings_set_n_copies(settings,int(n));return;}
    if(name=="duplex"){auto n=value.integral();if(n<1||n>3)fail(380);gtk_print_settings_set_duplex(settings,n==2?GTK_PRINT_DUPLEX_VERTICAL:n==3?GTK_PRINT_DUPLEX_HORIZONTAL:GTK_PRINT_DUPLEX_SIMPLEX);return;}
    if(name=="colormode"){auto n=value.integral();if(n!=1&&n!=2)fail(380);gtk_print_settings_set_use_color(settings,n==2);return;}
    if(name=="collate"){gtk_print_settings_set_collate(settings,value.truth());return;}
    if(name=="zoom"){auto n=value.integral();if(n<1||n>400)fail(380);gtk_print_settings_set_scale(settings,double(n));return;}
    if(name=="printquality"){
      auto n=value.integral();if(n==0||n < -4||n>9600)fail(380);
      if(n>0)gtk_print_settings_set_resolution(settings,int(n));
      else{gtk_print_settings_unset(settings,GTK_PRINT_SETTINGS_RESOLUTION);gtk_print_settings_unset(settings,GTK_PRINT_SETTINGS_RESOLUTION_X);gtk_print_settings_unset(settings,GTK_PRINT_SETTINGS_RESOLUTION_Y);gtk_print_settings_set_quality(settings,n==-1?GTK_PRINT_QUALITY_DRAFT:n==-2?GTK_PRINT_QUALITY_LOW:n==-4?GTK_PRINT_QUALITY_HIGH:GTK_PRINT_QUALITY_NORMAL);}
      quality=int(n);return;
    }
    if(name=="papersize"){
      auto number=value.integral();if(number<1||number>118)fail(380,"Unsupported paper size");
      auto found=printerPaperSizes.find(int(number));if(found==printerPaperSizes.end())fail(380,"Unsupported paper size");
      if(active())fail(482,"Change paper size before starting the document");
      auto* paper=printerPaper(found->second);if(!paper)fail(380,"Unsupported paper size");
      gtk_page_setup_set_paper_size(setup,paper);gtk_print_settings_set_paper_size(settings,paper);gtk_paper_size_free(paper);paperCode=found->first;size();return;
    }
    if(name=="drivername"||name=="port"||name=="width"||name=="height"||name=="page")fail(383,"Printer property is read-only");
    drawing()->set(rt,raw,value,objectSet);
  }
  Value invoke(Runtime& rt,const std::string& raw,Args args)override{
    editable();auto name=lower(raw);
    if(name=="__selectprinter"){
      if(args.size()!=1)fail(450);if(args[0].value.type!=Type::Object)fail(13,"Set Printer requires a Printer object");
      select(std::dynamic_pointer_cast<GtkPrinterObject>(std::get<ObjectPtr>(args[0].value.payload)));return {};
    }
    if(name=="newpage"){
      if(!args.empty())fail(450);if(pages.size()>=1000)fail(7);auto surface=drawing();pages.push_back(std::move(surface->drawings));surface->drawings.clear();surface->currentX=surface->currentY=0;return {};
    }
    if(name=="killdoc"){if(!args.empty())fail(450);pages.clear();if(canvas){canvas->drawings.clear();canvas->currentX=canvas->currentY=0;}return {};}
    if(name=="enddoc"){
      if(!args.empty())fail(450);if(!active())return {};
      destination=gtkFindPrinterDestination(destination.name);auto surface=drawing();
      GError* error=nullptr;char* directory=g_dir_make_tmp("vb6-print-XXXXXX",&error);
      if(!directory){auto message=std::string(error?error->message:"Cannot create a private print spool directory");if(error)g_error_free(error);fail(482,message);}
      struct Spool{char* directory;std::string filename;~Spool(){std::error_code ignored;std::filesystem::remove(filename,ignored);std::filesystem::remove(directory,ignored);g_free(directory);}} spool{directory,std::string(directory)+"/document.pdf"};
      struct Submitting{bool& value;explicit Submitting(bool& flag):value(flag){value=true;}~Submitting(){value=false;}} submitting{printing};
      struct PrintState{GtkPrinterObject* printer;std::vector<std::vector<GtkDrawing>> pages;};
      PrintState state{this,pages};state.pages.push_back(surface->drawings);
      auto* operation=gtk_print_operation_new();gtk_print_operation_set_allow_async(operation,FALSE);
      auto* exportSettings=gtk_print_settings_copy(settings);gtk_print_settings_set_n_copies(exportSettings,1);gtk_print_settings_set_collate(exportSettings,FALSE);gtk_print_settings_set_printer(exportSettings,nullptr);
      gtk_print_operation_set_print_settings(operation,exportSettings);g_object_unref(exportSettings);
      gtk_print_operation_set_default_page_setup(operation,setup);gtk_print_operation_set_export_filename(operation,spool.filename.c_str());
      gtk_print_operation_set_unit(operation,GTK_UNIT_POINTS);gtk_print_operation_set_n_pages(operation,int(state.pages.size()));
      gtk_print_operation_set_job_name(operation,host->runtime->name.c_str());
      g_signal_connect(operation,"draw-page",G_CALLBACK(+[](GtkPrintOperation* operation,GtkPrintContext* context,gint page,gpointer data){
        auto* state=static_cast<PrintState*>(data);state->printer->host->event([&]{
          if(page<0||size_t(page)>=state->pages.size())fail(5);auto* cr=gtk_print_context_get_cairo_context(context);
          cairo_scale(cr,0.75,0.75);drawCommands(cr,state->pages[size_t(page)]);
        });if(state->printer->host->pending)gtk_print_operation_cancel(operation);
      }),&state);
      auto result=gtk_print_operation_run(operation,GTK_PRINT_OPERATION_ACTION_EXPORT,host->activeWindow(),&error);
      const auto renderError=std::string(error?error->message:"");if(error)g_error_free(error);
      g_object_unref(operation);host->check();
      if(!renderError.empty())fail(482,renderError);
      if(result!=GTK_PRINT_OPERATION_RESULT_APPLY)fail(482,"GTK could not render the print document");
      std::map<std::string,std::string> options;
      for(auto& entry:destination.options)if(entry.first.rfind("printer-",0)!=0&&entry.first!="device-uri")options[entry.first]=entry.second;
      options["document-format"]="application/pdf";options["copies"]=std::to_string(gtk_print_settings_get_n_copies(settings));
      const auto duplex=gtk_print_settings_get_duplex(settings);
      options["sides"]=duplex==GTK_PRINT_DUPLEX_VERTICAL?"two-sided-long-edge":duplex==GTK_PRINT_DUPLEX_HORIZONTAL?"two-sided-short-edge":"one-sided";
      options["print-color-mode"]=gtk_print_settings_get_use_color(settings)?"color":"monochrome";
      options["multiple-document-handling"]=gtk_print_settings_get_collate(settings)?"separate-documents-collated-copies":"separate-documents-uncollated-copies";
      options["orientation-requested"]=gtk_page_setup_get_orientation(setup)==GTK_PAGE_ORIENTATION_LANDSCAPE?"4":"3";
      if(quality>0)options["printer-resolution"]=std::to_string(quality)+"dpi";
      else options["print-quality"]=quality==-4?"5":quality==-3?"4":"3";
      auto* paper=gtk_page_setup_get_paper_size(setup);
      if(auto* media=pwgMediaForSize(int(std::round(gtk_paper_size_get_width(paper,GTK_UNIT_MM)*100)),int(std::round(gtk_paper_size_get_height(paper,GTK_UNIT_MM)*100))))options["media"]=media->pwg;
      gtkSubmitPrintFile(destination,spool.filename,host->runtime->name,options);
      pages.clear();surface->drawings.clear();surface->currentX=surface->currentY=0;return {};
    }
    static const std::set<std::string> properties={"devicename","drivername","port","width","height","orientation","copies","duplex","colormode","collate","printquality","papersize","zoom","trackdefault","page","twipsperpixelx","twipsperpixely"};
    if(args.empty()&&properties.count(name))return get(rt,raw);
    return drawing()->invoke(rt,raw,std::move(args));
  }
};
struct GtkPrintersObject final:Object {
  GtkHost* host;std::weak_ptr<int> life;
  explicit GtkPrintersObject(GtkHost& value):host(&value),life(value.life){}
  void check()const{if(life.expired())fail(91,"Native application has shut down");}
  std::string className()const override{return "Printers";}
  Value get(Runtime&,const std::string& name)override{check();if(lower(name)=="count")return Value::integer(gtkPrinterDestinations().size());fail(438);}
  Value invoke(Runtime& rt,const std::string& raw,Args args)override{
    check();auto name=lower(raw);
    if(name.empty()||name=="item"){
      if(args.size()!=1)fail(450);auto printers=gtkPrinterDestinations();auto n=args[0].value.integral();
      if(n<0||size_t(n)>=printers.size())fail(9);
      return Value::object(std::make_shared<GtkPrinterObject>(*host,std::move(printers[size_t(n)])));
    }
    if(args.empty())return get(rt,raw);fail(438);
  }
  std::vector<Value> enumerate(Runtime&)override{
    check();std::vector<Value> result;
    for(auto& printer:gtkPrinterDestinations())result.push_back(Value::object(std::make_shared<GtkPrinterObject>(*host,std::move(printer))));
    return result;
  }
};
}
GtkPicture::GtkPicture(GdkPixbuf* value):pixels(value){if(pixels)g_object_ref(pixels);}
GtkPicture::~GtkPicture(){if(pixels)g_object_unref(pixels);if(registry&&!ownerLife.expired())registry->remove(handle);}
Value GtkPicture::get(Runtime&,const std::string& raw){auto name=lower(raw);if(name=="handle")return Value::integer(handle);if(name=="type")return Value::integer(pixels?pictureType:0,Type::Integer);if(name=="width"||name=="height")return Value::integer(pixels?bankers((name=="width"?gdk_pixbuf_get_width(pixels):gdk_pixbuf_get_height(pixels))*2540.0/96):0);fail(438);}
Value gtkLoadPicture(GtkHost& host,const std::vector<uint8_t>& data) {
  if(data.empty())return Value::object(std::make_shared<GtkPicture>());auto validated=decodeNativePicture(data);auto bytes=validated.frames.empty()?validated.bytes:nativePictureFrameBytes(validated,validated.selected);auto* loader=gdk_pixbuf_loader_new();GError* error=nullptr;
  if(!gdk_pixbuf_loader_write(loader,bytes.data(),bytes.size(),&error)||!gdk_pixbuf_loader_close(loader,&error)){std::string message=error?error->message:"Image could not be decoded";if(error)g_error_free(error);g_object_unref(loader);fail(481,message);}
  auto image=std::make_shared<GtkPicture>(gdk_pixbuf_loader_get_pixbuf(loader));g_object_unref(loader);if(!image->pixels)fail(481);image->pictureType=validated.type;image->cursor=validated.cursor;image->hotspotX=validated.hotspotX;image->hotspotY=validated.hotspotY;image->encoded=std::move(validated.bytes);image->ownerLife=host.life;image->registry=&host.handles;image->handle=host.handles.add(image,HandleKind::Image);return Value::object(image);
}
Value gtkFont(std::weak_ptr<GtkControl> owner){return Value::object(std::make_shared<GtkFontObject>(owner));}
Value gtkPrinter(GtkHost& host,const std::string& name) {
  if(host.closing)fail(91,"Native application has shut down");
  if(name=="printers")return Value::object(std::make_shared<GtkPrintersObject>(host));
  if(name!="printer")fail(438);
  auto found=host.systemObjects.find(name);if(found!=host.systemObjects.end())return Value::object(found->second);
  GtkPrinterDestination selected;for(auto& printer:gtkPrinterDestinations())if(printer.isDefault){selected=std::move(printer);break;}
  auto printer=std::make_shared<GtkPrinterObject>(host,std::move(selected),true);host.systemObjects[name]=printer;return Value::object(printer);
}
void gtkSetPrinter(GtkHost& host,Value printer){gtkPrinter(host,"printer").asObject()->invoke(*host.runtime,"__selectprinter",{Arg(std::move(printer))});}
void gtkShowPrinterDialog(GtkHost& host,GtkControl& control){
  auto printer=std::dynamic_pointer_cast<GtkPrinterObject>(gtkPrinter(host,"printer").asObject());
  auto editable=[&]{printer->editable();if(printer->active())fail(482,"Finish or cancel the current document before changing printer settings");};
  editable();printer->refreshDefault();
  auto title=toUTF8(control.property("dialogtitle",Value::string(u"Printer")).string());
  auto* widget=gtk_print_unix_dialog_new(title.c_str(),host.activeWindow());g_object_ref_sink(widget);
  struct DialogGuard{GtkWidget* value;~DialogGuard(){gtk_widget_destroy(value);g_object_unref(value);}} guard{widget};
  auto* dialog=GTK_PRINT_UNIX_DIALOG(widget);
  gtk_print_unix_dialog_set_manual_capabilities(dialog,GtkPrintCapabilities(GTK_PRINT_CAPABILITY_COPIES|GTK_PRINT_CAPABILITY_COLLATE|GTK_PRINT_CAPABILITY_SCALE));
  gtk_print_unix_dialog_set_embed_page_setup(dialog,TRUE);
  // Give the dialog copies: cancelling must not mutate the selected Printer.
  auto* initialSettings=gtk_print_settings_copy(printer->settings);auto* initialSetup=gtk_page_setup_copy(printer->setup);
  gtk_print_unix_dialog_set_settings(dialog,initialSettings);gtk_print_unix_dialog_set_page_setup(dialog,initialSetup);
  g_object_unref(initialSettings);g_object_unref(initialSetup);
  if(host.runDialog(widget)!=GTK_RESPONSE_OK){if(control.flag("cancelerror"))fail(32755,"Dialog cancelled");return;}
  editable();
  auto* selected=gtk_print_unix_dialog_get_selected_printer(dialog);
  if(!selected||gtk_printer_is_virtual(selected))fail(484,"Select an installed CUPS printer");
  auto destination=gtkFindPrinterDestination(gtk_printer_get_name(selected));
  auto* settings=gtk_print_unix_dialog_get_settings(dialog);
  auto* setup=gtk_page_setup_copy(gtk_print_unix_dialog_get_page_setup(dialog));
  struct SettingsGuard{GtkPrintSettings* settings;GtkPageSetup* setup;~SettingsGuard(){if(settings)g_object_unref(settings);if(setup)g_object_unref(setup);}} selectedSettings{settings,setup};
  const auto copies=gtk_print_settings_get_n_copies(settings);const auto scale=gtk_print_settings_get_scale(settings);
  if(copies<1||copies>32767||!std::isfinite(scale)||scale<=0||scale>400)fail(380,"Printer settings are outside the supported range");
  gtk_print_settings_set_printer(settings,destination.queue.c_str());
  gtk_print_settings_set_orientation(settings,gtk_page_setup_get_orientation(setup));
  gtk_print_settings_set_paper_size(settings,gtk_page_setup_get_paper_size(setup));
  const auto resolution=gtk_print_settings_get_resolution(settings);const auto quality=gtk_print_settings_get_quality(settings);
  // GtkPrintUnixDialog only chooses settings. No GtkPrintJob is created here.
  printer->destination=std::move(destination);g_object_unref(printer->settings);g_object_unref(printer->setup);
  printer->settings=settings;printer->setup=setup;selectedSettings.settings=nullptr;selectedSettings.setup=nullptr;
  printer->quality=resolution>0?resolution:quality==GTK_PRINT_QUALITY_DRAFT?-1:quality==GTK_PRINT_QUALITY_LOW?-2:quality==GTK_PRINT_QUALITY_HIGH?-4:-3;
  printer->trackDefault=false;printer->identifyPaper();printer->size();
  control.properties["copies"]=Value::integer(copies,Type::Integer);
  control.properties["orientation"]=printer->get(*host.runtime,"orientation");
}
GtkDrawing gtkDrawing(GtkControl& control,std::string kind) {
  GtkDrawing command;command.kind=std::move(kind);command.color=int32_t(control.number("forecolor"));command.width=std::max(1.0,control.number("drawwidth",1));command.style=int(control.number("drawstyle"));command.fontName=control.property("fontname",Value::string(u"Sans")).string();command.fontSize=control.number("fontsize",8.25);command.bold=control.flag("fontbold");command.italic=control.flag("fontitalic");command.underline=control.flag("fontunderline");command.strikeout=control.flag("fontstrikethru");return command;
}
void gtkAppendDrawing(GtkControl& control,GtkDrawing command) {
  if(control.drawings.size()>=1000000)fail(7,"Drawing exceeds one million commands");for(auto value:command.coordinates)if(!std::isfinite(value)||std::abs(value)>1e9)fail(5,"Invalid drawing coordinate");if(!std::isfinite(command.width)||command.width<0||command.width>65535)fail(5);control.drawings.push_back(std::move(command));if(control.view)gtk_widget_queue_draw(control.view);
}
Value gtkPrint(GtkControl& control,Args args) {
  Text text;for(auto& arg:args)text+=printValue(scalar(*control.host->runtime,arg.value));auto command=gtkDrawing(control,"text");auto point=control.point(control.currentX,control.currentY);command.coordinates={point.first,point.second};command.text=text;
  auto* layout=gtk_widget_create_pango_layout(control.widget,toUTF8(text).c_str());int width,height;pango_layout_get_pixel_size(layout,&width,&height);g_object_unref(layout);gtkAppendDrawing(control,std::move(command));control.currentX=0;control.currentY+=(height?height:16)/control.unit(-1,false);return {};
}
void gtkDraw(GtkControl& control,cairo_t* cr) {
  cairo_save(cr);double width=gtk_widget_get_allocated_width(control.widget),height=gtk_widget_get_allocated_height(control.widget);
  if(control.content||control.spec.type=="MSChart"){source(cr,int32_t(control.number("backcolor",0xffffff)));cairo_paint(cr);}
  auto picture=control.property("picture",Value::object(nullptr));if(picture.type==Type::Object)if(auto image=std::dynamic_pointer_cast<GtkPicture>(std::get<ObjectPtr>(picture.payload))){auto command=gtkDrawing(control,"image");command.picture=image;if(image->pixels){command.coordinates={0,0,control.flag("stretch")?width:double(gdk_pixbuf_get_width(image->pixels)),control.flag("stretch")?height:double(gdk_pixbuf_get_height(image->pixels))};drawCommands(cr,{command});}}
  if(control.spec.type=="Line"){auto command=gtkDrawing(control,"line");command.color=int32_t(control.number("bordercolor",control.number("forecolor")));command.width=control.number("borderwidth",1);command.coordinates={0,0,width,height};drawCommands(cr,{command});}
  if(control.spec.type=="Shape"){auto shape=int(control.number("shape"));auto command=gtkDrawing(control,shape==2||shape==3?"ellipse":"rect");if(shape==1||shape==3){width=height=std::min(width,height);}command.coordinates={0,0,std::max(0.0,width-1),std::max(0.0,height-1)};if(control.number("fillstyle",1)!=1){command.color=int32_t(control.number("fillcolor"));command.fill=true;drawCommands(cr,{command});}command.fill=false;command.width=control.number("borderwidth",1);command.color=int32_t(control.number("bordercolor"));drawCommands(cr,{command});}
  if(control.spec.type=="MSChart"&&!control.grid.empty()&&!control.grid.front().empty()) {
    auto rows=control.grid.size(),cols=control.grid.front().size();double minimum=0,maximum=0,total=0;
    auto value=[&](size_t r,size_t c){try{return control.grid[r][c].empty()?0.0:Value::string(control.grid[r][c]).floating();}catch(const Error&){return 0.0;}};
    for(size_t r=0;r<rows;++r)for(size_t c=0;c<cols;++c){auto v=value(r,c);minimum=std::min(minimum,v);maximum=std::max(maximum,v);if(c==0)total+=std::max(0.0,v);}if(maximum==minimum)maximum=minimum+1;
    const int32_t palette[]={0xdd7632,0x2c993b,0x4543cf,0xa3467b,0x37aaaa,0xbbb233};auto chart=int(control.number("charttype",1));double left=36,top=12,w=std::max(1.0,width-48),h=std::max(1.0,height-36),zero=top+h*(maximum/(maximum-minimum));
    if(chart==14){double angle=-Pi/2;for(size_t r=0;r<rows;++r){auto next=angle+(total>0?std::max(0.0,value(r,0))/total:1.0/rows)*2*Pi;source(cr,palette[r%std::size(palette)]);cairo_move_to(cr,width/2,height/2);cairo_arc(cr,width/2,height/2,std::max(1.0,std::min(width,height)/2-12),angle,next);cairo_close_path(cr);cairo_fill(cr);angle=next;}}
    else for(size_t col=0;col<cols;++col){std::pair<double,double> previous;bool hasPrevious=false;for(size_t row=0;row<rows;++row){auto v=value(row,col);auto x=left+(row+0.5)*w/rows,y=top+h*(maximum-v)/(maximum-minimum);auto command=gtkDrawing(control,chart==3||chart==5?"line":"rect");command.color=palette[col%std::size(palette)];if(command.kind=="line"){if(hasPrevious){command.coordinates={previous.first,previous.second,x,y};drawCommands(cr,{command});}previous={x,y};hasPrevious=true;}else{auto bar=w/rows/cols*0.85;command.fill=true;command.coordinates={left+row*w/rows+col*bar,y,left+row*w/rows+(col+1)*bar,zero};drawCommands(cr,{command});}}}
  }
  drawCommands(cr,control.drawings);cairo_restore(cr);
}
std::shared_ptr<GtkControl> gtkDrawingControl(GtkHost& host,Value receiver) {
  auto object=receiver.asObject();if(auto control=std::dynamic_pointer_cast<GtkControl>(object))return control;
  if(auto form=std::dynamic_pointer_cast<Instance>(object)){host.runtime->load(form);return host.form(form)->surface;}
  if(auto printer=std::dynamic_pointer_cast<GtkPrinterObject>(object))return printer->drawing();fail(438,"Object is not a GTK drawing surface");
}
void GtkHost::graphics(Frame&,Value receiver,const std::string& kind,std::vector<Value> coords,Value paint,bool fill) {
  auto target=gtkDrawingControl(*this,receiver);auto command=gtkDrawing(*target,kind);if(paint.type!=Type::Missing)command.color=int32_t(coerce(paint,"long").integral());command.fill=fill;
  std::vector<double> values;for(auto& value:coords)values.push_back(value.floating());
  if(kind=="line"||kind=="rect"){if(values.size()!=4)fail(5);auto a=target->point(values[0],values[1]),b=target->point(values[2],values[3]);command.coordinates={a.first,a.second,b.first,b.second};target->currentX=values[2];target->currentY=values[3];}
  else if(kind=="pixel"){if(values.size()!=2)fail(5);auto p=target->point(values[0],values[1]);command.coordinates={p.first,p.second};target->currentX=values[0];target->currentY=values[1];}
  else if(kind=="circle"){if(values.size()!=3||values[2]<0)fail(5);auto p=target->point(values[0],values[1]);double x=values[2]*target->unit(-1,true),y=values[2]*target->unit(-1,false);command.kind="ellipse";command.coordinates={p.first-x,p.second-y,p.first+x,p.second+y};target->currentX=values[0];target->currentY=values[1];}
  else fail(438,"Unsupported native drawing command: "+kind);
  gtkAppendDrawing(*target,std::move(command));
}
Value gtkPrintForm(GtkHost& host,const std::shared_ptr<GtkForm>& form) {
  auto* operation=gtk_print_operation_new();gtk_print_operation_set_n_pages(operation,1);gtk_print_operation_set_unit(operation,GTK_UNIT_POINTS);
  struct State{GtkHost* host;std::shared_ptr<GtkForm> form;};State state{&host,form};
  g_signal_connect(operation,"draw-page",G_CALLBACK(+[](GtkPrintOperation*,GtkPrintContext* context,gint,gpointer data){auto* state=static_cast<State*>(data);state->host->event([&]{auto* cr=gtk_print_context_get_cairo_context(context);double scale=std::min(gtk_print_context_get_width(context)/std::max(1,state->form->width),gtk_print_context_get_height(context)/std::max(1,state->form->height));cairo_scale(cr,scale,scale);gtk_widget_draw(state->form->surface->view,cr);});}),&state);
  GError* error=nullptr;auto result=gtk_print_operation_run(operation,GTK_PRINT_OPERATION_ACTION_PRINT_DIALOG,host.activeWindow(),&error);g_object_unref(operation);host.check();if(error){std::string text=error->message;g_error_free(error);fail(482,text);}return Value::boolean(result!=GTK_PRINT_OPERATION_RESULT_CANCEL);
}
}
