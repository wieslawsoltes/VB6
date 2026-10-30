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
  for(size_t i=0;i<a.text.size();++i)if(at(a,i)!=at(b,i))throw std::runtime_error("RTF roundtrip changed attributes at UTF-16 offset "+std::to_string(i)+" in ["+toUTF8(a.text.substr(0,80))+"]");
  require(a.emptyStyle==b.emptyStyle,"RTF roundtrip changed trailing insertion style");
  require(a.fields==b.fields,"RTF roundtrip changed inert field instructions or ranges");
  require(a.objects.size()==b.objects.size(),"RTF roundtrip dropped embedded objects");
  if(!a.objects.empty())require(gtkRtfWrite(a)==gtkRtfWrite(b),"RTF roundtrip changed structured object content");
}
const std::string redPixel="89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082";
const std::string modernLists=R"({\rtf1\deff0{\fonttbl{\f0 Sans;}{\f1\fcharset2 Symbol;}{\f2 Serif;}}{\colortbl;\red255\green0\blue0;}{\*\listtable{\list\listhybrid{\listlevel\levelnfc1\levelstartat4\leveljc2{\leveltext\'02\'00.;}{\levelnumbers\'01;}\f2\fs28\b\cf1\li720\fi-360\jclisttab\tx720}{\listlevel\levelnfc0\levelstartat2\levellegal1\levelnorestart1{\leveltext\'04\'00.\'01);}{\levelnumbers\'01\'03;}\li1440\fi-360\tx1440}\listid11}{\list\listsimple{\listlevel\levelnfc23{\leveltext\'01\'b7;}{\levelnumbers;}\f1\li720\fi-360\tx720}\listid22}}{\*\listoverridetable{\listoverride\listid11\listoverridecount0\ls1}{\listoverride\listid11\listoverridecount1{\lfolevel\listoverridestartat\levelstartat8}\ls2}{\listoverride\listid22\listoverridecount0\ls3}})";
std::string hexBytes(const std::string& bytes){static const char digits[]="0123456789abcdef";std::string value;for(auto ch:bytes){value+=digits[uint8_t(ch)>>4];value+=digits[uint8_t(ch)&15];}return value;}
GtkWidget* anchoredWidget(GtkTextChildAnchor* anchor) {
#if GTK_MAJOR_VERSION < 4
  auto* widgets=gtk_text_child_anchor_get_widgets(anchor);auto* result=widgets?GTK_WIDGET(widgets->data):nullptr;g_list_free(widgets);return result;
#else
  guint count=0;auto** widgets=gtk_text_child_anchor_get_widgets(anchor,&count);auto* result=count?widgets[0]:nullptr;g_free(widgets);return result;
#endif
}
GtkWidget* richChild(GtkWidget* widget) {
  if(GTK_IS_TEXT_VIEW(widget))return widget;
#if GTK_MAJOR_VERSION < 4
  if(!GTK_IS_CONTAINER(widget))return nullptr;auto* children=gtk_container_get_children(GTK_CONTAINER(widget));GtkWidget* found=nullptr;for(auto* item=children;item&&!found;item=item->next)found=richChild(GTK_WIDGET(item->data));g_list_free(children);return found;
#else
  for(auto* child=gtk_widget_get_first_child(widget);child;child=gtk_widget_get_next_sibling(child))if(auto* found=richChild(child))return found;return nullptr;
#endif
}
void settle(GtkHost& host){for(int i=0;i<24;++i){host.pump();g_usleep(2000);}}
std::array<int,4> markerPixels(GtkControl& control) {
  auto* surface=cairo_image_surface_create(CAIRO_FORMAT_ARGB32,1024,512);auto* context=cairo_create(surface);gtkRichDraw(control,context);cairo_destroy(context);cairo_surface_flush(surface);
  int left=1024,top=512,right=-1,bottom=-1;const auto* data=cairo_image_surface_get_data(surface);const int stride=cairo_image_surface_get_stride(surface);
  for(int y=0;y<512;++y){const auto* row=reinterpret_cast<const uint32_t*>(data+y*stride);for(int x=0;x<1024;++x){const auto color=row[x];if((color>>24)>32&&((color>>16)&255)>32&&((color>>8)&255)<20&&(color&255)<20){left=std::min(left,x);right=std::max(right,x);top=std::min(top,y);bottom=std::max(bottom,y);}}}
  cairo_surface_destroy(surface);return {left,top,right-left+1,bottom-top+1};
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
  auto numbers=gtkRtfParse(R"({\rtf1{\*\pn\pnlvlbody\pnucrm\pnstart4{\pntxtb (}{\pntxta )}}first\par second})");
  require(at(numbers,0).paragraph.numbering==2&&gtkRtfListMarker(at(numbers,0).paragraph,4)==u"(IV)","Numbered paragraphs lost their numbering format or affixes");same(numbers,gtkRtfParse(gtkRtfWrite(numbers)));
  auto custom=gtkRtfParse(R"({\rtf1{\listtext 2.3.\tab}section})");require(custom.text==u"section"&&at(custom,0).paragraph.marker==u"2.3.","Explicit multilevel list marker was discarded");same(custom,gtkRtfParse(gtkRtfWrite(custom)));
  auto modern=gtkRtfParse(modernLists+R"(\pard\ls1\ilvl0 First\par\pard\ls1\ilvl1 SubA\par\pard\ls1\ilvl0 Second\par\pard\ls1\ilvl1 SubB\par\pard\ls2\ilvl0 Restart\par\pard\ls1\ilvl0 Resume\par\pard\ls3 Bullet})");
  require(at(modern,0).paragraph.marker==u"IV."&&at(modern,modern.text.find(u"SubA")).paragraph.marker==u"4.2)"&&at(modern,modern.text.find(u"SubB")).paragraph.marker==u"5.3)"&&at(modern,modern.text.find(u"Restart")).paragraph.marker==u"VIII."&&at(modern,modern.text.find(u"Resume")).paragraph.marker==u"VI."&&at(modern,modern.text.find(u"Bullet")).paragraph.marker==u"\u2022","Modern list counters, legal numbering, no-restart or override identities were lost");
  require(at(modern,0).paragraph.markerFont==u"Serif"&&at(modern,0).paragraph.markerSize==14&&at(modern,0).paragraph.markerBold==1&&at(modern,0).paragraph.markerColor==255&&at(modern,0).paragraph.markerAlignment==2,"Modern list marker character formatting was discarded");same(modern,gtkRtfParse(gtkRtfWrite(modern)));
  auto explicitModern=gtkRtfParse(modernLists+R"(\pard\ls1\ilvl1{\listtext 9.8)\tab}Explicit\par\pard\li2160\fi-720\ls1\ilvl0 Indented})");require(at(explicitModern,0).paragraph.marker==u"9.8)"&&at(explicitModern,explicitModern.text.find(u"Indented")).paragraph.left==2160&&at(explicitModern,explicitModern.text.find(u"Indented")).paragraph.first==-720,"Explicit marker result or paragraph list override was lost");same(explicitModern,gtkRtfParse(gtkRtfWrite(explicitModern)));
  auto styledMarker=gtkRtfParse(R"({\rtf1{\fonttbl{\f0 Sans;}{\f1 Serif;}}{\colortbl;\red255\green0\blue0;}{\pntext\f1\fs30\b\i\cf1 Label\tab}body})");require(at(styledMarker,0).paragraph.marker==u"Label"&&at(styledMarker,0).paragraph.markerFont==u"Serif"&&at(styledMarker,0).paragraph.markerSize==15&&at(styledMarker,0).paragraph.markerBold==1&&at(styledMarker,0).paragraph.markerItalic==1&&at(styledMarker,0).paragraph.markerColor==255,"Standalone styled list marker was lost");same(styledMarker,gtkRtfParse(gtkRtfWrite(styledMarker)));
  auto automaticMarker=gtkRtfParse(R"({\rtf1{\colortbl;\red255\green0\blue0;}\cf1{\pntext\cf0 Label\tab}body})");require(at(automaticMarker,0).paragraph.markerColor==-1&&at(automaticMarker,0).foreground==255,"Automatic marker color was confused with inherited body color");same(automaticMarker,gtkRtfParse(gtkRtfWrite(automaticMarker)));
  auto maximumMarker=gtkRtfParse("{\\rtf1{\\pntext "+std::string(64,'X')+"}body}");require(at(maximumMarker,0).paragraph.marker.size()==64,"Maximum-size list marker was truncated");same(maximumMarker,gtkRtfParse(gtkRtfWrite(maximumMarker)));error(7,[&]{gtkRtfParse("{\\rtf1{\\pntext "+std::string(65,'X')+"\\tab}body}");});
  auto maximumAffix=gtkRtfParse("{\\rtf1{\\*\\pn\\pnlvlbody\\pndec{\\pntxtb "+std::string(64,'X')+"}}body}");require(at(maximumAffix,0).paragraph.numberBefore.size()==64,"Maximum-size numbering affix was truncated");same(maximumAffix,gtkRtfParse(gtkRtfWrite(maximumAffix)));error(7,[&]{gtkRtfParse("{\\rtf1{\\*\\pn\\pnlvlbody\\pndec{\\pntxtb "+std::string(65,'X')+"}}body}");});
  auto resetLists=modernLists;resetLists.replace(resetLists.find("\\levelnorestart1"),std::string("\\levelnorestart1").size(),"\\levelnorestart0");auto resetting=gtkRtfParse(resetLists+R"(\ls1 First\par\ilvl1 Child\par\ilvl0 Second\par\ilvl1 Reset})");require(at(resetting,resetting.text.find(u"Reset")).paragraph.marker==u"5.2)","Subordinate list numbering did not restart after its ancestor advanced");same(resetting,gtkRtfParse(gtkRtfWrite(resetting)));
  auto changedLists=modernLists;const std::string oldOverride=R"(\listoverride\listid11\listoverridecount1{\lfolevel\listoverridestartat\levelstartat8}\ls2)";changedLists.replace(changedLists.find(oldOverride),oldOverride.size(),R"(\listoverride\listid11\listoverridecount1{\lfolevel\listoverrideformat{\listlevel\levelnfc3\levelstartat3\leveljc1{\leveltext\'02\'00);}{\levelnumbers\'01;}\f2\fs32\i\cf0\li1080\fi-360\tx1080}}\ls2)");auto overriddenList=gtkRtfParse(changedLists+R"(\ls2 Override})");require(at(overriddenList,0).paragraph.marker==u"C)"&&at(overriddenList,0).paragraph.markerItalic==1&&at(overriddenList,0).paragraph.markerSize==16&&at(overriddenList,0).paragraph.markerAlignment==1&&at(overriddenList,0).paragraph.markerColor==-1,"List level formatting override did not replace the base definition");same(overriddenList,gtkRtfParse(gtkRtfWrite(overriddenList)));
  auto unnumberedLists=modernLists;unnumberedLists.replace(unnumberedLists.find("\\levelnfc23"),std::string("\\levelnfc23").size(),"\\levelnfc255");auto unnumbered=gtkRtfParse(unnumberedLists+R"(\ls3 Bullet})");require(at(unnumbered,0).paragraph.marker==u"\u2022","Unnumbered literal list marker was lost");same(unnumbered,gtkRtfParse(gtkRtfWrite(unnumbered)));
  error(453,[&]{gtkRtfParse(R"({\rtf1{\pntext{\b A}B\tab}body})");});
  for(const auto& suffix:{R"(\ls99 text})",R"(\ls1\ilvl8 text})"})error(380,[&]{gtkRtfParse(modernLists+suffix);});
  auto badLevels=modernLists;badLevels.replace(badLevels.find("\\levelnumbers\\'01;"),std::string("\\levelnumbers\\'01;").size(),"\\levelnumbers\\'02;");error(380,[&]{gtkRtfParse(badLevels+"text}");});
  auto futureLevel=modernLists;futureLevel.replace(futureLevel.find("\\leveltext\\'02\\'00.;"),std::string("\\leveltext\\'02\\'00.;").size(),"\\leveltext\\'02\\'01.;");error(380,[&]{gtkRtfParse(futureLevel+R"(\ls1{\listtext Explicit\tab}text})");});
  auto wrongLength=modernLists;wrongLength.replace(wrongLength.find("\\leveltext\\'02\\'00.;"),std::string("\\leveltext\\'02\\'00.;").size(),"\\leveltext\\'03\\'00.;");error(380,[&]{gtkRtfParse(wrongLength+"text}");});
  auto unsupportedLevels=modernLists;unsupportedLevels.insert(unsupportedLevels.find("\\levelstartat4"),"\\levelfollow1");error(453,[&]{gtkRtfParse(unsupportedLevels+"text}");});
  auto spacing=gtkRtfParse(R"({\rtf1\deftab360\sl480\slmult1\tqr\tx720\tqc\tx1440\tqdec\tx2160 first\tab second\tab 12.34\par last})");
  require(at(spacing,0).paragraph.tabAlignments==std::vector<int>({1,2,3})&&at(spacing,0).paragraph.lineSpacing==480&&at(spacing,0).paragraph.lineMultiple==1&&at(spacing,0).paragraph.defaultTab==360,"RTF aligned tabs or multiple line spacing were discarded");same(spacing,gtkRtfParse(gtkRtfWrite(spacing)));
  auto fields=gtkRtfParse(R"({\rtf1 before {\field\fldlock{\*\fldinst HYPERLINK "https://example.org"}{\fldrslt\b Example}} after {\field{\*\fldinst LINK external-file}{\fldrslt cached}}})");
  require(fields.text==u"before Example after cached"&&fields.fields.size()==2&&fields.fields[0].first==7&&fields.fields[0].last==14&&fields.fields[0].locked&&fields.fields[1].instruction==u"LINK external-file","Inert field results or instructions were lost");same(fields,gtkRtfParse(gtkRtfWrite(fields)));
  auto nestedFields=gtkRtfParse(R"({\rtf1{\field{\*\fldinst IF 1}{\fldrslt a{\field{\*\fldinst PAGE}{\fldrslt 2}}z}}})");same(nestedFields,gtkRtfParse(gtkRtfWrite(nestedFields)));
  error(380,[&]{gtkRtfParse(R"({\rtf1{\field{\*\fldinst PAGE}}})");});
  auto picture=gtkRtfParse("{\\rtf1 before{\\pict\\pngblip\\picwgoal300\\pichgoal300 "+redPixel+"}after}");require(picture.text==u"before\ufffcafter"&&picture.objects.size()==1&&picture.objects[0].width==1&&picture.objects[0].widthGoal==300,"RTF picture bytes, geometry or object anchor were lost");same(picture,gtkRtfParse(gtkRtfWrite(picture)));
  const auto binaryPicture="{\\rtf1{\\pict\\pngblip\\bin"+std::to_string(picture.objects[0].bytes.size())+" "+picture.objects[0].bytes+"}}";auto binaryImage=gtkRtfParse(binaryPicture);require(binaryImage.objects[0].bytes==picture.objects[0].bytes,"Binary RTF image data was not preserved");same(binaryImage,gtkRtfParse(gtkRtfWrite(binaryImage)));
  const auto pictureGroup="{\\pict\\pngblip "+redPixel+"}";auto preferredPicture=gtkRtfParse("{\\rtf1{\\*\\shppict"+pictureGroup+"}{\\nonshppict{\\pict\\wmetafile8 00}}}");require(preferredPicture.objects.size()==1&&preferredPicture.text==u"\ufffc","Preferred picture duplicated its obsolete fallback");same(preferredPicture,gtkRtfParse(gtkRtfWrite(preferredPicture)));
  auto unrelatedPictures=gtkRtfParse("{\\rtf1"+pictureGroup+"{\\nonshppict"+pictureGroup+"}}");require(unrelatedPictures.objects.size()==2&&unrelatedPictures.text==u"\ufffc\ufffc","Unpaired picture fallback was discarded after an unrelated picture");same(unrelatedPictures,gtkRtfParse(gtkRtfWrite(unrelatedPictures)));
  error(453,[&]{gtkRtfParse("{\\rtf1"+pictureGroup+"{\\nonshppict{\\pict\\wmetafile8 00}}}");});error(380,[&]{gtkRtfParse("{\\rtf1{\\*\\shppict"+pictureGroup+"}{\\nonshppict visible text}}");});
  auto table=gtkRtfParse(R"({\rtf1 Before{\trowd\trleft0\trgaph60\clbrdrt\brdrs\brdrw30\cellx1440\clvertalc\cellx2880\intbl\b Left\cell\b0 Right\cell\row}After})");
  require(table.text==u"Before\n\ufffc\nAfter"&&table.objects.size()==1&&table.objects[0].cells.size()==2&&table.objects[0].cells[0].content->text==u"Left"&&table.objects[0].cells[1].content->text==u"Right"&&table.objects[0].cells[0].borders[0].width==30,"RTF table structure, cell text or borders were lost");same(table,gtkRtfParse(gtkRtfWrite(table)));
  auto nestedTable=gtkRtfParse(R"({\rtf1{\trowd\cellx2880 outer{\trowd\cellx1440 inner\nestcell\nestrow}\cell\row}})");same(nestedTable,gtkRtfParse(gtkRtfWrite(nestedTable)));
  auto regions=gtkRtfParse(R"({\rtf1{\header\b Header}body{\footnote Note}{\footer Footer}{\object\objemb{\*\objclass Word.Document}{\*\objdata 00010203}{\result\i Cached preview}}})");
  require(regions.objects.size()==4&&regions.objects[0].content->text==u"Header"&&regions.objects[1].content->text==u"Note"&&regions.objects[3].bytes==std::string("\0\1\2\3",4)&&regions.objects[3].content->text==u"Cached preview","Page regions or inert OLE result data were lost");same(regions,gtkRtfParse(gtkRtfWrite(regions)));
  for(const auto& input:{"{\\rtf1{\\pict\\pngblip deadbeef}}","{\\rtf1\\trowd\\cell text}","{\\rtf1\\trowd\\cellx1440 text\\row}","{\\rtf1\\trowd\\clmrg\\cellx1440\\cell\\row}"})error(380,[&]{gtkRtfParse(input);});
  auto symbol=gtkRtfParse(R"({\rtf1{\fonttbl{\f0\fcharset2 Symbol;}{\f1\fcharset42 Custom;}}\f0\u65?\u945?\f1\u66?})");
  require(symbol.text==u"A\u03b1B"&&at(symbol,0).charset==2&&at(symbol,2).charset==42,"Explicit Unicode with legacy font charset was lost");same(symbol,gtkRtfParse(gtkRtfWrite(symbol)));
  auto symbolBytes=gtkRtfParse(R"({\rtf1{\fonttbl{\f0\fcharset2 Symbol;}}\f0 ABab\'b7\'a5\'e5\\\u92?})");require(symbolBytes.text==u"\u0391\u0392\u03b1\u03b2\u2022\u221e\u2211\u2234\\","Legacy Symbol bytes were not decoded into portable Unicode");same(symbolBytes,gtkRtfParse(gtkRtfWrite(symbolBytes)));
  error(453,[&]{gtkRtfParse(R"({\rtf1{\fonttbl{\f0\fcharset2 Symbol;}}\f0\'e6})");});
  for(const auto& input:{R"({\rtf1\chftn})",R"({\rtf1{\trowd\trrh-200\cellx1440 text\cell\row}})",R"({\rtf1{\trowd\trleft-100\cellx1440 text\cell\row}})",R"({\rtf1{\trowd\trautofit1\cellx1440 text\cell\row}})",R"({\rtf1{\object\objscalex200{\result preview}}})"})error(453,[&]{gtkRtfParse(input);});
  auto scaledBudget=picture;scaledBudget.objects[0].widthGoal=scaledBudget.objects[0].heightGoal=61440;error(7,[&]{gtkRtfValidateObjects(scaledBudget);});
  auto fieldBudget=regions;fieldBudget.objects[0].content->fields.resize(2050);fieldBudget.objects[1].content->fields.resize(2050);error(7,[&]{gtkRtfValidateObjects(fieldBudget);});
  auto overriddenScript=gtkRtfParse(R"({\rtf1\up6\super superscript\dn3 baseline})");same(overriddenScript,gtkRtfParse(gtkRtfWrite(overriddenScript)));
  auto nativeUnsupported=symbol;nativeUnsupported.runs.front().style.paragraph.lineExtra=15;error(453,[&]{gtkRtfWrite(nativeUnsupported);});
  auto scopedParagraph=gtkRtfParse(R"({\rtf1{\qc centered}})");same(scopedParagraph,gtkRtfParse(gtkRtfWrite(scopedParagraph)));
  auto paragraphSeparators=gtkRtfParse(R"({\rtf1\qc one\u13?\u10?\qr two\u8233?\ql three\u13?})");same(paragraphSeparators,gtkRtfParse(gtkRtfWrite(paragraphSeparators)));
  auto info=gtkRtfParse(R"({\rtf1{\info{\title Example}{\author Test}}{\*\generator VB6;}\paperw12240\paperh15840 text})");
  auto saved=gtkRtfWrite(info);require(saved.find("\\title Example")!=std::string::npos&&saved.find("\\paperw12240")!=std::string::npos,"RTF metadata was not preserved");
  for(const std::string input:{"", "{\\rtf1", "{\\rtf1 ok}}", "{\\rtf1 ok}garbage", "{\\rtf1\\'xy}", "{\\rtf1\\u-10179?}", "{\\rtf1\\bin999 xx}", "{\\rtf1\\cf20 x}", "{\\rtf1\\fs99999999999 x}", "{\\rtf1{\\stylesheet{\\s1\\sbasedon2 A;}{\\s2\\sbasedon1 B;}}\\s1 x}"})error(380,[&]{gtkRtfParse(input);});
  for(const std::string input:{R"({\rtf1{\object\objdata 00}})",R"({\rtf1\ulw text})",R"({\rtf1{\*\unknownFeature ignored}})"})error(453,[&]{gtkRtfParse(input);});
  error(7,[&]{gtkRtfParse("{\\rtf1"+std::string(256,'{')+"x"+std::string(257,'}'));});
  error(7,[&]{gtkRtfParse(std::string(GtkRtfMaxBytes+1,'x'));});
  error(380,[&]{gtkRtfParse(std::string("{\\rtf1 a")+'\0'+"b}");});
  std::cout<<"LINUX_RTF_PARSER_OK\n";
}
ControlSpec spec(const std::string& type,const std::string& name){ControlSpec value;value.type=type;value.name=name;value.properties={{"width",Value::integer(6000)},{"height",Value::integer(3000)}};return value;}
}
int main() {
  try {
    parser();
#ifdef VB6_RTF_PARSER_ONLY
    return 0;
#else
    Runtime runtime(makeNativeHost());runtime.name="GTK RichTextBox contracts";auto& host=static_cast<GtkHost&>(*runtime.host);
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
    auto* buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));GtkTextIter iter;gtk_text_buffer_get_iter_at_offset(buffer,&iter,6);
