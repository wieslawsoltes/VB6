// GTK widgets and the VB control property/method boundary. MIT.
#include "gtk.hpp"
#include <fstream>

namespace vb6 {
namespace {
bool isGrid(const GtkControl& c) { return c.spec.type=="MSFlexGrid"||c.spec.type=="MSHFlexGrid"||c.spec.type=="DataGrid"; }
void range(int64_t index,size_t count) { if(index<0||uint64_t(index)>=count)fail(381,"Invalid property array index"); }
int charOffset(const Text& text,size_t utf16) {
  utf16=std::min(utf16,text.size());int offset=0;
  for(size_t i=0;i<utf16;++i,++offset)if(text[i]>=0xd800&&text[i]<=0xdbff&&i+1<utf16&&text[i+1]>=0xdc00&&text[i+1]<=0xdfff)++i;
  return offset;
}
size_t utf16Offset(const Text& text,int offset) {
  size_t i=0;for(int n=0;n<offset&&i<text.size();++n,++i)if(text[i]>=0xd800&&text[i]<=0xdbff&&i+1<text.size()&&text[i+1]>=0xdc00&&text[i+1]<=0xdfff)++i;
  return i;
}
void markWidget(GtkWidget* widget,const std::shared_ptr<GtkControl>& control) {
  if(!widget)return;g_object_set_data_full(G_OBJECT(widget),"vb6-control",new std::weak_ptr<GtkControl>(control),
    [](gpointer data){delete static_cast<std::weak_ptr<GtkControl>*>(data);});
}
void watchDestruction(GtkWidget* widget,const std::shared_ptr<GtkControl>& control) {
  gtkSignal(widget,"destroy",G_CALLBACK(+[](GtkWidget*,gpointer data) noexcept {
    auto c=gtkModel(data);if(!c||c->disposed)return;
    try{c->dispose();}catch(...){if(!c->hostLife.expired()){c->host->pending=std::current_exception();c->host->stopLoops();}}
  }),control);
}
}

std::string gtkCaption(const Text& input,bool mnemonic) {
  Text output;
  for(size_t i=0;i<input.size();++i) {
    if(input[i]==u'&') {if(i+1<input.size()&&input[i+1]==u'&'){output+=u'&';++i;}else if(mnemonic)output+=u'_';}
    else {if(input[i]==u'_'&&mnemonic)output+=u'_';output+=input[i];}
  }
  return toUTF8(output);
}
GdkRGBA gtkColor(int64_t input) {
  uint32_t value=uint32_t(input);
  if(value&0x80000000u) {
    const uint32_t system[]={0xc8c8c8,0x000000,0xd77800,0xb4b4b4,0xf0f0f0,0xffffff,0x646464,0x000000,0x000000,0x000000,0xb4b4b4,0xb4b4b4,0xababab,0xd77800,0xffffff,0xf0f0f0,0xa0a0a0,0x6d6d6d,0x000000,0x000000,0xffffff,0x696969,0xe3e3e3,0x000000,0xe1ffff};
    value=(value&255)<std::size(system)?system[value&255]:0xf0f0f0;
  }
  return {double(value&255)/255,double((value>>8)&255)/255,double((value>>16)&255)/255,1};
}
int32_t gtkColorValue(const GdkRGBA& color) {
  auto byte=[](double n){return uint32_t(std::lround(std::clamp(n,0.0,1.0)*255));};
  return int32_t(byte(color.red)|(byte(color.green)<<8)|(byte(color.blue)<<16));
}
GtkControl::~GtkControl() {
  // Shutdown disposes native widgets before Runtime releases object aliases.
  if(!disposed)dispose();
}
std::shared_ptr<GtkControl> GtkControl::self() { return std::static_pointer_cast<GtkControl>(shared_from_this()); }
std::shared_ptr<GtkForm> GtkControl::form() const { auto instance=owner.lock();if(!instance)fail(91);return host->form(instance); }
Value GtkControl::property(const std::string& name,Value fallback) const { auto it=properties.find(lower(name));return it==properties.end()?fallback:it->second; }
double GtkControl::number(const std::string& name,double fallback) const { return property(name,Value::real(fallback)).floating(); }
bool GtkControl::flag(const std::string& name,bool fallback) const { return property(name,Value::boolean(fallback)).truth(); }
std::string GtkControl::defaultMember() const {
  auto& type=spec.type;
  if(type=="TextBox"||type=="RichTextBox"||type=="ComboBox"||type=="ListBox"||isGrid(*this))return "text";
  if(type=="Label"||type=="Frame"||type=="CommandButton"||type=="Form"||type=="MDIForm")return "caption";
  if(type=="FileListBox")return "filename";if(type=="DirListBox")return "path";if(type=="DriveListBox")return "drive";
  return "value";
}
GtkWidget* GtkControl::container() const {
  if(GTK_IS_NOTEBOOK(widget)) {int index=gtk_notebook_get_current_page(GTK_NOTEBOOK(widget));return index<0?nullptr:gtk_notebook_get_nth_page(GTK_NOTEBOOK(widget),index);}
  return content;
}
GtkWidget* GtkControl::editor() const {
  if(GTK_IS_ENTRY(widget)||GTK_IS_TEXT_VIEW(widget))return widget;
  if(GTK_IS_COMBO_BOX(widget)&&gtk_combo_box_get_has_entry(GTK_COMBO_BOX(widget)))return gtk_bin_get_child(GTK_BIN(widget));
  return nullptr;
}
Text GtkControl::editText() const {
  auto* edit=editor();
  if(GTK_IS_ENTRY(edit))return fromUTF8(gtk_entry_get_text(GTK_ENTRY(edit)));
  if(GTK_IS_TEXT_VIEW(edit)) {auto* buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(edit));GtkTextIter first,last;gtk_text_buffer_get_bounds(buffer,&first,&last);auto* text=gtk_text_buffer_get_text(buffer,&first,&last,TRUE);auto value=fromUTF8(text);g_free(text);return value;}
  return property("text",Value::string(u"")).string();
}
std::pair<size_t,size_t> GtkControl::editSelection() const {
  auto* edit=editor();if(!edit)fail(438);int start=0,end=0;
  if(GTK_IS_ENTRY(edit)) {if(!gtk_editable_get_selection_bounds(GTK_EDITABLE(edit),&start,&end))start=end=gtk_editable_get_position(GTK_EDITABLE(edit));}
  else {auto* buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(edit));GtkTextIter a,b;if(!gtk_text_buffer_get_selection_bounds(buffer,&a,&b)){gtk_text_buffer_get_iter_at_mark(buffer,&a,gtk_text_buffer_get_insert(buffer));b=a;}start=gtk_text_iter_get_offset(&a);end=gtk_text_iter_get_offset(&b);}
  auto text=editText();auto begin=utf16Offset(text,std::min(start,end)),finish=utf16Offset(text,std::max(start,end));return {begin,finish-begin};
}
void GtkControl::editSelect(size_t start,size_t length) {
  auto* edit=editor();if(!edit)fail(438);auto text=editText();start=std::min(start,text.size());length=std::min(length,text.size()-start);
  int first=charOffset(text,start),last=charOffset(text,start+length);
  if(GTK_IS_ENTRY(edit))gtk_editable_select_region(GTK_EDITABLE(edit),first,last);
  else {auto* buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(edit));GtkTextIter a,b;gtk_text_buffer_get_iter_at_offset(buffer,&a,first);gtk_text_buffer_get_iter_at_offset(buffer,&b,last);gtk_text_buffer_select_range(buffer,&b,&a);}
}
void GtkControl::editSetText(const Text& text,bool fire) {
  auto prior=editText();auto value=text;auto limit=number("maxlength",0);if(limit>0&&value.size()>size_t(limit))value.resize(size_t(limit));
  auto utf8=toUTF8(value);auto* edit=editor();
  {GtkEventSuppression guard(*this);if(GTK_IS_ENTRY(edit))gtk_entry_set_text(GTK_ENTRY(edit),utf8.c_str());else if(GTK_IS_TEXT_VIEW(edit))gtk_text_buffer_set_text(gtk_text_view_get_buffer(GTK_TEXT_VIEW(edit)),utf8.c_str(),int(utf8.size()));}
  properties["text"]=Value::string(value);if(fire&&prior!=value)event("change");
}
double GtkControl::unit(int mode,bool horizontal) const {
  if(mode<0)mode=int(number("scalemode",1));
  switch(mode){case 1:return 1.0/15;case 2:return 96.0/72;case 3:return 1;case 4:return horizontal?8:16;case 5:return 96;case 6:return 96.0/25.4;case 7:return 96.0/2.54;
    case 0:{double size=horizontal?gtk_widget_get_allocated_width(view):gtk_widget_get_allocated_height(view);double span=number(horizontal?"scalewidth":"scaleheight",size);if(span==0)fail(5);return size/span;}default:fail(380,"Invalid ScaleMode");}
}
std::pair<double,double> GtkControl::point(double x,double y) const {return {(x-number("scaleleft"))*unit(-1,true),(y-number("scaletop"))*unit(-1,false)};}
void GtkControl::applyFrame() {
  if(!view||menu||spec.type=="Form"||spec.type=="MDIForm")return;
  auto x=number("left")/15,y=number("top")/15,w=number("width",1800)/15,h=number("height",450)/15;
  if(!std::isfinite(x)||!std::isfinite(y)||!std::isfinite(w)||!std::isfinite(h)||w<0||h<0||std::max({std::abs(x),std::abs(y),w,h})>20000)fail(380,"Invalid native control geometry");
  auto* parent=gtk_widget_get_parent(view);if(parent&&GTK_IS_FIXED(parent))gtk_fixed_move(GTK_FIXED(parent),view,int(x),int(y));
  gtk_widget_set_size_request(view,int(w),int(h));initialRect={int(x),int(y),int(w),int(h)};
}
void GtkControl::applyFont() {
  if(!widget)return;double size=number("fontsize",8.25);if(!std::isfinite(size)||size<=0||size>3072)fail(380,"Invalid font size");
  auto* font=pango_font_description_new();pango_font_description_set_family(font,toUTF8(property("fontname",Value::string(u"Sans")).string()).c_str());
  pango_font_description_set_size(font,int(size*PANGO_SCALE));pango_font_description_set_weight(font,flag("fontbold")?PANGO_WEIGHT_BOLD:PANGO_WEIGHT_NORMAL);
  pango_font_description_set_style(font,flag("fontitalic")?PANGO_STYLE_ITALIC:PANGO_STYLE_NORMAL);gtk_widget_override_font(widget,font);
  if(auto* edit=editor();edit&&edit!=widget)gtk_widget_override_font(edit,font);pango_font_description_free(font);
  if(GTK_IS_LABEL(widget)){auto* attrs=pango_attr_list_new();if(flag("fontunderline"))pango_attr_list_insert(attrs,pango_attr_underline_new(PANGO_UNDERLINE_SINGLE));if(flag("fontstrikethru"))pango_attr_list_insert(attrs,pango_attr_strikethrough_new(TRUE));gtk_label_set_attributes(GTK_LABEL(widget),attrs);pango_attr_list_unref(attrs);}
}
void GtkControl::initialize() {
  if(initialized)return;initialized=true;hostLife=host->life;
  for(auto& p:spec.properties)properties[lower(p.name)]=p.value;
  for(auto& entry:properties)if(entry.first=="picture"||entry.first=="icon"||entry.first=="mouseicon"||entry.first=="disabledpicture"||entry.first=="downpicture") {
    if(entry.second.type==Type::Object)continue;auto id=entry.second.integral();if(id<0||id>65535)fail(481,"Invalid compiled picture ID");
    entry.second=id?gtkLoadPicture(*host,nativeResources(*host->runtime).designer(uint16_t(id))):Value::object(nullptr);
  }
  properties["name"]=Value::string(fromUTF8(spec.name));if(spec.index>=0)properties["index"]=Value::integer(spec.index,Type::Integer);
  const auto& type=spec.type;auto caption=gtkCaption(property("caption",Value::string(fromUTF8(spec.name))).string());
  if(type=="Menu") {
    auto text=property("caption",Value::string(u"")).string();menu=text==u"-"?gtk_separator_menu_item_new():gtk_check_menu_item_new_with_mnemonic(caption.c_str());
    g_object_ref_sink(menu);view=menu;widget=menu;watchDestruction(view,self());handle=host->handles.add(self(),HandleKind::Menu);
    gtkSignal(menu,"activate",G_CALLBACK(+[](GtkMenuItem*,gpointer data){gtkEvent(data,[](GtkControl& c){c.event("click");});}),self());refresh();return;
  }
  if(type=="Timer"||type=="CommonDialog"||type=="ImageList") {
    handle=host->handles.add(self(),HandleKind::Control);if(type=="Timer")timerChanged();if(type=="ImageList")items("listimages");return;
  }
  if(type=="CommandButton")widget=gtk_button_new_with_mnemonic(caption.c_str());
  else if(type=="CheckBox")widget=gtk_check_button_new_with_mnemonic(caption.c_str());
  else if(type=="OptionButton") {
    GSList* group=nullptr;if(auto object=owner.lock())for(auto& peer:gtkFormControls(object))if(peer->spec.type=="OptionButton"&&peer->spec.parent==spec.parent) {group=gtk_radio_button_get_group(GTK_RADIO_BUTTON(peer->widget));break;}
    widget=gtk_radio_button_new_with_mnemonic(group,caption.c_str());
  }
  else if(type=="Label") {view=gtk_event_box_new();widget=gtk_label_new_with_mnemonic(caption.c_str());gtk_container_add(GTK_CONTAINER(view),widget);gtk_widget_show(widget);gtk_label_set_xalign(GTK_LABEL(widget),0);}
  else if(type=="TextBox"&&!flag("multiline")) {widget=gtk_entry_new();auto password=property("passwordchar",Value::string(u"")).string();if(!password.empty()){gtk_entry_set_visibility(GTK_ENTRY(widget),FALSE);gtk_entry_set_invisible_char(GTK_ENTRY(widget),password[0]);}}
  else if(type=="TextBox"||type=="RichTextBox") {view=gtk_scrolled_window_new(nullptr,nullptr);widget=gtk_text_view_new();gtk_container_add(GTK_CONTAINER(view),widget);gtk_widget_show(widget);auto scroll=int(number("scrollbars",2));gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(view),scroll&1?GTK_POLICY_AUTOMATIC:GTK_POLICY_NEVER,scroll&2?GTK_POLICY_AUTOMATIC:GTK_POLICY_NEVER);gtk_text_view_set_wrap_mode(GTK_TEXT_VIEW(widget),scroll&1?GTK_WRAP_NONE:GTK_WRAP_WORD_CHAR);}
  else if(type=="ComboBox"||type=="DriveListBox")widget=type=="DriveListBox"||number("style",0)==2?gtk_combo_box_text_new():gtk_combo_box_text_new_with_entry();
  else if(type=="Frame") {widget=gtk_frame_new(caption.c_str());content=gtk_fixed_new();gtk_container_add(GTK_CONTAINER(widget),content);gtk_widget_show(content);}
  else if(type=="Form"||type=="MDIForm"||type=="PictureBox") {widget=gtk_fixed_new();content=widget;}
  else if(type=="Image"||type=="Line"||type=="Shape"||type=="MSChart")widget=gtk_drawing_area_new();
  else if(type=="ListBox"||type=="ListView"||type=="TreeView"||type=="FileListBox"||type=="DirListBox"||isGrid(*this)) {
    view=gtk_scrolled_window_new(nullptr,nullptr);widget=gtk_tree_view_new();gtk_container_add(GTK_CONTAINER(view),widget);gtk_widget_show(widget);
    gtk_tree_selection_set_mode(gtk_tree_view_get_selection(GTK_TREE_VIEW(widget)),flag("multiselect")?GTK_SELECTION_MULTIPLE:GTK_SELECTION_SINGLE);
    if(isGrid(*this))resizeGrid(size_t(number("rows",2)),size_t(number("cols",2)));
    if(type=="TreeView")items("nodes");if(type=="ListView"){items("listitems");items("columnheaders");}
    gtkConnectTree(*this);updateColumns();
  }
  else if(type=="HScrollBar"||type=="VScrollBar"||type=="Slider") {
    auto* adjustment=gtk_adjustment_new(number("value"),number("min"),number("max",100),number("smallchange",1),number("largechange",10),0);
    if(type=="Slider"){widget=gtk_scale_new(number("orientation",0)==1?GTK_ORIENTATION_VERTICAL:GTK_ORIENTATION_HORIZONTAL,adjustment);gtk_scale_set_draw_value(GTK_SCALE(widget),FALSE);}
    else widget=gtk_scrollbar_new(type=="VScrollBar"?GTK_ORIENTATION_VERTICAL:GTK_ORIENTATION_HORIZONTAL,adjustment);
  }
  else if(type=="UpDown")widget=gtk_spin_button_new_with_range(number("min"),number("max",100),number("increment",1));
  else if(type=="ProgressBar")widget=gtk_progress_bar_new();
  else if(type=="DTPicker"||type=="MonthView")widget=gtk_calendar_new();
  else if(type=="TabStrip"||type=="SSTab")widget=gtk_notebook_new();
  else if(type=="Toolbar")widget=gtk_toolbar_new();
  else if(type=="StatusBar")widget=gtk_box_new(GTK_ORIENTATION_HORIZONTAL,0);
  else fail(453,"GTK native control is not implemented: "+type);
  if(!view)view=widget;g_object_ref_sink(view);markWidget(view,self());if(widget!=view)markWidget(widget,self());watchDestruction(view,self());
  handle=host->handles.add(self(),type=="Form"||type=="MDIForm"?HandleKind::Window:HandleKind::Control);
  gtk_widget_set_name(widget,("vb6-"+spec.name).c_str());
  if(GTK_IS_BUTTON(widget))gtkSignal(widget,GTK_IS_TOGGLE_BUTTON(widget)?"toggled":"clicked",G_CALLBACK(+[](GtkButton*,gpointer data){gtkEvent(data,[](GtkControl& c){c.changed(GTK_IS_TOGGLE_BUTTON(c.widget)?"value":"click");});}),self());
  if(auto* edit=editor()) {
    if(GTK_IS_ENTRY(edit))gtkSignal(edit,"changed",G_CALLBACK(+[](GtkEditable*,gpointer data){gtkEvent(data,[](GtkControl& c){c.changed("text");});}),self());
    else gtkSignal(gtk_text_view_get_buffer(GTK_TEXT_VIEW(edit)),"changed",G_CALLBACK(+[](GtkTextBuffer*,gpointer data){gtkEvent(data,[](GtkControl& c){c.changed("text");});}),self());
  }
  if(GTK_IS_COMBO_BOX(widget))gtkSignal(widget,"changed",G_CALLBACK(+[](GtkComboBox*,gpointer data){gtkEvent(data,[](GtkControl& c){c.changed("listindex");});}),self());
  if(GTK_IS_RANGE(widget)||GTK_IS_SPIN_BUTTON(widget))gtkSignal(widget,"value-changed",G_CALLBACK(+[](GtkWidget*,gpointer data){gtkEvent(data,[](GtkControl& c){c.changed("value");});}),self());
  if(GTK_IS_CALENDAR(widget))gtkSignal(widget,"day-selected",G_CALLBACK(+[](GtkCalendar*,gpointer data){gtkEvent(data,[](GtkControl& c){c.changed("value");});}),self());
  if(GTK_IS_NOTEBOOK(widget)) {
    gtkSignal(widget,"switch-page",G_CALLBACK(+[](GtkNotebook*,GtkWidget*,guint page,gpointer data){gtkEvent(data,[&](GtkControl& c){if(c.suppressEvents)return;auto prior=c.property("tab",Value::integer(0));c.properties["tab"]=Value::integer(page,Type::Integer);c.event("click",c.spec.type=="SSTab"?Args{Arg(prior)}:Args{});});}),self());
    auto count=type=="SSTab"?int(number("tabs",3)):1;if(count<1||count>1000)fail(380);
    auto collection=items("tabs");for(int i=0;i<count;++i)collection->invoke(*host->runtime,"add",{Arg(Value::missing()),Arg(Value::string(u"")),Arg(Value::string(u"Tab "+fromUTF8(std::to_string(i))))});
  }
  if(type=="Toolbar")items("buttons");if(type=="StatusBar")items("panels");
  if(type=="MSChart")resizeGrid(size_t(number("rowcount",5)),size_t(number("columncount",1)));
  if(content||type=="Image"||type=="Line"||type=="Shape"||type=="MSChart")gtkSignal(widget,"draw",G_CALLBACK(+[](GtkWidget*,cairo_t* cr,gpointer data)->gboolean {gtkEvent(data,[&](GtkControl& c){gtkDraw(c,cr);});return FALSE;}),self());
  gtkConnectInput(*this);
  auto initial=property("list");if(initial.type==Type::Array)for(auto& value:initial.asArray()->values)list.push_back(value.string());itemData.resize(list.size());
  if(type=="DriveListBox"||type=="DirListBox"||type=="FileListBox")reloadFiles();
  refresh();applyFrame();applyFont();
}
void GtkControl::refresh() {
  if(disposed)return;GtkEventSuppression guard(*this);
  if(menu) {if(GTK_IS_CHECK_MENU_ITEM(menu)){gtk_menu_item_set_label(GTK_MENU_ITEM(menu),gtkCaption(property("caption",Value::string(u"")).string()).c_str());gtk_menu_item_set_use_underline(GTK_MENU_ITEM(menu),TRUE);gtk_check_menu_item_set_active(GTK_CHECK_MENU_ITEM(menu),flag("checked"));}gtk_widget_set_sensitive(menu,flag("enabled",true));gtk_widget_set_visible(menu,flag("visible",true));return;}
  if(!view)return;
  gtk_widget_set_visible(view,flag("visible",true));gtk_widget_set_sensitive(view,flag("enabled",true));
  gtk_widget_set_tooltip_text(view,toUTF8(property("tooltiptext",Value::string(u"")).string()).c_str());
  auto caption=gtkCaption(property("caption",Value::string(fromUTF8(spec.name))).string());
  if(GTK_IS_BUTTON(widget))gtk_button_set_label(GTK_BUTTON(widget),caption.c_str());
  if(GTK_IS_BUTTON(widget)) {
    auto value=property(!flag("enabled",true)&&properties.count("disabledpicture")?"disabledpicture":"picture",Value::object(nullptr));
    auto picture=value.type==Type::Object?std::dynamic_pointer_cast<GtkPicture>(std::get<ObjectPtr>(value.payload)):nullptr;
    gtk_button_set_image(GTK_BUTTON(widget),picture&&picture->pixels?gtk_image_new_from_pixbuf(picture->pixels):nullptr);gtk_button_set_always_show_image(GTK_BUTTON(widget),picture!=nullptr);
  }
  if(GTK_IS_TOGGLE_BUTTON(widget)){gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(widget),number("value")!=0);gtk_toggle_button_set_inconsistent(GTK_TOGGLE_BUTTON(widget),number("value")==2);}
  if(GTK_IS_LABEL(widget)){gtk_label_set_text_with_mnemonic(GTK_LABEL(widget),caption.c_str());gtk_label_set_xalign(GTK_LABEL(widget),number("alignment")==1?1:number("alignment")==2?0.5:0);gtk_label_set_line_wrap(GTK_LABEL(widget),flag("wordwrap",true));}
  if(GTK_IS_FRAME(widget))gtk_frame_set_label(GTK_FRAME(widget),gtkCaption(property("caption",Value::string(u"")).string(),false).c_str());
  if(auto* edit=editor()) {
    auto text=property("text",Value::string(u"")).string();if(editText()!=text)editSetText(text,false);
    if(GTK_IS_ENTRY(edit)){gtk_editable_set_editable(GTK_EDITABLE(edit),!flag("locked"));gtk_entry_set_alignment(GTK_ENTRY(edit),number("alignment")==1?1:number("alignment")==2?0.5:0);}
    else {gtk_text_view_set_editable(GTK_TEXT_VIEW(edit),!flag("locked"));gtk_text_view_set_justification(GTK_TEXT_VIEW(edit),number("alignment")==1?GTK_JUSTIFY_RIGHT:number("alignment")==2?GTK_JUSTIFY_CENTER:GTK_JUSTIFY_LEFT);}
  }
  if(GTK_IS_RANGE(widget)||GTK_IS_SPIN_BUTTON(widget)||GTK_IS_PROGRESS_BAR(widget)) {
    double minimum=number("min"),maximum=number("max",100),value=number("value",minimum);if(!std::isfinite(minimum)||!std::isfinite(maximum)||!std::isfinite(value)||maximum<minimum||value<minimum||value>maximum)fail(380,"Value is outside Min/Max");
    if(GTK_IS_RANGE(widget)){gtk_range_set_range(GTK_RANGE(widget),minimum,maximum);gtk_range_set_increments(GTK_RANGE(widget),number("smallchange",1),number("largechange",10));gtk_range_set_value(GTK_RANGE(widget),value);}
    if(GTK_IS_SPIN_BUTTON(widget)){gtk_spin_button_set_range(GTK_SPIN_BUTTON(widget),minimum,maximum);gtk_spin_button_set_value(GTK_SPIN_BUTTON(widget),value);}
    if(GTK_IS_PROGRESS_BAR(widget))gtk_progress_bar_set_fraction(GTK_PROGRESS_BAR(widget),maximum==minimum?0:(value-minimum)/(maximum-minimum));
  }
  if(GTK_IS_CALENDAR(widget)) {auto value=parseDate(property("value",Value::string(u"2000-01-01")));auto date=civilTime(value);properties["value"]=value;gtk_calendar_select_month(GTK_CALENDAR(widget),date.month-1,date.year);gtk_calendar_select_day(GTK_CALENDAR(widget),date.day);}
  if(properties.count("forecolor")){auto color=gtkColor(number("forecolor"));gtk_widget_override_color(widget,GTK_STATE_FLAG_NORMAL,&color);}
  if(properties.count("backcolor")){auto color=gtkColor(number("backcolor"));gtk_widget_override_background_color(widget,GTK_STATE_FLAG_NORMAL,&color);}
  if(GTK_IS_COMBO_BOX(widget)||GTK_IS_TREE_VIEW(widget))reloadList();
  auto pointer=int(number("mousepointer"));auto* window=gtk_widget_get_window(view);if(window){const char* cursor=pointer==2?"crosshair":pointer==3?"text":pointer==9?"move":pointer==11?"wait":pointer==10?"not-allowed":pointer==15?"pointer":"default";GdkCursor* value=nullptr;
    if(pointer==99){auto image=property("mouseicon",Value::object(nullptr));auto picture=image.type==Type::Object?std::dynamic_pointer_cast<GtkPicture>(std::get<ObjectPtr>(image.payload)):nullptr;if(picture&&picture->pixels)value=gdk_cursor_new_from_pixbuf(gdk_window_get_display(window),picture->pixels,picture->hotspotX,picture->hotspotY);}
    if(!value)value=gdk_cursor_new_from_name(gdk_window_get_display(window),cursor);gdk_window_set_cursor(window,value);if(value)g_object_unref(value);}
  gtk_widget_queue_draw(view);
}
void GtkControl::dispose() {
  if(disposed)return;disposed=true;if(timer){g_source_remove(timer);timer=0;}
  if(!hostLife.expired()){host->cancelTimers(handle);host->handles.remove(persistentDC);host->handles.remove(handle);}persistentDC=0;
  if(dataBinding){dataBinding->detach();dataBinding.reset();}pendingEdit.reset();
  for(auto& entry:collections)entry.second->owner.reset();
  // Containers can destroy their descendants independently of VB Unload (for
  // example Tabs.Remove). Invalidate borrowed widget pointers before GTK's
  // recursive destruction, then release exactly the reference owned by us.
  auto* owned=std::exchange(view,nullptr);widget=content=menu=nullptr;
  if(owned){if(!gtk_widget_in_destruction(owned))gtk_widget_destroy(owned);g_object_unref(owned);}
  if(model){g_object_unref(model);model=nullptr;}if(css){g_object_unref(css);css=nullptr;}
  for(auto& page:tabPages)g_object_unref(page.second);tabPages.clear();
}
void GtkControl::event(const std::string& name,Args args) {
  if(disposed||suppressEvents)return;auto object=owner.lock();if(!object||!object->loaded)return;
  auto prefix=spec.type=="Form"?"form":spec.type=="MDIForm"?"mdiform":lower(spec.name);
  if(spec.index>=0)args.insert(args.begin(),Arg(Value::integer(spec.index,Type::Integer)));
  host->runtime->dispatch(object,prefix+"_"+lower(name),std::move(args));
}
void GtkControl::timerChanged() {
  if(timer){g_source_remove(timer);timer=0;}auto interval=number("interval");
  if(interval<0||interval>65535||std::floor(interval)!=interval)fail(380,"Timer Interval must be 0..65535 milliseconds");
  if(!interval||!flag("enabled",true)||disposed)return;
  auto* weak=new std::weak_ptr<GtkControl>(self());
  timer=g_timeout_add_full(G_PRIORITY_DEFAULT,guint(interval),+[](gpointer data)->gboolean {
    auto c=gtkModel(data);if(!c||c->disposed)return G_SOURCE_REMOVE;if(c->eventActive)return G_SOURCE_CONTINUE;
    c->host->event([&]{c->eventActive=true;try{c->event("timer");c->eventActive=false;}catch(...){c->eventActive=false;throw;}});return G_SOURCE_CONTINUE;
  },weak,+[](gpointer data){delete static_cast<std::weak_ptr<GtkControl>*>(data);});
}
void GtkControl::changed(const std::string& name) {
  if(suppressEvents||disposed)return;
  if(name=="text") {auto value=editText();auto maximum=number("maxlength");if(maximum>0&&value.size()>size_t(maximum)){value.resize(size_t(maximum));editSetText(value,false);}auto old=property("text",Value::string(u"")).string();properties["text"]=Value::string(value);if(old!=value)event("change");return;}
  if(name=="listindex") {auto index=gtk_combo_box_get_active(GTK_COMBO_BOX(widget));properties["listindex"]=Value::integer(index);selected.clear();if(index>=0)selected.insert(size_t(index));if(spec.type=="DriveListBox"&&index>=0)properties["drive"]=Value::string(list[size_t(index)]);event(spec.type=="DriveListBox"?"change":"click");return;}
  if(name=="value") {
    if(GTK_IS_TOGGLE_BUTTON(widget)) {auto value=gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(widget));gtk_toggle_button_set_inconsistent(GTK_TOGGLE_BUTTON(widget),FALSE);properties["value"]=Value::integer(value?1:0,Type::Integer);if(spec.type=="OptionButton"&&!value)return;event("click");return;}
    if(GTK_IS_RANGE(widget))properties["value"]=Value::integer(bankers(gtk_range_get_value(GTK_RANGE(widget))));
    else if(GTK_IS_SPIN_BUTTON(widget))properties["value"]=Value::integer(gtk_spin_button_get_value_as_int(GTK_SPIN_BUTTON(widget)));
    else if(GTK_IS_CALENDAR(widget)){guint y,m,d;gtk_calendar_get_date(GTK_CALENDAR(widget),&y,&m,&d);properties["value"]=civilDate({int(y),int(m+1),int(d),0,0,0});}
    event("change");if(GTK_IS_RANGE(widget))event("scroll");return;
  }
  event(name);
}
Value GtkControl::get(Runtime& rt,const std::string& raw) {
  if(disposed||hostLife.expired())fail(91,"Control has been unloaded");auto name=lower(raw.empty()?defaultMember():raw);
  if(name=="handle"||name=="hwnd")return Value::integer(handle);
  if(name=="font")return gtkFont(self());
  if(name=="container"||name=="parent"){auto object=owner.lock();if(!object)fail(91);return spec.parent.empty()?Value::object(object):object->get(rt,spec.parent);}
  if(name=="controls"){auto object=owner.lock();if(!object)fail(91);return host->formGet(object,name);}
  if(name=="visible")return Value::boolean(view?gtk_widget_get_visible(view):flag("visible",true));
  if(name=="enabled")return Value::boolean(view?gtk_widget_get_sensitive(view):flag("enabled",true));
  if(name=="text"&&editor())return Value::string(editText());
  if(name=="selstart"||name=="sellength"||name=="seltext"){auto selection=editSelection();return name=="selstart"?Value::integer(selection.first):name=="sellength"?Value::integer(selection.second):Value::string(editText().substr(selection.first,selection.second));}
  if(name=="listcount")return Value::integer(list.size());if(name=="selcount")return Value::integer(selected.size());
  if(name=="listindex")return property(name,Value::integer(-1));
  if(name=="text"&&(spec.type=="ListBox"||spec.type=="ComboBox")){auto index=number("listindex",-1);return Value::string(index>=0&&size_t(index)<list.size()?list[size_t(index)]:Text());}
  if(name=="filename"&&spec.type=="FileListBox"){auto index=number("listindex",-1);return Value::string(index>=0&&size_t(index)<list.size()?list[size_t(index)]:Text());}
  if(name=="nodes"||name=="listitems"||name=="columnheaders"||name=="buttons"||name=="panels"||name=="listimages"||(name=="tabs"&&spec.type!="SSTab"))return Value::object(items(name));
  if(name=="tabs"&&spec.type=="SSTab")return Value::integer(items("tabs")->values.size(),Type::Integer);
  if(name=="selecteditem") {
    auto collection=items(spec.type=="TreeView"?"nodes":spec.type=="ListView"?"listitems":"tabs");
    if(GTK_IS_NOTEBOOK(widget)){auto index=gtk_notebook_get_current_page(GTK_NOTEBOOK(widget));return Value::object(index>=0&&size_t(index)<collection->values.size()?collection->values[size_t(index)]:nullptr);}
    if(GTK_IS_TREE_VIEW(widget)){GtkTreeModel* current=nullptr;GtkTreeIter iter;if(gtk_tree_selection_get_selected(gtk_tree_view_get_selection(GTK_TREE_VIEW(widget)),&current,&iter)){guint64 identity=0;gtk_tree_model_get(current,&iter,gtk_tree_model_get_n_columns(current)-1,&identity,-1);for(auto& item:collection->values)if(item->identity==identity)return Value::object(item);}}return Value::object(nullptr);
  }
  if(name=="rows"||name=="rowcount")return Value::integer(grid.size());
  if(name=="cols"||name=="columncount")return Value::integer(grid.empty()?0:grid[0].size());
  if(name=="row"||name=="col"||name=="column")return property(name,Value::integer(spec.type=="MSChart"?1:0));
  if(name=="data"&&spec.type=="MSChart"){auto r=int64_t(number("row",1))-1,c=int64_t(number("column",1))-1;range(r,grid.size());range(c,grid[size_t(r)].size());return Value::string(grid[size_t(r)][size_t(c)]);}
  if(name=="text"&&isGrid(*this)){auto r=int64_t(number("row")),c=int64_t(number("col"));range(r,grid.size());range(c,grid[size_t(r)].size());return Value::string(grid[size_t(r)][size_t(c)]);}
  if(name=="datasource"&&isGrid(*this))return Value::object(dataBinding?dataBinding->source:nullptr);
  if(name=="currentx")return Value::real(currentX,Type::Single);if(name=="currenty")return Value::real(currentY,Type::Single);
  if(name=="scalewidth"||name=="scaleheight")return property(name,Value::real(view?(name=="scalewidth"?gtk_widget_get_allocated_width(view):gtk_widget_get_allocated_height(view))/unit(-1,name=="scalewidth"):0,Type::Single));
  if(name=="hdc"){if(!host->handles.find(persistentDC,HandleKind::DC))persistentDC=int32_t(host->api(rt,"user32.GetDC",{Arg(Value::integer(handle))}).integral());return Value::integer(persistentDC);}
  if(name=="picture"||name=="mouseicon"||name=="icon"||name=="disabledpicture"||name=="downpicture")return property(name,Value::object(nullptr));
  auto it=properties.find(name);if(it!=properties.end())return it->second;
  if(name=="tag"||name=="tooltiptext"||name=="text"||name=="caption")return Value::string(u"");
  if(name=="tabstop")return Value::boolean(true);
  const std::set<std::string> zeros={"value","tabindex","left","top","interval","newindex","tab","row","col","checked","locked","maxlength","fontbold","fontitalic","fontunderline","fontstrikethru","alignment"};
  if(zeros.count(name))return Value::integer(0);
  if(name=="fontname")return Value::string(u"Sans");if(name=="fontsize")return Value::real(8.25);
  fail(438,"Unsupported GTK property "+spec.type+"."+raw);
}
void GtkControl::set(Runtime& rt,const std::string& raw,Value value,bool) {
  if(disposed||hostLife.expired())fail(91);auto name=lower(raw.empty()?defaultMember():raw);
  if(name=="value"&&GTK_IS_CALENDAR(widget))value=parseDate(value);
  if(name=="name"||name=="index"||name=="hwnd"||name=="handle"||name=="listcount")fail(383);
  if(name=="datasource"&&isGrid(*this)){bindRecordset(std::move(value));return;}
  if(name=="font"){auto font=value.asObject();for(auto& field:std::map<std::string,std::string>{{"name","fontname"},{"size","fontsize"},{"bold","fontbold"},{"italic","fontitalic"},{"underline","fontunderline"},{"strikethrough","fontstrikethru"}})set(rt,field.second,font->get(rt,field.first));return;}
  if(name=="selstart"||name=="sellength"||name=="seltext") {auto selection=editSelection();if(name=="seltext"){auto text=editText(),insert=value.string();text.replace(selection.first,selection.second,insert);editSetText(text);editSelect(selection.first+insert.size(),0);}else{auto n=value.integral();if(n<0)fail(380);editSelect(name=="selstart"?size_t(n):selection.first,name=="sellength"?size_t(n):0);}return;}
  if(name=="text"&&editor()){editSetText(value.string());return;}
  if(name=="text"&&isGrid(*this)){writeCell(size_t(number("row")),size_t(number("col")),value);return;}
  if(name=="listindex"){auto n=value.integral();if(n< -1||n>=int64_t(list.size()))fail(380);auto prior=number("listindex",-1);properties[name]=Value::integer(n);selected.clear();if(n>=0)selected.insert(size_t(n));reloadList();if(editor()&&n>=0)editSetText(list[size_t(n)]);if(prior!=n)event("click");return;}
  if(name=="rows"||name=="cols"||name=="rowcount"||name=="columncount") {if(dataBinding)fail(380,"Bound grid shape is owned by its Recordset");auto n=value.integral();if(n<0||n>100000)fail(380);auto rows=name=="rows"||name=="rowcount"?size_t(n):grid.size(),cols=name=="cols"||name=="columncount"?size_t(n):(grid.empty()?0:grid[0].size());resizeGrid(rows,cols);updateColumns();reloadList();return;}
  if(name=="data"&&spec.type=="MSChart"){writeCell(size_t(number("row",1)-1),size_t(number("column",1)-1),value);if(view)gtk_widget_queue_draw(view);return;}
  if(name=="row"||name=="col"||name=="column"){auto n=value.integral();range(n-(spec.type=="MSChart"?1:0),name=="row"?grid.size():grid.empty()?0:grid[0].size());properties[name]=Value::integer(n);return;}
  if(name=="tab"&&GTK_IS_NOTEBOOK(widget)){auto n=value.integral();range(n,items("tabs")->values.size());gtk_notebook_set_current_page(GTK_NOTEBOOK(widget),int(n));properties[name]=Value::integer(n,Type::Integer);return;}
  if(name=="selecteditem") {auto item=std::dynamic_pointer_cast<GtkItem>(value.asObject());if(!item||item->owner.lock().get()!=this)fail(380);if(GTK_IS_NOTEBOOK(widget)){gtk_notebook_set_current_page(GTK_NOTEBOOK(widget),int(item->get(rt,"index").integral()-1));return;}auto found=treePaths.find(item->identity);if(found==treePaths.end())fail(380);auto* path=gtk_tree_path_new_from_string(found->second.c_str());gtk_tree_view_expand_to_path(GTK_TREE_VIEW(widget),path);gtk_tree_view_set_cursor(GTK_TREE_VIEW(widget),path,nullptr,FALSE);gtk_tree_path_free(path);return;}
  if(name=="currentx"||name=="currenty"){if(name=="currentx")currentX=value.floating();else currentY=value.floating();return;}
  if(name=="picture"||name=="icon"||name=="mouseicon"||name=="disabledpicture"||name=="downpicture"){if(value.type!=Type::Object)fail(13);auto object=std::get<ObjectPtr>(value.payload);auto picture=std::dynamic_pointer_cast<GtkPicture>(object);if(object&&!picture)fail(13);properties[name]=value;
    if((name=="icon")&&(spec.type=="Form"||spec.type=="MDIForm"))gtk_window_set_icon(GTK_WINDOW(form()->window),picture?picture->pixels:nullptr);
    if(name=="picture"&&picture&&picture->pixels&&((spec.type=="Image"&&!flag("stretch"))||(spec.type=="PictureBox"&&flag("autosize")))){properties["width"]=Value::real(gdk_pixbuf_get_width(picture->pixels)*15);properties["height"]=Value::real(gdk_pixbuf_get_height(picture->pixels)*15);applyFrame();}
    refresh();return;}
  const std::set<std::string> supported={"caption","text","left","top","width","height","visible","enabled","tag","tooltiptext","backcolor","forecolor","fontname","fontsize","fontbold","fontitalic","fontunderline","fontstrikethru","alignment","locked","maxlength","value","min","max","smallchange","largechange","increment","interval","checked","tabindex","tabstop","scalemode","scaleleft","scaletop","scalewidth","scaleheight","drawstyle","drawmode","drawwidth","fillcolor","fillstyle","bordercolor","borderwidth","shape","borderstyle","stretch","sorted","multiselect","gridlines","fullrowselect","fixedrows","fixedcols","rowsel","colsel","simpletext","style","filter","filterindex","filename","dialogtitle","initdir","defaultext","flags","cancelerror","path","pattern","drive","redraw","mousepointer","color","fontcharset","anchor","dock","autoredraw","keypreview"};
  if(!supported.count(name)&&!(spec.type=="MSChart"&&(name=="charttype"||name=="rowlabel"||name=="columnlabel")))fail(438,"Unsupported GTK property "+spec.type+"."+raw);
  if(name=="charttype"&&value.integral()!=1&&value.integral()!=3&&value.integral()!=5&&value.integral()!=14)fail(453,"GTK MSChart supports 2D bar (1), line (3), area-line (5), and pie (14) chart types");
  if(name=="interval"&&(value.integral()<0||value.integral()>65535))fail(380);
  if(name=="maxlength"&&value.integral()<0)fail(380);
  if(name=="value"&&(spec.type=="CheckBox"||spec.type=="OptionButton")&&(value.integral()<0||value.integral()>(spec.type=="CheckBox"?2:1)))fail(380);
  if(name=="scalemode"&&(value.integral()<0||value.integral()>7))fail(380);
  auto previous=property(name);properties[name]=value;
  try {
    if(name=="left"||name=="top"||name=="width"||name=="height")applyFrame();
    else if(name.rfind("font",0)==0)applyFont();
    else if(name=="interval"||(name=="enabled"&&spec.type=="Timer"))timerChanged();
    else if(name=="path"||name=="pattern"||name=="drive")reloadFiles();
    else if(name=="simpletext"&&spec.type=="StatusBar"){auto panels=items("panels");if(panels->values.empty())panels->invoke(rt,"add",{Arg(Value::missing()),Arg(Value::string(u"")),Arg(value)});else panels->values.front()->set(rt,"text",value);}
    else refresh();
  }catch(...){properties[name]=previous;throw;}
  if(name=="value"&&previous.number()!=value.number()) {
    if(spec.type=="CheckBox"||(spec.type=="OptionButton"&&value.truth()))event("click");
    else if(GTK_IS_RANGE(widget)||GTK_IS_SPIN_BUTTON(widget)||GTK_IS_CALENDAR(widget))event("change");
  }
}
Ref GtkControl::reference(Runtime& rt,const std::string& raw,Args args) {
  if(dataBinding&&lower(raw)=="textmatrix"&&args.size()==2) {
    auto row=args[0].value.integral(),column=args[1].value.integral();if(row<0||column<0||size_t(row)>=grid.size()||size_t(column)>=grid[size_t(row)].size())fail(381);
    auto binding=dataBinding;auto original=Value::string(grid[size_t(row)][size_t(column)]);std::optional<RecordsetGridEdit> token;if(row)token=binding->begin(size_t(row),size_t(column));std::weak_ptr<GtkControl> weak=self();
    return {[original]{return original;},[weak,binding,token](Value value,bool){auto c=weak.lock();if(!c||c->disposed)fail(91);if(c->dataBinding!=binding||!binding->active)fail(3218,"Grid binding changed during assignment");if(!token)fail(381);binding->commit(*token,std::move(value));},"string",false,false};
  }
  if(args.empty())return Object::reference(rt,raw,{});auto c=self();auto name=lower(raw);
  return {[c,&rt,name,args]{return c->invoke(rt,name,args);},[c,&rt,name,args](Value value,bool){auto all=args;all.emplace_back(std::move(value));c->invoke(rt,"let:"+name,all);},"variant",false,false};
}
Value GtkControl::invoke(Runtime& rt,const std::string& raw,Args args) {
  if(disposed||hostLife.expired())fail(91);bool put=raw.rfind("let:",0)==0||raw.rfind("set:",0)==0;auto name=lower(put?raw.substr(4):raw);if(name.empty())name=defaultMember();
  if(!put&&(name=="nodes"||name=="listitems"||name=="columnheaders"||name=="buttons"||name=="panels"||name=="listimages"||(name=="tabs"&&spec.type!="SSTab")))return args.empty()?Value::object(items(name)):items(name)->invoke(rt,"item",std::move(args));
  if(name=="list"||name=="itemdata"||name=="selected") {if(args.size()!=(put?2:1))fail(450);auto n=args[0].value.integral();range(n,list.size());auto i=size_t(n);if(put){if(name=="list")list[i]=args[1].value.string();else if(name=="itemdata")itemData[i]=int32_t(coerce(args[1].value,"long").integral());else if(args[1].value.truth()){if(!flag("multiselect"))selected.clear();selected.insert(i);}else selected.erase(i);reloadList();return {};}return name=="list"?Value::string(list[i]):name=="itemdata"?Value::integer(itemData[i]):Value::boolean(selected.count(i));}
  if(name=="textmatrix"||name=="textarray") {auto count=name=="textmatrix"?2u:1u;if(args.size()!=count+(put?1u:0u))fail(450);auto columns=grid.empty()?0:grid[0].size();if(!columns)fail(381);auto row=name=="textmatrix"?args[0].value.integral():args[0].value.integral()/int64_t(columns),col=name=="textmatrix"?args[1].value.integral():args[0].value.integral()%int64_t(columns);range(row,grid.size());range(col,columns);if(put){writeCell(size_t(row),size_t(col),args[count].value);return {};}return Value::string(grid[size_t(row)][size_t(col)]);}
  if(name=="colwidth"||name=="rowheight") {if(args.size()!=(put?2:1))fail(450);auto n=args[0].value.integral();if(n<0||n>100000)fail(381);auto& values=name=="colwidth"?columnWidths:rowHeights;if(put){auto size=args[1].value.floating()/15;if(!std::isfinite(size)||size<0||size>20000)fail(380);values[int(n)]=size;updateColumns();reloadList();return {};}return Value::real((values.count(int(n))?values[int(n)]:name=="colwidth"?90:22)*15);}
  if(put&&args.size()==1){set(rt,name,args[0].value);return {};}
  if(name=="additem") {if(args.empty()||args.size()>2)fail(450);auto text=args[0].value.string();auto index=integerArgument(args,1,list.size());if(index<0||index>int64_t(list.size()))fail(5);if(list.size()>=1000000)fail(7);if(flag("sorted"))index=std::lower_bound(list.begin(),list.end(),text)-list.begin();list.insert(list.begin()+index,text);itemData.insert(itemData.begin()+index,0);std::set<size_t> shifted;for(auto i:selected)shifted.insert(i>=size_t(index)?i+1:i);selected=std::move(shifted);auto previous=number("listindex",-1);if(previous>=index)properties["listindex"]=Value::integer(int64_t(previous)+1);properties["newindex"]=Value::integer(index);reloadList();return {};}
  if(name=="removeitem") {if(args.size()!=1)fail(450);auto index=args[0].value.integral();range(index,list.size());list.erase(list.begin()+index);itemData.erase(itemData.begin()+index);std::set<size_t> shifted;for(auto i:selected)if(i!=size_t(index))shifted.insert(i>size_t(index)?i-1:i);selected=std::move(shifted);auto previous=int64_t(number("listindex",-1));properties["listindex"]=Value::integer(previous==index?-1:previous>index?previous-1:previous);reloadList();return {};}
  if(name=="clear") {if(dataBinding)fail(380,"Clear requires detaching the Recordset");list.clear();itemData.clear();selected.clear();properties["listindex"]=Value::integer(-1);for(auto& row:grid)for(auto& value:row)value.clear();reloadList();return {};}
  if(name=="setfocus") {if(!widget||!gtk_widget_get_sensitive(widget)||!gtk_widget_get_visible(view))fail(5);gtk_widget_grab_focus(editor()?editor():widget);return {};}
  if(name=="refresh"){if(view)gtk_widget_queue_draw(view);host->pump();return {};}
  if(name=="move") {if(args.size()<2||args.size()>4)fail(450);const char* names[]={"left","top","width","height"};for(size_t i=0;i<args.size();++i)if(args[i].value.type!=Type::Missing)properties[names[i]]=args[i].value;applyFrame();return {};}
  if(name=="zorder") {auto n=integerArgument(args,0);if(n<0||n>1)fail(5);auto* window=view?gtk_widget_get_window(view):nullptr;if(window){if(n)gdk_window_lower(window);else gdk_window_raise(window);}return {};}
  if(name=="click"){event("click");return {};}
  if(name=="cls"){drawings.clear();currentX=currentY=0;if(view)gtk_widget_queue_draw(view);return {};}
  if(name=="print")return gtkPrint(*this,std::move(args));
  if(name=="paintpicture") {if(args.size()<3||args.size()>9)fail(450);auto image=std::dynamic_pointer_cast<GtkPicture>(args[0].value.asObject());if(!image||!image->pixels)fail(5);auto command=gtkDrawing(*this,"image");command.picture=image;auto origin=point(args[1].value.floating(),args[2].value.floating());double width=argument(args,3,Value::real(gdk_pixbuf_get_width(image->pixels)/unit(-1,true))).floating(),height=argument(args,4,Value::real(gdk_pixbuf_get_height(image->pixels)/unit(-1,false))).floating();command.coordinates={origin.first,origin.second,width*unit(-1,true),height*unit(-1,false)};if(args.size()>5){command.coordinates.push_back(argument(args,5,Value::real(0)).floating()*unit(-1,true));command.coordinates.push_back(argument(args,6,Value::real(0)).floating()*unit(-1,false));command.coordinates.push_back(argument(args,7,Value::real(width)).floating()*unit(-1,true));command.coordinates.push_back(argument(args,8,Value::real(height)).floating()*unit(-1,false));}gtkAppendDrawing(*this,std::move(command));return {};}
  if(name=="textwidth"||name=="textheight") {if(args.size()!=1||!widget)fail(450);auto* layout=gtk_widget_create_pango_layout(widget,toUTF8(args[0].value.string()).c_str());int width,height;pango_layout_get_pixel_size(layout,&width,&height);g_object_unref(layout);return Value::real((name=="textwidth"?width:height)/unit(-1,name=="textwidth"),Type::Single);}
  if(name=="scalex"||name=="scaley") {if(args.empty()||args.size()>3)fail(450);auto x=name=="scalex";return Value::real(args[0].value.floating()*unit(int(integerArgument(args,1,number("scalemode",1))),x)/unit(int(integerArgument(args,2,number("scalemode",1))),x),Type::Single);}
  if(name=="showopen"||name=="showsave"||name=="showcolor"||name=="showfont"||name=="showprinter")return host->dialog(*this,name);
  if(name=="getdc")return host->api(rt,"user32.GetDC",{Arg(Value::integer(handle))});
  if(name=="loadfile"&&editor()) {if(integerArgument(args,1,1)!=1)fail(453,"GTK RichTextBox RTF file import is unavailable; use plain text format 1");std::ifstream stream(toUTF8(stringArgument(args,0)),std::ios::binary);if(!stream)fail(53);std::string text((std::istreambuf_iterator<char>(stream)),{});editSetText(fromUTF8(text));return {};}
  if(name=="savefile"&&editor()) {if(integerArgument(args,1,1)!=1)fail(453,"GTK RichTextBox RTF file export is unavailable; use plain text format 1");std::ofstream stream(toUTF8(stringArgument(args,0)),std::ios::binary);if(!stream)fail(75);stream<<toUTF8(editText());if(!stream)fail(75);return {};}
  if(args.empty())return get(rt,name);fail(438,"Unsupported GTK method "+spec.type+"."+raw);
}
void GtkControl::reloadFiles() {
  list.clear();itemData.clear();selected.clear();properties["listindex"]=Value::integer(-1);
  if(spec.type=="DriveListBox") {list.push_back(u"/");std::error_code error;for(const char* base:{"/media","/mnt"})if(std::filesystem::is_directory(base,error))for(auto& path:std::filesystem::directory_iterator(base,error))if(path.is_directory(error))list.push_back(fromUTF8(path.path().string()));properties["drive"]=property("drive",Value::string(u"/"));}
  else {auto folder=std::filesystem::path(toUTF8(property("path",Value::string(fromUTF8(std::filesystem::current_path().string()))).string()));std::error_code error;if(!std::filesystem::is_directory(folder,error))fail(76);properties["path"]=Value::string(fromUTF8(folder.string()));auto pattern=property("pattern",Value::string(u"*.*")).string();if(pattern==u"*.*")pattern=u"*";for(auto it=std::filesystem::directory_iterator(folder,error);!error&&it!=std::filesystem::directory_iterator();it.increment(error)){bool directory=it->is_directory(error);if(error)break;auto name=fromUTF8(it->path().filename().string());if((spec.type=="DirListBox"&&directory)||(spec.type=="FileListBox"&&!directory&&like(name,pattern,true)))list.push_back(name);}if(error)fail(75,error.message());std::sort(list.begin(),list.end());}
  itemData.resize(list.size());reloadList();
}
Value GtkControlArray::get(Runtime&,const std::string& raw) {auto name=lower(raw);if(name=="count")return Value::integer(elements.size());if(name=="lbound")return Value::integer(elements.empty()?0:elements.begin()->first);if(name=="ubound")return Value::integer(elements.empty()?-1:elements.rbegin()->first);fail(438);}
Value GtkControlArray::invoke(Runtime& rt,const std::string& raw,Args args) {
  auto name=lower(raw);
  if(name.empty()||name=="item"){if(args.size()!=1)fail(450);auto index=int(coerce(args[0].value,"integer").integral());auto it=elements.find(index);if(it==elements.end())fail(340);return Value::object(it->second);}
  if(name=="load"){if(args.size()!=1)fail(450);auto index=int(coerce(args[0].value,"integer").integral());if(index<0||elements.count(index))fail(360);auto object=owner.lock();if(!object)fail(91);auto spec=prototype;spec.index=index;spec.properties.push_back({"index",Value::integer(index,Type::Integer)});spec.properties.push_back({"visible",Value::boolean(false)});elements[index]=host->createControl(object,std::move(spec),true);return {};}
  if(name=="unload"){if(args.size()!=1)fail(450);auto index=int(coerce(args[0].value,"integer").integral());auto it=elements.find(index);if(it==elements.end())fail(340);if(designElements.count(index))fail(362);it->second->dispose();elements.erase(it);return {};}
  if(args.empty())return get(rt,name);fail(438);
}
std::vector<Value> GtkControlArray::enumerate(Runtime&) {std::vector<Value> result;for(auto& entry:elements)result.push_back(Value::object(entry.second));return result;}
}
