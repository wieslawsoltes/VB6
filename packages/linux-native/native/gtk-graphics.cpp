// Cairo/Pango/GdkPixbuf rendering and native GTK printing. MIT.
#include "gtk.hpp"

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
struct GtkPrinterObject final:Object {
  GtkHost* host;Module module;std::shared_ptr<Instance> context;std::shared_ptr<GtkControl> canvas;
  GtkPrintSettings* settings=nullptr;GtkPageSetup* setup=nullptr;std::vector<std::vector<GtkDrawing>> pages;
  explicit GtkPrinterObject(GtkHost& value):host(&value){
    module.name="GtkPrinter";context=std::make_shared<Instance>(*host->runtime,module);ControlSpec spec;spec.name="Printer";spec.type="PictureBox";spec.properties={{"backcolor",Value::integer(0xffffff)},{"forecolor",Value::integer(0)},{"fontsize",Value::real(10)}};canvas=std::make_shared<GtkControl>(*host,context,spec);canvas->initialize();settings=gtk_print_settings_new();setup=gtk_page_setup_new();size();
  }
  ~GtkPrinterObject()override{canvas->dispose();g_object_unref(settings);g_object_unref(setup);}
  void size(){double width=gtk_page_setup_get_paper_width(setup,GTK_UNIT_POINTS)/0.75,height=gtk_page_setup_get_paper_height(setup,GTK_UNIT_POINTS)/0.75;gtk_widget_set_size_request(canvas->view,int(width),int(height));}
  std::string className()const override{return "Printer";}
  Value get(Runtime& rt,const std::string& raw)override{auto name=lower(raw);if(name=="devicename"){auto* printer=gtk_print_settings_get_printer(settings);return Value::string(fromUTF8(printer?printer:"Default"));}if(name=="drivername")return Value::string(u"GTK Print Backend");if(name=="port")return Value::string(u"CUPS");if(name=="width"||name=="height")return Value::real((name=="width"?gtk_page_setup_get_paper_width(setup,GTK_UNIT_POINTS):gtk_page_setup_get_paper_height(setup,GTK_UNIT_POINTS))*20);if(name=="orientation")return Value::integer(gtk_page_setup_get_orientation(setup)==GTK_PAGE_ORIENTATION_LANDSCAPE?2:1,Type::Integer);if(name=="copies")return Value::integer(gtk_print_settings_get_n_copies(settings),Type::Integer);if(name=="page")return Value::integer(pages.size()+1);if(name=="twipsperpixelx"||name=="twipsperpixely")return Value::integer(15);return canvas->get(rt,raw);}
  void set(Runtime& rt,const std::string& raw,Value value,bool objectSet)override{auto name=lower(raw);if(name=="orientation"){auto n=value.integral();if(n!=1&&n!=2)fail(380);gtk_page_setup_set_orientation(setup,n==1?GTK_PAGE_ORIENTATION_PORTRAIT:GTK_PAGE_ORIENTATION_LANDSCAPE);size();return;}if(name=="copies"){auto n=value.integral();if(n<1||n>32767)fail(380);gtk_print_settings_set_n_copies(settings,int(n));return;}if(name=="devicename"){gtk_print_settings_set_printer(settings,toUTF8(value.string()).c_str());return;}canvas->set(rt,raw,value,objectSet);}
  Value invoke(Runtime& rt,const std::string& raw,Args args)override{
    auto name=lower(raw);if(name=="newpage"){if(pages.size()>=1000)fail(7);pages.push_back(std::move(canvas->drawings));canvas->drawings.clear();canvas->currentX=canvas->currentY=0;return {};}
    if(name=="killdoc"){pages.clear();canvas->drawings.clear();canvas->currentX=canvas->currentY=0;return {};}
    if(name=="enddoc"){
      if(pages.empty()&&canvas->drawings.empty())return {};pages.push_back(std::move(canvas->drawings));canvas->drawings.clear();auto* operation=gtk_print_operation_new();gtk_print_operation_set_print_settings(operation,settings);gtk_print_operation_set_default_page_setup(operation,setup);gtk_print_operation_set_unit(operation,GTK_UNIT_POINTS);gtk_print_operation_set_n_pages(operation,int(pages.size()));gtk_print_operation_set_job_name(operation,host->runtime->name.c_str());
      g_signal_connect(operation,"draw-page",G_CALLBACK(+[](GtkPrintOperation*,GtkPrintContext* context,gint page,gpointer data){auto* printer=static_cast<GtkPrinterObject*>(data);printer->host->event([&]{if(page<0||size_t(page)>=printer->pages.size())fail(5);auto* cr=gtk_print_context_get_cairo_context(context);cairo_scale(cr,0.75,0.75);drawCommands(cr,printer->pages[size_t(page)]);});}),this);
      GError* error=nullptr;auto result=gtk_print_operation_run(operation,GTK_PRINT_OPERATION_ACTION_PRINT_DIALOG,host->activeWindow(),&error);if(result==GTK_PRINT_OPERATION_RESULT_APPLY){g_object_unref(settings);settings=gtk_print_operation_get_print_settings(operation);g_object_ref(settings);}g_object_unref(operation);pages.clear();canvas->currentX=canvas->currentY=0;host->check();if(error){auto message=std::string(error->message);g_error_free(error);fail(482,message);}return {};
    }
    return canvas->invoke(rt,raw,std::move(args));
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
  host.ensureApplication();if(name!="printer")fail(453,"GTK native Printers enumeration is unavailable; use the system print dialog");
  auto found=host.systemObjects.find(name);if(found!=host.systemObjects.end())return Value::object(found->second);auto printer=std::make_shared<GtkPrinterObject>(host);host.systemObjects[name]=printer;return Value::object(printer);
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
  if(auto printer=std::dynamic_pointer_cast<GtkPrinterObject>(object))return printer->canvas;fail(438,"Object is not a GTK drawing surface");
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