#if GTK_MAJOR_VERSION < 4
    auto* attributes=gtk_text_attributes_new();gtk_text_iter_get_attributes(&iter,attributes);
    require(pango_font_description_get_weight(attributes->font)==PANGO_WEIGHT_BOLD&&attributes->appearance.underline==PANGO_UNDERLINE_SINGLE,"VB formatting did not reach actual GTK text tags");gtk_text_attributes_unref(attributes);
#else
    auto* actualTags=gtk_text_iter_get_tags(&iter);require(actualTags,"VB formatting did not create native text tags");int weight=0,underline=0;g_object_get(actualTags->data,"weight",&weight,"underline",&underline,nullptr);g_slist_free(actualTags);require(weight==PANGO_WEIGHT_BOLD&&underline==PANGO_UNDERLINE_SINGLE,"VB formatting did not reach actual GTK4 text tags");
#endif
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
    editor->set(runtime,"textrtf",Value::string(u"{\\rtf1\\sl480\\slmult1\\tqr\\tx1440 A\\tab B\\par C}"));
    buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));gtk_text_buffer_get_start_iter(buffer,&iter);auto* aligned=gtk_text_iter_get_tags(&iter);require(aligned,"Native spacing tag missing");PangoTabArray* tabs=nullptr;g_object_get(aligned->data,"tabs",&tabs,nullptr);PangoTabAlign alignment;int position;pango_tab_array_get_tab(tabs,0,&alignment,&position);require(alignment==PANGO_TAB_RIGHT&&position==96,"RTF tab alignment did not reach Pango");pango_tab_array_free(tabs);
