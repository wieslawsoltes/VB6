// RTF reader/writer for the native GTK text buffer. MIT.
// Reference: https://learn.microsoft.com/en-us/previous-versions/office/developer/office2000/aa140284(v=office.10)
// A group-scoped reader, never a regex text stripper. Unsupported visible
// destinations fail before the caller replaces any native text or formatting.
#include "gtk-rtf.hpp"
#include "gtk-symbol.hpp"
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
  if(codepage==42) {
    Text result;result.reserve(bytes.size());
    for(auto byte:bytes){auto value=GtkRtfSymbolCharacters[uint8_t(byte)];if(!value)fail(380,"Undefined byte in RTF Symbol text");if(value>=0xe000&&value<=0xf8ff)fail(453,"Font-private Symbol glyphs have no portable Unicode representation");result+=value;}
    gtkRtfValidateText(result);return result;
  }
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
std::pair<int,int> imageGeometry(const GtkRtfObject& object) {
  const auto& bytes=object.bytes;
  auto u32=[&](size_t offset,bool big){if(offset+4>bytes.size())invalid("truncated image header");uint32_t value=0;for(size_t i=0;i<4;++i)value|=uint32_t(uint8_t(bytes[offset+i]))<<(8*(big?3-i:i));return value;};
  int width=0,height=0;
  if(object.format=="pngblip") {
    if(bytes.size()<33||bytes.compare(0,8,"\x89PNG\r\n\x1a\n",8)||bytes.compare(12,4,"IHDR"))invalid("invalid PNG picture");
    width=int(u32(16,true));height=int(u32(20,true));
  }else if(object.format=="jpegblip") {
    if(bytes.size()<4||uint8_t(bytes[0])!=0xff||uint8_t(bytes[1])!=0xd8)invalid("invalid JPEG picture");
    size_t at=2;
    while(at<bytes.size()) {
      if(uint8_t(bytes[at++])!=0xff)invalid("invalid JPEG marker");while(at<bytes.size()&&uint8_t(bytes[at])==0xff)++at;if(at==bytes.size())break;auto marker=uint8_t(bytes[at++]);
      if(marker==0xda||marker==0xd9)break;if(marker==0x01||(marker>=0xd0&&marker<=0xd8))continue;
      if(at+2>bytes.size())invalid("truncated JPEG segment");size_t length=uint8_t(bytes[at])*256+uint8_t(bytes[at+1]);if(length<2||length>bytes.size()-at)invalid("invalid JPEG segment length");
      if(marker>=0xc0&&marker<=0xcf&&marker!=0xc4&&marker!=0xc8&&marker!=0xcc){if(length<8)invalid("truncated JPEG frame");height=uint8_t(bytes[at+3])*256+uint8_t(bytes[at+4]);width=uint8_t(bytes[at+5])*256+uint8_t(bytes[at+6]);break;}at+=length;
    }
    if(!width||!height)invalid("JPEG picture has no image frame");
  }else if(object.format=="dibitmap") {
    auto header=u32(0,false);if((header!=40&&header!=108&&header!=124)||bytes.size()<header)invalid("unsupported DIB header");
    auto rawHeight=int32_t(u32(8,false));if(rawHeight==INT32_MIN)invalid("invalid DIB height");width=int32_t(u32(4,false));height=std::abs(rawHeight);
  }else unsupported("pict "+object.format);
  if(width<=0||height<=0)invalid("invalid image dimensions");
  if(width>8192||height>8192||uint64_t(width)*height>GtkRtfMaxImagePixels)fail(7,"RTF image exceeds 8192 pixels per side or 16 Mi pixels");
  if((object.width&&object.width!=width)||(object.height&&object.height!=height))invalid("picture dimensions disagree with its encoded image");return {width,height};
}
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
enum class Destination {Body,Fonts,Colors,Styles,Skip,Bullet,BulletText,ListMarker,Field,FieldInstruction};
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
  bool markerAfter=false;
  unsigned markerFlags=0,markerUsedFlags=0,paragraphOverrides=0;
  std::optional<GtkRtfStyle> markerStyle;
  int list=0,level=0;
  int tabAlignment=0;
  std::shared_ptr<GtkRtfField> field;
  bool ownsField=false,fieldResult=false;
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
    case 238:return 1250;case 255:return 437;case 2:return 42;
    default:unsupported("fcharset"+std::to_string(charset));
  }
}
void copyMarkerStyle(GtkRtfParagraph& target,const GtkRtfParagraph& source) {
  target.markerFont=source.markerFont;target.markerSize=source.markerSize;target.markerBold=source.markerBold;target.markerItalic=source.markerItalic;target.markerAlignment=source.markerAlignment;target.markerColor=source.markerColor;
}
class Reader {
  const std::string& input;
  Lexer lexer;
  State state;
  std::vector<State> groups;
  std::map<int,Font> fonts;
  std::vector<int> colors;
  std::map<std::pair<bool,int>,StyleDefinition> styles;
  struct ListLevel {GtkRtfParagraph paragraph;Text pattern;bool legal=false,noRestart=false;};
  std::map<int,std::vector<ListLevel>> lists,overrides;
  struct ListCounter {std::array<int,9> values{};std::array<bool,9> active{};};
  std::map<int,ListCounter> listCounters;
  GtkRtfDocument result;
  std::string encoded;
  int encodedPage=1252,skip=0,defaultFont=-1;
  size_t paragraphFirst=0;
  GtkRtfParagraph paragraph;
  int paragraphList=0,paragraphLevel=0;
  bool header=false,finished=false;
  size_t documentDepth=0;
  std::optional<Token> pendingClose;
  std::optional<std::pair<size_t,size_t>> pictureFallback;
  struct TableContext {
    GtkRtfDocument outer;
    size_t paragraphFirst=0,complete=0;
    GtkRtfParagraph paragraph;
    int list=0,level=0;
    GtkRtfObject row;
    GtkRtfCell cell;
    int border=-1;
  };
  std::vector<TableContext> tables;

