// RTF grammar, attributed GTK signals and file transactions. MIT.
#include "gtk-richtext.hpp"
#include <iostream>
#include <fstream>

using namespace vb6;
namespace {
void require(bool value,const char* message){if(!value)throw std::runtime_error(message);}
void error(int number,const std::function<void()>& action) {
  try{action();}catch(const Error& e){if(e.number!=number)throw std::runtime_error("Expected VB error "+std::to_string(number)+", got "+std::to_string(e.number)+": "+e.what());return;}
  throw std::runtime_error("Expected VB error "+std::to_string(number));
}
const GtkRtfStyle& at(const GtkRtfDocument& document,size_t offset) {
  for(const auto& run:document.runs)if(run.first<=offset&&offset<run.last)return run.style;
  return document.emptyStyle;
}
void same(const GtkRtfDocument& a,const GtkRtfDocument& b) {
  if(a.text!=b.text)throw std::runtime_error("RTF roundtrip changed Unicode text: ["+toUTF8(a.text)+"] -> ["+toUTF8(b.text)+"]");
  for(size_t i=0;i<a.text.size();++i)if(at(a,i)!=at(b,i))throw std::runtime_error("RTF roundtrip changed attributes at UTF-16 offset "+std::to_string(i));
  require(a.emptyStyle==b.emptyStyle,"RTF roundtrip changed trailing insertion style");
}
void parser() {
  const std::string sample=R"({\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fswiss Arial;}{\f1\fmodern Courier New;}}{\colortbl;\red255\green0\blue0;\red0\green255\blue0;}\pard\f0\fs20 plain {\b\i\cf1\highlight2 BOLD} tail\par\qc\li720\fi-360\ri180\sb120\sa240\tx720\tx1440\f1\fs25\uldb Center\tab two\line soft\par\pard\protect\v hidden\v0\protect0\up6 raised\up0\super super\nosupersub})";
  auto doc=gtkRtfParse(sample);require(doc.text==u"plain BOLD tail\nCenter\ttwo\u2028soft\nhiddenraisedsuper","RTF destinations leaked into body text");
  require(at(doc,6).bold&&at(doc,6).italic&&at(doc,6).foreground==255&&at(doc,6).background==65280,"RTF character formatting was lost");
  require(!at(doc,10).bold&&at(doc,10).foreground==-1,"RTF group state did not restore");
  require(at(doc,16).paragraph.alignment==2&&at(doc,16).paragraph.left==720&&at(doc,16).paragraph.first==-360,"RTF paragraph formatting was lost");
  same(doc,gtkRtfParse(gtkRtfWrite(doc)));
  auto unicode=gtkRtfParse(R"({\rtf1\ansi\ansicpg1252 caf\'e9 \uc1\u28450?\u23383? {\uc2\u945ab}\u946? \u-10179?\u-8704?\~\_\\\{\}})");
  require(unicode.text==u"caf\u00e9 \u6f22\u5b57 \u03b1\u03b2 \U0001f600\u00a0\u2011\\{}","RTF Unicode/fallback/group decoding is wrong");
  same(unicode,gtkRtfParse(gtkRtfWrite(unicode)));
  auto dbcs=gtkRtfParse(R"({\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset128 MS Gothic;}{\f2\fcharset204 Arial;}}A\f1\'82\'a0\'82\'a2\f2\'cf\'f0\'e8\'e2\'e5\'f2\f0Z})");
  require(dbcs.text==u"A\u3042\u3044\u041f\u0440\u0438\u0432\u0435\u0442Z","RTF font-specific DBCS/Cyrillic decoding is wrong");
  same(dbcs,gtkRtfParse(gtkRtfWrite(dbcs)));
  auto styles=gtkRtfParse(R"({\rtf1\deff0{\fonttbl{\f0 Arial;}}{\stylesheet{\s0\fs20 Normal;}{\s2\sbasedon1\i Derived;}{\s1\sbasedon0\b\qc Heading;}{\*\cs3\additive\ul Emphasis;}}\s2 Heading {\cs3 emphasis}\plain\pard plain})");
  require(at(styles,0).bold&&at(styles,0).italic&&at(styles,0).paragraph.alignment==0,"RTF paragraph reset must affect the complete paragraph");
  require(at(styles,8).bold&&at(styles,8).italic&&at(styles,8).underline==1,"RTF inherited/additive stylesheet formatting was lost");
  same(styles,gtkRtfParse(gtkRtfWrite(styles)));
  auto alternatives=gtkRtfParse(R"({\rtf1{\upr{ANSI}{\*\ud Unicode\u945?}}})");
  require(alternatives.text==u"Unicode\u03b1","RTF Unicode alternative destination was duplicated");
  auto bullet=gtkRtfParse(R"({\rtf1{\pntext\u8226?\tab}{\*\pn\pnlvlblt{\pntxtb\u8226?}}\li720\fi-360 item\par})");
  require(bullet.text==u"item\n"&&at(bullet,0).paragraph.bullet,"RTF bullet list fallback leaked into text");same(bullet,gtkRtfParse(gtkRtfWrite(bullet)));
  auto symbol=gtkRtfParse(R"({\rtf1{\fonttbl{\f0\fcharset2 Symbol;}{\f1\fcharset42 Custom;}}\f0\u65?\u945?\f1\u66?})");
  require(symbol.text==u"A\u03b1B"&&at(symbol,0).charset==2&&at(symbol,2).charset==42,"Explicit Unicode with legacy font charset was lost");same(symbol,gtkRtfParse(gtkRtfWrite(symbol)));
  error(453,[&]{gtkRtfParse(R"({\rtf1{\fonttbl{\f0\fcharset2 Symbol;}}\f0 raw})");});
  auto overriddenScript=gtkRtfParse(R"({\rtf1\up6\super superscript\dn3 baseline})");same(overriddenScript,gtkRtfParse(gtkRtfWrite(overriddenScript)));
  auto nativeUnsupported=symbol;nativeUnsupported.runs.front().style.paragraph.lineExtra=15;error(453,[&]{gtkRtfWrite(nativeUnsupported);});
  auto scopedParagraph=gtkRtfParse(R"({\rtf1{\qc centered}})");same(scopedParagraph,gtkRtfParse(gtkRtfWrite(scopedParagraph)));
  auto paragraphSeparators=gtkRtfParse(R"({\rtf1\qc one\u13?\u10?\qr two\u8233?\ql three\u13?})");same(paragraphSeparators,gtkRtfParse(gtkRtfWrite(paragraphSeparators)));
  auto info=gtkRtfParse(R"({\rtf1{\info{\title Example}{\author Test}}{\*\generator VB6;}\paperw12240\paperh15840 text})");
  auto saved=gtkRtfWrite(info);require(saved.find("\\title Example")!=std::string::npos&&saved.find("\\paperw12240")!=std::string::npos,"RTF metadata was not preserved");
  for(const std::string input:{"", "{\\rtf1", "{\\rtf1 ok}}", "{\\rtf1 ok}garbage", "{\\rtf1\\'xy}", "{\\rtf1\\u-10179?}", "{\\rtf1\\bin999 xx}", "{\\rtf1\\cf20 x}", "{\\rtf1\\fs99999999999 x}", "{\\rtf1{\\stylesheet{\\s1\\sbasedon2 A;}{\\s2\\sbasedon1 B;}}\\s1 x}"})error(380,[&]{gtkRtfParse(input);});
  for(const std::string input:{R"({\rtf1{\pict\pngblip deadbeef}})",R"({\rtf1{\object\objdata 00}})",R"({\rtf1{\field{\*\fldinst LINK test}{\fldrslt display}}})",R"({\rtf1\trowd\cell text})",R"({\rtf1\ulw text})",R"({\rtf1{\*\unknownFeature ignored}})",R"({\rtf1\sl480\slmult1 double})",R"({\rtf1\tqr\tx720 right})"})error(453,[&]{gtkRtfParse(input);});
  error(7,[&]{gtkRtfParse("{\\rtf1"+std::string(256,'{')+"x"+std::string(257,'}'));});
  error(7,[&]{gtkRtfParse(std::string(GtkRtfMaxBytes+1,'x'));});
  error(380,[&]{gtkRtfParse(std::string("{\\rtf1 a")+'\0'+"b}");});
  std::cout<<"LINUX_RTF_PARSER_OK\n";
}
ControlSpec spec(const std::string& type,const std::string& name){ControlSpec value;value.type=type;value.name=name;value.properties={{"width",Value::integer(6000)},{"height",Value::integer(3000)}};return value;}
}
int main() {
  try {
    parser();Runtime runtime(makeNativeHost());runtime.name="GTK RichTextBox contracts";auto& host=static_cast<GtkHost&>(*runtime.host);
    Module module;module.name="RichForm";module.kind="form";module.form=spec("Form","RichForm");module.controls.push_back(spec("RichTextBox","Editor"));module.controls.push_back(spec("TextBox","Plain"));
    int changes=0,selections=0;Procedure change;change.name="editor_change";change.code=[&](Frame&){++changes;return Value{};};module.procedures[change.name]=change;
    Procedure selected;selected.name="editor_selchange";selected.code=[&](Frame&){++selections;return Value{};};module.procedures[selected.name]=selected;
    runtime.modules["richform"]=module;auto form=runtime.instance("RichForm");runtime.load(form);
    auto editor=std::dynamic_pointer_cast<GtkControl>(form->controls.at("editor"));auto plain=std::dynamic_pointer_cast<GtkControl>(form->controls.at("plain"));
    require(GTK_IS_TEXT_VIEW(editor->widget),"RichTextBox is not native GtkTextView");
    editor->set(runtime,"text",Value::string(u"plain BOLD tail"));editor->editSelect(6,4);changes=0;
    editor->set(runtime,"selbold",Value::boolean(true));require(changes==1,"Selection formatting must emit one Change");
    editor->set(runtime,"selitalic",Value::boolean(true));editor->set(runtime,"selunderline",Value::boolean(true));editor->set(runtime,"selstrikethru",Value::boolean(true));
    editor->set(runtime,"selfontsize",Value::real(12.5));editor->set(runtime,"selcolor",Value::integer(255));editor->set(runtime,"selbackcolor",Value::integer(65280));
    require(editor->editSelection()==std::make_pair(size_t(6),size_t(4)),"Formatting disturbed UTF-16 selection");
    auto* buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));GtkTextIter iter;gtk_text_buffer_get_iter_at_offset(buffer,&iter,6);auto* attributes=gtk_text_attributes_new();gtk_text_iter_get_attributes(&iter,attributes);
    require(pango_font_description_get_weight(attributes->font)==PANGO_WEIGHT_BOLD&&attributes->appearance.underline==PANGO_UNDERLINE_SINGLE,"VB formatting did not reach actual GTK text tags");gtk_text_attributes_unref(attributes);
    auto fragment=editor->get(runtime,"selrtf");editor->editSelect(0,10);require(editor->get(runtime,"selbold").type==Type::Null,"Mixed rich selection did not return Null");
    editor->set(runtime,"text",Value::string(u"# tail"));editor->editSelect(0,1);auto parsedFragment=gtkRtfParse(gtkRtfBytes(fragment.string()));require(parsedFragment.text==u"BOLD","Selected fragment parser text differs");editor->set(runtime,"selrtf",fragment);
    require(editor->editText()==u"BOLD tail"&&editor->editSelection()==std::make_pair(size_t(4),size_t(0)),"SelRTF replacement lost text or caret position");
    editor->editSelect(0,4);require(editor->get(runtime,"selbold").truth()&&editor->get(runtime,"selitalic").truth(),"SelRTF did not preserve attributes");
    editor->editSelect(2,0);editor->set(runtime,"selrtf",Value::string(u"{\\rtf1\\qr fragment\\par\\qc next}"));
    auto paste=gtkRichSnapshot(*editor);same(paste,gtkRtfParse(gtkRtfWrite(paste)));
    editor->editSelect(2,1);require(editor->get(runtime,"selalignment").integral()==0,"Fragment paragraph formatting changed an existing paragraph's leading style");
    editor->editSelect(11,1);require(editor->get(runtime,"selalignment").integral()==2,"Inserted new paragraph did not use fragment paragraph formatting");
    editor->set(runtime,"text",Value::string(u"# tail"));editor->editSelect(0,1);editor->set(runtime,"selrtf",fragment);editor->editSelect(0,4);
    auto preserved=editor->get(runtime,"textrtf");auto selectedRange=editor->editSelection();changes=0;
    for(const auto& rtf:{u"bad",u"{\\rtf1 incomplete",u"{\\rtf1{\\pict xx}}"})error(rtf==Text(u"{\\rtf1{\\pict xx}}")?453:380,[&]{editor->set(runtime,"textrtf",Value::string(rtf));});
    error(380,[&]{editor->set(runtime,"selfontsize",Value::integer(0));});error(380,[&]{editor->set(runtime,"selbold",Value::null());});
    require(editor->get(runtime,"textrtf").string()==preserved.string()&&editor->editSelection()==selectedRange&&changes==0,"Failed RTF/formatting update was not transactional");
    error(438,[&]{plain->set(runtime,"selbold",Value::boolean(true));});
    editor->editSelect(4,0);editor->set(runtime,"selbold",Value::boolean(false));editor->set(runtime,"selitalic",Value::boolean(false));editor->set(runtime,"selfontsize",Value::real(14));changes=0;
    buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));gtk_text_buffer_insert_at_cursor(buffer," native",-1);host.check();
    require(changes==1&&editor->editText()==u"BOLD native tail","Native text insertion did not emit a single Change");
    editor->editSelect(4,7);require(!editor->get(runtime,"selbold").truth()&&editor->get(runtime,"selfontsize").floating()==14,"Native typed text lost caret formatting");
    editor->set(runtime,"seltext",Value::string(u"\U0001f600"));require(editor->editText()==u"BOLD\U0001f600 tail"&&editor->editSelection().first==6,"SelText did not preserve UTF-16 caret indexing");
    editor->editSelect(0,4);require(editor->get(runtime,"selbold").truth(),"SelText flattened neighboring attributed runs");
    editor->set(runtime,"text",Value::string(u"first\nsecond\n"));editor->editSelect(1,2);editor->set(runtime,"selalignment",Value::integer(2));editor->set(runtime,"selindent",Value::integer(360));editor->set(runtime,"selhangingindent",Value::integer(180));editor->set(runtime,"selrightindent",Value::integer(90));
    editor->set(runtime,"seltabcount",Value::integer(2));editor->invoke(runtime,"let:seltabs",{Arg(Value::integer(0)),Arg(Value::integer(600))});
    require(editor->get(runtime,"selindent").integral()==360&&editor->get(runtime,"selhangingindent").integral()==180&&editor->invoke(runtime,"seltabs",{Arg(Value::integer(0))}).integral()==600,"Paragraph indents/tabs contract is wrong");
    editor->editSelect(0,1);require(editor->get(runtime,"selalignment").integral()==2,"Paragraph formatting failed to expand selection to the first character");
    editor->editSelect(6,1);require(editor->get(runtime,"selalignment").integral()==0,"Paragraph formatting escaped to the next paragraph");
    editor->set(runtime,"selbullet",Value::boolean(true));auto document=gtkRichSnapshot(*editor);same(document,gtkRtfParse(gtkRtfWrite(document)));
    host.formCall(form,"show",{});host.pump(); // Exercise the native bullet drawing path.
    editor->set(runtime,"text",Value::string(u"locked"));editor->editSelect(0,6);editor->set(runtime,"selprotected",Value::boolean(true));
    buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));gtk_text_buffer_get_iter_at_offset(buffer,&iter,2);require(!gtk_text_buffer_insert_interactive(buffer,&iter,"x",-1,TRUE),"SelProtected did not prevent native interactive edits");
    editor->set(runtime,"textrtf",preserved);auto before=editor->get(runtime,"textrtf").string();
    editor->invoke(runtime,"savefile",{Arg(Value::string(u"gtk-richtext-roundtrip.rtf"))});require(!editor->get(runtime,"modified").truth(),"SaveFile did not clear Modified");
    editor->set(runtime,"text",Value::string(u"changed"));editor->invoke(runtime,"loadfile",{Arg(Value::string(u"gtk-richtext-roundtrip.rtf"))});require(editor->get(runtime,"textrtf").string()==before,"Default LoadFile/SaveFile did not roundtrip RTF formatting");
    {std::ofstream file("gtk-richtext-invalid.rtf");file<<"{\\rtf1{\\object invalid}}";}
    auto priorSelection=editor->editSelection();error(453,[&]{editor->invoke(runtime,"loadfile",{Arg(Value::string(u"gtk-richtext-invalid.rtf"))});});
    require(editor->get(runtime,"textrtf").string()==before&&editor->editSelection()==priorSelection,"LoadFile failure replaced the previous document");
    editor->set(runtime,"text",Value::string(u"\u6f22\u5b57 \U0001f600"));editor->invoke(runtime,"savefile",{Arg(Value::string(u"gtk-richtext-utf8.txt")),Arg(Value::integer(1))});editor->set(runtime,"text",Value::string(u""));editor->invoke(runtime,"loadfile",{Arg(Value::string(u"gtk-richtext-utf8.txt")),Arg(Value::integer(1))});require(editor->editText()==u"\u6f22\u5b57 \U0001f600","Explicit plain UTF-8 file persistence lost Unicode");
    require(editor->invoke(runtime,"find",{Arg(Value::string(u"\U0001f600"))}).integral()==3,"Find returned a scalar offset instead of UTF-16 offset");
    require(selections>0,"RichTextBox SelChange did not dispatch");
    for(const char* name:{"gtk-richtext-roundtrip.rtf","gtk-richtext-invalid.rtf","gtk-richtext-utf8.txt"})std::filesystem::remove(name);
    runtime.unload(form);error(91,[&]{editor->get(runtime,"textrtf");});runtime.stop();
    std::cout<<"LINUX_GTK_RICHTEXT_OK\n";return 0;
  }catch(const Error& e){std::cerr<<"GTK RichTextBox VB error "<<e.number<<": "<<e.what()<<"\n";return 1;}
  catch(const std::exception& e){std::cerr<<"GTK RichTextBox contract failure: "<<e.what()<<"\n";return 1;}
}