#if GTK_MAJOR_VERSION >= 4
    float lineHeight=0;g_object_get(aligned->data,"line-height",&lineHeight,nullptr);require(lineHeight>1.99f&&lineHeight<2.01f,"RTF double spacing did not reach GTK4 line-height");
#else
    int lineExtra=0;g_object_get(aligned->data,"pixels-inside-wrap",&lineExtra,nullptr);require(lineExtra>0,"RTF double spacing did not reach native wrapped-line geometry");
#endif
    g_slist_free(aligned);same(gtkRichSnapshot(*editor),gtkRtfParse(gtkRtfWrite(gtkRichSnapshot(*editor))));
    editor->set(runtime,"textrtf",Value::string(u"{\\rtf1\\fs24 A\\par B}"));settle(host);buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));GtkTextIter lineA,lineB;GdkRectangle lineRectA,lineRectB;gtk_text_buffer_get_iter_at_offset(buffer,&lineA,0);gtk_text_buffer_get_iter_at_offset(buffer,&lineB,2);gtk_text_view_get_iter_location(GTK_TEXT_VIEW(editor->widget),&lineA,&lineRectA);gtk_text_view_get_iter_location(GTK_TEXT_VIEW(editor->widget),&lineB,&lineRectB);const int naturalAdvance=lineRectB.y-lineRectA.y;
