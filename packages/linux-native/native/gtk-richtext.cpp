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
  std::pair<int,int> selection{-1,-1};
  size_t operationDepth=0,userActionDepth=0;
  bool dirty=false,typingOverride=false,selecting=false;
  guint selectionIdle=0;
  struct Insertion {int first=0,count=0;GtkRtfStyle style;};
  std::vector<Insertion> insertions;
  ~GtkRichText(){if(selectionIdle)g_source_remove(selectionIdle);if(buffer)g_object_unref(buffer);}
};
namespace {
GtkRichText& rich(GtkControl& control) {
  if(control.disposed)fail(91);
  if(control.spec.type!="RichTextBox"||!GTK_IS_TEXT_VIEW(control.widget)||!control.richText)fail(438,"Selection formatting requires RichTextBox");
  return *control.richText;
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
  para.rtl=attributes->direction==GTK_TEXT_DIR_RTL;para.tabs.clear();
  if(attributes->tabs)for(int i=0;i<pango_tab_array_get_size(attributes->tabs);++i){PangoTabAlign align;int position;pango_tab_array_get_tab(attributes->tabs,i,&align,&position);if(align!=PANGO_TAB_LEFT)fail(453,"Native rich text contains an unsupported tab alignment");para.tabs.push_back(int(std::lround(position*15.0/(pango_tab_array_get_positions_in_pixels(attributes->tabs)?1:PANGO_SCALE))));}
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
  if(para.alignment<0||para.alignment>3||para.left<0||para.right<0||para.left>31680||para.right>31680||std::abs(para.first)>31680||para.before<0||para.after<0||para.before>31680||para.after>31680)fail(380,"Invalid rich paragraph geometry");
  if(para.lineExtra)fail(453,"Non-default native rich line spacing cannot be represented losslessly as RTF");
  if(para.bullet&&para.rtl)fail(453,"RTL rich bullet paragraphs are unavailable");
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
  int left=para.left,indent=para.first;
  if(para.bullet){left=std::max(360,left);indent=0;}
  auto underline=style.underline==2?PANGO_UNDERLINE_DOUBLE:style.underline==3?PANGO_UNDERLINE_ERROR:style.underline?PANGO_UNDERLINE_SINGLE:PANGO_UNDERLINE_NONE;
  const auto rise=int(std::lround((style.rise/15.0+style.script*style.size*4.0/9)*PANGO_SCALE));
  g_object_set(value,"family",toUTF8(style.font).c_str(),"size-points",style.size,"weight",style.bold?PANGO_WEIGHT_BOLD:PANGO_WEIGHT_NORMAL,
    "style",style.italic?PANGO_STYLE_ITALIC:PANGO_STYLE_NORMAL,"variant",style.smallCaps?PANGO_VARIANT_SMALL_CAPS:PANGO_VARIANT_NORMAL,
    "underline",underline,"strikethrough",gboolean(style.strike),"foreground-rgba",&fore,"background-rgba",&back,
    "invisible",gboolean(style.hidden),"editable",gboolean(!style.protectedText),"rise",rise,"scale",style.script?0.7:1.0,
    "letter-spacing",int(std::lround(style.spacing/15.0*PANGO_SCALE)),"left-margin",pixels(left),"right-margin",pixels(para.right),"indent",pixels(indent),
    "pixels-above-lines",pixels(para.before),"pixels-below-lines",pixels(para.after),"pixels-inside-wrap",0,
    "justification",para.alignment==1?GTK_JUSTIFY_RIGHT:para.alignment==2?GTK_JUSTIFY_CENTER:para.alignment==3?GTK_JUSTIFY_FILL:GTK_JUSTIFY_LEFT,
    "direction",para.rtl?GTK_TEXT_DIR_RTL:GTK_TEXT_DIR_LTR,nullptr);
  auto count=para.tabs.empty()?64:int(para.tabs.size());auto* tabs=pango_tab_array_new(count,TRUE);
  for(int i=0;i<count;++i)pango_tab_array_set_tab(tabs,i,PANGO_TAB_LEFT,pixels(para.tabs.empty()?(i+1)*720:para.tabs[size_t(i)]));
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
  if(!c.suppressEvents)c.event("change");
}
void signal(GtkTextBuffer* buffer,const char* name,GCallback callback,const std::shared_ptr<GtkControl>& c,bool after=false) {
  g_signal_connect_data(buffer,name,callback,new std::weak_ptr<GtkControl>(c),+[](gpointer data,GClosure*){delete static_cast<std::weak_ptr<GtkControl>*>(data);},after?G_CONNECT_AFTER:GConnectFlags(0));
}
void connect(GtkControl& c,GtkRichText& state) {
  signal(state.buffer,"begin-user-action",G_CALLBACK(+[](GtkTextBuffer* buffer,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& rich=::vb6::rich(owner);if(rich.buffer==buffer)++rich.userActionDepth;});}),c.self());
  signal(state.buffer,"end-user-action",G_CALLBACK(+[](GtkTextBuffer* buffer,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& rich=::vb6::rich(owner);if(rich.buffer!=buffer)return;if(rich.userActionDepth)--rich.userActionDepth;emitChange(owner);});}),c.self(),true);
  signal(state.buffer,"insert-text",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter* iter,gchar* input,gint bytes,gpointer data){
    gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer!=buffer)return;
      try {
        auto text=fromUTF8(std::string(input,bytes<0?std::strlen(input):size_t(bytes)));gtkRtfValidateText(text);
        auto previous=owner.editText();auto maximum=owner.number("maxlength");
        if(text.size()>GtkRtfMaxText-previous.size())fail(7,"RichTextBox text exceeds 4 Mi UTF-16 units");
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
  signal(state.buffer,"delete-range",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,GtkTextIter*,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer==buffer)++state.operationDepth;});}),c.self());
  signal(state.buffer,"delete-range",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,GtkTextIter*,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer!=buffer)return;if(state.operationDepth)--state.operationDepth;state.typingOverride=false;gtkRichSelectionChanged(owner,false);emitChange(owner);});}),c.self(),true);
  signal(state.buffer,"changed",G_CALLBACK(+[](GtkTextBuffer* buffer,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer==buffer){state.dirty=true;emitChange(owner);}});}),c.self());
  signal(state.buffer,"mark-set",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,GtkTextMark* mark,gpointer data){gtkEvent(data,[&](GtkControl& owner){auto& state=rich(owner);if(state.buffer!=buffer||state.selecting||state.operationDepth||owner.suppressEvents)return;
    if(mark!=gtk_text_buffer_get_insert(buffer)&&mark!=gtk_text_buffer_get_selection_bound(buffer))return;
    if(!state.selectionIdle)state.selectionIdle=g_idle_add_full(G_PRIORITY_DEFAULT_IDLE,+[](gpointer payload)->gboolean {gtkEvent(payload,[](GtkControl& control){auto state=control.richText;if(state){state->selectionIdle=0;gtkRichSelectionChanged(control);}});return G_SOURCE_REMOVE;},new std::weak_ptr<GtkControl>(owner.self()),+[](gpointer payload){delete static_cast<std::weak_ptr<GtkControl>*>(payload);});
  });}),c.self(),true);
  signal(state.buffer,"insert-pixbuf",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,GdkPixbuf*,gpointer data){g_signal_stop_emission_by_name(buffer,"insert-pixbuf");gtkEvent(data,[](GtkControl&){fail(453,"RichTextBox embedded images require an unsupported RTF picture destination");});}),c.self());
  signal(state.buffer,"insert-child-anchor",G_CALLBACK(+[](GtkTextBuffer* buffer,GtkTextIter*,GtkTextChildAnchor*,gpointer data){g_signal_stop_emission_by_name(buffer,"insert-child-anchor");gtkEvent(data,[](GtkControl&){fail(453,"RichTextBox embedded objects are unavailable");});}),c.self());
}
std::shared_ptr<GtkRichText> prepare(GtkControl& c,const GtkRtfDocument& document) {
  gtkRtfValidateText(document.text);validateStyle(document.emptyStyle);
  auto result=std::make_shared<GtkRichText>();result->buffer=gtk_text_buffer_new(nullptr);result->metadata=document.metadata;result->typing=result->trailing=document.emptyStyle;
  auto utf8=toUTF8(document.text);gtk_text_buffer_set_text(result->buffer,utf8.data(),int(utf8.size()));
  size_t previous=0;int scalar=0;
  for(const auto& run:document.runs) {
    if(run.first!=previous||run.last<=run.first||run.last>document.text.size())fail(380,"Invalid rich formatting ranges");
    int count=scalarOffset(document.text.substr(run.first,run.last-run.first),run.last-run.first);apply(c,*result,scalar,scalar+count,run.style);scalar+=count;previous=run.last;
  }
  if(previous!=document.text.size())fail(380,"Rich text lacks attributed runs");
  // Register GTK's structured format as well as plain text for native copy/paste.
  gtk_text_buffer_register_serialize_tagset(result->buffer,nullptr);gtk_text_buffer_register_deserialize_tagset(result->buffer,nullptr);
  connect(c,*result);return result;
}
bool equal(const GtkRtfDocument& a,const GtkRtfDocument& b) {
  if(a.text!=b.text||a.metadata!=b.metadata||a.emptyStyle!=b.emptyStyle)return false;
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
  return result;
}
void appendDocument(GtkRtfDocument& destination,const GtkRtfDocument& source) {
  for(const auto& run:source.runs)gtkRtfAppend(destination,source.text.substr(run.first,run.last-run.first),run.style);
  destination.emptyStyle=source.emptyStyle;
}
GtkRtfDocument normalizeParagraphs(const GtkRtfDocument& source) {
  GtkRtfDocument result;result.metadata=source.metadata;auto paragraph=source.emptyStyle.paragraph;bool first=true;
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
  else if(name=="selrightindent")style.paragraph.right=int(value.integral());else if(name=="selbullet")style.paragraph.bullet=value.truth();
  else if(name=="seltabcount"){auto& tabs=style.paragraph.tabs;auto count=size_t(value.integral());while(tabs.size()<count)tabs.push_back(tabs.empty()?720:tabs.back()+720);tabs.resize(count);}
  else if(name=="seltabs"){if(index<0||size_t(index)>=style.paragraph.tabs.size())fail(381);style.paragraph.tabs[size_t(index)]=int(value.integral());}
  validateStyle(style);
}
void setAttribute(GtkControl& c,const std::string& name,Value value,int index=-1) {
  value=checked(name,std::move(value));auto& state=rich(c);gtkRichSelectionChanged(c,false);
  auto range=c.editSelection();auto original=gtkRichSnapshot(c);auto first=range.first,last=first+range.second;
  auto typing=state.typing;formatted(typing,name,value,index); // Validate caret value before any mutation.
  if(paragraphProperty(name)&&!original.text.empty()) {
    while(first&&!gtkRtfParagraphEnd(original.text,first-1))--first;
    if(last==range.first&&last==original.text.size()&&gtkRtfParagraphEnd(original.text,original.text.size()-1))first=last;
    else {if(last>range.first&&last&&gtkRtfParagraphEnd(original.text,last-1)){}else {while(last<original.text.size()&&(last==first||!gtkRtfParagraphEnd(original.text,last-1)))++last;}}
  }
  if(first==last) {state.typing=typing;state.typingOverride=true;if(first==original.text.size())state.trailing=typing;return;}
  GtkRtfDocument next;next.metadata=original.metadata;next.emptyStyle=original.emptyStyle;
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
    if(style.paragraph.bullet&&!style.hidden) {
      int x,y;gtk_text_view_buffer_to_window_coords(GTK_TEXT_VIEW(c.widget),GTK_TEXT_WINDOW_WIDGET,rectangle.x,rectangle.y,&x,&y);
      auto* layout=gtk_widget_create_pango_layout(c.widget,"\xe2\x80\xa2");auto* font=pango_font_description_new();pango_font_description_set_family(font,toUTF8(style.font).c_str());pango_font_description_set_size(font,int(style.size*PANGO_SCALE));pango_layout_set_font_description(layout,font);pango_font_description_free(font);
      auto color=gtkColor(style.foreground<0?int64_t(c.number("forecolor",0)):style.foreground);gdk_cairo_set_source_rgba(context,&color);
      cairo_move_to(context,x-std::max(12,pixels(-style.paragraph.first)),y);pango_cairo_show_layout(context,layout);g_object_unref(layout);
    }
    if(!gtk_text_iter_forward_line(&iter))break;
  }
}
}