  std::string groupBody(const Token& start) {
    size_t depth=1;
    for(;;){auto token=lexer.next();if(token.kind==Token::End)invalid("unclosed destination");if(token.kind==Token::Open){if(++depth+groups.size()>256)fail(7,"RTF nesting exceeds 256 groups");}else if(token.kind==Token::Close&&!--depth){pendingClose=token;return input.substr(start.last,token.first-start.last);}}
  }
  GtkRtfDocument fragment(const std::string& body) {
    if(documentDepth>=16)fail(7,"RTF document nesting exceeds 16 levels");
    const auto wrapped="{\\rtf1 "+body+"}";Reader nested(wrapped);nested.documentDepth=documentDepth+1;
    nested.fonts=fonts;nested.colors=colors;nested.styles=styles;nested.lists=lists;nested.overrides=overrides;nested.defaultFont=defaultFont;nested.state.style=state.style;nested.state.font=state.font;nested.state.codepage=state.codepage;nested.state.unicodeFallback=state.unicodeFallback;
    return nested.read();
  }
  static std::pair<Token,std::string> subdestination(Lexer& parser,const std::string& body) {
    auto header=parser.next();if(header.kind==Token::Symbol&&header.name=="*")header=parser.next();if(header.kind!=Token::Word)invalid("missing list subdestination");
    size_t depth=1;for(;;){auto token=parser.next();if(token.kind==Token::End)invalid("unclosed list destination");if(token.kind==Token::Open){if(++depth>256)fail(7,"RTF list nesting exceeds 256");}else if(token.kind==Token::Close&&!--depth)return {header,body.substr(header.last,token.first-header.last)};}
  }
  Text levelText(const std::string& body,const State& fontState) {
    Lexer parser(body);Text result;std::string bytes;int length=-1,fallback=fontState.unicodeFallback,skipping=0;bool ended=false;
    auto font=fonts.find(fontState.font);const int codepage=font==fonts.end()?state.codepage:font->second.codepage?font->second.codepage:charsetCodepage(font->second.charset,state.codepage);
    auto flushBytes=[&]{if(!bytes.empty()){result+=gtkRtfDecode(bytes,codepage);bytes.clear();}};
    auto byte=[&](unsigned char value,bool terminator){if(skipping){--skipping;return;}if(length<0){length=value;return;}if(terminator&&value==';'){flushBytes();if(ended)invalid("multiple list text terminators");ended=true;return;}if(ended){if(value!=' '&&value!='\t')invalid("text after list text terminator");return;}if(value<9){flushBytes();result+=char16_t(value);}else bytes+=char(value);};
    for(auto token=parser.next();token.kind!=Token::End;token=parser.next()) {
      if(token.kind==Token::Bytes)for(auto value:token.bytes)byte(uint8_t(value),true);
      else if(token.kind==Token::Symbol&&token.name=="'")byte(uint8_t(token.number),false);
      else if(token.kind==Token::Symbol&&(token.name=="\\"||token.name=="{"||token.name=="}"))byte(uint8_t(token.name[0]),false);
      else if(token.kind==Token::Word&&token.name=="uc")fallback=required(token,0,255);
      else if(token.kind==Token::Word&&token.name=="u"){if(length<0||ended)invalid("misplaced Unicode list text");flushBytes();result+=char16_t(uint16_t(required(token,-32768,65535)));skipping=fallback;}
      else if(token.kind==Token::Word&&token.name=="leveltemplateid"){}
      else invalid("invalid leveltext control");
      if(result.size()+bytes.size()>256)fail(7,"List level text exceeds 256 units");
    }
    flushBytes();if(length<0||!ended||skipping||result.size()!=size_t(length))invalid("incorrect list text length or terminator");return result;
  }
  static void levelNumbers(const std::string& body,const Text& pattern) {
    Lexer parser(body);std::vector<unsigned char> offsets;bool ended=false;
    auto add=[&](unsigned char byte){if(ended)invalid("list placeholder after terminator");offsets.push_back(byte);if(offsets.size()>9)invalid("too many list placeholders");};
    for(auto token=parser.next();token.kind!=Token::End;token=parser.next()) {
      if(token.kind==Token::Symbol&&token.name=="'")add(uint8_t(token.number));
      else if(token.kind==Token::Bytes)for(auto byte:token.bytes){if(byte==';'){if(ended)invalid("multiple list number terminators");ended=true;}else if(byte!=' '&&byte!='\t')add(uint8_t(byte));}
      else invalid("invalid levelnumbers control");
    }
    std::vector<unsigned char> expected;for(size_t i=0;i<pattern.size();++i)if(pattern[i]<9)expected.push_back(static_cast<unsigned char>(i+1));
    if(offsets!=expected)invalid("list placeholder offsets disagree with leveltext");
  }
  ListLevel listLevel(const std::string& body) {
    Lexer parser(body);ListLevel level;State fontState;defaults(fontState);int type=0;std::optional<std::string> pattern,numbers;
    for(auto token=parser.next();token.kind!=Token::End;token=parser.next()) {
      if(token.kind==Token::Bytes&&token.bytes.find_first_not_of(" \t")==std::string_view::npos)continue;
      if(token.kind==Token::Open){auto group=subdestination(parser,body);if(group.first.name=="leveltext"){if(pattern)invalid("duplicate leveltext");pattern=group.second;}else if(group.first.name=="levelnumbers"){if(numbers)invalid("duplicate levelnumbers");numbers=group.second;}else unsupported(group.first.name);continue;}
      if(token.kind!=Token::Word)invalid("invalid list level control");const auto& name=token.name;auto& para=level.paragraph;
      if(name=="levelnfc"||name=="levelnfcn")type=required(token,0,255);
      else if(name=="levelstartat")para.numberStart=required(token,1,1000000);
      else if(name=="leveljc"||name=="leveljcn")para.markerAlignment=required(token,0,2);
      else if(name=="levelfollow"){if(required(token,0,2))unsupported("levelfollow (non-tab separator)");}
      else if(name=="levellegal")level.legal=!token.parameter||token.number;
      else if(name=="levelnorestart")level.noRestart=!token.parameter||token.number;
      else if(name=="leveltemplateid"||name=="leveltentative"||name=="jclisttab"){}
      else if(name=="levelspace"||name=="levelindent"||name=="levelold"||name=="levelprev"||name=="levelprevspace"||name=="fbias"){if(!token.parameter||token.number)unsupported(name);}
      else if(name=="f"||name=="fs"||name=="b"||name=="i"||name=="cf") {
        format(fontState,token);if(name=="f")para.markerFont=fontState.style.font;else if(name=="fs")para.markerSize=fontState.style.size;else if(name=="b")para.markerBold=fontState.style.bold;else if(name=="i")para.markerItalic=fontState.style.italic;else para.markerColor=fontState.style.foreground;
      }else if(name=="li"||name=="fi"||name=="tx"||name=="tql"||name=="tqr"||name=="tqc"||name=="tqdec") {
        format(fontState,token);para.left=fontState.style.paragraph.left;para.first=fontState.style.paragraph.first;para.tabs=fontState.style.paragraph.tabs;para.tabAlignments=fontState.style.paragraph.tabAlignments;
      }else unsupported(name+" (list level)");
    }
    if(!pattern||!numbers)invalid("list level is missing text or placeholder offsets");level.pattern=levelText(*pattern,fontState);levelNumbers(*numbers,level.pattern);
    if(type<=4)level.paragraph.numbering=type+1;
    else if(type==23||type==255){if(std::any_of(level.pattern.begin(),level.pattern.end(),[](auto value){return value<9;}))invalid("unnumbered list level has numeric placeholders");level.paragraph.bullet=!level.pattern.empty();}
    else unsupported("levelnfc"+std::to_string(type));
    return level;
  }
  static void validateListLevels(const std::vector<ListLevel>& levels) {
    for(size_t i=0;i<levels.size();++i)for(auto value:levels[i].pattern)if(value<9) {
      if(size_t(value)>i)invalid("list marker refers to a deeper or undefined level");
      if(!levels[size_t(value)].paragraph.numbering)invalid("numeric list marker refers to an unnumbered level");
    }
  }
  void listTable(const Token& start) {
    if(!state.first||state.destination!=Destination::Body||!result.text.empty()||!lists.empty())invalid("misplaced list table");
    const auto body=groupBody(start);Lexer parser(body);
    for(auto token=parser.next();token.kind!=Token::End;token=parser.next()) {
      if(token.kind==Token::Bytes&&token.bytes.find_first_not_of(" \t")==std::string_view::npos)continue;
      if(token.kind!=Token::Open)invalid("list table entry is not a group");auto entry=subdestination(parser,body);if(entry.first.name!="list")unsupported(entry.first.name);
      Lexer definition(entry.second);std::optional<int> id;std::vector<ListLevel> levels;bool simple=false;
      for(auto item=definition.next();item.kind!=Token::End;item=definition.next()) {
        if(item.kind==Token::Bytes&&item.bytes.find_first_not_of(" \t")==std::string_view::npos)continue;
        if(item.kind==Token::Open){auto group=subdestination(definition,entry.second);if(group.first.name=="listlevel"){if(levels.size()>=9)invalid("list exceeds nine levels");levels.push_back(listLevel(group.second));}else if(group.first.name=="listname"){if(group.second.size()>1024)fail(7,"List name exceeds 1024 bytes");}else unsupported(group.first.name);}
        else if(item.kind==Token::Word&&item.name=="listid"){if(id)invalid("duplicate list ID property");id=required(item,INT32_MIN,INT32_MAX);}
        else if(item.kind==Token::Word&&item.name=="listsimple")simple=!item.parameter||item.number;
        else if(item.kind==Token::Word&&(item.name=="listtemplateid"||item.name=="listhybrid")){}
        else if(item.kind==Token::Word&&item.name=="listrestarthdn"){if(!item.parameter||item.number)unsupported(item.name);}
        else unsupported(item.name.empty()?"list definition":item.name);
      }
      if(!id||!*id||levels.empty()||(simple&&levels.size()!=1)||lists.count(*id))invalid("invalid or duplicate list definition");validateListLevels(levels);if(lists.size()>=GtkRtfMaxTable)fail(7,"RTF list table exceeds 4096 entries");lists.emplace(*id,std::move(levels));
    }
    state.destination=Destination::Skip;
  }
  void listOverrides(const Token& start) {
    if(!state.first||state.destination!=Destination::Body||!result.text.empty()||!overrides.empty())invalid("misplaced list override table");
    const auto body=groupBody(start);Lexer parser(body);
    for(auto token=parser.next();token.kind!=Token::End;token=parser.next()) {
      if(token.kind==Token::Bytes&&token.bytes.find_first_not_of(" \t")==std::string_view::npos)continue;
      if(token.kind!=Token::Open)invalid("list override entry is not a group");auto entry=subdestination(parser,body);if(entry.first.name!="listoverride")unsupported(entry.first.name);
      struct Change {std::optional<int> start;std::optional<ListLevel> format;};std::vector<Change> changes;Lexer definition(entry.second);std::optional<int> id,index,count;
      for(auto item=definition.next();item.kind!=Token::End;item=definition.next()) {
        if(item.kind==Token::Bytes&&item.bytes.find_first_not_of(" \t")==std::string_view::npos)continue;
        if(item.kind==Token::Word){if(item.name=="listid"){if(id)invalid("duplicate override list ID");id=required(item,INT32_MIN,INT32_MAX);}else if(item.name=="ls"){if(index)invalid("duplicate override index");index=required(item,1,INT32_MAX);}else if(item.name=="listoverridecount"){if(count)invalid("duplicate override count");count=required(item,0,9);}else unsupported(item.name);continue;}
        if(item.kind!=Token::Open)invalid("invalid list override");auto group=subdestination(definition,entry.second);if(group.first.name!="lfolevel")unsupported(group.first.name);if(changes.size()>=9)invalid("too many list override levels");
        Lexer changeParser(group.second);Change change;bool startFlag=false,formatFlag=false;
        for(auto setting=changeParser.next();setting.kind!=Token::End;setting=changeParser.next()) {
          if(setting.kind==Token::Bytes&&setting.bytes.find_first_not_of(" \t")==std::string_view::npos)continue;
          if(setting.kind==Token::Open){auto nested=subdestination(changeParser,group.second);if(nested.first.name!="listlevel")unsupported(nested.first.name);if(change.format)invalid("duplicate overridden level format");change.format=listLevel(nested.second);}
          else if(setting.kind==Token::Word&&setting.name=="listoverridestartat")startFlag=!setting.parameter||setting.number;
          else if(setting.kind==Token::Word&&setting.name=="listoverrideformat")formatFlag=!setting.parameter||setting.number;
          else if(setting.kind==Token::Word&&setting.name=="levelstartat"){if(change.start)invalid("duplicate list start override");change.start=required(setting,1,1000000);}
          else unsupported(setting.name.empty()?"list level override":setting.name);
        }
        if(startFlag!=bool(change.start)||formatFlag!=bool(change.format))invalid("list override flags disagree with their values");changes.push_back(std::move(change));
      }
      if(!id||!index||!count||!lists.count(*id)||overrides.count(*index)||changes.size()!=size_t(*count))invalid("invalid list override definition");auto levels=lists.at(*id);if(changes.size()>levels.size())invalid("override has more levels than its list");
      for(size_t i=0;i<changes.size();++i){if(changes[i].format)levels[i]=*changes[i].format;if(changes[i].start)levels[i].paragraph.numberStart=*changes[i].start;}
      validateListLevels(levels);if(overrides.size()>=GtkRtfMaxTable)fail(7,"RTF list override table exceeds 4096 entries");overrides.emplace(*index,std::move(levels));
    }
    state.destination=Destination::Skip;
  }
  void selectList(State& target) {
    auto& para=target.style.paragraph;
    if(!target.list){para.bullet=false;para.numbering=0;para.marker.clear();return;}
    auto found=overrides.find(target.list);if(found==overrides.end()||size_t(target.level)>=found->second.size())invalid("undefined list override or level");const auto& level=found->second[size_t(target.level)];const auto& source=level.paragraph;
    para.bullet=source.bullet;para.numbering=source.numbering;para.numberStart=source.numberStart;copyMarkerStyle(para,source);
    if(!(target.paragraphOverrides&1))para.left=source.left;if(!(target.paragraphOverrides&2))para.first=source.first;if(!(target.paragraphOverrides&4)){para.tabs=source.tabs;para.tabAlignments=source.tabAlignments;}
    para.numberBefore.clear();para.numberAfter.clear();
    auto placeholder=level.pattern.find(char16_t(target.level));if(placeholder!=Text::npos&&std::count_if(level.pattern.begin(),level.pattern.end(),[](auto value){return value<9;})==1){para.numberBefore=level.pattern.substr(0,placeholder);para.numberAfter=level.pattern.substr(placeholder+1);}
  }
  void finishListMarker() {
    if(!paragraphList||paragraphFirst==result.runs.size())return;
    const auto& levels=overrides.at(paragraphList);const auto& level=levels.at(size_t(paragraphLevel));auto& counter=listCounters[paragraphList];const auto index=size_t(paragraphLevel);
    if(counter.active[index]){if(counter.values[index]>=1000000)fail(7,"List counter exceeds 1000000");++counter.values[index];}else {counter.values[index]=level.paragraph.numberStart;counter.active[index]=true;}
    for(size_t i=index+1;i<levels.size();++i)if(!levels[i].noRestart)counter.active[i]=false;
    if(paragraph.marker.empty())for(auto value:level.pattern) {
      if(value<9){const auto parent=size_t(value);if(parent>index||parent>=levels.size())invalid("list marker refers to a deeper or undefined level");auto style=levels[parent].paragraph;if(!style.numbering)invalid("numeric list marker refers to an unnumbered level");style.marker.clear();style.numberBefore.clear();style.numberAfter.clear();if(level.legal&&parent<index)style.numbering=1;paragraph.marker+=gtkRtfListMarker(style,counter.active[parent]?counter.values[parent]:style.numberStart);}
      else paragraph.marker+=value;
      if(paragraph.marker.size()>64)fail(7,"Generated list marker exceeds 64 UTF-16 units");
    }
    gtkRtfValidateText(paragraph.marker);if(state.list)state.style.paragraph.marker.clear();
  }
  void appendObject(GtkRtfObject object) {
    if(result.objects.size()>=GtkRtfMaxObjects)fail(7,"RTF embedded object limit exceeded");
    if(object.kind==GtkRtfObject::TableRow&&!result.text.empty()&&!gtkRtfParagraphEnd(result.text,result.text.size()-1))bodyText(u"\n");
    object.first=result.text.size();bodyText(object.kind==GtkRtfObject::Picture?u"\ufffc":object.kind==GtkRtfObject::TableRow?u"\ufffc\n":u"\ufffc\u2028");object.last=result.text.size();result.objects.push_back(std::move(object));
  }
  void pictureAlternative(const Token& start,bool fallback) {
    if(!state.first||state.destination!=Destination::Body)invalid("misplaced picture alternative");
    const auto body=groupBody(start);Lexer parser(body);auto token=parser.next();
    while(token.kind==Token::Bytes&&token.bytes.find_first_not_of(" \t")==std::string_view::npos)token=parser.next();
    if(token.kind!=Token::Open)invalid("picture alternative must contain one picture");
    const auto entry=subdestination(parser,body);if(entry.first.name!="pict")invalid("picture alternative has a non-picture result");
    for(token=parser.next();token.kind!=Token::End;token=parser.next())if(token.kind!=Token::Bytes||token.bytes.find_first_not_of(" \t")!=std::string_view::npos)invalid("picture alternative contains multiple results");
    const auto identity=std::make_pair(groups.back().groupStart,result.text.size());
    if(!fallback||!pictureFallback||*pictureFallback!=identity) {
      auto document=fragment("{\\pict "+entry.second+"}");
      if(document.objects.size()!=1||document.objects[0].kind!=GtkRtfObject::Picture||document.text!=u"\ufffc")invalid("invalid picture alternative result");
      appendObject(std::move(document.objects[0]));
    }
    if(fallback)pictureFallback.reset();else pictureFallback=std::make_pair(groups.back().groupStart,result.text.size());
    state.destination=Destination::Skip;
  }
  static std::string binaryHex(const std::string& body) {
    Lexer parser(body);std::string bytes;int high=-1;
    for(auto token=parser.next();token.kind!=Token::End;token=parser.next()) {
      if(token.kind==Token::Word&&token.name=="bin") {if(high>=0)invalid("binary block splits hexadecimal byte");bytes.append(token.bytes.data(),token.bytes.size());}
      else if(token.kind==Token::Bytes)for(auto ch:token.bytes){if(ch==' '||ch=='\t')continue;auto digit=hex(ch);if(digit<0)invalid("non-hexadecimal picture/object data");if(high<0)high=digit;else {bytes+=char(high*16+digit);high=-1;}}
      else invalid("unexpected picture/object data control");
      if(bytes.size()>GtkRtfMaxBytes)fail(7,"RTF embedded binary is too large");
    }
    if(high>=0)invalid("odd hexadecimal data length");return bytes;
  }
  void picture(const Token& start) {
    const auto body=groupBody(start);Lexer parser(body);GtkRtfObject object;std::string data;size_t depth=0;bool metadata=false;
    for(auto token=parser.next();token.kind!=Token::End;token=parser.next()) {
      if(token.kind==Token::Open){if(depth++)invalid("nested picture property");metadata=true;continue;}
      if(token.kind==Token::Close){if(!depth)invalid("picture group underflow");--depth;metadata=false;continue;}
      if(metadata){if(token.kind==Token::Symbol&&token.name=="*")continue;if(token.kind==Token::Word&&token.name=="blipuid")continue;if(token.kind==Token::Bytes&&token.bytes.find_first_not_of("0123456789abcdefABCDEF \t")==std::string_view::npos)continue;unsupported(token.name.empty()?"picture properties":token.name);}
      if(token.kind==Token::Bytes||(token.kind==Token::Word&&token.name=="bin")){data+=body.substr(token.first,token.last-token.first);continue;}
      if(token.kind!=Token::Word)invalid("invalid picture control");const auto& name=token.name;
      if(name=="pngblip"||name=="jpegblip"||name=="dibitmap") {if(!object.format.empty())invalid("multiple picture formats");if(name=="dibitmap"&&token.parameter&&token.number!=0)unsupported(name);object.format=name;}
      else if(name=="picw")object.width=required(token,1,1000000);else if(name=="pich")object.height=required(token,1,1000000);
      else if(name=="picwgoal")object.widthGoal=required(token,1,316800);else if(name=="pichgoal")object.heightGoal=required(token,1,316800);
      else if(name=="picscalex")object.scaleX=required(token,1,10000);else if(name=="picscaley")object.scaleY=required(token,1,10000);
      else if(name=="piccropl")object.cropLeft=required(token,-316800,316800);else if(name=="piccropr")object.cropRight=required(token,-316800,316800);else if(name=="piccropt")object.cropTop=required(token,-316800,316800);else if(name=="piccropb")object.cropBottom=required(token,-316800,316800);
      else if(name=="bliptag"||name=="blipupi"||name=="picbmp"||name=="picbpp"){}
      else unsupported(name);
    }
    if(depth)invalid("unclosed picture property");if(object.format.empty())unsupported("pict (missing PNG/JPEG/DIB format)");object.bytes=binaryHex(data);if(object.bytes.empty())invalid("empty picture");
    const auto geometry=imageGeometry(object);object.width=geometry.first;object.height=geometry.second;if(!object.widthGoal)object.widthGoal=object.width*15;if(!object.heightGoal)object.heightGoal=object.height*15;
    appendObject(std::move(object));state.destination=Destination::Skip;
  }
  void region(const Token& start) {
    auto body=groupBody(start);GtkRtfObject object;object.kind=GtkRtfObject::Region;object.destination=start.name;
    object.content=std::make_shared<GtkRtfDocument>(fragment(body));appendObject(std::move(object));state.destination=Destination::Skip;
  }
  void embedded(const Token& start) {
    const auto body=groupBody(start);Lexer parser(body);GtkRtfObject object;object.kind=GtkRtfObject::Embedded;object.format="objemb";
    for(auto token=parser.next();token.kind!=Token::End;token=parser.next()) {
      if(token.kind==Token::Bytes&&token.bytes.find_first_not_of(" \t")==std::string_view::npos)continue;
      if(token.kind==Token::Word) {
        if(token.name=="objemb"||token.name=="objlink"||token.name=="objautlink"||token.name=="objsub"||token.name=="objpub"||token.name=="objicemb")object.format=token.name;
        else if(token.name=="objw")object.widthGoal=required(token,0,316800);else if(token.name=="objh")object.heightGoal=required(token,0,316800);
        else if(token.name=="objscalex"||token.name=="objscaley"){if(required(token,1,10000)!=100)unsupported(token.name+" (scaled object preview)");}
        else if(token.name=="objupdate"||token.name=="objsetsize"||token.name=="objlock"){}
        else unsupported(token.name);continue;
      }
      if(token.kind!=Token::Open)invalid("invalid embedded object destination");
      auto header=parser.next();if(header.kind==Token::Symbol&&header.name=="*")header=parser.next();if(header.kind!=Token::Word)invalid("missing object subdestination");
      size_t depth=1;Token close;for(;;){close=parser.next();if(close.kind==Token::End)invalid("unclosed object subdestination");if(close.kind==Token::Open)++depth;else if(close.kind==Token::Close&&!--depth)break;}
      const auto content=body.substr(header.last,close.first-header.last);
      if(header.name=="objdata")object.bytes=binaryHex(content);
      else if(header.name=="objclass"||header.name=="objname"){auto doc=fragment(content);if(!doc.objects.empty()||doc.text.size()>1024)invalid("invalid embedded object name");if(header.name=="objclass")object.label=doc.text;}
      else if(header.name=="result"){if(object.content)invalid("multiple embedded object previews");object.content=std::make_shared<GtkRtfDocument>(fragment(content));}
      else unsupported(header.name);
    }
    if(!object.content)unsupported("object (missing inert result preview)");appendObject(std::move(object));state.destination=Destination::Skip;
  }
  bool table(const Token& token) {
    const auto& name=token.name;
    if(name=="trowd") {
      if(tables.size()+documentDepth>=16)fail(7,"RTF table nesting exceeds 16 levels");TableContext context;context.outer=std::move(result);context.paragraphFirst=paragraphFirst;context.paragraph=paragraph;context.list=paragraphList;context.level=paragraphLevel;context.row.kind=GtkRtfObject::TableRow;tables.push_back(std::move(context));result=GtkRtfDocument{};result.emptyStyle=state.style;paragraphFirst=0;paragraphList=paragraphLevel=0;return true;
    }
    if(tables.empty()){if(name=="cell"||name=="row"||name=="nestcell"||name=="nestrow")invalid("table terminator outside a row");return false;}
    auto& context=tables.back();auto& row=context.row;
    if(name=="cellx") {context.cell.right=required(token,-31680,31680);if(context.cell.right<=row.left||(!row.cells.empty()&&context.cell.right<=row.cells.back().right))invalid("non-increasing table cell boundaries");if(row.cells.size()>=64)fail(7,"RTF row exceeds 64 cells");row.cells.push_back(context.cell);context.cell=GtkRtfCell{};context.border=-1;return true;}
    if(name=="trleft"){row.left=required(token,-31680,31680);if(row.left<0)unsupported("trleft (negative table offset)");}else if(name=="trgaph")row.gap=required(token,0,15840);else if(name=="trrh"){row.height=required(token,-31680,31680);if(row.height<0)unsupported("trrh (exact clipped table height)");}
    else if(name=="trql")row.alignment=0;else if(name=="trqr")row.alignment=1;else if(name=="trqc")row.alignment=2;
    else if(name=="clcbpat")context.cell.background=color(token);
    else if(name=="clvertalt")context.cell.vertical=0;else if(name=="clvertalc")context.cell.vertical=1;else if(name=="clvertalb")context.cell.vertical=2;
    else if(name=="clmgf")context.cell.merge=1;else if(name=="clmrg")context.cell.merge=2;
    else if(name=="clbrdrt")context.border=0;else if(name=="clbrdrr")context.border=1;else if(name=="clbrdrb")context.border=2;else if(name=="clbrdrl")context.border=3;
    else if(name=="brdrs"||name=="brdrdb"||name=="brdrdash"||name=="brdrdot"||name=="brdrnil"||name=="brdrnone") {if(context.border<0)invalid("border style without table cell edge");context.cell.borders[size_t(context.border)].style=name=="brdrs"?1:name=="brdrdb"?2:name=="brdrdash"?3:name=="brdrdot"?4:0;}
    else if(name=="brdrw"||name=="brdrcf"){if(context.border<0)invalid("border property without table cell edge");auto& border=context.cell.borders[size_t(context.border)];if(name=="brdrw")border.width=required(token,0,720);else border.color=color(token);}
    else if(name=="intbl"||name=="cltxlrtb"){}
    else if(name=="itap"){if(required(token,0,16)!=int(tables.size()))invalid("table depth disagrees with its row nesting");}
    else if(name=="trkeep"||name=="trhdr"||name=="trautofit"||name=="trftsWidth"||name=="trwWidth"||name=="clftsWidth"||name=="clwWidth"){if(!token.parameter||token.number)unsupported(name+" (table layout)");}
    else if(name=="cell"||name=="nestcell") {if(context.complete>=row.cells.size())invalid("more table cell contents than definitions");finishParagraph();result.emptyStyle=state.style;gtkRtfValidateText(result.text);row.cells[context.complete++].content=std::make_shared<GtkRtfDocument>(std::move(result));result=GtkRtfDocument{};result.emptyStyle=state.style;paragraphFirst=0;}
    else if(name=="row"||name=="nestrow") {if(context.complete!=row.cells.size()||row.cells.empty()||!result.text.empty())invalid("unterminated table cells");auto completed=std::move(context);tables.pop_back();result=std::move(completed.outer);paragraphFirst=completed.paragraphFirst;paragraph=completed.paragraph;paragraphList=completed.list;paragraphLevel=completed.level;state.style.paragraph=paragraph;appendObject(std::move(completed.row));}
    else return false;
    return true;
  }

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
    if(paragraphs){auto interval=target.style.paragraph.defaultTab;target.style.paragraph=GtkRtfParagraph{};target.style.paragraph.defaultTab=interval;target.tabAlignment=0;target.list=target.level=0;target.paragraphOverrides=0;}
  }
  void finishParagraph() {
    finishListMarker();
    for(size_t i=paragraphFirst;i<result.runs.size();++i)result.runs[i].style.paragraph=paragraph;
    paragraphFirst=result.runs.size();paragraphList=paragraphLevel=0;
  }
  void bodyText(const Text& value) {
    if(state.font<0&&defaultFont>=0)selectFont(state,defaultFont);
    if(state.listMarker&&!state.style.paragraph.bullet&&!state.style.paragraph.numbering&&state.style.paragraph.marker.empty())invalid("list marker without a list definition");
    state.listMarker=false;
    paragraph=state.style.paragraph;paragraphList=state.list;paragraphLevel=state.level;
    auto append=[&](const Text& part) {
      if(part.empty())return;
      paragraph=state.style.paragraph;paragraphList=state.list;paragraphLevel=state.level;
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
      case Destination::BulletText:state.bulletText+=value;if(state.bulletText.size()>64)fail(7,"RTF list affix exceeds 64 UTF-16 units");break;
      case Destination::ListMarker:
        if(value.find_first_not_of(u"\t")!=Text::npos) {
          if(state.markerStyle){const auto& first=*state.markerStyle;const auto& next=state.style;if(std::tie(first.font,first.size,first.bold,first.italic,first.foreground)!=std::tie(next.font,next.size,next.bold,next.italic,next.foreground))unsupported("listtext (mixed marker character formatting)");}
          else state.markerStyle=state.style;
          state.markerUsedFlags|=state.markerFlags;
        }
        state.bulletText+=value;
        // pntext includes the separating tab and may include trailing spaces.
        // Bound visible marker text independently so a maximum-length marker
        // can read the writer's own trailing separator on the next import.
        {const auto last=state.bulletText.find_last_not_of(u"\t ");if((last!=Text::npos&&last>=64)||state.bulletText.size()>128)fail(7,"RTF list marker exceeds 64 visible UTF-16 units or its separator budget");}
        break;
      case Destination::FieldInstruction:
        if(!state.field)invalid("field instruction outside a field");state.field->instruction+=value;if(state.field->instruction.size()>65536)fail(7,"RTF field instruction exceeds 65536 UTF-16 units");break;
      case Destination::Field:for(auto ch:value)if(ch!=u' '&&ch!=u'\t')invalid("field text outside its result");break;
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
    else if(word=="li"){para.left=required(token,0,31680);target.paragraphOverrides|=1;}else if(word=="ri")para.right=required(token,0,31680);else if(word=="fi"){para.first=required(token,-31680,31680);target.paragraphOverrides|=2;}
    else if(word=="sb")para.before=required(token,0,31680);else if(word=="sa")para.after=required(token,0,31680);
    else if(word=="ltrpar")para.rtl=false;else if(word=="rtlpar")para.rtl=true;
    else if(word=="tx") {auto value=required(token,0,31680);if(target.list&&!(target.paragraphOverrides&4)){para.tabs.clear();para.tabAlignments.clear();}target.paragraphOverrides|=4;if(para.tabs.size()>=64)fail(7,"RTF paragraph exceeds 64 tab stops");if(!para.tabs.empty()&&value<=para.tabs.back())invalid("tab stops are not increasing");para.tabs.push_back(value);para.tabAlignments.push_back(target.tabAlignment);target.tabAlignment=0;}
    else if(word=="tql")target.tabAlignment=0;else if(word=="tqr")target.tabAlignment=1;else if(word=="tqc")target.tabAlignment=2;else if(word=="tqdec")target.tabAlignment=3;
    else if(word=="sl")para.lineSpacing=required(token,-31680,31680);
    else if(word=="slmult")para.lineMultiple=required(token,0,1);
    else if(word=="pnnone"){para.bullet=false;para.numbering=0;para.marker.clear();}
    else if(word=="ls"){target.list=required(token,0,INT32_MAX);selectList(target);}
    else if(word=="ilvl"){target.level=required(token,0,8);if(target.list)selectList(target);}
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
    if(name=="listtable"){listTable(token);return;}
    if(name=="listoverridetable"){listOverrides(token);return;}
    if(name=="pict"){if(!state.first||state.destination!=Destination::Body)invalid("misplaced picture");picture(token);return;}
    if(name=="object"){if(!state.first||state.destination!=Destination::Body)invalid("misplaced object");embedded(token);return;}
    static const std::set<std::string> regions={"footnote","endnote","annotation","header","headerl","headerr","headerf","footer","footerl","footerr","footerf"};
    if(regions.count(name)){if(!state.first||state.destination!=Destination::Body)invalid("misplaced page region");region(token);return;}
    if(name=="shppict"||name=="nonshppict"){pictureAlternative(token,name=="nonshppict");return;}
    if(name=="field") {if(!state.first||state.destination!=Destination::Body)invalid("misplaced field");if(result.fields.size()>=4096)fail(7,"RTF field limit exceeded");state.field=std::make_shared<GtkRtfField>();state.field->first=result.text.size();state.ownsField=true;state.fieldResult=false;state.destination=Destination::Field;return;}
    if(name=="fldinst") {if(!state.first||!state.field||state.destination!=Destination::Field)invalid("misplaced field instruction");state.destination=Destination::FieldInstruction;return;}
    if(name=="fldrslt") {if(!state.first||!state.field||state.destination!=Destination::Field)invalid("misplaced field result");state.destination=Destination::Body;state.fieldResult=true;return;}
    if(state.destination==Destination::Field) {if(name=="fldlock")state.field->locked=!token.parameter||token.number;else if(name=="flddirty")state.field->dirty=!token.parameter||token.number;else if(name=="fldedit"||name=="fldpriv"){}else unsupported(name);return;}
    if(state.destination==Destination::FieldInstruction) {if(name=="u"||name=="uc")unicode(token);else if(name=="tab")text(u"\t");else unsupported(name);return;}
    static const std::set<std::string> visibleDestinations={"objdata","shp","shpinst","shptxt","do","listtable","listoverridetable","nesttableprops","mmath","mObj"};
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
    if(name=="pntext"||name=="listtext") {if(!state.first)invalid("misplaced list marker");state.destination=Destination::ListMarker;state.bulletText.clear();state.listMarker=true;state.markerFlags=state.markerUsedFlags=0;state.markerStyle.reset();return;}
    if(state.destination==Destination::ListMarker) {
      if(name=="u"||name=="uc")unicode(token);else if(name=="tab")text(u"\t");
      else if(name=="f"||name=="fs"||name=="b"||name=="i"||name=="cf") {format(state,token);state.markerFlags|=name=="f"?1:name=="fs"?2:name=="b"?4:name=="i"?8:16;}
      else unsupported(name+" (list marker formatting)");return;
    }
    if(name=="pn") {if(!state.first)invalid("misplaced bullet definition");state.destination=Destination::Bullet;return;}
    if(state.destination==Destination::Bullet||state.destination==Destination::BulletText) {
      if(name=="pnlvlblt"){state.bulletKind=true;state.style.paragraph.numbering=0;}
      else if(name=="pndec")state.style.paragraph.numbering=1;
      else if(name=="pnucrm")state.style.paragraph.numbering=2;else if(name=="pnlcrm")state.style.paragraph.numbering=3;
      else if(name=="pnucltr")state.style.paragraph.numbering=4;else if(name=="pnlcltr")state.style.paragraph.numbering=5;
      else if(name=="pntxtb"||name=="pntxta"){state.destination=Destination::BulletText;state.bulletText.clear();state.markerAfter=name=="pntxta";}
      else if(name=="pnstart")state.style.paragraph.numberStart=required(token,1,1000000);
      else if(name=="pnf"){selectFont(state,required(token,0,INT32_MAX));state.style.paragraph.markerFont=state.style.font;}
      else if(name=="pnfs")state.style.paragraph.markerSize=required(token,1,6144)/2.0;
      else if(name=="pnb")state.style.paragraph.markerBold=!token.parameter||token.number;
      else if(name=="pni")state.style.paragraph.markerItalic=!token.parameter||token.number;
      else if(name=="pncf")state.style.paragraph.markerColor=color(token);
      else if(name=="pnql"||name=="pnqc"||name=="pnqr")state.style.paragraph.markerAlignment=name=="pnqc"?1:name=="pnqr"?2:0;
      else if(name=="pnlvlbody"){}
      else if(name=="pnindent"||name=="pnhang"||name=="pnlvlcont"||name=="pnprev"||name=="pnacross"){if(!token.parameter||token.number)unsupported(name);}
      else if(name=="u"||name=="uc")unicode(token);else unsupported(name);
      return;
    }
    if(state.destination==Destination::Body&&table(token))return;
    if(name=="deftab")state.style.paragraph.defaultTab=required(token,1,31680);
    else if(name=="ansi")state.codepage=1252;else if(name=="mac")state.codepage=10000;else if(name=="pc")state.codepage=437;else if(name=="pca")state.codepage=850;
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
    else if(name=="chftn")unsupported("chftn (automatic note reference numbering)");
    else if(name=="emdash")text(u"\u2014");else if(name=="endash")text(u"\u2013");else if(name=="emspace")text(u"\u2003");else if(name=="enspace")text(u"\u2002");else if(name=="qmspace")text(u"\u2005");
    else if(name=="bullet")text(u"\u2022");else if(name=="lquote")text(u"\u2018");else if(name=="rquote")text(u"\u2019");else if(name=="ldblquote")text(u"\u201c");else if(name=="rdblquote")text(u"\u201d");
    else if(format(state,token)){paragraph=state.style.paragraph;paragraphList=state.list;paragraphLevel=state.level;}
    else {
      static const std::set<std::string> documentProperties={"deftab","deflang","deflangfe","adeflang","viewkind","viewscale","viewzk","fet","paperw","paperh","margl","margr","margt","margb","gutter","landscape","widowctrl","nowidctlpar","widctlpar","hyphauto","hyphconsec","hyphhotz","hyphcaps","nouicompat","formshade","horzdoc","deftab","sectd","linex","headery","footery","pgwsxn","pghsxn","marglsxn","margrsxn","margtsxn","margbsxn","guttersxn","titlepg","endnhere","ftnbj","ftnstart","ftnalt","aenddoc","noxlattoyen","expshrtn","nouicompat","nocompatoptions","htmautsp","rsidroot","insrsid","charrsid","pararsid","ltrdoc","rtldoc","fet","uc","defchp","defpap","noextrasprl","horzsect","formprot","formdisp","formshade","readonlyrecommended"};
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
      Token token;if(pendingClose){token=*pendingClose;pendingClose.reset();}else token=lexer.next();if(token.kind==Token::End)break;
      if(finished){if(token.kind==Token::Bytes&&token.bytes.find_first_not_of(" \t")==std::string_view::npos)continue;invalid("trailing content after root group");}
      if(token.kind==Token::Open) {
        flush();skip=0;if(groups.size()>=256)fail(7,"RTF nesting exceeds 256 groups");
        auto child=state;child.first=true;child.optional=false;child.preserve=false;child.groupStart=token.first;child.ownsFont=child.ownsStyle=child.ownsField=false;child.alternatives=0;
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
        if(child.fieldResult)state.fieldResult=true;
        if(child.ownsField){if(!child.fieldResult)invalid("field has no visible result");child.field->last=result.text.size();gtkRtfValidateText(child.field->instruction);result.fields.push_back(*child.field);}
        if(child.listMarker)state.listMarker=true;
        if(child.preserve)result.metadata.push_back(input.substr(child.groupStart,token.last-child.groupStart));
        if(child.destination==Destination::BulletText) {if(child.markerAfter)state.style.paragraph.numberAfter=child.bulletText;else state.style.paragraph.numberBefore=child.bulletText;}
        if(child.destination==Destination::ListMarker) {
          if(state.destination==Destination::ListMarker){state.bulletText=std::move(child.bulletText);state.markerStyle=std::move(child.markerStyle);state.markerUsedFlags=child.markerUsedFlags;}
          else {auto marker=child.bulletText;while(!marker.empty()&&(marker.back()==u'\t'||marker.back()==u' '))marker.pop_back();auto& para=state.style.paragraph;para.marker=std::move(marker);
            if(child.markerStyle){const auto& style=*child.markerStyle;auto flags=child.markerUsedFlags;if(flags&1)para.markerFont=style.font;if(flags&2)para.markerSize=style.size;if(flags&4)para.markerBold=style.bold;if(flags&8)para.markerItalic=style.italic;if(flags&16)para.markerColor=style.foreground;}
          }
        }
        if(child.destination==Destination::Bullet&&state.destination==Destination::Body) {
          if(!child.bulletKind&&!child.style.paragraph.numbering)invalid("list definition has no numbering format");
          state.style.paragraph.bullet=child.bulletKind;state.style.paragraph.numbering=child.style.paragraph.numbering;state.style.paragraph.numberStart=child.style.paragraph.numberStart;
          state.style.paragraph.numberBefore=child.style.paragraph.numberBefore;state.style.paragraph.numberAfter=child.style.paragraph.numberAfter;
          copyMarkerStyle(state.style.paragraph,child.style.paragraph);
          if(child.bulletKind&&!child.style.paragraph.numberBefore.empty())state.style.paragraph.marker=child.style.paragraph.numberBefore;
          paragraph=state.style.paragraph;
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
          if(token.name=="\\"||token.name=="{"||token.name=="}")text(page()==42?gtkRtfDecode(token.name,42):Text(1,char16_t(token.name[0])));
          else if(token.name=="~")text(u"\u00a0");else if(token.name=="-")text(u"\u00ad");else if(token.name=="_")text(u"\u2011");else unsupported(token.name);
        }
      }else word(token);
      // The header itself precedes the destination/header controls in its root.
      if(token.name!="rtf")state.first=false;
    }
    // Do not accept a valid prefix followed by another RTF group or garbage.
    if(finished)for(auto token=lexer.next();token.kind!=Token::End;token=lexer.next())if(token.kind!=Token::Bytes||token.bytes.find_first_not_of(" \t")!=std::string_view::npos)invalid("trailing content after root group");
    if(!header||!finished||!groups.empty()||!tables.empty())invalid("unclosed group or table row");
    finishParagraph();gtkRtfValidateText(result.text);
    if(!result.text.empty()&&!gtkRtfParagraphEnd(result.text,result.text.size()-1))result.emptyStyle.paragraph=paragraph;
    for(const auto& entry:styles){State checked;defaults(checked);std::set<std::pair<bool,int>> visiting;applyStyle(checked,entry.first.second,entry.first.first,visiting);}
    // The writer needs scalar-aligned ranges even when \u surrogate halves
    // appeared as separate tokens. A formatting change between halves is invalid.
    for(const auto& run:result.runs)if(run.first&&result.text[run.first]>=0xdc00&&result.text[run.first]<=0xdfff)invalid("formatting changes inside a Unicode surrogate pair");
    gtkRtfValidateObjects(result);return std::move(result);
  }
};
void encodedText(std::string& output,const Text& text,bool font=false,bool unicodeASCII=false) {
  for(auto ch:text) {
    if((ch==u'\\'||ch==u'{'||ch==u'}')&&!unicodeASCII){output+='\\';output+=char(ch);}
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
Text gtkRtfListMarker(const GtkRtfParagraph& paragraph,int ordinal) {
  if(!paragraph.marker.empty())return paragraph.marker;
  if(paragraph.bullet)return paragraph.numberBefore.empty()?u"\u2022":paragraph.numberBefore;
  if(!paragraph.numbering)return {};
  if(ordinal<1||ordinal>1000000)fail(7,"Rich list counter exceeds 1000000");int number=ordinal;Text value;
  if(paragraph.numbering==2||paragraph.numbering==3) {
    static const std::pair<int,const char*> numerals[]={{1000,"M"},{900,"CM"},{500,"D"},{400,"CD"},{100,"C"},{90,"XC"},{50,"L"},{40,"XL"},{10,"X"},{9,"IX"},{5,"V"},{4,"IV"},{1,"I"}};
    for(const auto& entry:numerals)while(number>=entry.first){value+=fromUTF8(entry.second);number-=entry.first;if(value.size()>64)fail(7,"Roman list marker exceeds 64 UTF-16 units");}
    if(paragraph.numbering==3)for(auto& ch:value)if(ch>=u'A'&&ch<=u'Z')ch+=u'a'-u'A';
  }else if(paragraph.numbering==4||paragraph.numbering==5) {
    do {--number;value.insert(value.begin(),char16_t((paragraph.numbering==4?u'A':u'a')+number%26));number/=26;}while(number);
  }else value=fromUTF8(std::to_string(number));
  return paragraph.numberBefore+value+paragraph.numberAfter;
}
void gtkRtfValidateObjects(const GtkRtfDocument& document) {
  size_t count=0,cells=0,text=0,bytes=0,pixels=0,fields=0,runs=0;std::set<const GtkRtfDocument*> ancestors;
  std::function<void(const GtkRtfDocument&,size_t)> visit=[&](const GtkRtfDocument& doc,size_t depth) {
    if(depth>16||!ancestors.insert(&doc).second)fail(7,"RTF document object nesting exceeds 16 levels or contains a cycle");
    if(doc.text.size()>GtkRtfMaxText-text)fail(7,"Nested RTF text exceeds 4 Mi UTF-16 units");text+=doc.text.size();size_t previous=0;
    if(doc.fields.size()>GtkRtfMaxTable-fields)fail(7,"Nested RTF fields exceed 4096");fields+=doc.fields.size();if(doc.runs.size()>GtkRtfMaxRuns-runs)fail(7,"Nested RTF formatting exceeds 65536 runs");runs+=doc.runs.size();
    for(const auto& object:doc.objects) {
      if(++count>GtkRtfMaxObjects)fail(7,"RTF embedded object limit exceeded");
      const auto expected=object.kind==GtkRtfObject::Picture?Text(u"\ufffc"):object.kind==GtkRtfObject::TableRow?Text(u"\ufffc\n"):Text(u"\ufffc\u2028");
      if(object.first<previous||object.first>object.last||object.last>doc.text.size()||doc.text.substr(object.first,object.last-object.first)!=expected)invalid("invalid embedded object range");previous=object.last;
      if(object.bytes.size()>GtkRtfMaxBytes-bytes)fail(7,"Embedded RTF bytes exceed 16 MiB");bytes+=object.bytes.size();
      if(object.kind==GtkRtfObject::Picture) {
        const auto geometry=imageGeometry(object);const auto area=size_t(geometry.first)*geometry.second;if(area>GtkRtfMaxImagePixels-pixels)fail(7,"Combined RTF images exceed 16 Mi pixels");pixels+=area;
        if(object.scaleX<1||object.scaleX>10000||object.scaleY<1||object.scaleY>10000||object.widthGoal<=0||object.heightGoal<=0||object.widthGoal>316800||object.heightGoal>316800)invalid("invalid picture geometry");
        const int64_t width=int64_t(object.widthGoal)-object.cropLeft-object.cropRight,height=int64_t(object.heightGoal)-object.cropTop-object.cropBottom;
        if(width<=0||height<=0)invalid("picture cropping removes the complete image");const auto targetWidth=std::max<int64_t>(1,std::lround(width*(object.scaleX/1500.0))),targetHeight=std::max<int64_t>(1,std::lround(height*(object.scaleY/1500.0)));
        if(targetWidth>8192||targetHeight>8192||targetWidth*targetHeight>int64_t(GtkRtfMaxImagePixels))fail(7,"Scaled RTF image exceeds the pixel limit");
        if(targetWidth!=geometry.first||targetHeight!=geometry.second||object.cropLeft||object.cropRight||object.cropTop||object.cropBottom){const auto extra=size_t(targetWidth*targetHeight);if(extra>GtkRtfMaxImagePixels-pixels)fail(7,"Combined source and scaled RTF images exceed 16 Mi pixels");pixels+=extra;}
      }else if(object.kind==GtkRtfObject::TableRow) {
        if(object.cells.empty()||object.cells.size()>64||object.left< -31680||object.left>31680||object.gap<0||object.gap>15840||object.alignment<0||object.alignment>2||std::abs(int64_t(object.height))>31680)invalid("invalid table row geometry");int right=object.left;
        if(object.left<0||object.height<0)unsupported("table (negative offset or exact clipped row height)");
        if(object.first&&!gtkRtfParagraphEnd(doc.text,object.first-1))invalid("table row must start an outer paragraph");
        for(size_t i=0;i<object.cells.size();++i){const auto& cell=object.cells[i];if(++cells>GtkRtfMaxTable)fail(7,"RTF table cell limit exceeded");if(cell.right<=right||cell.right>31680||cell.vertical<0||cell.vertical>2||cell.merge<0||cell.merge>2||(!i&&cell.merge==2)||cell.background< -1||cell.background>0xffffff||!cell.content)invalid("invalid table cell");right=cell.right;
          for(const auto& border:cell.borders)if(border.style<0||border.style>4||border.width<0||border.width>720||border.color< -1||border.color>0xffffff)invalid("invalid table cell border");
          if(cell.merge==2&&(!cell.content->text.empty()||!cell.content->objects.empty()))invalid("merged continuation cell contains visible content");visit(*cell.content,depth+1);
        }
      }else if(object.kind==GtkRtfObject::Region||object.kind==GtkRtfObject::Embedded) {
        if(!object.content)invalid("embedded object has no visible document");gtkRtfValidateText(object.label);if(object.label.size()>1024)invalid("object class is too long");
        if(object.kind==GtkRtfObject::Region){static const std::set<std::string> allowed={"footnote","endnote","annotation","header","headerl","headerr","headerf","footer","footerl","footerr","footerf"};if(!allowed.count(object.destination))invalid("invalid document region destination");}
        visit(*object.content,depth+1);
      }else invalid("unknown embedded object kind");
    }
    ancestors.erase(&doc);
  };
  visit(document,0);
}
std::string gtkRtfWrite(const GtkRtfDocument& document) {
  gtkRtfValidateText(document.text);gtkRtfValidateObjects(document);
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
    if(std::abs(int64_t(para.lineSpacing))>31680||para.lineMultiple<0||para.lineMultiple>1||(para.lineMultiple&&para.lineSpacing<0)||para.defaultTab<1||para.defaultTab>31680)invalid("invalid paragraph line spacing or default tabs");
    if(para.numbering<0||para.numbering>5||para.numberStart<1||para.numberStart>1000000||(para.bullet&&para.numbering))invalid("invalid paragraph numbering");
    gtkRtfValidateText(para.markerFont);if(para.markerFont.size()>255||para.markerFont.find_first_of(u";\r\n\t")!=Text::npos||!std::isfinite(para.markerSize)||para.markerSize<0||para.markerSize>3072||std::abs(para.markerSize*2-std::round(para.markerSize*2))>0.000001||para.markerBold< -1||para.markerBold>1||para.markerItalic< -1||para.markerItalic>1||para.markerAlignment<0||para.markerAlignment>2||para.markerColor< -2||para.markerColor>0xffffff)invalid("invalid marker formatting");
    for(const auto& value:{para.numberBefore,para.numberAfter,para.marker}){gtkRtfValidateText(value);if(value.size()>64||value.find_first_of(u"\r\n\t")!=Text::npos)invalid("invalid list marker");}
    if(para.tabs.size()>64)fail(7,"RTF paragraph exceeds 64 tab stops");
    if(para.tabAlignments.size()>para.tabs.size())invalid("orphan tab alignments");
    for(auto align:para.tabAlignments)if(align<0||align>3)invalid("invalid tab alignment");
    int previous=-1;for(auto stop:para.tabs){if(stop<0||stop>31680||stop<=previous)invalid("invalid tab stops");previous=stop;}
    if(!fonts.count({style.font,style.charset}))fonts[{style.font,style.charset}]=fonts.size();
    if(!para.markerFont.empty()&&!fonts.count({para.markerFont,0}))fonts[{para.markerFont,0}]=fonts.size();
    for(auto color:{style.foreground,style.background,para.markerColor})if(color>=0&&!colors.count(color))colors[color]=colors.size()+1;
    if(fonts.size()>GtkRtfMaxTable||colors.size()>=GtkRtfMaxTable)fail(7,"RTF font/color table limit exceeded");
  };
  std::function<void(const GtkRtfDocument&)> collectDocument=[&](const GtkRtfDocument& doc){collect(doc.emptyStyle);for(const auto& run:doc.runs)collect(run.style);for(const auto& object:doc.objects){if(object.content)collectDocument(*object.content);for(const auto& cell:object.cells){for(auto color:{cell.background,cell.borders[0].color,cell.borders[1].color,cell.borders[2].color,cell.borders[3].color})if(color>=0&&!colors.count(color))colors[color]=colors.size()+1;collectDocument(*cell.content);}}};
  collectDocument(document);if(colors.size()>=GtkRtfMaxTable)fail(7,"RTF color table limit exceeded");
  std::string output="{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl";
  for(const auto& font:fonts){output+="{\\f"+std::to_string(font.second)+"\\fnil\\fcharset"+std::to_string(font.first.second)+" ";encodedText(output,font.first.first,true);output+=";}";}
  output+="}{\\colortbl;";
  std::vector<int> ordered(colors.size());for(const auto& color:colors)ordered[color.second-1]=color.first;
  for(auto color:ordered)output+="\\red"+std::to_string(color&255)+"\\green"+std::to_string((color>>8)&255)+"\\blue"+std::to_string((color>>16)&255)+";";
  output+="}\n";
  auto control=[&](const char* name,int64_t value){output+='\\';output+=name;output+=std::to_string(value);};
  size_t tableDepth=0;
  auto formatting=[&](const GtkRtfStyle& style,bool paragraphs=true) {
    output+=paragraphs?"\\pard\\plain":"\\plain";
    if(paragraphs&&tableDepth){output+="\\intbl";control("itap",int64_t(tableDepth));}
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
      if(para.lineSpacing){control("sl",para.lineSpacing);control("slmult",para.lineMultiple);}
      control("deftab",para.defaultTab);
      for(size_t i=0;i<para.tabs.size();++i){const auto align=i<para.tabAlignments.size()?para.tabAlignments[i]:0;if(align)output+=align==1?"\\tqr":align==2?"\\tqc":"\\tqdec";control("tx",para.tabs[i]);}
      if(!para.marker.empty()){
        output+="{\\pntext";if(!para.markerFont.empty())control("f",int64_t(fonts.at({para.markerFont,0})));if(para.markerSize)control("fs",int64_t(std::lround(para.markerSize*2)));if(para.markerBold>=0)control("b",para.markerBold);if(para.markerItalic>=0)control("i",para.markerItalic);if(para.markerColor>= -1)control("cf",para.markerColor<0?0:int64_t(colors.at(para.markerColor)));output+=' ';encodedText(output,para.marker,false,true);output+="\\tab}";
      }
      if(para.bullet||para.numbering) {
        output+="{\\*\\pn";
        if(para.bullet)output+="\\pnlvlblt";
        else {static const char* types[]={"","\\pndec","\\pnucrm","\\pnlcrm","\\pnucltr","\\pnlcltr"};output+="\\pnlvlbody";output+=types[para.numbering];control("pnstart",para.numberStart);}
        if(!para.markerFont.empty())control("pnf",int64_t(fonts.at({para.markerFont,0})));if(para.markerSize)control("pnfs",int64_t(std::lround(para.markerSize*2)));if(para.markerBold>=0)control("pnb",para.markerBold);if(para.markerItalic>=0)control("pni",para.markerItalic);if(para.markerColor>= -1)control("pncf",para.markerColor<0?0:int64_t(colors.at(para.markerColor)));if(para.markerAlignment)output+=para.markerAlignment==1?"\\pnqc":"\\pnqr";
        output+="{\\pntxtb ";encodedText(output,para.numberBefore,false,true);output+='}';
        output+="{\\pntxta ";encodedText(output,para.numberAfter,false,true);output+='}';
        output+='}';
      }
    }
    if(output.back()!='}')output+=' ';
  };
  auto binary=[&](const std::string& value){if(value.size()>(GtkRtfMaxBytes-output.size())/2)fail(7,"Serialized RTF exceeds 16 MiB");static const char digits[]="0123456789abcdef";for(auto ch:value){output+=digits[uint8_t(ch)>>4];output+=digits[uint8_t(ch)&15];}};
  std::function<void(const GtkRtfDocument&)> writeDocument;
  auto writeObject=[&](const GtkRtfObject& object) {
    if(object.kind==GtkRtfObject::Picture) {
      output+="{\\pict\\"+object.format;if(object.format=="dibitmap")output+='0';control("picw",object.width);control("pich",object.height);control("picwgoal",object.widthGoal);control("pichgoal",object.heightGoal);
      if(object.scaleX!=100)control("picscalex",object.scaleX);if(object.scaleY!=100)control("picscaley",object.scaleY);
      if(object.cropLeft)control("piccropl",object.cropLeft);if(object.cropRight)control("piccropr",object.cropRight);if(object.cropTop)control("piccropt",object.cropTop);if(object.cropBottom)control("piccropb",object.cropBottom);output+=' ';binary(object.bytes);output+='}';
    }else if(object.kind==GtkRtfObject::TableRow) {
      output+="{\\trowd";control("trleft",object.left);control("trgaph",object.gap);if(object.height)control("trrh",object.height);output+=object.alignment==1?"\\trqr":object.alignment==2?"\\trqc":"\\trql";
      for(const auto& cell:object.cells){output+=cell.vertical==1?"\\clvertalc":cell.vertical==2?"\\clvertalb":"\\clvertalt";if(cell.background>=0)control("clcbpat",int64_t(colors.at(cell.background)));if(cell.merge)output+=cell.merge==1?"\\clmgf":"\\clmrg";
        static const char* sides[]={"\\clbrdrt","\\clbrdrr","\\clbrdrb","\\clbrdrl"};static const char* styles[]={"","\\brdrs","\\brdrdb","\\brdrdash","\\brdrdot"};
        for(size_t i=0;i<4;++i){const auto& border=cell.borders[i];if(border.style){output+=sides[i];output+=styles[border.style];control("brdrw",border.width);if(border.color>=0)control("brdrcf",int64_t(colors.at(border.color)));}}
        control("cellx",cell.right);
      }
      ++tableDepth;for(const auto& cell:object.cells){writeDocument(*cell.content);output+=tableDepth>1?"\\nestcell ":"\\cell ";}output+=tableDepth>1?"\\nestrow}":"\\row}";--tableDepth;
    }else {
      const auto parentDepth=tableDepth;tableDepth=0;
      if(object.kind==GtkRtfObject::Region){output+="{\\"+object.destination+" ";writeDocument(*object.content);output+='}';}
      else {output+="{\\object\\"+object.format;if(object.widthGoal)control("objw",object.widthGoal);if(object.heightGoal)control("objh",object.heightGoal);if(!object.label.empty()){output+="{\\*\\objclass ";encodedText(output,object.label);output+='}';}output+="{\\*\\objdata ";binary(object.bytes);output+="}{\\result ";writeDocument(*object.content);output+="}}";}
      tableDepth=parentDepth;
    }
    if(output.size()>GtkRtfMaxBytes)fail(7,"Serialized RTF exceeds 16 MiB");
  };
  writeDocument=[&](const GtkRtfDocument& doc) {
  for(const auto& metadata:doc.metadata){if(metadata.size()>GtkRtfMaxBytes-output.size())fail(7);output+=metadata;}
  size_t previous=0;
  for(const auto& run:doc.runs) {
    if(run.first!=previous||run.last<=run.first||run.last>doc.text.size())invalid("non-contiguous formatting model");
    previous=run.last;
  }
  if(previous!=doc.text.size())invalid("text without formatting runs");
  auto fields=doc.fields;if(fields.size()>4096)fail(7,"RTF field limit exceeded");
  std::stable_sort(fields.begin(),fields.end(),[](const auto& a,const auto& b){return a.first<b.first||(a.first==b.first&&a.last>b.last);});
  for(const auto& field:fields) {if(field.first>field.last||field.last>doc.text.size()||field.instruction.size()>65536)invalid("invalid field range");gtkRtfValidateText(field.instruction);for(auto offset:{field.first,field.last}){if(offset<doc.text.size()&&doc.text[offset]>=0xdc00&&doc.text[offset]<=0xdfff)invalid("field splits Unicode scalar");for(const auto& object:doc.objects)if(offset>object.first&&offset<object.last)invalid("field splits an embedded object");}}
  size_t at=0,runIndex=0,fieldIndex=0,objectIndex=0;std::vector<size_t> ends;
  for(;;) {
    while(!ends.empty()&&ends.back()==at){output+="}}";ends.pop_back();}
    while(fieldIndex<fields.size()&&fields[fieldIndex].first==at) {
      const auto& field=fields[fieldIndex++];if(!ends.empty()&&field.last>ends.back())invalid("overlapping fields");
      output+="{\\field";if(field.locked)output+="\\fldlock";if(field.dirty)output+="\\flddirty";output+="{\\*\\fldinst ";encodedText(output,field.instruction);output+="}{\\fldrslt ";
      if(field.last==at)output+="}}";else {if(ends.size()>=32)fail(7,"RTF field nesting exceeds 32");ends.push_back(field.last);}
    }
    if(at==doc.text.size())break;
    while(runIndex<doc.runs.size()&&doc.runs[runIndex].last<=at)++runIndex;
    const auto& run=doc.runs.at(runIndex);
    if(objectIndex<doc.objects.size()&&doc.objects[objectIndex].first==at){formatting(run.style);const auto& object=doc.objects[objectIndex++];writeObject(object);at=object.last;continue;}
    auto end=run.last;if(fieldIndex<fields.size())end=std::min(end,fields[fieldIndex].first);if(!ends.empty())end=std::min(end,ends.back());if(objectIndex<doc.objects.size())end=std::min(end,doc.objects[objectIndex].first);
    if(end<=at)invalid("overlapping field or object boundaries");formatting(run.style);encodedText(output,doc.text.substr(at,end-at),false,!byteCharset(run.style.charset));at=end;
  }
  if(!ends.empty()||fieldIndex!=fields.size())invalid("unclosed field model");
  formatting(doc.emptyStyle,doc.text.empty()||gtkRtfParagraphEnd(doc.text,doc.text.size()-1));
  };
  writeDocument(document);
  output+='}';if(output.size()>GtkRtfMaxBytes)fail(7,"Serialized RTF exceeds 16 MiB");return output;
}
}
