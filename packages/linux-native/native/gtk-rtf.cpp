// RTF reader/writer for the native GTK text buffer. MIT.
// Reference: https://learn.microsoft.com/en-us/previous-versions/office/developer/office2000/aa140284(v=office.10)
// A group-scoped reader, never a regex text stripper. Unsupported visible
// destinations fail before the caller replaces any native text or formatting.
#include "gtk-rtf.hpp"
#include <glib.h>
#include <string_view>
#include <limits>

namespace vb6 {
bool gtkRtfParagraphEnd(const Text& text,size_t position) noexcept {
  auto ch=text[position];return ch==u'\n'||ch==u'\u2029'||(ch==u'\r'&&(position+1==text.size()||text[position+1]!=u'\n'));
}
void gtkRtfValidateText(const Text& text) {
  if(text.size()>GtkRtfMaxText)fail(7,"RichTextBox text exceeds 4 Mi UTF-16 units");
  for(size_t i=0;i<text.size();++i) {
    auto ch=text[i];
    if(!ch)fail(380,"RichTextBox cannot contain an embedded NUL");
    if(ch>=0xd800&&ch<=0xdbff) {
      if(i+1==text.size()||text[i+1]<0xdc00||text[i+1]>0xdfff)fail(380,"Invalid Unicode surrogate in rich text");
      ++i;
    }else if(ch>=0xdc00&&ch<=0xdfff)fail(380,"Invalid Unicode surrogate in rich text");
  }
}
void gtkRtfAppend(GtkRtfDocument& document,const Text& text,const GtkRtfStyle& style) {
  if(text.empty())return;
  if(text.size()>GtkRtfMaxText-document.text.size())fail(7,"RichTextBox text exceeds 4 Mi UTF-16 units");
  const auto first=document.text.size();document.text+=text;
  if(!document.runs.empty()&&document.runs.back().last==first&&document.runs.back().style==style)document.runs.back().last=document.text.size();
  else {
    if(document.runs.size()>=GtkRtfMaxRuns)fail(7,"RTF exceeds 65536 formatting runs");
    document.runs.push_back({first,document.text.size(),style});
  }
  document.emptyStyle=style;
}
std::string gtkRtfBytes(const Text& text) {
  if(text.size()>GtkRtfMaxBytes)fail(7,"RTF input exceeds 16 MiB");
  std::string result;result.reserve(text.size());
  for(auto ch:text){if(ch>255||!ch)fail(380,"RTF strings must contain RTF bytes; encode Unicode with \\u escapes");result+=char(ch);}
  return result;
}
Text gtkRtfDecode(const std::string& bytes,int codepage) {
  if(bytes.empty())return {};
  if(bytes.size()>GtkRtfMaxBytes)fail(7);
  if(bytes.find('\0')!=std::string::npos)fail(380,"Embedded NUL in RTF character data");
  const auto encoding=codepage==10000?std::string("MACINTOSH"):codepage==65001?std::string("UTF-8"):"CP"+std::to_string(codepage);
  gsize length=0;GError* error=nullptr;
  auto* output=g_convert(bytes.data(),gssize(bytes.size()),"UTF-8",encoding.c_str(),nullptr,&length,&error);
  if(!output) {
    const bool unavailable=error&&error->code==G_CONVERT_ERROR_NO_CONVERSION;
    if(error)g_error_free(error);
    fail(unavailable?453:380,unavailable?"Unsupported RTF code page "+std::to_string(codepage):"Invalid byte sequence for RTF code page "+std::to_string(codepage));
  }
  std::unique_ptr<gchar,decltype(&g_free)> owned(output,g_free);
  if(length>GtkRtfMaxBytes)fail(7);
  auto result=fromUTF8(std::string(output,length));gtkRtfValidateText(result);return result;
}

namespace {
[[noreturn]] void invalid(const std::string& message) {fail(380,"Invalid RTF: "+message);}
[[noreturn]] void unsupported(const std::string& word) {fail(453,"Unsupported RTF control \\"+word+"; the document was not changed");}
bool letter(char value) {return (value>='a'&&value<='z')||(value>='A'&&value<='Z');}
int hex(char value) {return value>='0'&&value<='9'?value-'0':value>='a'&&value<='f'?value-'a'+10:value>='A'&&value<='F'?value-'A'+10:-1;}
struct Token {
  enum Kind {Open,Close,Word,Symbol,Bytes,End} kind=End;
  std::string name;
  int64_t number=0;
  bool parameter=false;
  size_t first=0,last=0;
  std::string_view bytes;
};
class Lexer {
  const std::string& input;
  size_t at=0,count=0;
public:
  explicit Lexer(const std::string& value):input(value){}
  Token next() {
    while(at<input.size()&&(input[at]=='\r'||input[at]=='\n'))++at;
    Token token;token.first=at;
    if(at==input.size())return token;
    if(++count>4*1024*1024)fail(7,"RTF token limit exceeded");
    auto ch=input[at++];
    if(!ch)invalid("embedded NUL");
    if(ch=='{'||ch=='}')token.kind=ch=='{'?Token::Open:Token::Close;
    else if(ch!='\\') {
      token.kind=Token::Bytes;
      while(at<input.size()&&input[at]!='{'&&input[at]!='}'&&input[at]!='\\'&&input[at]!='\r'&&input[at]!='\n')++at;
      token.bytes=std::string_view(input).substr(token.first,at-token.first);
      if(token.bytes.find('\0')!=std::string_view::npos)invalid("embedded NUL outside binary destination");
    }else {
      if(at==input.size())invalid("trailing backslash");
      ch=input[at++];
      if(!letter(ch)) {
        token.kind=Token::Symbol;token.name=ch;
        if(ch=='\'') {
          if(at+2>input.size()||hex(input[at])<0||hex(input[at+1])<0)invalid("invalid hexadecimal escape");
          token.number=hex(input[at])*16+hex(input[at+1]);at+=2;
        }else if(ch=='\r'||ch=='\n') {
          if(ch=='\r'&&at<input.size()&&input[at]=='\n')++at;
          token.kind=Token::Word;token.name="par";
        }
      }else {
        token.kind=Token::Word;auto first=at-1;
        while(at<input.size()&&letter(input[at]))++at;
        if(at-first>32)invalid("control word is longer than 32 characters");
        token.name=input.substr(first,at-first);
        bool negative=false;
        if(at<input.size()&&input[at]=='-'){negative=true;++at;if(at==input.size()||input[at]<'0'||input[at]>'9')invalid("invalid numeric parameter");}
        uint64_t number=0;
        while(at<input.size()&&input[at]>='0'&&input[at]<='9') {
          token.parameter=true;auto digit=uint64_t(input[at++]-'0');
          if(number>(uint64_t(INT32_MAX)+1-digit)/10)invalid("numeric parameter overflow");
          number=number*10+digit;
        }
        if(number>uint64_t(INT32_MAX)+(negative?1:0))invalid("numeric parameter overflow");
        token.number=negative?-int64_t(number):int64_t(number);
        if(at<input.size()&&input[at]==' ')++at;
        if(token.name=="bin") {
          if(!token.parameter||token.number<0||uint64_t(token.number)>input.size()-at)invalid("truncated binary destination");
          token.bytes=std::string_view(input).substr(at,size_t(token.number));at+=size_t(token.number);
        }
      }
    }
    token.last=at;return token;
  }
};
struct Font {int id=0,charset=0,codepage=0;Text name;};
struct StyleDefinition {int id=0,base=-1;bool character=false,additive=false;Text name;std::vector<Token> controls;};
enum class Destination {Body,Fonts,Colors,Styles,Skip,Bullet,BulletText};
struct State {
  GtkRtfStyle style;
  Destination destination=Destination::Body;
  int font=-1,codepage=1252,unicodeFallback=1;
  bool first=true,optional=false,preserve=false;
  size_t groupStart=0;
  std::shared_ptr<Font> fontEntry;
  std::shared_ptr<StyleDefinition> styleEntry;
  bool ownsFont=false,ownsStyle=false;
  int red=-1,green=-1,blue=-1;
  int alternatives=0;
  bool bulletKind=false;
  bool listMarker=false;
  Text bulletText;
  int lineSpacing=0,lineMultiple=0;
};
int required(const Token& token,int minimum,int maximum) {
  if(!token.parameter||token.number<minimum||token.number>maximum)invalid("out-of-range \\"+token.name);
  return int(token.number);
}
bool byteCharset(int charset) {
  switch(charset) {
    case 0:case 1:case 77:case 128:case 129:case 130:case 134:case 136:case 161:case 162:case 163:
    case 177:case 178:case 186:case 204:case 222:case 238:case 255:return true;
    default:return false;
  }
}
int charsetCodepage(int charset,int fallback) {
  switch(charset) {
    case 0:case 1:return fallback;case 77:return 10000;case 128:return 932;case 129:return 949;case 130:return 1361;
    case 134:return 936;case 136:return 950;case 161:return 1253;case 162:return 1254;case 163:return 1258;
    case 177:return 1255;case 178:return 1256;case 186:return 1257;case 204:return 1251;case 222:return 874;
    case 238:return 1250;case 255:return 437;case 2:unsupported("fcharset2 (legacy Symbol character encoding)");
    default:unsupported("fcharset"+std::to_string(charset));
  }
}
class Reader {
  const std::string& input;
  Lexer lexer;
  State state;
  std::vector<State> groups;
  std::map<int,Font> fonts;
  std::vector<int> colors;
  std::map<std::pair<bool,int>,StyleDefinition> styles;
  GtkRtfDocument result;
  std::string encoded;
  int encodedPage=1252,skip=0,defaultFont=-1;
  size_t paragraphFirst=0;
  GtkRtfParagraph paragraph;
  bool header=false,finished=false;