void gtkRichInitialize(GtkControl& c) {
  if(c.spec.type!="RichTextBox"||c.richText)return;
  GtkRtfDocument document;document.emptyStyle=defaults(c);c.richText=prepare(c,document);
  gtk_text_view_set_buffer(GTK_TEXT_VIEW(c.widget),c.richText->buffer);nativeSelection(*c.richText,0,0);
  g_signal_connect_data(c.widget,"draw",G_CALLBACK(+[](GtkWidget*,cairo_t* context,gpointer data)->gboolean {gtkEvent(data,[&](GtkControl& owner){drawBullets(owner,context);});return FALSE;}),new std::weak_ptr<GtkControl>(c.self()),+[](gpointer data,GClosure*){delete static_cast<std::weak_ptr<GtkControl>*>(data);},G_CONNECT_AFTER);
}
void gtkRichDispose(GtkControl& c) {c.richText.reset();}
void gtkRichSelectionChanged(GtkControl& c,bool fire) {
  if(!c.richText||c.disposed)return;auto& state=rich(c);
  if(state.selectionIdle){g_source_remove(state.selectionIdle);state.selectionIdle=0;}
  auto current=selection(state.buffer);if(current==state.selection)return;
  state.selection=current;state.typing=insertionStyle(c,current.first);state.typingOverride=false;
  if(fire)c.event("selchange");
}
GtkRtfDocument gtkRichSnapshot(GtkControl& c) {
  auto& state=rich(c);GtkRtfDocument document;document.emptyStyle=state.trailing;document.metadata=state.metadata;
  GtkTextIter iter,end;gtk_text_buffer_get_bounds(state.buffer,&iter,&end);
  while(gtk_text_iter_compare(&iter,&end)<0) {
    if(gtk_text_iter_get_pixbuf(&iter)||gtk_text_iter_get_child_anchor(&iter))fail(453,"RichTextBox contains unsupported embedded content");
    auto next=iter;if(!gtk_text_iter_forward_to_tag_toggle(&next,nullptr))next=end;if(gtk_text_iter_compare(&next,&end)>0)next=end;
    auto line=iter;gtk_text_iter_forward_line(&line);if(gtk_text_iter_compare(&line,&iter)>0&&gtk_text_iter_compare(&line,&next)<0)next=line;
    auto* text=gtk_text_buffer_get_text(state.buffer,&iter,&next,TRUE);std::unique_ptr<gchar,decltype(&g_free)> owned(text,g_free);
    gtkRtfAppend(document,fromUTF8(text),nativeStyle(c,iter));iter=next;
  }
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
