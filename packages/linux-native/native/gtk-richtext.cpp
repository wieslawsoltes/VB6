// Native GTK3 attributed text, selection formatting, and atomic RTF persistence.
// https://docs.gtk.org/gtk3/class.TextBuffer.html
// https://docs.gtk.org/gtk3/class.TextTag.html
#include "gtk-richtext.hpp"
#include <fstream>
#include <cstring>

namespace vb6 {
struct GtkRichText {
  GtkTextBuffer* buffer=nullptr;
  std::map<GtkRtfStyle,GtkTextTag*> tags;
  GtkRtfStyle typing;
  GtkRtfStyle trailing;
  std::vector<std::string> metadata;
  struct Field {GtkTextMark* first=nullptr;GtkTextMark* last=nullptr;GtkRtfField value;};
  std::vector<Field> fields;
  struct Presentation {
    GtkWidget* widget=nullptr;
    GdkPixbuf* image=nullptr;
    GObject* paintable=nullptr;
    GtkTextChildAnchor* anchor=nullptr;
    GtkTextMark* mark=nullptr;
    std::vector<std::shared_ptr<GtkControl>> children;
    ~Presentation(){for(auto& child:children)child->dispose();if(widget)g_object_unref(widget);if(image)g_object_unref(image);if(paintable)g_object_unref(paintable);if(anchor)g_object_unref(anchor);if(mark){if(auto* buffer=gtk_text_mark_get_buffer(mark))gtk_text_buffer_delete_mark(buffer,mark);g_object_unref(mark);}}
  };
  struct Embedded {GtkTextMark* first=nullptr;GtkTextChildAnchor* anchor=nullptr;GtkRtfObject value;std::shared_ptr<Presentation> presentation;};
  std::vector<Embedded> objects;
  std::weak_ptr<GtkControl> parent;
  std::pair<int,int> selection{-1,-1};
  size_t operationDepth=0,userActionDepth=0;
  bool dirty=false,typingOverride=false,selecting=false;
  guint selectionIdle=0;
  struct Insertion {int first=0,count=0;GtkRtfStyle style;};
  std::vector<Insertion> insertions;
  ~GtkRichText(){if(selectionIdle)g_source_remove(selectionIdle);for(auto& field:fields){g_object_unref(field.first);g_object_unref(field.last);}if(buffer)g_object_unref(buffer);}
};
namespace {
GtkRichText& rich(GtkControl& control) {
  if(control.disposed)fail(91);
  if(control.spec.type!="RichTextBox"||!GTK_IS_TEXT_VIEW(control.widget)||!control.richText)fail(438,"Selection formatting requires RichTextBox");
  return *control.richText;
}
bool liveObject(GtkRichText& state,const GtkRichText::Embedded& object,GtkTextIter* position=nullptr) {
  if(gtk_text_mark_get_deleted(object.first))return false;GtkTextIter iter;gtk_text_buffer_get_iter_at_mark(state.buffer,&iter,object.first);if(position)*position=iter;
  if(object.anchor)return !gtk_text_child_anchor_get_deleted(object.anchor)&&gtk_text_iter_get_child_anchor(&iter)==object.anchor;
#if GTK_MAJOR_VERSION < 4
  return gtk_text_iter_get_pixbuf(&iter)==object.presentation->image;
#else
  return G_OBJECT(gtk_text_iter_get_paintable(&iter))==object.presentation->paintable;
#endif
}
GtkRtfStyle defaults(GtkControl& c) {
  GtkRtfStyle value;value.font=c.property("fontname",Value::string(u"Sans")).string();value.size=c.number("fontsize",8.25);
  value.bold=c.flag("fontbold");value.italic=c.flag("fontitalic");value.underline=c.flag("fontunderline")?1:0;value.strike=c.flag("fontstrikethru");
  value.foreground=gtkColorValue(gtkColor(c.number("forecolor",0)));value.background=gtkColorValue(gtkColor(c.number("backcolor",0xffffff)));
  value.paragraph.alignment=int(c.number("alignment",0));return value;
}
int scalarOffset(const Text& text,size_t offset) {
  int result=0;offset=std::min(offset,text.size());
  for(size_t i=0;i<offset;++i,++result)if(text[i]>=0xd800&&text[i]<=0xdbff&&i+1<text.size())++i;
  return result;
}
size_t utf16Offset(const Text& text,int offset) {
  size_t result=0;for(int i=0;i<offset&&result<text.size();++i,++result)if(text[result]>=0xd800&&text[result]<=0xdbff&&result+1<text.size())++result;
  return result;
}
std::pair<int,int> selection(GtkTextBuffer* buffer) {
  GtkTextIter first,last;
  if(!gtk_text_buffer_get_selection_bounds(buffer,&first,&last)){gtk_text_buffer_get_iter_at_mark(buffer,&first,gtk_text_buffer_get_insert(buffer));last=first;}
  return {gtk_text_iter_get_offset(&first),gtk_text_iter_get_offset(&last)};
}
void nativeSelection(GtkRichText& state,int first,int last) {
  GtkTextIter a,b;gtk_text_buffer_get_iter_at_offset(state.buffer,&a,first);gtk_text_buffer_get_iter_at_offset(state.buffer,&b,last);
  state.selecting=true;gtk_text_buffer_select_range(state.buffer,&b,&a);state.selecting=false;state.selection={first,last};
}
int pixels(int twips) {return int(std::lround(twips/GtkTwipsPerPixel));}
std::pair<double,double> fontMetrics(GtkControl& c,const Text& family,double size,bool bold,bool italic) {
  auto* font=pango_font_description_new();pango_font_description_set_family(font,toUTF8(family).c_str());pango_font_description_set_size(font,int(size*PANGO_SCALE));pango_font_description_set_weight(font,bold?PANGO_WEIGHT_BOLD:PANGO_WEIGHT_NORMAL);pango_font_description_set_style(font,italic?PANGO_STYLE_ITALIC:PANGO_STYLE_NORMAL);
  auto* metrics=pango_context_get_metrics(gtk_widget_get_pango_context(c.widget),font,nullptr);const auto value=std::make_pair(pango_font_metrics_get_ascent(metrics)/double(PANGO_SCALE),pango_font_metrics_get_descent(metrics)/double(PANGO_SCALE));pango_font_metrics_unref(metrics);pango_font_description_free(font);return value;
}
GtkRtfStyle nativeStyle(GtkControl& c,const GtkTextIter& iter) {
  auto base=defaults(c);auto* list=gtk_text_iter_get_tags(&iter);int priority=-1;bool foreign=false;
  for(auto* item=list;item;item=item->next) {
    auto* tag=GTK_TEXT_TAG(item->data);auto* style=static_cast<GtkRtfStyle*>(g_object_get_data(G_OBJECT(tag),"vb6-rich-style"));
    if(style&&gtk_text_tag_get_priority(tag)>priority){base=*style;priority=gtk_text_tag_get_priority(tag);}
    if(!style)foreign=true;
  }
  g_slist_free(list);
  auto paragraphStyle=[&](GtkRtfStyle value) {
    // GTK paragraph layout uses the attributes at the start of the logical
    // line, even when later character tags carry different paragraph fields.
    if(!gtk_text_iter_starts_line(&iter)){auto first=iter;gtk_text_iter_set_line_offset(&first,0);value.paragraph=nativeStyle(c,first).paragraph;}
    return value;
  };
  if(!foreign)return paragraphStyle(std::move(base));
#if GTK_MAJOR_VERSION < 4
  // GTK clipboard/DND can introduce ordinary native text tags. Read their
  // effective properties so a later RTF save does not discard their formatting.
  auto* attributes=gtk_text_attributes_new();gtk_text_iter_get_attributes(&iter,attributes);
  std::unique_ptr<GtkTextAttributes,decltype(&gtk_text_attributes_unref)> owned(attributes,gtk_text_attributes_unref);
  if(attributes->font) {
    if(auto* family=pango_font_description_get_family(attributes->font))base.font=fromUTF8(family);
    auto size=pango_font_description_get_size(attributes->font);if(size>0)base.size=size*attributes->font_scale/double(PANGO_SCALE);
    base.bold=pango_font_description_get_weight(attributes->font)>=PANGO_WEIGHT_SEMIBOLD;
    base.italic=pango_font_description_get_style(attributes->font)!=PANGO_STYLE_NORMAL;
    base.smallCaps=pango_font_description_get_variant(attributes->font)==PANGO_VARIANT_SMALL_CAPS;
  }
  if(attributes->appearance.underline!=PANGO_UNDERLINE_NONE&&attributes->appearance.underline!=PANGO_UNDERLINE_SINGLE&&attributes->appearance.underline!=PANGO_UNDERLINE_DOUBLE&&attributes->appearance.underline!=PANGO_UNDERLINE_ERROR)fail(453,"Native underline style cannot be preserved as RTF");
  for(auto* color:attributes->appearance.rgba)if(color&&color->alpha!=1)fail(453,"Native translucent text colors cannot be preserved as RTF");
  base.spacing=int(std::lround(attributes->letter_spacing*GtkTwipsPerPixel/PANGO_SCALE));
  base.underline=attributes->appearance.underline==PANGO_UNDERLINE_DOUBLE?2:attributes->appearance.underline==PANGO_UNDERLINE_ERROR?3:attributes->appearance.underline!=PANGO_UNDERLINE_NONE;
  base.strike=attributes->appearance.strikethrough;base.hidden=attributes->invisible;base.protectedText=!attributes->editable;
  const auto rgb=[](GdkColor color){return int((color.red>>8)|((color.green>>8)<<8)|((color.blue>>8)<<16));};
  base.foreground=rgb(attributes->appearance.fg_color);if(attributes->appearance.draw_bg)base.background=rgb(attributes->appearance.bg_color);
  base.rise=int(std::lround(attributes->appearance.rise*GtkTwipsPerPixel/PANGO_SCALE));base.script=0;
  auto& para=base.paragraph;
  para.alignment=attributes->justification==GTK_JUSTIFY_RIGHT?1:attributes->justification==GTK_JUSTIFY_CENTER?2:attributes->justification==GTK_JUSTIFY_FILL?3:0;
  para.left=attributes->left_margin*15;para.right=attributes->right_margin*15;para.first=attributes->indent*15;
  para.before=attributes->pixels_above_lines*15;para.after=attributes->pixels_below_lines*15;para.lineExtra=attributes->pixels_inside_wrap*15;
  para.rtl=attributes->direction==GTK_TEXT_DIR_RTL;para.tabs.clear();para.tabAlignments.clear();
  if(attributes->tabs)for(int i=0;i<pango_tab_array_get_size(attributes->tabs);++i){PangoTabAlign align;int position;pango_tab_array_get_tab(attributes->tabs,i,&align,&position);if(align<PANGO_TAB_LEFT||align>PANGO_TAB_DECIMAL)fail(453,"Native rich text contains an unsupported tab alignment");para.tabs.push_back(int(std::lround(position*15.0/(pango_tab_array_get_positions_in_pixels(attributes->tabs)?1:PANGO_SCALE))));para.tabAlignments.push_back(int(align));}
#else
  // GtkTextAttributes was removed in GTK4. Fold explicitly set properties in
  // priority order, including ordinary native clipboard tags, through GObject.
  list=gtk_text_iter_get_tags(&iter);std::vector<GtkTextTag*> ordered;
  for(auto* item=list;item;item=item->next)ordered.push_back(GTK_TEXT_TAG(item->data));g_slist_free(list);
  std::sort(ordered.begin(),ordered.end(),[](auto* a,auto* b){return gtk_text_tag_get_priority(a)<gtk_text_tag_get_priority(b);});base=defaults(c);
  for(auto* value:ordered) {
    if(auto* style=static_cast<GtkRtfStyle*>(g_object_get_data(G_OBJECT(value),"vb6-rich-style"))){base=*style;continue;}
    auto set=[&](const char* name){std::string property=std::string(name)+"-set";if(!g_object_class_find_property(G_OBJECT_GET_CLASS(value),property.c_str()))return false;gboolean enabled=FALSE;g_object_get(value,property.c_str(),&enabled,nullptr);return bool(enabled);};
    auto integer=[&](const char* name){int number=0;g_object_get(value,name,&number,nullptr);return number;};
    auto flag=[&](const char* name){gboolean enabled=FALSE;g_object_get(value,name,&enabled,nullptr);return bool(enabled);};
    if(set("family")){gchar* name=nullptr;g_object_get(value,"family",&name,nullptr);if(name)base.font=fromUTF8(name);g_free(name);}
    if(set("size")){double size=0;g_object_get(value,"size-points",&size,nullptr);base.size=size;}
    if(set("scale")){double scale=1;g_object_get(value,"scale",&scale,nullptr);base.size*=scale;}
    if(set("weight"))base.bold=integer("weight")>=PANGO_WEIGHT_SEMIBOLD;
    if(set("style"))base.italic=integer("style")!=PANGO_STYLE_NORMAL;
    if(set("variant"))base.smallCaps=integer("variant")==PANGO_VARIANT_SMALL_CAPS;
    if(set("underline")){auto underline=integer("underline");if(underline!=PANGO_UNDERLINE_NONE&&underline!=PANGO_UNDERLINE_SINGLE&&underline!=PANGO_UNDERLINE_DOUBLE&&underline!=PANGO_UNDERLINE_ERROR)fail(453,"Native underline cannot be preserved as RTF");base.underline=underline==PANGO_UNDERLINE_DOUBLE?2:underline==PANGO_UNDERLINE_ERROR?3:underline!=PANGO_UNDERLINE_NONE;}
    if(set("strikethrough"))base.strike=flag("strikethrough");if(set("invisible"))base.hidden=flag("invisible");if(set("editable"))base.protectedText=!flag("editable");
    for(auto name:{"foreground","background"})if(set(name)){GdkRGBA* color=nullptr;g_object_get(value,(std::string(name)+"-rgba").c_str(),&color,nullptr);if(color){auto copy=*color;gdk_rgba_free(color);if(copy.alpha!=1)fail(453,"Native translucent text colors cannot be preserved as RTF");(name[0]=='f'?base.foreground:base.background)=gtkColorValue(copy);}}
    if(set("rise")){base.rise=int(std::lround(integer("rise")*15.0/PANGO_SCALE));base.script=0;}
    if(set("letter-spacing"))base.spacing=int(std::lround(integer("letter-spacing")*15.0/PANGO_SCALE));
    auto& para=base.paragraph;
    if(set("justification")){auto align=integer("justification");para.alignment=align==GTK_JUSTIFY_RIGHT?1:align==GTK_JUSTIFY_CENTER?2:align==GTK_JUSTIFY_FILL?3:0;}
    if(set("left-margin"))para.left=integer("left-margin")*15;if(set("right-margin"))para.right=integer("right-margin")*15;if(set("indent"))para.first=integer("indent")*15;
    if(set("pixels-above-lines"))para.before=integer("pixels-above-lines")*15;if(set("pixels-below-lines"))para.after=integer("pixels-below-lines")*15;if(set("pixels-inside-wrap"))para.lineExtra=integer("pixels-inside-wrap")*15;
    if(set("line-height")){float scale=0;g_object_get(value,"line-height",&scale,nullptr);para.lineSpacing=int(std::lround(scale*240));para.lineMultiple=1;}
    if(set("tabs")){PangoTabArray* tabs=nullptr;g_object_get(value,"tabs",&tabs,nullptr);para.tabs.clear();para.tabAlignments.clear();if(tabs){for(int i=0;i<pango_tab_array_get_size(tabs);++i){PangoTabAlign align;int position;pango_tab_array_get_tab(tabs,i,&align,&position);para.tabs.push_back(int(std::lround(position*15.0/(pango_tab_array_get_positions_in_pixels(tabs)?1:PANGO_SCALE))));para.tabAlignments.push_back(int(align));}pango_tab_array_free(tabs);}}
  }
#endif
  return paragraphStyle(std::move(base));
}
GtkRtfStyle insertionStyle(GtkControl& c,int offset) {
  auto& state=rich(c);int length=gtk_text_buffer_get_char_count(state.buffer);
  if(!length)return state.typing;
  if(offset==length&&offset>0) {
    GtkTextIter previous;gtk_text_buffer_get_iter_at_offset(state.buffer,&previous,offset-1);
    auto ch=gtk_text_iter_get_char(&previous);if(ch=='\n'||ch=='\r'||ch==0x2029)return state.trailing;
  }
  GtkTextIter iter;gtk_text_buffer_get_iter_at_offset(state.buffer,&iter,offset==length?offset-1:offset);
  return nativeStyle(c,iter);
}
void validateStyle(const GtkRtfStyle& style) {
  gtkRtfValidateText(style.font);
  if(style.font.empty()||style.font.size()>255||style.font.find_first_of(u"\r\n;\t")!=Text::npos)fail(380,"Invalid rich text font family");
  if(!std::isfinite(style.size)||style.size<=0||style.size>3072)fail(380,"Invalid rich text font size");
  const auto& para=style.paragraph;
  gtkRtfValidateText(para.markerFont);if(para.markerFont.size()>255||para.markerFont.find_first_of(u";\r\n\t")!=Text::npos||!std::isfinite(para.markerSize)||para.markerSize<0||para.markerSize>3072||para.markerBold< -1||para.markerBold>1||para.markerItalic< -1||para.markerItalic>1||para.markerAlignment<0||para.markerAlignment>2||para.markerColor< -2||para.markerColor>0xffffff)fail(380,"Invalid rich list marker formatting");
  for(const auto& value:{para.numberBefore,para.numberAfter,para.marker}){gtkRtfValidateText(value);if(value.size()>64||value.find_first_of(u"\r\n\t")!=Text::npos)fail(380,"Invalid rich list marker text");}
  if(para.alignment<0||para.alignment>3||para.left<0||para.right<0||para.left>31680||para.right>31680||std::abs(para.first)>31680||para.before<0||para.after<0||para.before>31680||para.after>31680)fail(380,"Invalid rich paragraph geometry");
  if(para.lineExtra)fail(453,"Non-default native rich line spacing cannot be represented losslessly as RTF");
  if(std::abs(int64_t(para.lineSpacing))>31680||para.lineMultiple<0||para.lineMultiple>1||(para.lineMultiple&&para.lineSpacing<0))fail(380,"Invalid rich line spacing");
  if(para.defaultTab<1||para.defaultTab>31680||para.tabAlignments.size()>para.tabs.size())fail(380,"Invalid rich tab geometry");
  for(auto alignment:para.tabAlignments)if(alignment<0||alignment>3)fail(380,"Invalid rich tab alignment");
  if(para.tabs.size()>64)fail(7,"Rich paragraph exceeds 64 tab stops");
  int previous=-1;for(int tab:para.tabs){if(tab<0||tab>31680||tab<=previous)fail(380,"Rich tab stops must be increasing and between 0 and 31680 twips");previous=tab;}
}
GtkTextTag* tag(GtkControl& c,GtkRichText& state,const GtkRtfStyle& style) {
  auto found=state.tags.find(style);if(found!=state.tags.end())return found->second;
  validateStyle(style);if(state.tags.size()>=GtkRtfMaxRuns)fail(7,"Rich formatting tag limit exceeded");
  auto* value=gtk_text_buffer_create_tag(state.buffer,nullptr,nullptr);
  auto fore=gtkColor(style.foreground<0?int64_t(c.number("forecolor",0)):style.foreground);
  auto back=gtkColor(style.background<0?int64_t(c.number("backcolor",0xffffff)):style.background);
  const auto& para=style.paragraph;
  int left=para.left,right=para.right,indent=para.first;
  if(para.bullet||para.numbering||!para.marker.empty()){(para.rtl?right:left)=std::max(360,para.rtl?right:left);indent=0;}
  auto underline=style.underline==2?PANGO_UNDERLINE_DOUBLE:style.underline==3?PANGO_UNDERLINE_ERROR:style.underline?PANGO_UNDERLINE_SINGLE:PANGO_UNDERLINE_NONE;
  const auto rise=int(std::lround((style.rise/15.0+style.script*style.size*4.0/9)*PANGO_SCALE));
  g_object_set(value,"family",toUTF8(style.font).c_str(),"size-points",style.size,"weight",style.bold?PANGO_WEIGHT_BOLD:PANGO_WEIGHT_NORMAL,
    "style",style.italic?PANGO_STYLE_ITALIC:PANGO_STYLE_NORMAL,"variant",style.smallCaps?PANGO_VARIANT_SMALL_CAPS:PANGO_VARIANT_NORMAL,
    "underline",underline,"strikethrough",gboolean(style.strike),"foreground-rgba",&fore,"background-rgba",&back,
    "invisible",gboolean(style.hidden),"editable",gboolean(!style.protectedText),"rise",rise,"scale",style.script?0.7:1.0,
    "letter-spacing",int(std::lround(style.spacing/15.0*PANGO_SCALE)),"left-margin",pixels(left),"right-margin",pixels(right),"indent",pixels(indent),
    "pixels-above-lines",pixels(para.before),"pixels-below-lines",pixels(para.after),"pixels-inside-wrap",0,
    "justification",para.alignment==1?GTK_JUSTIFY_RIGHT:para.alignment==2?GTK_JUSTIFY_CENTER:para.alignment==3?GTK_JUSTIFY_FILL:GTK_JUSTIFY_LEFT,
    "direction",para.rtl?GTK_TEXT_DIR_RTL:GTK_TEXT_DIR_LTR,nullptr);
  const bool hasMarker=para.bullet||para.numbering||!para.marker.empty();
  if(para.lineSpacing||hasMarker) {
    const auto metrics=fontMetrics(c,style.font,style.size,style.bold,style.italic);const double natural=metrics.first+metrics.second;
    double markerHeight=natural;if(hasMarker){const auto marker=fontMetrics(c,para.markerFont.empty()?style.font:para.markerFont,para.markerSize?para.markerSize:style.size,para.markerBold<0?style.bold:bool(para.markerBold),para.markerItalic<0?style.italic:bool(para.markerItalic));markerHeight=std::max(natural,marker.first+marker.second);}
    if(!para.lineSpacing){g_object_set(value,"pixels-above-lines",pixels(para.before)+int(std::ceil(markerHeight-natural)),nullptr);}
    else {
    const double requested=para.lineMultiple?markerHeight*para.lineSpacing/240.0:para.lineSpacing>0?std::max(markerHeight,para.lineSpacing/15.0):-para.lineSpacing/15.0;
#if GTK_MAJOR_VERSION >= 4
    g_object_set(value,"line-height",float(requested/std::max(1.0,natural)),nullptr);
#else
    if(requested+0.01<markerHeight)fail(453,"Compressed or exact small line heights require the GTK4 RichTextBox backend");
    const int extra=int(std::lround(requested-natural));g_object_set(value,"pixels-inside-wrap",extra,"pixels-above-lines",pixels(para.before)+extra/2,"pixels-below-lines",pixels(para.after)+extra-extra/2,nullptr);
#endif
    }
  }
  auto count=para.tabs.empty()?64:int(para.tabs.size());auto* tabs=pango_tab_array_new(count,TRUE);
  for(int i=0;i<count;++i){auto alignment=size_t(i)<para.tabAlignments.size()?para.tabAlignments[size_t(i)]:0;pango_tab_array_set_tab(tabs,i,PangoTabAlign(alignment),pixels(para.tabs.empty()?(i+1)*para.defaultTab:para.tabs[size_t(i)]));if(alignment==3)pango_tab_array_set_decimal_point(tabs,i,'.');}
  g_object_set(value,"tabs",tabs,nullptr);pango_tab_array_free(tabs);
  g_object_set_data_full(G_OBJECT(value),"vb6-rich-style",new GtkRtfStyle(style),+[](gpointer data){delete static_cast<GtkRtfStyle*>(data);});
  state.tags.emplace(style,value);return value;
}
void apply(GtkControl& c,GtkRichText& state,int first,int last,const GtkRtfStyle& style) {
  if(first==last)return;
  auto* value=tag(c,state,style);GtkTextIter a,b;gtk_text_buffer_get_iter_at_offset(state.buffer,&a,first);gtk_text_buffer_get_iter_at_offset(state.buffer,&b,last);
  gtk_text_buffer_remove_all_tags(state.buffer,&a,&b);gtk_text_buffer_apply_tag(state.buffer,value,&a,&b);
}
void emitChange(GtkControl& c) {
  auto state=c.richText;if(!state||state->operationDepth||state->userActionDepth||!state->dirty)return;
  state->dirty=false;c.properties["text"]=Value::string(c.editText());
  if(auto parent=state->parent.lock()){if(parent->richText){parent->richText->dirty=true;gtk_text_buffer_set_modified(parent->richText->buffer,TRUE);emitChange(*parent);}return;}
  if(!c.suppressEvents)c.event("change");
}
void signal(GtkTextBuffer* buffer,const char* name,GCallback callback,const std::shared_ptr<GtkControl>& c,bool after=false) {
  g_signal_connect_data(buffer,name,callback,new std::weak_ptr<GtkControl>(c),+[](gpointer data,GClosure*){delete static_cast<std::weak_ptr<GtkControl>*>(data);},after?G_CONNECT_AFTER:GConnectFlags(0));
}
size_t documentTextUnits(GtkControl& control) {
  auto& state=rich(control);size_t total=control.editText().size();
  for(const auto& object:state.objects)if(liveObject(state,object))for(const auto& child:object.presentation->children){const auto count=documentTextUnits(*child);if(count>GtkRtfMaxText-total)fail(7,"Nested RichTextBox text exceeds 4 Mi UTF-16 units");total+=count;}
  return total;
}
void connect(GtkControl& c,GtkRichText& state) {
  signal(state.buffer,"begin-user-action",G_CALLBACK(+[](GtkTextBuffer* buffer,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& rich=::vb6::rich(owner);if(rich.buffer==buffer)++rich.userActionDepth;});}),c.self());
  signal(state.buffer,"end-user-action",G_CALLBACK(+[](GtkTextBuffer* buffer,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& rich=::vb6::rich(owner);if(rich.buffer!=buffer)return;if(rich.userActionDepth)--rich.userActionDepth;emitChange(owner);});}),c.self(),true);
  signal(state.buffer,"insert-text",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter* iter,gchar* input,gint bytes,gpointer data){
    gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer!=buffer)return;
      try {
        auto offset=gtk_text_iter_get_offset(iter);for(const auto& object:state.objects){GtkTextIter start;if(!liveObject(state,object,&start))continue;auto first=gtk_text_iter_get_offset(&start),last=first+int(object.value.last-object.value.first);if(offset>first&&offset<last){gtk_text_buffer_get_iter_at_offset(buffer,iter,last);break;}}
        auto text=fromUTF8(std::string(input,bytes<0?std::strlen(input):size_t(bytes)));gtkRtfValidateText(text);
        for(const auto& object:state.objects)if(object.value.kind==GtkRtfObject::TableRow){GtkTextIter start;if(!liveObject(state,object,&start)||gtk_text_iter_get_offset(iter)!=gtk_text_iter_get_offset(&start)||text.empty()||gtkRtfParagraphEnd(text,text.size()-1))continue;auto first=gtk_text_iter_get_offset(&start);if(!first)fail(380,"Insert a paragraph break before typing before a table");gtk_text_buffer_get_iter_at_offset(buffer,iter,first-1);break;}
        auto previous=owner.editText();auto maximum=owner.number("maxlength");
        if(text.size()>GtkRtfMaxText-previous.size())fail(7,"RichTextBox text exceeds 4 Mi UTF-16 units");
        if(!state.objects.empty()||!state.parent.expired()){auto root=owner.self();while(auto parent=root->richText->parent.lock())root=std::move(parent);if(text.size()>GtkRtfMaxText-documentTextUnits(*root))fail(7,"Nested RichTextBox text exceeds 4 Mi UTF-16 units");}
        if(maximum>0&&text.size()>size_t(maximum)-std::min(size_t(maximum),previous.size())){g_signal_stop_emission_by_name(buffer,"insert-text");return;}
        auto first=gtk_text_iter_get_offset(iter);auto style=state.typingOverride&&first==state.selection.first?state.typing:insertionStyle(owner,first);
        tag(owner,state,style);state.insertions.push_back({first,int(g_utf8_strlen(input,bytes)),style});++state.operationDepth;
      }catch(...){g_signal_stop_emission_by_name(buffer,"insert-text");throw;}
    });
  }),c.self());
  signal(state.buffer,"insert-text",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,gchar*,gint,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer!=buffer||state.insertions.empty())return;auto insertion=state.insertions.back();state.insertions.pop_back();
    apply(owner,state,insertion.first,insertion.first+insertion.count,insertion.style);state.typing=insertion.style;state.trailing=insertion.style;
    state.selection=selection(buffer);state.typingOverride=true;if(state.operationDepth)--state.operationDepth;emitChange(owner);
  });}),c.self(),true);
  signal(state.buffer,"delete-range",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter* first,GtkTextIter* last,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer!=buffer)return;
    int a=gtk_text_iter_get_offset(first),b=gtk_text_iter_get_offset(last);for(const auto& object:state.objects){GtkTextIter start;if(!liveObject(state,object,&start))continue;auto x=gtk_text_iter_get_offset(&start),y=x+int(object.value.last-object.value.first);if(a<y&&b>x){a=std::min(a,x);b=std::max(b,y);}}
    for(const auto& object:state.objects)if(object.value.kind==GtkRtfObject::TableRow&&a>0){GtkTextIter start;if(!liveObject(state,object,&start)||b!=gtk_text_iter_get_offset(&start))continue;auto previous=*first;gtk_text_buffer_get_iter_at_offset(buffer,&previous,a-1);auto ch=gtk_text_iter_get_char(&previous);if(ch!='\n'&&ch!='\r'&&ch!=0x2029){g_signal_stop_emission_by_name(buffer,"delete-range");return;}}
    gtk_text_buffer_get_iter_at_offset(buffer,first,a);gtk_text_buffer_get_iter_at_offset(buffer,last,b);++state.operationDepth;
  });}),c.self());
  signal(state.buffer,"delete-range",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,GtkTextIter*,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer!=buffer)return;state.objects.erase(std::remove_if(state.objects.begin(),state.objects.end(),[&](const auto& object){return !liveObject(state,object);}),state.objects.end());if(state.operationDepth)--state.operationDepth;state.typingOverride=false;gtkRichSelectionChanged(owner,false);emitChange(owner);});}),c.self(),true);
  signal(state.buffer,"changed",G_CALLBACK(+[](GtkTextBuffer* buffer,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer==buffer){state.dirty=true;emitChange(owner);}});}),c.self());
  signal(state.buffer,"mark-set",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,GtkTextMark* mark,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer!=buffer||state.selecting||state.operationDepth||owner.suppressEvents)return;
    if(mark!=gtk_text_buffer_get_insert(buffer)&&mark!=gtk_text_buffer_get_selection_bound(buffer))return;
    if(!state.selectionIdle)state.selectionIdle=g_idle_add_full(G_PRIORITY_DEFAULT_IDLE,+[](gpointer payload)->gboolean {gtkEvent(payload,[](GtkControl& control){auto state=control.richText;if(state){state->selectionIdle=0;gtkRichSelectionChanged(control);}});return G_SOURCE_REMOVE;},new std::weak_ptr<GtkControl>(owner.self()),+[](gpointer payload){delete static_cast<std::weak_ptr<GtkControl>*>(payload);});
  });}),c.self(),true);