#if GTK_MAJOR_VERSION >= 4
    editor->set(runtime,"textrtf",Value::string(u"{\\rtf1\\fs24\\sl120\\slmult1 A\\par B}"));settle(host);buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));gtk_text_buffer_get_iter_at_offset(buffer,&lineA,0);gtk_text_buffer_get_iter_at_offset(buffer,&lineB,2);gtk_text_view_get_iter_location(GTK_TEXT_VIEW(editor->widget),&lineA,&lineRectA);gtk_text_view_get_iter_location(GTK_TEXT_VIEW(editor->widget),&lineB,&lineRectB);require(lineRectB.y>lineRectA.y&&lineRectB.y-lineRectA.y<naturalAdvance,"GTK4 compressed spacing did not reduce actual native line advance");auto* compactTags=gtk_text_iter_get_tags(&lineA);float compactHeight=0;g_object_get(compactTags->data,"line-height",&compactHeight,nullptr);g_slist_free(compactTags);require(compactHeight>0.49f&&compactHeight<0.51f,"GTK4 compressed line-height factor was lost");same(gtkRichSnapshot(*editor),gtkRtfParse(gtkRtfWrite(gtkRichSnapshot(*editor))));
#else
    require(naturalAdvance>0,"GTK3 did not allocate native line geometry");editor->editSelect(0,1);const auto beforeCompression=editor->get(runtime,"textrtf").string();const auto compressionSelection=editor->editSelection();const auto compressionModified=editor->get(runtime,"modified").truth();changes=0;for(const auto& input:{u"{\\rtf1\\fs24\\sl120\\slmult1 A\\par B}",u"{\\rtf1\\fs24\\sl-60 A\\par B}"})error(453,[&]{editor->set(runtime,"textrtf",Value::string(input));});require(editor->get(runtime,"textrtf").string()==beforeCompression&&editor->editSelection()==compressionSelection&&editor->get(runtime,"modified").truth()==compressionModified&&changes==0,"GTK3 compressed spacing rejection was not transactional");