  int page() const {
    if(state.destination==Destination::Fonts&&state.fontEntry)return state.fontEntry->codepage?state.fontEntry->codepage:!byteCharset(state.fontEntry->charset)?state.codepage:charsetCodepage(state.fontEntry->charset,state.codepage);
    auto font=fonts.find(state.font);
    return font==fonts.end()?state.codepage:font->second.codepage?font->second.codepage:charsetCodepage(font->second.charset,state.codepage);
  }
  void selectFont(State& target,int id) {
    auto found=fonts.find(id);if(found==fonts.end())invalid("undefined font \\f"+std::to_string(id));
    target.font=id;target.style.font=found->second.name;target.style.charset=found->second.charset;
  }
  void defaults(State& target,bool characters=true,bool paragraphs=true) {
    if(characters){auto original=target.style.paragraph;target.style=GtkRtfStyle{};target.style.paragraph=original;target.font=-1;if(defaultFont>=0)selectFont(target,defaultFont);}
    if(paragraphs){target.style.paragraph=GtkRtfParagraph{};target.lineSpacing=target.lineMultiple=0;}
  }
  void finishParagraph() {
    for(size_t i=paragraphFirst;i<result.runs.size();++i)result.runs[i].style.paragraph=paragraph;
    paragraphFirst=result.runs.size();
  }
  void bodyText(const Text& value) {
    if(state.font<0&&defaultFont>=0)selectFont(state,defaultFont);
    if(state.lineSpacing!=0&&!(state.lineSpacing==240&&state.lineMultiple==1))unsupported("sl (non-default line spacing)");
    if(state.listMarker&&!state.style.paragraph.bullet)unsupported("pntext (list has no supported bullet definition)");
    state.listMarker=false;
    paragraph=state.style.paragraph;
    auto append=[&](const Text& part) {
      if(part.empty())return;
      if(paragraphFirst==result.runs.size()&&!result.runs.empty()&&result.runs.back().style==state.style) {
        if(result.runs.size()>=GtkRtfMaxRuns)fail(7,"RTF formatting run limit exceeded");
        const auto start=result.text.size();if(part.size()>GtkRtfMaxText-start)fail(7);
        result.text+=part;result.runs.push_back({start,result.text.size(),state.style});result.emptyStyle=state.style;
      }else gtkRtfAppend(result,part,state.style);
    };
    size_t first=0;
    for(size_t i=0;i<value.size();++i)if(gtkRtfParagraphEnd(value,i)) {
      // Keep a boundary after each paragraph until paragraph formatting has
      // been finalized; a following paragraph can choose a different style.
      append(value.substr(first,i-first+1));finishParagraph();first=i+1;
    }
    if(first<value.size())append(value.substr(first));
  }
  void text(const Text& value) {
    if(value.empty())return;
    switch(state.destination) {
      case Destination::Body:bodyText(value);break;
      case Destination::Fonts:
        if(!state.fontEntry){for(auto ch:value)if(ch!=u' '&&ch!=u'\t')invalid("font name without font ID");break;}
        for(auto ch:value){if(ch==u';'){finishFont();}else if(state.fontEntry){state.fontEntry->name+=ch;if(state.fontEntry->name.size()>255)invalid("font name is too long");}else if(ch!=u' '&&ch!=u'\t')invalid("text after font terminator");}break;
      case Destination::Styles:
        if(!state.styleEntry){state.styleEntry=std::make_shared<StyleDefinition>();state.ownsStyle=true;}
        for(auto ch:value){if(ch==u';')finishStyle();else if(state.styleEntry){state.styleEntry->name+=ch;if(state.styleEntry->name.size()>255)invalid("style name is too long");}else if(ch!=u' '&&ch!=u'\t')invalid("text after style terminator");}break;
      case Destination::Colors:
        for(auto ch:value)if(ch==u';') {
          if(colors.size()>=GtkRtfMaxTable)fail(7,"RTF color table is too large");
          colors.push_back(state.red<0&&state.green<0&&state.blue<0?-1:std::max(0,state.red)|(std::max(0,state.green)<<8)|(std::max(0,state.blue)<<16));state.red=state.green=state.blue=-1;
        }else if(ch!=u' '&&ch!=u'\t')invalid("text in color table");break;
      case Destination::BulletText:state.bulletText+=value;if(state.bulletText.size()>32)unsupported("pntxtb (custom list marker)");break;
      case Destination::Bullet:for(auto ch:value)if(ch!=u' '&&ch!=u'\t')unsupported("pn (custom list content)");break;
      case Destination::Skip:break;
    }
  }
  void flush() {
    if(encoded.empty())return;auto pending=std::move(encoded);encoded.clear();text(gtkRtfDecode(pending,encodedPage));
  }
  void bytes(std::string_view value) {
    if(state.destination==Destination::Skip)return;
    if(skip){auto count=std::min(size_t(skip),value.size());value.remove_prefix(count);skip-=int(count);}
    if(value.empty())return;
    auto codepage=page();if(!encoded.empty()&&codepage!=encodedPage)flush();encodedPage=codepage;
    if(value.size()>GtkRtfMaxBytes-encoded.size())fail(7);encoded.append(value.data(),value.size());
  }
  void finishFont() {
    if(!state.fontEntry)return;
    auto entry=*state.fontEntry;
    while(!entry.name.empty()&&(entry.name.back()==u' '||entry.name.back()==u'\t'))entry.name.pop_back();
    while(!entry.name.empty()&&(entry.name.front()==u' '||entry.name.front()==u'\t'))entry.name.erase(entry.name.begin());
    if(entry.name.empty())invalid("empty font name");
    gtkRtfValidateText(entry.name);
    if(fonts.count(entry.id))invalid("duplicate font ID");
    if(fonts.size()>=GtkRtfMaxTable)fail(7,"RTF font table is too large");
    fonts.emplace(entry.id,std::move(entry));state.fontEntry.reset();state.ownsFont=false;
  }
  void finishStyle() {
    if(!state.styleEntry)return;
    const auto key=std::make_pair(state.styleEntry->character,state.styleEntry->id);
    if(styles.count(key))invalid("duplicate style ID");
    if(styles.size()>=GtkRtfMaxTable)fail(7,"RTF style table is too large");
    styles.emplace(key,*state.styleEntry);state.styleEntry.reset();state.ownsStyle=false;
  }
  int color(const Token& token) const {
    auto index=required(token,0,int(GtkRtfMaxTable)-1);
    if(index==0&&colors.empty())return -1;
    if(size_t(index)>=colors.size())invalid("undefined color table index");
    return colors[size_t(index)];
  }
  bool format(State& target,const Token& token) {
    const auto& word=token.name;auto& style=target.style;auto& para=style.paragraph;const bool on=!token.parameter||token.number!=0;
    if(word=="b")style.bold=on;else if(word=="i")style.italic=on;else if(word=="strike")style.strike=on;
    else if(word=="v")style.hidden=on;else if(word=="protect")style.protectedText=on;else if(word=="scaps")style.smallCaps=on;
    else if(word=="ul")style.underline=on?1:0;else if(word=="ulnone")style.underline=0;else if(word=="uldb")style.underline=on?2:0;else if(word=="ulwave")style.underline=on?3:0;
    else if(word=="f")selectFont(target,required(token,0,INT32_MAX));
    else if(word=="fs")style.size=required(token,1,6144)/2.0;
    else if(word=="fsmilli")style.size=required(token,1,3072000)/1000.0;
    else if(word=="cf")style.foreground=color(token);else if(word=="cb"||word=="highlight")style.background=color(token);
    else if(word=="up"){style.rise=(token.parameter?required(token,0,31680):6)*10;style.script=0;}
    else if(word=="dn"){style.rise=-(token.parameter?required(token,0,31680):6)*10;style.script=0;}
    else if(word=="super"){style.script=1;style.rise=0;}
    else if(word=="sub"){style.script=-1;style.rise=0;}
    else if(word=="nosupersub"){style.rise=0;style.script=0;}
    else if(word=="expndtw")style.spacing=required(token,-31680,31680);
    else if(word=="expnd")style.spacing=required(token,-6336,6336)*5;
    else if(word=="lang"||word=="langfe"||word=="langnp"||word=="langfenp")style.language=required(token,0,65535);
    else if(word=="plain")defaults(target,true,false);
    else if(word=="pard")defaults(target,false,true);
    else if(word=="ql")para.alignment=0;else if(word=="qr")para.alignment=1;else if(word=="qc")para.alignment=2;else if(word=="qj")para.alignment=3;
    else if(word=="li")para.left=required(token,0,31680);else if(word=="ri")para.right=required(token,0,31680);else if(word=="fi")para.first=required(token,-31680,31680);
    else if(word=="sb")para.before=required(token,0,31680);else if(word=="sa")para.after=required(token,0,31680);
    else if(word=="ltrpar")para.rtl=false;else if(word=="rtlpar")para.rtl=true;
    else if(word=="tx") {auto value=required(token,0,31680);if(para.tabs.size()>=64)fail(7,"RTF paragraph exceeds 64 tab stops");if(!para.tabs.empty()&&value<=para.tabs.back())invalid("tab stops are not increasing");para.tabs.push_back(value);}
    else if(word=="tql"){} // GTK3's baseline Pango contract supports left tabs.
    else if(word=="sl")target.lineSpacing=required(token,-31680,31680);
    else if(word=="slmult")target.lineMultiple=required(token,0,1);
    else if(word=="pnnone")para.bullet=false;
    else return false;
    return true;
  }
  void applyStyle(State& target,int id,bool character,std::set<std::pair<bool,int>>& visiting) {
    const auto key=std::make_pair(character,id);auto found=styles.find(key);
    if(found==styles.end()){if(!character&&id==0)return;invalid("undefined style");}
    if(visiting.size()>=128)fail(7,"RTF style inheritance exceeds 128 levels");
    if(!visiting.insert(key).second)invalid("cyclic style inheritance");
    if(found->second.base>=0&&found->second.base!=id)applyStyle(target,found->second.base,character,visiting);
    for(const auto& token:found->second.controls)if(!format(target,token))unsupported(token.name);
    visiting.erase(key);
  }
  void word(const Token& token) {
    const auto& name=token.name;
    if(state.destination==Destination::Skip)return;
    if(name=="rtf"){if(header||!state.first||groups.size()!=1||required(token,1,1)!=1)invalid("invalid RTF header");header=true;return;}
    if(!header)invalid("missing RTF header");
    if(name=="fonttbl"||name=="colortbl"||name=="stylesheet") {
      if(!state.first||state.destination!=Destination::Body||!result.text.empty())invalid("misplaced header table");
      state.destination=name=="fonttbl"?Destination::Fonts:name=="colortbl"?Destination::Colors:Destination::Styles;
      state.fontEntry.reset();state.styleEntry.reset();state.ownsFont=state.ownsStyle=false;return;
    }
    static const std::set<std::string> visibleDestinations={"pict","shppict","nonshppict","object","objdata","field","fldinst","fldrslt","footnote","endnote","annotation","header","headerl","headerr","headerf","footer","footerl","footerr","footerf","shp","shpinst","shptxt","do","listtable","listoverridetable","listtext","nesttableprops","mmath","mObj"};
    if(visibleDestinations.count(name))unsupported(name);
    static const std::set<std::string> metadataDestinations={"info","generator","xmlnstbl","revtbl","rsidtbl","filetbl","themedata","colorschememapping","latentstyles","datastore","docvar","bkmkstart","bkmkend","atnauthor","atnid"};
    if(state.first&&metadataDestinations.count(name)) {state.preserve=state.destination==Destination::Body;state.destination=Destination::Skip;return;}
    if(state.optional&&state.first&&name!="ud"&&name!="cs"&&name!="pn"&&name!="falt"&&name!="panose") {
      // Unknown optional groups may describe future visible formatting. Diagnose
      // them instead of silently deleting bytes from a subsequently saved file.
      unsupported(name+" (optional destination)");
    }
    if(state.destination==Destination::Fonts) {
      if(name=="f"){if(state.fontEntry)invalid("unterminated font entry");state.fontEntry=std::make_shared<Font>();state.fontEntry->id=required(token,0,INT32_MAX);state.ownsFont=true;}
      else if(name=="fcharset"){if(!state.fontEntry)invalid("font charset before font ID");state.fontEntry->charset=required(token,0,255);}
      else if(name=="cpg"){if(!state.fontEntry)invalid("font code page before font ID");state.fontEntry->codepage=required(token,1,65535);}
      else if(name=="falt"||name=="panose"){if(!state.first)invalid("misplaced font metadata");state.destination=Destination::Skip;}
      else if(name=="fnil"||name=="froman"||name=="fswiss"||name=="fmodern"||name=="fscript"||name=="fdecor"||name=="ftech"||name=="fbidi"||name=="fprq"){}
      else if(name=="u"||name=="uc")unicode(token);else unsupported(name);
      return;
    }
    if(state.destination==Destination::Colors) {
      if(name=="red")state.red=required(token,0,255);else if(name=="green")state.green=required(token,0,255);else if(name=="blue")state.blue=required(token,0,255);else unsupported(name);return;
    }
    if(state.destination==Destination::Styles) {
      if(!state.styleEntry){state.styleEntry=std::make_shared<StyleDefinition>();state.ownsStyle=true;}
      if(name=="s"||name=="cs"){state.styleEntry->id=required(token,0,INT32_MAX);state.styleEntry->character=name=="cs";}
      else if(name=="sbasedon")state.styleEntry->base=required(token,0,INT32_MAX);
      else if(name=="additive")state.styleEntry->additive=true;
      else if(name=="snext"||name=="sautoupd"||name=="slink"||name=="slocked"||name=="shidden"||name=="sqformat"||name=="spriority"||name=="sunhideused"||name=="ssemihidden"||name=="styrsid"){}
      else if(name=="u"||name=="uc")unicode(token);
      else {if(state.styleEntry->controls.size()>=256)fail(7,"RTF style has too many properties");state.styleEntry->controls.push_back(token);}
      return;
    }
    if(name=="pntext") {if(!state.first)invalid("misplaced list marker");state.destination=Destination::Skip;state.listMarker=true;return;}
    if(name=="pn") {if(!state.first)invalid("misplaced bullet definition");state.destination=Destination::Bullet;return;}
    if(state.destination==Destination::Bullet||state.destination==Destination::BulletText) {
      if(name=="pnlvlblt")state.bulletKind=true;
      else if(name=="pntxtb"){state.destination=Destination::BulletText;state.bulletText.clear();}
      else if(name=="pntxta"){state.destination=Destination::BulletText;state.bulletText.clear();}
      else if(name=="pnf"||name=="pnfs"||name=="pnindent"||name=="pnstart"||name=="pnhang"){}
      else if(name=="u"||name=="uc")unicode(token);else unsupported(name);
      return;
    }
    if(name=="ansi")state.codepage=1252;else if(name=="mac")state.codepage=10000;else if(name=="pc")state.codepage=437;else if(name=="pca")state.codepage=850;
    else if(name=="ansicpg")state.codepage=required(token,1,65535);
    else if(name=="deff"){if(!result.text.empty())invalid("misplaced default font");defaultFont=required(token,0,INT32_MAX);}
    else if(name=="u"||name=="uc")unicode(token);
    else if(name=="upr") {if(!state.first)invalid("misplaced Unicode alternative group");state.alternatives=1;}
    else if(name=="ud") {if(!state.first||!state.optional)invalid("misplaced Unicode destination");}
    else if(name=="s"||name=="cs") {
      auto id=required(token,0,INT32_MAX);auto original=state.style.paragraph;
      auto found=styles.find({name=="cs",id});
      if(name=="s"||found==styles.end()||!found->second.additive)defaults(state,true,name=="s");
      std::set<std::pair<bool,int>> visiting;applyStyle(state,id,name=="cs",visiting);
      if(name=="cs")state.style.paragraph=original;
    }
    else if(name=="par")text(u"\n");else if(name=="line")text(u"\u2028");else if(name=="tab")text(u"\t");
    else if(name=="emdash")text(u"\u2014");else if(name=="endash")text(u"\u2013");else if(name=="emspace")text(u"\u2003");else if(name=="enspace")text(u"\u2002");else if(name=="qmspace")text(u"\u2005");
    else if(name=="bullet")text(u"\u2022");else if(name=="lquote")text(u"\u2018");else if(name=="rquote")text(u"\u2019");else if(name=="ldblquote")text(u"\u201c");else if(name=="rdblquote")text(u"\u201d");
    else if(format(state,token)){paragraph=state.style.paragraph;}
    else {
      static const std::set<std::string> documentProperties={"deftab","deflang","deflangfe","adeflang","viewkind","viewscale","viewzk","fet","paperw","paperh","margl","margr","margt","margb","gutter","landscape","widowctrl","nowidctlpar","widctlpar","hyphauto","hyphconsec","hyphhotz","hyphcaps","nouicompat","formshade","horzdoc","deftab","sectd","linex","headery","footery","pgwsxn","pghsxn","marglsxn","margrsxn","margtsxn","margbsxn","guttersxn","titlepg","endnhere","ftnbj","ftnstart","aenddoc","noxlattoyen","expshrtn","nouicompat","nocompatoptions","htmautsp","rsidroot","insrsid","charrsid","pararsid","ltrdoc","rtldoc","fet","uc","defchp","defpap","noextrasprl","horzsect","formprot","formdisp","formshade","readonlyrecommended"};
      if(documentProperties.count(name)) {
        if(name=="deftab"&&required(token,1,31680)!=720)unsupported("deftab (non-default automatic tab interval)");
        // Keep document-level information without allowing unbounded duplicates.
        if(result.metadata.size()>=8192)fail(7,"RTF metadata limit exceeded");
        result.metadata.push_back("\\"+name+(token.parameter?std::to_string(token.number):"")+" ");
      }else unsupported(name);
    }
  }
  void unicode(const Token& token) {
    if(token.name=="uc")state.unicodeFallback=required(token,0,255);
    else {auto value=required(token,-32768,65535);text(Text(1,char16_t(uint16_t(value))));skip=state.unicodeFallback;}
  }
public:
  explicit Reader(const std::string& value):input(value),lexer(value){}
  GtkRtfDocument read() {
    if(input.size()>GtkRtfMaxBytes)fail(7,"RTF input exceeds 16 MiB");
    if(input.rfind("{\\rtf",0)!=0)invalid("missing RTF header");
    for(;;) {
      auto token=lexer.next();if(token.kind==Token::End)break;
      if(finished){if(token.kind==Token::Bytes&&token.bytes.find_first_not_of(" \t")==std::string_view::npos)continue;invalid("trailing content after root group");}
      if(token.kind==Token::Open) {
        flush();skip=0;if(groups.size()>=256)fail(7,"RTF nesting exceeds 256 groups");
        auto child=state;child.first=true;child.optional=false;child.preserve=false;child.groupStart=token.first;child.ownsFont=child.ownsStyle=false;child.alternatives=0;
        if(state.alternatives==1){child.destination=Destination::Skip;state.alternatives=2;}
        else if(state.alternatives==2){child.destination=Destination::Body;state.alternatives=3;}
        groups.push_back(state);state=std::move(child);continue;
      }
      if(groups.empty())invalid("content outside root group");
      if(token.kind==Token::Close) {
        flush();skip=0;
        if(state.ownsFont&&state.fontEntry)invalid("font entry is missing its semicolon");
        if(state.ownsStyle&&state.styleEntry)invalid("style entry is missing its semicolon");
        if(state.alternatives&&state.alternatives!=3)invalid("incomplete Unicode alternative");
        auto child=std::move(state);state=std::move(groups.back());groups.pop_back();
        if(child.listMarker)state.listMarker=true;
        if(child.preserve)result.metadata.push_back(input.substr(child.groupStart,token.last-child.groupStart));
        if(child.destination==Destination::BulletText) {
          auto marker=child.bulletText;
          marker.erase(std::remove(marker.begin(),marker.end(),u'\t'),marker.end());
          if(!marker.empty()&&marker!=u"\u2022"&&marker!=u"\u00b7")unsupported("pntxtb (custom list marker)");
        }
        if(child.destination==Destination::Bullet&&state.destination==Destination::Body) {
          if(!child.bulletKind)unsupported("pn (numbered lists)");state.style.paragraph.bullet=true;paragraph=state.style.paragraph;
        }
        if(groups.empty()){if(child.font<0&&defaultFont>=0)selectFont(child,defaultFont);result.emptyStyle=child.style;finished=true;break;}
        continue;
      }
      if(token.kind==Token::Bytes){bytes(token.bytes);state.first=false;continue;}
      if(token.kind==Token::Symbol&&token.name=="'"){char value=char(token.number);bytes(std::string_view(&value,1));state.first=false;continue;}
      flush();
      if(skip) {--skip;continue;}
      if(token.kind==Token::Symbol) {
        if(token.name=="*"){if(!state.first)invalid("misplaced optional destination marker");state.optional=true;continue;}
        if(state.destination!=Destination::Skip) {
          if(token.name=="\\"||token.name=="{"||token.name=="}")text(Text(1,char16_t(token.name[0])));
          else if(token.name=="~")text(u"\u00a0");else if(token.name=="-")text(u"\u00ad");else if(token.name=="_")text(u"\u2011");else unsupported(token.name);
        }
      }else word(token);
      // The header itself precedes the destination/header controls in its root.
      if(token.name!="rtf")state.first=false;
    }
    // Do not accept a valid prefix followed by another RTF group or garbage.
    if(finished)for(auto token=lexer.next();token.kind!=Token::End;token=lexer.next())if(token.kind!=Token::Bytes||token.bytes.find_first_not_of(" \t")!=std::string_view::npos)invalid("trailing content after root group");
    if(!header||!finished||!groups.empty())invalid("unclosed group");
    finishParagraph();gtkRtfValidateText(result.text);
    if(!result.text.empty()&&!gtkRtfParagraphEnd(result.text,result.text.size()-1))result.emptyStyle.paragraph=paragraph;
    for(const auto& entry:styles){State checked;defaults(checked);std::set<std::pair<bool,int>> visiting;applyStyle(checked,entry.first.second,entry.first.first,visiting);}
    // The writer needs scalar-aligned ranges even when \u surrogate halves
    // appeared as separate tokens. A formatting change between halves is invalid.
    for(const auto& run:result.runs)if(run.first&&result.text[run.first]>=0xdc00&&result.text[run.first]<=0xdfff)invalid("formatting changes inside a Unicode surrogate pair");
    return std::move(result);
  }
};
void encodedText(std::string& output,const Text& text,bool font=false,bool unicodeASCII=false) {
  for(auto ch:text) {
    if(ch==u'\\'||ch==u'{'||ch==u'}'){output+='\\';output+=char(ch);}
    else if(ch==u'\n')output+="\\par\n";
    else if(ch==u'\r')output+="\\u13?";
    else if(ch==u'\t')output+="\\tab ";
    else if(ch==0x2028)output+="\\line ";
    else if(ch>=32&&ch<127&&!unicodeASCII&&(!font||ch!=u';'))output+=char(ch);
    else {output+="\\u";output+=std::to_string(int16_t(ch));output+='?';}
    if(output.size()>GtkRtfMaxBytes)fail(7,"Serialized RTF exceeds 16 MiB");
  }
}
}

GtkRtfDocument gtkRtfParse(const std::string& input) {return Reader(input).read();}
std::string gtkRtfWrite(const GtkRtfDocument& document) {
  gtkRtfValidateText(document.text);
  if(document.runs.size()>GtkRtfMaxRuns)fail(7);
  std::map<std::pair<Text,int>,size_t> fonts;
  std::map<int,size_t> colors;
  auto collect=[&](const GtkRtfStyle& style) {
    // A native clipboard/tag client can supply styles beyond this RTF subset.
    // Reject those before serialization instead of writing an unreadable file
    // or silently omitting visible formatting such as custom line spacing.
    gtkRtfValidateText(style.font);
    if(style.font.empty()||style.font.size()>255||style.font.find_first_of(u";\r\n\t")!=Text::npos)invalid("invalid font family");
    if(!std::isfinite(style.size)||style.size<=0||style.size>3072||std::abs(style.size*1000-std::round(style.size*1000))>0.000001)invalid("font size cannot be represented precisely");
    if(style.underline<0||style.underline>3||style.charset<0||style.charset>255||style.language<0||style.language>65535||style.script< -1||style.script>1)invalid("unsupported character format");
    if(style.rise%10||std::abs(int64_t(style.rise))>316800||(style.script&&style.rise))unsupported("up/dn (unrepresentable native baseline)");
    if(std::abs(int64_t(style.spacing))>31680)unsupported("expndtw (native character spacing out of range)");
    for(auto color:{style.foreground,style.background})if(color< -1||color>0xffffff)invalid("invalid color");
    const auto& para=style.paragraph;
    if(para.alignment<0||para.alignment>3||para.left<0||para.right<0||para.left>31680||para.right>31680||std::abs(int64_t(para.first))>31680||para.before<0||para.after<0||para.before>31680||para.after>31680)invalid("invalid paragraph geometry");
    if(para.lineExtra)unsupported("sl (non-default native line spacing)");
    if(para.tabs.size()>64)fail(7,"RTF paragraph exceeds 64 tab stops");
    int previous=-1;for(auto stop:para.tabs){if(stop<0||stop>31680||stop<=previous)invalid("invalid tab stops");previous=stop;}
    if(!fonts.count({style.font,style.charset}))fonts[{style.font,style.charset}]=fonts.size();
    for(auto color:{style.foreground,style.background})if(color>=0&&!colors.count(color))colors[color]=colors.size()+1;
    if(fonts.size()>GtkRtfMaxTable||colors.size()>=GtkRtfMaxTable)fail(7,"RTF font/color table limit exceeded");
  };
  collect(document.emptyStyle);for(const auto& run:document.runs)collect(run.style);
  std::string output="{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl";
  for(const auto& font:fonts){output+="{\\f"+std::to_string(font.second)+"\\fnil\\fcharset"+std::to_string(font.first.second)+" ";encodedText(output,font.first.first,true);output+=";}";}
  output+="}{\\colortbl;";
  std::vector<int> ordered(colors.size());for(const auto& color:colors)ordered[color.second-1]=color.first;
  for(auto color:ordered)output+="\\red"+std::to_string(color&255)+"\\green"+std::to_string((color>>8)&255)+"\\blue"+std::to_string((color>>16)&255)+";";
  output+="}\n";
  for(const auto& metadata:document.metadata){if(metadata.size()>GtkRtfMaxBytes-output.size())fail(7);output+=metadata;}
  auto control=[&](const char* name,int64_t value){output+='\\';output+=name;output+=std::to_string(value);};
  auto formatting=[&](const GtkRtfStyle& style,bool paragraphs=true) {
    output+=paragraphs?"\\pard\\plain":"\\plain";
    control("f",int64_t(fonts.at({style.font,style.charset})));control("fs",int64_t(std::lround(style.size*2)));
    if(std::abs(style.size*2-std::round(style.size*2))>0.000001)control("fsmilli",int64_t(std::lround(style.size*1000)));
    if(style.bold)output+="\\b";if(style.italic)output+="\\i";if(style.strike)output+="\\strike";
    if(style.hidden)output+="\\v";if(style.protectedText)output+="\\protect";if(style.smallCaps)output+="\\scaps";
    if(style.underline)output+=style.underline==2?"\\uldb":style.underline==3?"\\ulwave":"\\ul";
    if(style.foreground>=0)control("cf",int64_t(colors.at(style.foreground)));
    if(style.background>=0)control("highlight",int64_t(colors.at(style.background)));
    if(style.script)output+=style.script>0?"\\super":"\\sub";
    else if(style.rise){if(style.rise%10)fail(380,"RTF baseline offsets require multiples of 10 twips");control(style.rise>0?"up":"dn",std::abs(style.rise)/10);}
    if(style.spacing)control("expndtw",style.spacing);if(style.language)control("lang",style.language);
    if(paragraphs) {
      const auto& para=style.paragraph;
      output+=para.alignment==1?"\\qr":para.alignment==2?"\\qc":para.alignment==3?"\\qj":"\\ql";
      if(para.left)control("li",para.left);if(para.right)control("ri",para.right);if(para.first)control("fi",para.first);
      if(para.before)control("sb",para.before);if(para.after)control("sa",para.after);if(para.rtl)output+="\\rtlpar";
      for(auto tab:para.tabs)control("tx",tab);
      if(para.bullet)output+="{\\*\\pn\\pnlvlblt{\\pntxtb\\u8226?}}";
    }
    if(output.back()!='}')output+=' ';
  };
  size_t previous=0;
  for(const auto& run:document.runs) {
    if(run.first!=previous||run.last<=run.first||run.last>document.text.size())invalid("non-contiguous formatting model");
    formatting(run.style);encodedText(output,document.text.substr(run.first,run.last-run.first),false,!byteCharset(run.style.charset));previous=run.last;
  }
  if(previous!=document.text.size())invalid("text without formatting runs");
  formatting(document.emptyStyle,document.text.empty()||gtkRtfParagraphEnd(document.text,document.text.size()-1));
  output+='}';if(output.size()>GtkRtfMaxBytes)fail(7,"Serialized RTF exceeds 16 MiB");return output;
}
}