#if GTK_MAJOR_VERSION < 4
  signal(state.buffer,"insert-pixbuf",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,GdkPixbuf*,gpointer data){g_signal_stop_emission_by_name(buffer,"insert-pixbuf");gtkEvent(data,[](GtkControl&){fail(453,"RichTextBox embedded images require an unsupported RTF picture destination");});}),c.self());
#else
  signal(state.buffer,"insert-paintable",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,GdkPaintable*,gpointer data){g_signal_stop_emission_by_name(buffer,"insert-paintable");gtkEvent(data,[](GtkControl&){fail(453,"RichTextBox embedded images require an unsupported RTF picture destination");});}),c.self());
#endif
  signal(state.buffer,"insert-child-anchor",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,GtkTextChildAnchor*,gpointer data){g_signal_stop_emission_by_name(buffer,"insert-child-anchor");gtkEvent(data,[](GtkControl&){fail(453,"RichTextBox embedded objects are unavailable");});}),c.self());
}
std::shared_ptr<GtkRichText> prepare(GtkControl&,const GtkRtfDocument&);
void attachObjects(GtkControl&);
void attachRichDrawing(GtkControl& c) {
  g_object_set_data_full(G_OBJECT(c.widget),"vb6-control",new std::weak_ptr<GtkControl>(c.self()),+[](gpointer data){delete static_cast<std::weak_ptr<GtkControl>*>(data);});
#if GTK_MAJOR_VERSION < 4
  g_signal_connect_data(c.widget,"draw",G_CALLBACK(+[](GtkWidget*,cairo_t* context,gpointer data)->gboolean {gtkEvent(data,[&](GtkControl& owner){gtkRichDraw(owner,context);});return FALSE;}),new std::weak_ptr<GtkControl>(c.self()),+[](gpointer data,GClosure*){delete static_cast<std::weak_ptr<GtkControl>*>(data);},G_CONNECT_AFTER);
#endif
}
GdkPixbuf* picturePixels(const GtkRtfObject& object) {
  std::string bytes=object.bytes;const char* format=object.format=="pngblip"?"png":object.format=="jpegblip"?"jpeg":"bmp";
  if(object.format=="dibitmap") {
    auto u32=[&](size_t at){if(at+4>bytes.size())fail(380,"Invalid RTF DIB header");uint32_t value=0;for(size_t i=0;i<4;++i)value|=uint32_t(uint8_t(bytes[at+i]))<<(i*8);return value;};
    const auto header=u32(0),colors=u32(32),compression=u32(16);auto bits=uint8_t(bytes[14])|(uint8_t(bytes[15])<<8);uint64_t offset=14+uint64_t(header)+(colors?colors:bits<=8?1u<<bits:0)*4u+(header==40&&compression==3?12:0);
    if(offset>bytes.size()+14)fail(380,"Invalid RTF DIB color table");std::string file(14,'\0');file[0]='B';file[1]='M';auto write=[&](size_t at,uint32_t value){for(size_t i=0;i<4;++i)file[at+i]=char(value>>(8*i));};write(2,uint32_t(bytes.size()+14));write(10,uint32_t(offset));bytes=file+bytes;
  }
  GError* error=nullptr;auto* loader=gdk_pixbuf_loader_new_with_type(format,&error);
  if(!loader){std::string detail=error?error->message:"Native image codec unavailable";if(error)g_error_free(error);fail(453,detail);}
  std::unique_ptr<GdkPixbufLoader,decltype(&g_object_unref)> owned(loader,g_object_unref);
  struct Dimensions {int width,height;bool invalid=false;} dimensions{object.width,object.height,false};
  g_signal_connect(loader,"size-prepared",G_CALLBACK(+[](GdkPixbufLoader* decoder,int width,int height,gpointer value){auto& expected=*static_cast<Dimensions*>(value);if(width!=expected.width||height!=expected.height||width<=0||height<=0||width>8192||height>8192||uint64_t(width)*height>GtkRtfMaxImagePixels){expected.invalid=true;gdk_pixbuf_loader_set_size(decoder,1,1);}}),&dimensions);
  bool valid=gdk_pixbuf_loader_write(loader,reinterpret_cast<const guchar*>(bytes.data()),bytes.size(),&error);
  if(valid)valid=gdk_pixbuf_loader_close(loader,&error);else gdk_pixbuf_loader_close(loader,nullptr);
  if(!valid||dimensions.invalid){std::string detail=error?error->message:"RTF image dimensions changed during decode";if(error)g_error_free(error);fail(dimensions.invalid?7:380,"Invalid RTF image: "+detail);}
  auto* source=gdk_pixbuf_loader_get_pixbuf(loader);if(!source)fail(380,"RTF picture has no pixels");
  const double factorX=object.scaleX/1500.0,factorY=object.scaleY/1500.0;
  const auto width=std::max(1,int(std::lround((object.widthGoal-object.cropLeft-object.cropRight)*factorX))),height=std::max(1,int(std::lround((object.heightGoal-object.cropTop-object.cropBottom)*factorY)));
  if(width>8192||height>8192||uint64_t(width)*height>GtkRtfMaxImagePixels)fail(7,"RTF scaled image exceeds pixel limits");
  if(width==object.width&&height==object.height&&!object.cropLeft&&!object.cropRight&&!object.cropTop&&!object.cropBottom)return GDK_PIXBUF(g_object_ref(source));
  auto* target=gdk_pixbuf_new(GDK_COLORSPACE_RGB,TRUE,8,width,height);if(!target)fail(7,"Cannot allocate RTF picture");gdk_pixbuf_fill(target,0);
  const auto offsetX=-object.cropLeft*factorX,offsetY=-object.cropTop*factorY;
  const auto firstX=std::clamp(int(std::floor(offsetX)),0,width),firstY=std::clamp(int(std::floor(offsetY)),0,height);
  const auto lastX=std::clamp(int(std::ceil(offsetX+object.widthGoal*factorX)),0,width),lastY=std::clamp(int(std::ceil(offsetY+object.heightGoal*factorY)),0,height);
  if(lastX>firstX&&lastY>firstY)gdk_pixbuf_scale(source,target,firstX,firstY,lastX-firstX,lastY-firstY,offsetX,offsetY,object.widthGoal*factorX/object.width,object.heightGoal*factorY/object.height,GDK_INTERP_BILINEAR);return target;
}
std::shared_ptr<GtkControl> childEditor(GtkControl& parent,const GtkRtfDocument& document,int background=-1) {
  ControlSpec spec;spec.name="_rtf_content";spec.type="RichTextBox";auto child=std::make_shared<GtkControl>(*parent.host,parent.owner.lock(),std::move(spec));
  for(const auto& name:{"fontname","fontsize","fontbold","fontitalic","forecolor","backcolor"})if(parent.properties.count(name))child->properties[name]=parent.properties.at(name);
  if(background>=0)child->properties["backcolor"]=Value::integer(background);
  child->widget=child->content=child->view=gtkNativeTextViewNew();g_object_ref_sink(child->view);
  gtk_text_view_set_wrap_mode(GTK_TEXT_VIEW(child->widget),GTK_WRAP_WORD_CHAR);gtk_text_view_set_editable(GTK_TEXT_VIEW(child->widget),gtk_text_view_get_editable(GTK_TEXT_VIEW(parent.widget)));
  child->richText=prepare(*child,document);child->richText->parent=parent.self();gtk_text_view_set_buffer(GTK_TEXT_VIEW(child->widget),child->richText->buffer);attachRichDrawing(*child);
  attachObjects(*child);
  if(background>=0){auto color=gtkColor(background);gtk_widget_override_background_color(child->widget,GTK_STATE_FLAG_NORMAL,&color);}
  return child;
}
std::shared_ptr<GtkRichText::Presentation> presentation(GtkControl& c,const GtkRtfObject& object) {
  auto result=std::make_shared<GtkRichText::Presentation>();
  if(object.kind==GtkRtfObject::Picture){result->image=picturePixels(object);return result;}
  auto* container=object.kind==GtkRtfObject::TableRow?gtk_grid_new():gtk_box_new(GTK_ORIENTATION_VERTICAL,3);result->widget=GTK_WIDGET(g_object_ref_sink(container));
  if(object.kind==GtkRtfObject::TableRow) {
    int left=object.left;
    for(size_t i=0;i<object.cells.size();++i){const auto& cell=object.cells[i];if(cell.merge==2){left=cell.right;continue;}auto end=i+1;while(end<object.cells.size()&&object.cells[end].merge==2)++end;
      auto child=childEditor(c,*cell.content,cell.background);auto* box=gtk_box_new(GTK_ORIENTATION_VERTICAL,0);gtk_container_add(GTK_CONTAINER(box),child->view);
      gtk_widget_set_size_request(box,std::max(1,pixels(object.cells[end-1].right-left)),std::max(-1,pixels(std::abs(object.height))));gtk_widget_set_hexpand(child->view,TRUE);gtk_widget_set_vexpand(child->view,TRUE);
      gtk_widget_set_valign(child->view,cell.vertical==1?GTK_ALIGN_CENTER:cell.vertical==2?GTK_ALIGN_END:GTK_ALIGN_FILL);
      gtk_grid_attach(GTK_GRID(container),box,int(i),0,int(end-i),1);result->children.push_back(std::move(child));
      auto* provider=gtk_css_provider_new();std::string css="* { padding: "+std::to_string(pixels(object.gap))+"px;";static const char* sides[]={"top","right","bottom","left"};static const char* styles[]={"none","solid","double","dashed","dotted"};
      for(size_t edge=0;edge<4;++edge){const auto& border=edge==1?object.cells[end-1].borders[edge]:cell.borders[edge];auto color=gtkColor(border.color<0?int64_t(c.number("forecolor",0)):border.color);auto* encoded=gdk_rgba_to_string(&color);css+="border-"+std::string(sides[edge])+": "+std::to_string(border.style?std::max(1,pixels(border.width)):0)+"px "+styles[border.style]+" "+encoded+";";g_free(encoded);}
      if(cell.background>=0){auto color=gtkColor(cell.background);auto* encoded=gdk_rgba_to_string(&color);css+="background-color: "+std::string(encoded)+";";g_free(encoded);}css+='}';
#if GTK_MAJOR_VERSION < 4
      gtk_css_provider_load_from_data(provider,css.c_str(),-1,nullptr);
#else
      gtk_css_provider_load_from_data(provider,css.c_str(),-1);
#endif
      gtk_style_context_add_provider(gtk_widget_get_style_context(box),GTK_STYLE_PROVIDER(provider),GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);g_object_unref(provider);left=cell.right;
    }
    gtk_widget_set_margin_start(container,pixels(std::max(0,object.left)));gtk_widget_set_halign(container,object.alignment==1?GTK_ALIGN_END:object.alignment==2?GTK_ALIGN_CENTER:GTK_ALIGN_START);
  }else {
    const auto label=object.kind==GtkRtfObject::Embedded?(object.label.empty()?std::string("Embedded object preview"):toUTF8(object.label)+" — preview"):object.destination.rfind("header",0)==0?std::string("Header"):object.destination.rfind("footer",0)==0?std::string("Footer"):object.destination=="annotation"?std::string("Comment"):object.destination=="endnote"?std::string("Endnote"):std::string("Footnote");
    auto* title=gtk_label_new(label.c_str());gtk_label_set_xalign(GTK_LABEL(title),0);gtk_container_add(GTK_CONTAINER(container),title);auto child=childEditor(c,*object.content);gtk_container_add(GTK_CONTAINER(container),child->view);gtk_widget_set_hexpand(child->view,TRUE);result->children.push_back(std::move(child));
    gtk_widget_set_size_request(container,std::max(120,pixels(object.widthGoal?object.widthGoal:int(c.number("width",4500)))-30),-1);
  }
  gtk_widget_show_all(container);return result;
}
void attachObjects(GtkControl& c) {
  for(auto& object:rich(c).objects)if(object.anchor&&object.presentation->widget)gtk_text_view_add_child_at_anchor(GTK_TEXT_VIEW(c.widget),object.presentation->widget,object.anchor);
}
std::shared_ptr<GtkRichText> prepare(GtkControl& c,const GtkRtfDocument& document) {
  gtkRtfValidateText(document.text);gtkRtfValidateObjects(document);validateStyle(document.emptyStyle);
  auto result=std::make_shared<GtkRichText>();result->buffer=gtk_text_buffer_new(nullptr);result->metadata=document.metadata;result->typing=result->trailing=document.emptyStyle;
  auto utf8=toUTF8(document.text);gtk_text_buffer_set_text(result->buffer,utf8.data(),int(utf8.size()));
  for(const auto& object:document.objects) {
    auto native=presentation(c,object);GtkTextIter first,last;auto offset=scalarOffset(document.text,object.first);gtk_text_buffer_get_iter_at_offset(result->buffer,&first,offset);last=first;gtk_text_iter_forward_char(&last);gtk_text_buffer_delete(result->buffer,&first,&last);GtkTextChildAnchor* anchor=nullptr;
    if(object.kind==GtkRtfObject::Picture) {
#if GTK_MAJOR_VERSION < 4
      gtk_text_buffer_insert_pixbuf(result->buffer,&first,native->image);
#else
      native->paintable=G_OBJECT(gdk_texture_new_for_pixbuf(native->image));gtk_text_buffer_insert_paintable(result->buffer,&first,GDK_PAINTABLE(native->paintable));
#endif
    }else {anchor=gtk_text_buffer_create_child_anchor(result->buffer,&first);native->anchor=GTK_TEXT_CHILD_ANCHOR(g_object_ref(anchor));}
    gtk_text_buffer_get_iter_at_offset(result->buffer,&first,offset);auto* mark=gtk_text_buffer_create_mark(result->buffer,nullptr,&first,FALSE);native->mark=GTK_TEXT_MARK(g_object_ref(mark));result->objects.push_back({mark,anchor,object,std::move(native)});
  }
  size_t previous=0;int scalar=0;
  for(const auto& run:document.runs) {
    if(run.first!=previous||run.last<=run.first||run.last>document.text.size())fail(380,"Invalid rich formatting ranges");
    int count=scalarOffset(document.text.substr(run.first,run.last-run.first),run.last-run.first);apply(c,*result,scalar,scalar+count,run.style);scalar+=count;previous=run.last;
  }
  if(previous!=document.text.size())fail(380,"Rich text lacks attributed runs");
  for(const auto& object:document.objects)if(object.kind==GtkRtfObject::TableRow&&object.alignment) {
    auto run=std::find_if(document.runs.begin(),document.runs.end(),[&](const auto& value){return value.first<=object.first&&object.first<value.last;});
    if(run==document.runs.end())fail(380,"Table row lacks formatting");
    auto* alignment=gtk_text_buffer_create_tag(result->buffer,nullptr,"justification",object.alignment==1?GTK_JUSTIFY_RIGHT:GTK_JUSTIFY_CENTER,nullptr);
    g_object_set_data_full(G_OBJECT(alignment),"vb6-rich-style",new GtkRtfStyle(run->style),+[](gpointer data){delete static_cast<GtkRtfStyle*>(data);});
    GtkTextIter first,last;gtk_text_buffer_get_iter_at_offset(result->buffer,&first,scalarOffset(document.text,object.first));gtk_text_buffer_get_iter_at_offset(result->buffer,&last,scalarOffset(document.text,object.last));gtk_text_buffer_apply_tag(result->buffer,alignment,&first,&last);
  }
  for(const auto& field:document.fields){if(field.first>field.last||field.last>document.text.size())fail(380,"Invalid rich field range");GtkTextIter a,b;gtk_text_buffer_get_iter_at_offset(result->buffer,&a,scalarOffset(document.text,field.first));gtk_text_buffer_get_iter_at_offset(result->buffer,&b,scalarOffset(document.text,field.last));result->fields.push_back({GTK_TEXT_MARK(g_object_ref(gtk_text_buffer_create_mark(result->buffer,nullptr,&a,TRUE))),GTK_TEXT_MARK(g_object_ref(gtk_text_buffer_create_mark(result->buffer,nullptr,&b,FALSE))),field});}
  // Register GTK's structured format as well as plain text for native copy/paste.
#if GTK_MAJOR_VERSION < 4
  gtk_text_buffer_register_serialize_tagset(result->buffer,nullptr);gtk_text_buffer_register_deserialize_tagset(result->buffer,nullptr);
#endif
  connect(c,*result);return result;
}
bool equal(const GtkRtfDocument& a,const GtkRtfDocument& b) {
  if(a.text!=b.text||a.metadata!=b.metadata||a.emptyStyle!=b.emptyStyle||a.fields!=b.fields||a.objects.size()!=b.objects.size())return false;
  if(!a.objects.empty()&&gtkRtfWrite(a)!=gtkRtfWrite(b))return false;
  size_t i=0,j=0;
  while(i<a.runs.size()&&j<b.runs.size()) {
    if(a.runs[i].style!=b.runs[j].style)return false;
    auto end=std::min(a.runs[i].last,b.runs[j].last);if(end==a.runs[i].last)++i;if(end==b.runs[j].last)++j;
  }
  return i==a.runs.size()&&j==b.runs.size();
}
void commit(GtkControl& c,const GtkRtfDocument& document,size_t start,size_t length,bool changed,bool fire=true) {
  auto prepared=prepare(c,document); // All parsing, validation, allocation and tag
  // construction finish before replacing the buffer displayed by the control.
  auto previous=c.richText;
  prepared->parent=previous->parent;
  {
    GtkEventSuppression suppression(c);
    auto* view=GTK_TEXT_VIEW(c.widget);auto wrap=gtk_text_view_get_wrap_mode(view);
    // GTK 3.24 can retain one_display_cache for an unvalidated old line during
    // set_buffer; a subsequent collapsed selection then walks that stale line.
    // Invalidate the old layout through public APIs before the atomic swap.
    // No event loop or VB handler runs between these two wrap-mode updates.
    gtk_text_view_set_wrap_mode(view,wrap==GTK_WRAP_NONE?GTK_WRAP_WORD_CHAR:GTK_WRAP_NONE);
    gtk_text_view_set_wrap_mode(view,wrap);
    c.richText=prepared;gtk_text_view_set_buffer(view,prepared->buffer);
    attachObjects(c);
    nativeSelection(*prepared,scalarOffset(document.text,start),scalarOffset(document.text,start+length));
    prepared->typing=insertionStyle(c,prepared->selection.first);prepared->typingOverride=false;
    c.properties["text"]=Value::string(document.text);gtk_text_buffer_set_modified(prepared->buffer,changed||gtk_text_buffer_get_modified(previous->buffer));
  }
  if(changed&&fire)c.event("change");
}
GtkRtfDocument slice(const GtkRtfDocument& document,size_t first,size_t last) {
  GtkRtfDocument result;result.emptyStyle=document.emptyStyle;
  for(const auto& run:document.runs)if(run.last>first&&run.first<last) {
    auto start=std::max(run.first,first),end=std::min(run.last,last);gtkRtfAppend(result,document.text.substr(start,end-start),run.style);
  }
  if(last==document.text.size()&&(!last||gtkRtfParagraphEnd(document.text,last-1)))result.emptyStyle=document.emptyStyle;
  for(auto field:document.fields)if(field.first>=first&&field.last<=last){field.first-=first;field.last-=first;result.fields.push_back(std::move(field));}
  for(auto object:document.objects)if(object.first<last&&object.last>first){if(object.first<first||object.last>last)fail(380,"A rich embedded object must be selected as a complete object");object.first-=first;object.last-=first;result.objects.push_back(std::move(object));}
  return result;
}
void appendDocument(GtkRtfDocument& destination,const GtkRtfDocument& source) {
  const auto offset=destination.text.size();for(auto field:source.fields){field.first+=offset;field.last+=offset;destination.fields.push_back(std::move(field));}
  for(auto object:source.objects){object.first+=offset;object.last+=offset;destination.objects.push_back(std::move(object));}
  for(const auto& run:source.runs)gtkRtfAppend(destination,source.text.substr(run.first,run.last-run.first),run.style);
  destination.emptyStyle=source.emptyStyle;
}
GtkRtfDocument normalizeParagraphs(const GtkRtfDocument& source) {
  GtkRtfDocument result;result.metadata=source.metadata;result.fields=source.fields;result.objects=source.objects;auto paragraph=source.emptyStyle.paragraph;bool first=true;
  for(const auto& run:source.runs)for(auto at=run.first;at<run.last;) {
    auto style=run.style;if(first)paragraph=style.paragraph;style.paragraph=paragraph;
    auto end=at;do {++end;}while(end<run.last&&!gtkRtfParagraphEnd(source.text,end-1));
    gtkRtfAppend(result,source.text.substr(at,end-at),style);first=gtkRtfParagraphEnd(source.text,end-1);at=end;
  }
  result.emptyStyle=source.emptyStyle;if(!first)result.emptyStyle.paragraph=paragraph;return result;
}
void replace(GtkControl& c,GtkRtfDocument replacement,bool whole,bool fire=true) {
  auto original=gtkRichSnapshot(c);auto range=c.editSelection();size_t first=whole?0:range.first,last=whole?original.text.size():first+range.second;
  GtkRtfDocument next;
  if(whole)next=std::move(replacement);
  else {next=slice(original,0,first);appendDocument(next,replacement);appendDocument(next,slice(original,last,original.text.size()));next.metadata=original.metadata;if(last!=original.text.size())next.emptyStyle=original.emptyStyle;}
  next=normalizeParagraphs(next);
  auto maximum=c.number("maxlength");if(maximum>0&&next.text.size()>size_t(maximum))fail(380,"RTF text exceeds RichTextBox.MaxLength");
  const bool changed=!equal(original,next);auto caret=whole?0:first+replacement.text.size();commit(c,next,caret,0,changed,fire);
}
bool paragraphProperty(const std::string& name) {
  return name=="selalignment"||name=="selindent"||name=="selhangingindent"||name=="selrightindent"||name=="selbullet"||name=="seltabcount"||name=="seltabs";
}
Value attribute(GtkControl& c,const GtkRtfStyle& style,const std::string& name) {
  if(name=="selbold")return Value::boolean(style.bold);if(name=="selitalic")return Value::boolean(style.italic);
  if(name=="selunderline")return Value::boolean(style.underline!=0);if(name=="selstrikethru")return Value::boolean(style.strike);
  if(name=="selprotected")return Value::boolean(style.protectedText);if(name=="selhidden")return Value::boolean(style.hidden);
  if(name=="selfontname")return Value::string(style.font);if(name=="selfontsize")return Value::real(style.size,Type::Single);
  if(name=="selfontcharset")return Value::integer(style.charset,Type::Integer);
  if(name=="selcolor")return Value::integer(style.foreground<0?gtkColorValue(gtkColor(c.number("forecolor",0))):style.foreground);
  if(name=="selbackcolor")return Value::integer(style.background<0?gtkColorValue(gtkColor(c.number("backcolor",0xffffff))):style.background);
  if(name=="selcharoffset")return Value::real(style.script?style.script*style.size*20/3:style.rise,Type::Single);
  if(name=="selalignment")return Value::integer(style.paragraph.alignment,Type::Integer);
  if(name=="selindent")return Value::real(style.paragraph.left+style.paragraph.first,Type::Single);
  if(name=="selhangingindent")return Value::real(-style.paragraph.first,Type::Single);
  if(name=="selrightindent")return Value::real(style.paragraph.right,Type::Single);
  if(name=="selbullet")return Value::boolean(style.paragraph.bullet);
  if(name=="seltabcount")return Value::integer(style.paragraph.tabs.size(),Type::Integer);
  fail(438);
}
Value checked(const std::string& name,Value value) {
  if(value.type==Type::Null)fail(380,"Cannot assign a mixed rich selection value");
  if(name=="selfontsize") {auto number=value.floating();if(!std::isfinite(number)||number<=0||number>3072)fail(380,"Invalid selection font size");return Value::real(std::max(0.5,std::round(number*2)/2));}
  if(name=="selfontname") {auto text=value.string();gtkRtfValidateText(text);if(text.empty()||text.size()>255||text.find_first_of(u";\r\n\t")!=Text::npos)fail(380,"Invalid selection font family");return Value::string(text);}
  if(name=="selcolor"||name=="selbackcolor")return Value::integer(gtkColorValue(gtkColor(coerce(value,"long").integral())));
  if(name=="selfontcharset"){auto number=value.integral();if(number<0||number>255)fail(380);return Value::integer(number);}
  if(name=="selalignment"){auto number=value.integral();if(number<0||number>3)fail(380);return Value::integer(number);}
  if(name=="seltabcount"){auto number=value.integral();if(number<0||number>64)fail(380);return Value::integer(number);}
  if(name=="selindent"||name=="selhangingindent"||name=="selrightindent"||name=="selcharoffset"||name=="seltabs") {
    auto number=value.floating();if(!std::isfinite(number)||std::abs(number)>31680||(number<0&&(name=="selindent"||name=="selrightindent"||name=="seltabs")))fail(380,"Invalid rich text offset");
    if(name=="selcharoffset")number=std::round(number/10)*10;else number=std::round(number);
    return Value::integer(int64_t(number));
  }
  return Value::boolean(value.truth());
}
void formatted(GtkRtfStyle& style,const std::string& name,const Value& value,int index=-1) {
  if(name=="selbold")style.bold=value.truth();else if(name=="selitalic")style.italic=value.truth();else if(name=="selunderline")style.underline=value.truth()?1:0;else if(name=="selstrikethru")style.strike=value.truth();
  else if(name=="selhidden")style.hidden=value.truth();else if(name=="selprotected")style.protectedText=value.truth();
  else if(name=="selfontname"){style.font=value.string();style.charset=0;}else if(name=="selfontsize")style.size=value.floating();else if(name=="selfontcharset")style.charset=int(value.integral());
  else if(name=="selcolor")style.foreground=int(value.integral());else if(name=="selbackcolor")style.background=int(value.integral());
  else if(name=="selcharoffset"){style.rise=int(value.integral());style.script=0;}
  else if(name=="selalignment")style.paragraph.alignment=int(value.integral());
  else if(name=="selindent")style.paragraph.left=int(value.integral())-style.paragraph.first;
  else if(name=="selhangingindent"){auto firstLine=style.paragraph.left+style.paragraph.first;style.paragraph.first=-int(value.integral());style.paragraph.left=firstLine-style.paragraph.first;}
  else if(name=="selrightindent")style.paragraph.right=int(value.integral());else if(name=="selbullet"){style.paragraph.bullet=value.truth();style.paragraph.numbering=0;style.paragraph.marker.clear();style.paragraph.numberBefore.clear();}
  else if(name=="seltabcount"){auto& tabs=style.paragraph.tabs;auto count=size_t(value.integral());while(tabs.size()<count)tabs.push_back(tabs.empty()?720:tabs.back()+720);tabs.resize(count);style.paragraph.tabAlignments.resize(count,0);}
  else if(name=="seltabs"){if(index<0||size_t(index)>=style.paragraph.tabs.size())fail(381);style.paragraph.tabs[size_t(index)]=int(value.integral());}
  validateStyle(style);
}
void setAttribute(GtkControl& c,const std::string& name,Value value,int index=-1) {
  value=checked(name,std::move(value));auto& state=rich(c);gtkRichSelectionChanged(c,false);
  auto range=c.editSelection();auto original=gtkRichSnapshot(c);auto first=range.first,last=first+range.second;
  if(first!=last)for(const auto& object:original.objects)if(first<object.last&&last>object.first){first=std::min(first,object.first);last=std::max(last,object.last);}
  auto typing=state.typing;formatted(typing,name,value,index); // Validate caret value before any mutation.
  if(paragraphProperty(name)&&!original.text.empty()) {
    while(first&&!gtkRtfParagraphEnd(original.text,first-1))--first;
    if(last==range.first&&last==original.text.size()&&gtkRtfParagraphEnd(original.text,original.text.size()-1))first=last;
    else {if(last>range.first&&last&&gtkRtfParagraphEnd(original.text,last-1)){}else {while(last<original.text.size()&&(last==first||!gtkRtfParagraphEnd(original.text,last-1)))++last;}}
  }
  if(first==last) {state.typing=typing;state.typingOverride=true;if(first==original.text.size())state.trailing=typing;return;}
  GtkRtfDocument next;next.metadata=original.metadata;next.fields=original.fields;next.objects=original.objects;next.emptyStyle=original.emptyStyle;
  for(const auto& run:original.runs) {
    auto before=std::min(run.last,first);if(run.first<before)gtkRtfAppend(next,original.text.substr(run.first,before-run.first),run.style);
    auto a=std::max(run.first,first),b=std::min(run.last,last);
    if(a<b){auto style=run.style;formatted(style,name,value,index);gtkRtfAppend(next,original.text.substr(a,b-a),style);}
    auto after=std::max(run.first,last);if(after<run.last)gtkRtfAppend(next,original.text.substr(after,run.last-after),run.style);
  }
  next.emptyStyle=original.emptyStyle;if(last==original.text.size())formatted(next.emptyStyle,name,value,index);
  if(equal(original,next))return;
  commit(c,next,range.first,range.second,true,false);c.richText->typing=typing;c.richText->typingOverride=true;c.event("change");
}
void drawBullets(GtkControl& c,cairo_t* context) {
  auto& state=rich(c);GtkTextIter iter;gtk_text_buffer_get_start_iter(state.buffer,&iter);
  GdkRectangle visible;gtk_text_view_get_visible_rect(GTK_TEXT_VIEW(c.widget),&visible);
  gtk_text_view_get_iter_at_location(GTK_TEXT_VIEW(c.widget),&iter,visible.x,visible.y);gtk_text_iter_set_line_offset(&iter,0);
  for(int count=0;count<4096;++count) {
    auto style=nativeStyle(c,iter);GdkRectangle rectangle;gtk_text_view_get_iter_location(GTK_TEXT_VIEW(c.widget),&iter,&rectangle);if(rectangle.y>visible.y+visible.height)break;
    if((style.paragraph.bullet||style.paragraph.numbering||!style.paragraph.marker.empty())&&!style.hidden) {
      int ordinal=style.paragraph.numberStart;auto before=iter;
      if(style.paragraph.numbering&&style.paragraph.marker.empty())for(int count=0;count<65536&&gtk_text_iter_backward_line(&before);++count){auto prior=nativeStyle(c,before).paragraph;if(prior.numbering!=style.paragraph.numbering||prior.numberStart!=style.paragraph.numberStart||prior.numberBefore!=style.paragraph.numberBefore||prior.numberAfter!=style.paragraph.numberAfter)break;++ordinal;}
      auto marker=toUTF8(gtkRtfListMarker(style.paragraph,ordinal));
      int x,y;gtk_text_view_buffer_to_window_coords(GTK_TEXT_VIEW(c.widget),GTK_TEXT_WINDOW_WIDGET,rectangle.x,rectangle.y,&x,&y);
      const auto& para=style.paragraph;auto* layout=gtk_widget_create_pango_layout(c.widget,marker.c_str());auto* font=pango_font_description_new();pango_font_description_set_family(font,toUTF8(para.markerFont.empty()?style.font:para.markerFont).c_str());pango_font_description_set_size(font,int((para.markerSize?para.markerSize:style.size)*PANGO_SCALE));pango_font_description_set_weight(font,(para.markerBold<0?style.bold:bool(para.markerBold))?PANGO_WEIGHT_BOLD:PANGO_WEIGHT_NORMAL);pango_font_description_set_style(font,(para.markerItalic<0?style.italic:bool(para.markerItalic))?PANGO_STYLE_ITALIC:PANGO_STYLE_NORMAL);pango_layout_set_font_description(layout,font);pango_font_description_free(font);int width=0;pango_layout_get_pixel_size(layout,&width,nullptr);
      auto color=gtkColor(para.markerColor>= -1?(para.markerColor<0?int64_t(c.number("forecolor",0)):para.markerColor):style.foreground<0?int64_t(c.number("forecolor",0)):style.foreground);gdk_cairo_set_source_rgba(context,&color);
      const auto markerX=para.rtl?x+rectangle.width+(para.first<0?pixels(-para.first):6):x-(para.first<0?pixels(-para.first):width+6);
      const auto baseline=fontMetrics(c,style.font,style.size,style.bold,style.italic).first-pango_layout_get_baseline(layout)/double(PANGO_SCALE);
      cairo_move_to(context,markerX-(para.markerAlignment==1?width/2:para.markerAlignment==2?width:0),y+baseline);pango_cairo_show_layout(context,layout);g_object_unref(layout);
    }
    if(!gtk_text_iter_forward_line(&iter))break;
  }
}
}