#endif
    editor->set(runtime,"textrtf",Value::string(fromUTF8(modernLists+R"(\pard\ls1\ilvl0 First})")));settle(host);const auto smallMarker=markerPixels(*editor);require(smallMarker[2]>0&&smallMarker[3]>0,"Styled modern list marker did not render red native pixels");auto largeMarker=gtkRichSnapshot(*editor);for(auto& run:largeMarker.runs)run.style.paragraph.markerSize=28;largeMarker.emptyStyle.paragraph.markerSize=28;editor->set(runtime,"textrtf",Value::string(fromUTF8(gtkRtfWrite(largeMarker))));settle(host);const auto largePixels=markerPixels(*editor);require(largePixels[3]>smallMarker[3],"Marker font size did not change actual native glyph geometry");same(gtkRichSnapshot(*editor),gtkRtfParse(gtkRtfWrite(gtkRichSnapshot(*editor))));
    editor->set(runtime,"textrtf",Value::string(u"{\\rtf1 before {\\field{\\*\\fldinst HYPERLINK \"https://example.org\"}{\\fldrslt value}} tail}"));editor->editSelect(10,0);buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));gtk_text_buffer_insert_at_cursor(buffer,"-edit-",-1);host.check();
    auto changedField=gtkRichSnapshot(*editor);require(changedField.fields.size()==1&&changedField.fields[0].first==7&&changedField.fields[0].last==18&&changedField.fields[0].instruction==u"HYPERLINK \"https://example.org\"","Native editing did not track the field result marks");same(changedField,gtkRtfParse(gtkRtfWrite(changedField)));
    editor->editSelect(7,11);auto fieldFragment=editor->get(runtime,"selrtf");editor->set(runtime,"text",Value::string(u"paste: "));editor->editSelect(7,0);editor->set(runtime,"selrtf",fieldFragment);require(gtkRichSnapshot(*editor).fields.size()==1,"SelRTF lost a complete field wrapper");
    editor->set(runtime,"textrtf",Value::string(fromUTF8("{\\rtf1 before{\\pict\\pngblip\\picwgoal300\\pichgoal300 "+redPixel+"}after}")));buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));gtk_text_buffer_get_iter_at_offset(buffer,&iter,6);
#if GTK_MAJOR_VERSION < 4
    auto* pixels=gtk_text_iter_get_pixbuf(&iter);require(pixels&&gdk_pixbuf_get_width(pixels)==20&&gdk_pixbuf_get_height(pixels)==20&&gdk_pixbuf_get_pixels(pixels)[0]==255,"RTF picture did not create the expected native red image pixels");
#else
    auto* pixels=gtk_text_iter_get_paintable(&iter);require(GDK_IS_TEXTURE(pixels)&&gdk_texture_get_width(GDK_TEXTURE(pixels))==20&&gdk_texture_get_height(GDK_TEXTURE(pixels))==20,"RTF picture did not create the expected GTK4 texture");std::array<guchar,1600> rgba{};gdk_texture_download(GDK_TEXTURE(pixels),rgba.data(),80);require(rgba[2]==255&&rgba[3]==255,"RTF picture texture lost its red pixel content");
#endif
    require(editor->editText()==u"before\ufffcafter","Native embedded image lost its UTF-16 text anchor");editor->editSelect(6,1);auto pictureFragment=editor->get(runtime,"selrtf");editor->set(runtime,"selbold",Value::boolean(true));same(gtkRichSnapshot(*editor),gtkRtfParse(gtkRtfWrite(gtkRichSnapshot(*editor))));
    editor->set(runtime,"seltext",Value::string(u"x"));require(gtkRichSnapshot(*editor).objects.empty(),"Replacing an image did not release its object model");editor->editSelect(6,1);editor->set(runtime,"selrtf",pictureFragment);require(gtkRichSnapshot(*editor).objects.size()==1,"SelRTF did not restore an inline picture");
    const auto imageBefore=editor->get(runtime,"textrtf").string();auto damaged=gtkRtfParse(gtkRtfBytes(imageBefore));damaged.objects[0].bytes[damaged.objects[0].bytes.size()-18]^=1;error(380,[&]{editor->set(runtime,"textrtf",Value::string(fromUTF8(gtkRtfWrite(damaged))));});require(editor->get(runtime,"textrtf").string()==imageBefore,"Image decode failure changed the existing buffer");
    for(const auto* codec:{"jpeg","bmp"}){auto* source=gdk_pixbuf_new(GDK_COLORSPACE_RGB,FALSE,8,2,2);gdk_pixbuf_fill(source,0x208040ff);gchar* data=nullptr;gsize length=0;require(gdk_pixbuf_save_to_buffer(source,&data,&length,codec,nullptr,nullptr),"Cannot prepare native image codec fixture");g_object_unref(source);std::string bytes(data,length);g_free(data);if(std::string(codec)=="bmp")bytes.erase(0,14);editor->set(runtime,"textrtf",Value::string(fromUTF8("{\\rtf1{\\pict\\"+std::string(codec==std::string("bmp")?"dibitmap0":"jpegblip")+" "+hexBytes(bytes)+"}}")));auto snap=gtkRichSnapshot(*editor);require(snap.objects.size()==1&&snap.objects[0].bytes==bytes,"Native JPEG/DIB interchange lost original encoded bytes");same(snap,gtkRtfParse(gtkRtfWrite(snap)));}
    editor->set(runtime,"textrtf",Value::string(u"{\\rtf1 Before{\\trowd\\trgaph60\\clbrdrt\\brdrs\\cellx1440\\cellx2880\\b Left\\cell\\b0 Right\\cell\\row}After}"));buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));gtk_text_buffer_get_iter_at_offset(buffer,&iter,7);auto* anchor=gtk_text_iter_get_child_anchor(&iter);require(anchor,"Table row did not create a native child anchor");auto* grid=anchoredWidget(anchor);require(GTK_IS_GRID(grid),"RTF table was not rendered with native GtkGrid cells");auto* cell=richChild(gtk_grid_get_child_at(GTK_GRID(grid),0,0));require(GTK_IS_TEXT_VIEW(cell),"Table cell does not contain an editable native rich text view");changes=0;gtk_text_buffer_insert_at_cursor(gtk_text_view_get_buffer(GTK_TEXT_VIEW(cell)),"edited ",-1);host.check();auto editedTable=gtkRichSnapshot(*editor);require(editedTable.objects[0].cells[0].content->text.find(u"edited ")!=Text::npos&&changes==1&&editor->get(runtime,"modified").truth(),"Native table cell edits did not persist or dispatch one outer Change");same(editedTable,gtkRtfParse(gtkRtfWrite(editedTable)));
    editor->editSelect(8,1);auto tableBefore=editor->get(runtime,"textrtf").string();error(380,[&]{editor->set(runtime,"seltext",Value::string(u"partial"));});require(editor->get(runtime,"textrtf").string()==tableBefore,"Partial object replacement was not transactional");
    buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));GtkTextIter a,b;gtk_text_buffer_get_iter_at_offset(buffer,&a,8);gtk_text_buffer_get_iter_at_offset(buffer,&b,9);gtk_text_buffer_delete(buffer,&a,&b);host.check();require(editor->editText()==u"Before\nAfter"&&gtkRichSnapshot(*editor).objects.empty(),"Native deletion did not remove the complete atomic table object");
    for(const auto& alignment:{"trql","trqc","trqr"}){editor->set(runtime,"textrtf",Value::string(fromUTF8("{\\rtf1{\\trowd\\"+std::string(alignment)+"\\cellx1440 cell\\cell\\row}}")));settle(host);buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));gtk_text_buffer_get_start_iter(buffer,&iter);GdkRectangle rectangle;gtk_text_view_get_iter_location(GTK_TEXT_VIEW(editor->widget),&iter,&rectangle);auto* row=anchoredWidget(gtk_text_iter_get_child_anchor(&iter));require(gtk_widget_get_allocated_width(row)==96,"Native table cell boundaries did not allocate the requested width");const auto available=gtk_widget_get_allocated_width(editor->widget);const int expected=std::string(alignment)=="trqc"?(available-96)/2:std::string(alignment)=="trqr"?available-96:0;if(std::abs(rectangle.x-expected)>3)throw std::runtime_error("Native table alignment has x="+std::to_string(rectangle.x)+", expected "+std::to_string(expected));same(gtkRichSnapshot(*editor),gtkRtfParse(gtkRtfWrite(gtkRichSnapshot(*editor))));editor->editSelect(2,0);gtk_text_buffer_insert_at_cursor(buffer,"after",-1);host.check();require(editor->editText()==u"\ufffc\nafter","Typing after an aligned table did not create normal following paragraph text");same(gtkRichSnapshot(*editor),gtkRtfParse(gtkRtfWrite(gtkRichSnapshot(*editor))));}
    editor->set(runtime,"textrtf",Value::string(u"{\\rtf1{\\header\\b Heading}body{\\footnote note}{\\object\\objemb{\\*\\objclass Test.Class}{\\*\\objdata 0102}{\\result cached}}}"));same(gtkRichSnapshot(*editor),gtkRtfParse(gtkRtfWrite(gtkRichSnapshot(*editor))));host.pump();
    editor->set(runtime,"text",Value::string(u"locked"));editor->editSelect(0,6);editor->set(runtime,"selprotected",Value::boolean(true));
    buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(editor->widget));gtk_text_buffer_get_iter_at_offset(buffer,&iter,2);require(!gtk_text_buffer_insert_interactive(buffer,&iter,"x",-1,TRUE),"SelProtected did not prevent native interactive edits");
    editor->set(runtime,"textrtf",preserved);auto before=editor->get(runtime,"textrtf").string();
    editor->invoke(runtime,"savefile",{Arg(Value::string(u"gtk-richtext-roundtrip.rtf"))});require(!editor->get(runtime,"modified").truth(),"SaveFile did not clear Modified");
    editor->set(runtime,"text",Value::string(u"changed"));editor->invoke(runtime,"loadfile",{Arg(Value::string(u"gtk-richtext-roundtrip.rtf"))});require(editor->get(runtime,"textrtf").string()==before,"Default LoadFile/SaveFile did not roundtrip RTF formatting");
    {std::ofstream file("gtk-richtext-invalid.rtf");file<<"{\\rtf1{\\object invalid}}";}
    auto priorSelection=editor->editSelection();error(380,[&]{editor->invoke(runtime,"loadfile",{Arg(Value::string(u"gtk-richtext-invalid.rtf"))});});
    require(editor->get(runtime,"textrtf").string()==before&&editor->editSelection()==priorSelection,"LoadFile failure replaced the previous document");
    editor->set(runtime,"text",Value::string(u"\u6f22\u5b57 \U0001f600"));editor->invoke(runtime,"savefile",{Arg(Value::string(u"gtk-richtext-utf8.txt")),Arg(Value::integer(1))});editor->set(runtime,"text",Value::string(u""));editor->invoke(runtime,"loadfile",{Arg(Value::string(u"gtk-richtext-utf8.txt")),Arg(Value::integer(1))});require(editor->editText()==u"\u6f22\u5b57 \U0001f600","Explicit plain UTF-8 file persistence lost Unicode");
    require(editor->invoke(runtime,"find",{Arg(Value::string(u"\U0001f600"))}).integral()==3,"Find returned a scalar offset instead of UTF-16 offset");
    require(selections>0,"RichTextBox SelChange did not dispatch");
    for(const char* name:{"gtk-richtext-roundtrip.rtf","gtk-richtext-invalid.rtf","gtk-richtext-utf8.txt"})std::filesystem::remove(name);
    runtime.unload(form);error(91,[&]{editor->get(runtime,"textrtf");});runtime.stop();
    std::cout<<"LINUX_GTK_RICHTEXT_OK\n";return 0;
#endif
  }catch(const Error& e){std::cerr<<"GTK RichTextBox VB error "<<e.number<<": "<<e.what()<<"\n";return 1;}
  catch(const std::exception& e){std::cerr<<"GTK RichTextBox contract failure: "<<e.what()<<"\n";return 1;}
}