void gtkRichDraw(GtkControl& c,cairo_t* context) {if(c.richText&&!c.disposed)drawBullets(c,context);}

void gtkRichInitialize(GtkControl& c) {
  if(c.spec.type!="RichTextBox"||c.richText)return;
  GtkRtfDocument document;document.emptyStyle=defaults(c);c.richText=prepare(c,document);
  gtk_text_view_set_buffer(GTK_TEXT_VIEW(c.widget),c.richText->buffer);nativeSelection(*c.richText,0,0);
  attachRichDrawing(c);
}
void gtkRichDispose(GtkControl& c) {c.richText.reset();}
void gtkRichSelectionChanged(GtkControl& c,bool fire) {
  if(!c.richText||c.disposed)return;auto& state=rich(c);
  if(state.selectionIdle){g_source_remove(state.selectionIdle);state.selectionIdle=0;}
  auto current=selection(state.buffer);if(current==state.selection)return;
  state.selection=current;state.typing=insertionStyle(c,current.first);state.typingOverride=false;
  if(fire&&state.parent.expired())c.event("selchange");
}
GtkRtfDocument gtkRichSnapshot(GtkControl& c) {
  auto& state=rich(c);GtkRtfDocument document;document.emptyStyle=state.trailing;document.metadata=state.metadata;
  GtkTextIter iter,end;gtk_text_buffer_get_bounds(state.buffer,&iter,&end);
  std::map<int,const GtkRichText::Embedded*> objects;for(const auto& object:state.objects){GtkTextIter at;if(liveObject(state,object,&at))objects.emplace(gtk_text_iter_get_offset(&at),&object);}
  while(gtk_text_iter_compare(&iter,&end)<0) {
    auto embedded=objects.find(gtk_text_iter_get_offset(&iter));
    if(embedded!=objects.end()) {
      const auto& original=*embedded->second;auto object=original.value;object.first=document.text.size();auto next=iter;gtk_text_iter_forward_chars(&next,int(object.last-original.value.first));auto* content=gtk_text_buffer_get_slice(state.buffer,&iter,&next,TRUE);std::unique_ptr<gchar,decltype(&g_free)> owned(content,g_free);gtkRtfAppend(document,fromUTF8(content),nativeStyle(c,iter));object.last=document.text.size();
      if(object.kind==GtkRtfObject::TableRow){size_t index=0;for(auto& cell:object.cells)if(cell.merge!=2)cell.content=std::make_shared<GtkRtfDocument>(gtkRichSnapshot(*original.presentation->children.at(index++)));}
      else if(object.content)object.content=std::make_shared<GtkRtfDocument>(gtkRichSnapshot(*original.presentation->children.at(0)));
      document.objects.push_back(std::move(object));iter=next;continue;
    }
#if GTK_MAJOR_VERSION < 4
    if(gtk_text_iter_get_pixbuf(&iter)||gtk_text_iter_get_child_anchor(&iter))fail(453,"RichTextBox contains unsupported embedded content");
#else
    if(gtk_text_iter_get_paintable(&iter)||gtk_text_iter_get_child_anchor(&iter))fail(453,"RichTextBox contains unsupported embedded content");
#endif
    auto next=iter;if(!gtk_text_iter_forward_to_tag_toggle(&next,nullptr))next=end;if(gtk_text_iter_compare(&next,&end)>0)next=end;
    auto line=iter;gtk_text_iter_forward_line(&line);if(gtk_text_iter_compare(&line,&iter)>0&&gtk_text_iter_compare(&line,&next)<0)next=line;
    auto object=objects.upper_bound(gtk_text_iter_get_offset(&iter));if(object!=objects.end()&&object->first<gtk_text_iter_get_offset(&next))gtk_text_buffer_get_iter_at_offset(state.buffer,&next,object->first);
    auto* text=gtk_text_buffer_get_slice(state.buffer,&iter,&next,TRUE);std::unique_ptr<gchar,decltype(&g_free)> owned(text,g_free);
    gtkRtfAppend(document,fromUTF8(text),nativeStyle(c,iter));iter=next;
  }
  for(const auto& field:state.fields){if(gtk_text_mark_get_deleted(field.first)||gtk_text_mark_get_deleted(field.last))continue;GtkTextIter a,b;gtk_text_buffer_get_iter_at_mark(state.buffer,&a,field.first);gtk_text_buffer_get_iter_at_mark(state.buffer,&b,field.last);auto copy=field.value;copy.first=utf16Offset(document.text,gtk_text_iter_get_offset(&a));copy.last=utf16Offset(document.text,gtk_text_iter_get_offset(&b));document.fields.push_back(std::move(copy));}
  document.emptyStyle=state.trailing;if(!document.text.empty()&&!gtkRtfParagraphEnd(document.text,document.text.size()-1))document.emptyStyle.paragraph=document.runs.back().style.paragraph;return document;
}
void gtkRichSetPlain(GtkControl& c,const Text& value,bool whole,bool fire) {
  auto text=value;gtkRtfValidateText(text);auto limit=c.number("maxlength");
  auto selected=c.editSelection();auto available=whole?size_t(std::max(0.0,limit)):size_t(std::max(0.0,limit))-std::min(size_t(std::max(0.0,limit)),c.editText().size()-selected.second);
  if(limit>0&&text.size()>available){text.resize(available);if(!text.empty()&&text.back()>=0xd800&&text.back()<=0xdbff)text.pop_back();}
  auto style=whole?defaults(c):rich(c).typing;GtkRtfDocument document;document.emptyStyle=style;gtkRtfAppend(document,text,style);
  replace(c,std::move(document),whole,fire);
}
bool gtkRichProperty(const std::string& name) noexcept {
  return name=="textrtf"||name=="selrtf"||name=="selbold"||name=="selitalic"||name=="selunderline"||name=="selstrikethru"||name=="selcolor"||name=="selbackcolor"||name=="selfontname"||name=="selfontsize"||name=="selfontcharset"||name=="selalignment"||name=="selindent"||name=="selhangingindent"||name=="selrightindent"||name=="selcharoffset"||name=="selprotected"||name=="selhidden"||name=="selbullet"||name=="seltabcount"||name=="modified";
}
Value gtkRichGet(GtkControl& c,const std::string& name) {
  auto& state=rich(c);gtkRichSelectionChanged(c,false);
  if(name=="modified")return Value::boolean(gtk_text_buffer_get_modified(state.buffer));
  auto selected=c.editSelection();
  if(name=="textrtf"||name=="selrtf") {
    auto document=gtkRichSnapshot(c);if(name=="selrtf"){if(!selected.second)return Value::string(u"");document=slice(document,selected.first,selected.first+selected.second);}
    return Value::string(fromUTF8(gtkRtfWrite(document)));
  }
  if(!selected.second)return attribute(c,state.typing,name);
  auto document=gtkRichSnapshot(c);std::optional<Value> result;
  for(const auto& run:document.runs)if(run.last>selected.first&&run.first<selected.first+selected.second) {
    auto value=attribute(c,run.style,name);if(result&&!binary("=",*result,value).truth())return Value::null();result=value;
  }
  return result?*result:attribute(c,state.typing,name);
}
void gtkRichSet(GtkControl& c,const std::string& name,Value value) {
  auto& state=rich(c);
  if(name=="modified"){gtk_text_buffer_set_modified(state.buffer,value.truth());return;}
  if(name=="textrtf"||name=="selrtf") {
    auto text=value.string();if(text.empty()){gtkRichSetPlain(c,u"",name=="textrtf");return;}
    auto document=gtkRtfParse(gtkRtfBytes(text));replace(c,std::move(document),name=="textrtf");return;
  }
  setAttribute(c,name,std::move(value));
}
bool gtkRichMethod(const std::string& name) noexcept {return name=="loadfile"||name=="savefile"||name=="seltabs"||name=="find"||name=="getlinenumber";}
Value gtkRichCall(GtkControl& c,const std::string& name,Args args,bool put) {
  rich(c);
  if(name=="seltabs") {
    if(args.size()!=(put?2:1))fail(450);auto index=args[0].value.integral();if(index<0||index>=64)fail(381);
    if(put){setAttribute(c,name,args[1].value,int(index));return {};}
    auto range=c.editSelection();auto document=gtkRichSnapshot(c);std::optional<int> result;
    auto value=[&](const GtkRtfStyle& style){if(size_t(index)>=style.paragraph.tabs.size())fail(381);return style.paragraph.tabs[size_t(index)];};
    if(!range.second)return Value::real(value(rich(c).typing),Type::Single);
    for(const auto& run:document.runs)if(run.last>range.first&&run.first<range.first+range.second){auto next=value(run.style);if(result&&*result!=next)return Value::null();result=next;}
    return Value::real(result.value_or(0),Type::Single);
  }
  if(name=="loadfile"||name=="savefile") {
    if(put||args.empty()||args.size()>2)fail(450);auto format=integerArgument(args,1,0);if(format<0||format>1)fail(380,"RichTextBox file format must be RTF (0) or plain UTF-8 text (1)");
    auto filename=toUTF8(stringArgument(args,0));if(filename.empty()||filename.find('\0')!=std::string::npos)fail(52);
    if(name=="loadfile") {
      std::ifstream stream(filename,std::ios::binary);if(!stream)fail(53,"Cannot open RichTextBox file");
      std::string bytes;char buffer[16384];
      while(stream){stream.read(buffer,sizeof(buffer));auto count=size_t(stream.gcount());if(count>GtkRtfMaxBytes-bytes.size())fail(7,"RichTextBox input file exceeds 16 MiB");bytes.append(buffer,count);}
      if(!stream.eof())fail(75,"Cannot read RichTextBox file");
      if(format==0)replace(c,gtkRtfParse(bytes),true);
      else {if(bytes.rfind("\xef\xbb\xbf",0)==0)bytes.erase(0,3);gtkRichSetPlain(c,gtkRtfDecode(bytes,65001),true);}
      return {};
    }
    auto bytes=format==0?gtkRtfWrite(gtkRichSnapshot(c)):toUTF8(c.editText());
    GError* error=nullptr;
    // GLib writes to an adjacent temporary file and renames only after a complete
    // write; a serialization or I/O error cannot truncate an existing document.
    if(!g_file_set_contents(filename.c_str(),bytes.data(),gssize(bytes.size()),&error)){std::string detail=error?error->message:"Cannot save rich text";if(error)g_error_free(error);fail(75,detail);}
    gtk_text_buffer_set_modified(rich(c).buffer,FALSE);return {};
  }
  if(name=="getlinenumber") {
    if(put||args.size()>1)fail(450);auto text=c.editText();auto offset=integerArgument(args,0,c.editSelection().first);if(offset<0||size_t(offset)>text.size())fail(380);GtkTextIter iter;gtk_text_buffer_get_iter_at_offset(rich(c).buffer,&iter,scalarOffset(text,size_t(offset)));return Value::integer(gtk_text_iter_get_line(&iter));
  }
  if(name=="find") {
    if(put||args.empty()||args.size()>4)fail(450);auto needle=stringArgument(args,0);gtkRtfValidateText(needle);auto text=c.editText();
    auto start=integerArgument(args,1,0),end=integerArgument(args,2,text.size()),flags=integerArgument(args,3,0);
    if(start<0||end<0||size_t(start)>text.size()||size_t(end)>text.size()||(flags&~14))fail(380);if(needle.empty())return Value::integer(-1);
    bool reverse=start>end;GtkTextIter first,limit,a,b;auto* buffer=rich(c).buffer;gtk_text_buffer_get_iter_at_offset(buffer,&first,scalarOffset(text,size_t(start)));gtk_text_buffer_get_iter_at_offset(buffer,&limit,scalarOffset(text,size_t(end)));
    auto searchFlags=GtkTextSearchFlags(GTK_TEXT_SEARCH_TEXT_ONLY|((flags&4)?0:GTK_TEXT_SEARCH_CASE_INSENSITIVE));auto utf8=toUTF8(needle);
    for(;;) {
      bool found=reverse?gtk_text_iter_backward_search(&first,utf8.c_str(),searchFlags,&a,&b,&limit):gtk_text_iter_forward_search(&first,utf8.c_str(),searchFlags,&a,&b,&limit);
      if(!found)return Value::integer(-1);
      if(!(flags&2)||(gtk_text_iter_starts_word(&a)&&gtk_text_iter_ends_word(&b))) {
        auto at=utf16Offset(text,gtk_text_iter_get_offset(&a)),last=utf16Offset(text,gtk_text_iter_get_offset(&b));if(!(flags&8))c.editSelect(at,last-at);return Value::integer(at);
      }
      first=reverse?a:b;
    }
  }
  fail(438,"Unsupported GTK RichTextBox method "+name);
}
}
