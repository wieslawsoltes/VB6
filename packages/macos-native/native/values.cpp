#include "vb6.hpp"
#include "array-ownership.hpp"
#include "calendar.hpp"
#include <cctype>
#include <cwctype>
#include <iomanip>
#include <sstream>

namespace vb6 {
Text errorText(int32_t n) {
  switch(n) {
    case 5:return u"Invalid procedure call or argument"; case 6:return u"Overflow";
    case 7:return u"Out of memory"; case 9:return u"Subscript out of range";
    case 11:return u"Division by zero"; case 13:return u"Type mismatch";
    case 14:return u"Out of string space"; case 20:return u"Resume without error";
    case 28:return u"Out of stack space"; case 35:return u"Sub or Function not defined";
    case 52:return u"Bad file name or number"; case 53:return u"File not found";
    case 54:return u"Bad file mode"; case 55:return u"File already open";
    case 57:return u"Device I/O error"; case 58:return u"File already exists";
    case 61:return u"Disk full"; case 62:return u"Input past end of file";
    case 70:return u"Permission denied"; case 75:return u"Path/File access error";
    case 76:return u"Path not found"; case 91:return u"Object variable or With block variable not set";
    case 93:return u"Invalid pattern string"; case 94:return u"Invalid use of Null";
    case 380:return u"Invalid property value"; case 424:return u"Object required";
    case 429:return u"ActiveX component cannot create object"; case 438:return u"Object does not support this property or method";
    case 445:return u"Object does not support this action"; case 448:return u"Named argument not found";
    case 449:return u"Argument not optional"; case 450:return u"Wrong number of arguments or invalid property assignment";
    case 451:return u"Property let procedure not defined and property get procedure did not return an object";
    case 457:return u"This key is already associated with an element of this collection";
    default:return u"Application-defined or object-defined error";
  }
}
Error::Error(int32_t n,const std::string& message,std::string src,int ln):
  std::runtime_error(message.empty()?toUTF8(errorText(n)):message),number(n),source(std::move(src)),line(ln),description(message.empty()?errorText(n):fromUTF8(message)) {}
[[noreturn]] void fail(int32_t n,const std::string& message) { throw Error(n,message); }
std::string lower(std::string s) { for(char& c:s)if(c>='A'&&c<='Z')c=char(c+32); return s; }
Text fromUTF8(const std::string& s) {
  Text result; result.reserve(s.size());
  for(size_t i=0;i<s.size();) {
    uint32_t c=static_cast<uint8_t>(s[i++]); size_t count=0;
    if(c>=0xc2&&c<=0xdf) { c&=0x1f; count=1; }
    else if(c>=0xe0&&c<=0xef) { c&=0xf; count=2; }
    else if(c>=0xf0&&c<=0xf4) { c&=7; count=3; }
    else if(c>=0x80) fail(13,"Invalid UTF-8 input");
    if(count>s.size()-i)fail(13,"Truncated UTF-8 input");
    for(size_t k=0;k<count;k++){uint32_t b=static_cast<uint8_t>(s[i++]);if((b&0xc0)!=0x80)fail(13,"Invalid UTF-8 continuation");c=(c<<6)|(b&63);}
    if((count==1&&c<0x80)||(count==2&&c<0x800)||(count==3&&c<0x10000)||c>0x10ffff||(c>=0xd800&&c<=0xdfff))fail(13,"Invalid UTF-8 scalar");
    if(c<0x10000)result.push_back(static_cast<char16_t>(c));else{c-=0x10000;result.push_back(static_cast<char16_t>(0xd800+(c>>10)));result.push_back(static_cast<char16_t>(0xdc00+(c&1023)));}
  } return result;
}
std::string toUTF8(const Text& s) {
  std::string result; result.reserve(s.size());
  for(size_t i=0;i<s.size();i++) {
    uint32_t c=s[i];if(c>=0xd800&&c<=0xdbff&&i+1<s.size()&&s[i+1]>=0xdc00&&s[i+1]<=0xdfff){c=0x10000+((c-0xd800)<<10)+(s[++i]-0xdc00);}else if(c>=0xd800&&c<=0xdfff)c=0xfffd;
    if(c<0x80)result+=char(c);else if(c<0x800){result+=char(0xc0|(c>>6));result+=char(0x80|(c&63));}
    else if(c<0x10000){result+=char(0xe0|(c>>12));result+=char(0x80|((c>>6)&63));result+=char(0x80|(c&63));}
    else{result+=char(0xf0|(c>>18));result+=char(0x80|((c>>12)&63));result+=char(0x80|((c>>6)&63));result+=char(0x80|(c&63));}
  } return result;
}
int64_t bankers(long double x) {
  if(!std::isfinite(x))fail(6);
  const long double base=std::floor(x),fraction=x-base;
  const long double rounded=fraction<0.5L?base:fraction>0.5L?base+1:std::fmod(base,2)==0?base:base+1;
  // Compare with powers of two: converting INT64_MAX to Apple's double-width
  // long double rounds it upward and would otherwise permit an undefined cast.
  if(rounded < -9223372036854775808.0L || rounded >= 9223372036854775808.0L)fail(6);
  return static_cast<int64_t>(rounded);
}
namespace {
struct Big {
  std::array<uint32_t,12> a{};
  Big()=default; explicit Big(unsigned __int128 n){for(size_t i=0;i<4;i++){a[i]=static_cast<uint32_t>(n);n>>=32;}}
  bool zero() const {for(auto n:a)if(n)return false;return true;}
  int compare(const Big& b)const{for(int i=11;i>=0;i--)if(a[i]!=b.a[i])return a[i]<b.a[i]?-1:1;return 0;}
  void add(const Big& b){uint64_t carry=0;for(size_t i=0;i<12;i++){uint64_t n=uint64_t(a[i])+b.a[i]+carry;a[i]=static_cast<uint32_t>(n);carry=n>>32;}if(carry)fail(6);}
  void sub(const Big& b){uint64_t borrow=0;for(size_t i=0;i<12;i++){uint64_t n=uint64_t(b.a[i])+borrow;borrow=uint64_t(a[i])<n;a[i]=static_cast<uint32_t>(uint64_t(a[i])-n);}if(borrow)fail(6);}
  void mul(uint32_t n){uint64_t carry=0;for(auto& limb:a){uint64_t v=uint64_t(limb)*n+carry;limb=static_cast<uint32_t>(v);carry=v>>32;}if(carry)fail(6);}
  void pow10(size_t n){if(n>114)fail(6);while(n--)mul(10);}
  uint32_t div(uint32_t n){uint64_t r=0;for(int i=11;i>=0;i--){uint64_t v=(r<<32)|a[i];a[i]=static_cast<uint32_t>(v/n);r=v%n;}return static_cast<uint32_t>(r);}
  void shift(){uint32_t carry=0;for(auto& n:a){uint32_t top=n>>31;n=(n<<1)|carry;carry=top;}if(carry)fail(6);}
  static Big multiply(const Big& a,const Big& b){Big out;for(size_t i=0;i<12;i++){uint64_t carry=0;for(size_t j=0;j+i<12;j++){uint64_t v=uint64_t(a.a[i])*b.a[j]+out.a[i+j]+carry;out.a[i+j]=static_cast<uint32_t>(v);carry=v>>32;}if(carry)fail(6);for(size_t j=12-i;j<12;j++)if(a.a[i]&&b.a[j])fail(6);}return out;}
  static std::pair<Big,Big> divide(const Big& n,const Big& d){if(d.zero())fail(11);Big q,r;for(int bit=383;bit>=0;bit--){r.shift();r.a[0]|=(n.a[size_t(bit)/32]>>(bit%32))&1;if(r.compare(d)>=0){r.sub(d);q.a[size_t(bit)/32]|=uint32_t(1)<<(bit%32);}}return {q,r};}
  unsigned __int128 small()const{for(size_t i=4;i<12;i++)if(a[i])fail(6);unsigned __int128 n=0;for(int i=3;i>=0;i--)n=(n<<32)|a[i];return n;}
  bool fits96()const{for(size_t i=3;i<a.size();i++)if(a[i])return false;return true;}
  Text string()const{if(zero())return u"0";Big n=*this;Text s;while(!n.zero())s.push_back(static_cast<char16_t>(u'0'+n.div(10)));std::reverse(s.begin(),s.end());return s;}
};
Big roundDivide(Big n,const Big& denominator){auto qr=Big::divide(n,denominator);Big twice=qr.second;twice.mul(2);int c=twice.compare(denominator);if(c>0||(c==0&&(qr.first.a[0]&1)))qr.first.add(Big(1));return qr.first;}
Decimal fitDecimal(Big n,int scale,bool sign) {
  if(scale<0){n.pow10(size_t(-scale));scale=0;}
  const Big original=n;int drop=std::max(0,scale-28);
  for(;;){Big divisor(1);divisor.pow10(size_t(drop));n=drop?roundDivide(original,divisor):original;if(n.fits96())break;if(drop>=scale)fail(6);drop++;}
  Decimal result;result.coefficient=n.small();result.scale=static_cast<uint8_t>(scale-drop);result.negative=sign&&!n.zero();
  while(result.scale&&result.coefficient%10==0){result.coefficient/=10;result.scale--;}
  return result;
}
Text trimmed(Text s){auto first=s.find_first_not_of(u" \t\r\n"),last=s.find_last_not_of(u" \t\r\n");return first==Text::npos?Text():s.substr(first,last-first+1);}
int64_t currencyRaw(const Decimal& d){Big n(d.coefficient);if(d.scale<4)n.pow10(4-d.scale);else if(d.scale>4){Big denominator(1);denominator.pow10(d.scale-4);n=roundDivide(n,denominator);}auto v=n.small();unsigned __int128 limit=static_cast<unsigned __int128>(1)<<63;if(v>limit||(!d.negative&&v==limit))fail(6);if(v==limit)return INT64_MIN;return d.negative?-static_cast<int64_t>(v):static_cast<int64_t>(v);}
Decimal asDecimal(const Value& v){if(v.type==Type::Decimal)return std::get<Decimal>(v.payload);if(v.type==Type::String)return Decimal::parse(v.string());if(v.type==Type::Currency){int64_t n=std::get<int64_t>(v.payload);Decimal d;d.negative=n<0;d.coefficient=n<0?static_cast<unsigned __int128>(-(static_cast<__int128>(n))):static_cast<unsigned __int128>(n);d.scale=4;return d;}return Decimal::fromNumber(v.number());}
Value result(long double n,Type type,bool variant){
  if(!std::isfinite(n))fail(6);
  if(type==Type::Byte||type==Type::Integer||type==Type::Long){long double lo=type==Type::Byte?0:type==Type::Integer?-32768.0L:-2147483648.0L,hi=type==Type::Byte?255:type==Type::Integer?32767.0L:2147483647.0L;if(n<lo||n>hi){if(!variant)fail(6);return result(n,type==Type::Byte?Type::Integer:type==Type::Integer?Type::Long:Type::Double,true);}return Value::integer(bankers(n),type,variant);}
  if(type==Type::Boolean)return Value::integer(n!=0?-1:0,Type::Boolean,variant);
  if(type==Type::Single&&!std::isfinite(static_cast<float>(n))){if(!variant)fail(6);type=Type::Double;}
  return Value::real(static_cast<double>(n),type,variant);
}
Type arithmeticType(Type a,Type b,const std::string& op){
  if(op=="^")return Type::Double;
  bool bit=op=="and"||op=="or"||op=="xor"||op=="eqv"||op=="imp";
  if(bit&&a==Type::Boolean&&b==Type::Boolean)return Type::Boolean;
  if(bit||op=="\\"||op=="mod"){auto small=[](Type t){return t==Type::Byte||t==Type::Integer||t==Type::Boolean||t==Type::Empty;};return !small(a)||!small(b)?Type::Long:a==Type::Byte&&b==Type::Byte?Type::Byte:Type::Integer;}
  if(a==Type::Decimal||b==Type::Decimal)return Type::Decimal;
  if((op=="+"||op=="-")&&(a==Type::Date||b==Type::Date))return op=="-"&&a==Type::Date&&b==Type::Date?Type::Double:Type::Date;
  if(a==Type::Empty)a=b==Type::Empty?Type::Integer:b;if(b==Type::Empty)b=a;
  auto normal=[](Type t){return t==Type::Boolean?Type::Integer:t==Type::String||t==Type::Date?Type::Double:t;};a=normal(a);b=normal(b);
  if(op=="/")return (a==Type::Single||b==Type::Single)&&a!=Type::Double&&b!=Type::Double&&a!=Type::Long&&b!=Type::Long&&a!=Type::Currency&&b!=Type::Currency?Type::Single:Type::Double;
  if((a==Type::Single&&b==Type::Long)||(b==Type::Single&&a==Type::Long))return Type::Double;
  if(op=="*"&&(a==Type::Currency||b==Type::Currency)&&(a==Type::Single||a==Type::Double||b==Type::Single||b==Type::Double))return Type::Double;
  const std::vector<Type> order=op=="*"?std::vector<Type>{Type::Byte,Type::Integer,Type::Long,Type::Single,Type::Currency,Type::Double}:std::vector<Type>{Type::Byte,Type::Integer,Type::Long,Type::Single,Type::Double,Type::Currency};
  auto ia=std::find(order.begin(),order.end(),a),ib=std::find(order.begin(),order.end(),b);if(ia==order.end()||ib==order.end())fail(13);return *std::max(ia,ib);
}
Text foldText(Text s){for(auto& c:s)c=static_cast<char16_t>(std::towlower(static_cast<wint_t>(c)));return s;}
}
Decimal Decimal::parse(const Text& input){
  Text s=trimmed(input);if(s.empty())fail(13);size_t i=0;bool sign=false;if(s[i]==u'+'||s[i]==u'-')sign=s[i++]==u'-';Big n;int scale=0;bool point=false,digit=false;
  for(;i<s.size();i++){char16_t c=s[i];if(c==u'.'&&!point){point=true;continue;}if(c<u'0'||c>u'9')break;n.mul(10);n.add(Big(c-u'0'));digit=true;if(point)scale++;}
  if(!digit)fail(13);if(i<s.size()&&(s[i]==u'e'||s[i]==u'E'||s[i]==u'd'||s[i]==u'D')){i++;bool negative=false;if(i<s.size()&&(s[i]==u'+'||s[i]==u'-'))negative=s[i++]==u'-';int exponent=0;size_t first=i;for(;i<s.size()&&s[i]>=u'0'&&s[i]<=u'9';i++){if(exponent>1000)fail(6);exponent=exponent*10+s[i]-u'0';}if(first==i)fail(13);scale+=negative?exponent:-exponent;}
  if(i!=s.size())fail(13);if(scale>76){if(n.zero())return {};fail(6);}return fitDecimal(n,scale,sign);
}
Decimal Decimal::fromNumber(long double n){if(!std::isfinite(n))fail(6);std::ostringstream s;s.imbue(std::locale::classic());s<<std::setprecision(15)<<n;return parse(fromUTF8(s.str()));}
Decimal Decimal::add(Decimal a,Decimal b,bool subtract){Big x(a.coefficient),y(b.coefficient);int scale=std::max(a.scale,b.scale);x.pow10(scale-a.scale);y.pow10(scale-b.scale);bool bsign=b.negative!=subtract,sign=a.negative;if(sign==bsign)x.add(y);else if(x.compare(y)>=0)x.sub(y);else{y.sub(x);x=y;sign=bsign;}return fitDecimal(x,scale,sign);}
Decimal Decimal::multiply(Decimal a,Decimal b){return fitDecimal(Big::multiply(Big(a.coefficient),Big(b.coefficient)),a.scale+b.scale,a.negative!=b.negative);}
Decimal Decimal::divide(Decimal a,Decimal b){if(!b.coefficient)fail(11);for(int scale=28;scale>=0;--scale){Big numerator(a.coefficient),denominator(b.coefficient);int shift=scale+int(b.scale)-int(a.scale);if(shift>=0)numerator.pow10(size_t(shift));else denominator.pow10(size_t(-shift));auto rounded=roundDivide(numerator,denominator);if(rounded.fits96())return fitDecimal(rounded,scale,a.negative!=b.negative);}fail(6);}
int Decimal::compare(const Decimal& b)const{if(!coefficient&&!b.coefficient)return 0;if(negative!=b.negative)return negative?-1:1;Big x(coefficient),y(b.coefficient);int scale=std::max(this->scale,b.scale);x.pow10(scale-this->scale);y.pow10(scale-b.scale);int c=x.compare(y);return negative?-c:c;}
long double Decimal::number()const{long double n=static_cast<long double>(coefficient);for(size_t i=0;i<scale;i++)n/=10;return negative?-n:n;}
Text Decimal::string()const{Text s=Big(coefficient).string();if(scale){if(s.size()<=scale)s.insert(0,size_t(scale)+1-s.size(),u'0');s.insert(s.size()-scale,1,u'.');}if(negative&&coefficient)s.insert(0,1,u'-');return s;}

Value Value::integer(int64_t n,Type t,bool v){if((t==Type::Byte&&(n<0||n>255))||(t==Type::Integer&&(n<-32768||n>32767))||(t==Type::Long&&(n<INT32_MIN||n>INT32_MAX))||(t==Type::Error&&(n<0||n>65535)))fail(6);Value out;out.type=t;out.variant=v;out.payload=t==Type::Boolean?(n?int64_t(-1):int64_t(0)):n;return out;}
Value Value::real(double n,Type t,bool v){if(!std::isfinite(n))fail(6);if(t==Type::Single){n=static_cast<float>(n);if(!std::isfinite(n))fail(6);}if(t==Type::Date&&(n<=-657435||n>=2958466))fail(6);Value out;out.type=t;out.variant=v;out.payload=n;return out;}
Value Value::string(Text s,bool v){if(s.size()>INT32_MAX)fail(14);Value out;out.type=Type::String;out.variant=v;out.payload=std::move(s);return out;}
Value Value::currency(const Text& s){return integer(currencyRaw(Decimal::parse(s)),Type::Currency);}
Value Value::decimal(Decimal d){Value out;out.type=Type::Decimal;out.variant=true;out.payload=d;return out;}
Value Value::object(ObjectPtr o){Value out;out.type=Type::Object;out.payload=std::move(o);return out;}
Value Value::array(std::shared_ptr<Array> a){Value out;out.type=Type::Array;out.payload=std::move(a);return out;}
Value Value::record(std::shared_ptr<Record> r){Value out;out.type=Type::Record;out.payload=std::move(r);return out;}
Value Value::null(){Value out;out.type=Type::Null;out.variant=true;return out;}
Value Value::missing(){Value out;out.type=Type::Missing;out.variant=true;return out;}
Value Value::boolean(bool b){return integer(b?-1:0,Type::Boolean);}
Value Value::copy()const{Value out=*this;out.arrayOwners.reset();if(type==Type::Array)out.payload=asArray()->copy();if(type==Type::Record)out.payload=asRecord()->copy();return out;}
long double Value::number()const{
  switch(type){case Type::Empty:return 0;case Type::Null:fail(94);case Type::Missing:fail(449);case Type::Currency:return static_cast<long double>(std::get<int64_t>(payload))/10000;case Type::Decimal:return std::get<Decimal>(payload).number();case Type::Byte:case Type::Integer:case Type::Long:case Type::Boolean:return std::get<int64_t>(payload);case Type::Single:case Type::Double:case Type::Date:return std::get<double>(payload);case Type::String:{const auto text=trimmed(string());if(text.empty())fail(13);std::string s=toUTF8(text);if(s.size()>2&&s[0]=='&'&&(s[1]=='h'||s[1]=='H'||s[1]=='o'||s[1]=='O')){size_t pos=0;try{auto n=std::stoull(s.substr(2),&pos,s[1]=='h'||s[1]=='H'?16:8);if(pos!=s.size()-2||n>UINT32_MAX)fail(13);return n>INT32_MAX?static_cast<int64_t>(n)-4294967296LL:static_cast<int64_t>(n);}catch(const std::exception&){fail(13);}}std::replace(s.begin(),s.end(),'D','E');std::replace(s.begin(),s.end(),'d','e');std::istringstream in(s);in.imbue(std::locale::classic());long double n;in>>std::noskipws>>n;if(!in||!in.eof())fail(13);if(!std::isfinite(n))fail(6);return n;}default:fail(13);}
}
int64_t Value::integral()const{return bankers(number());}
bool Value::truth()const{if(type==Type::Null||type==Type::Empty)return false;if(type==Type::String){auto text=lower(toUTF8(trimmed(string())));if(text=="true")return true;if(text=="false")return false;}return number()!=0;}
bool Value::isNumeric()const{try{if(type==Type::Date||type==Type::Boolean||type==Type::Null)return false;(void)number();return true;}catch(const Error&){return false;}}
Text Value::string()const{
  switch(type){case Type::String:return std::get<Text>(payload);case Type::Empty:return u"";case Type::Null:fail(94);case Type::Missing:fail(449);case Type::Boolean:return std::get<int64_t>(payload)?u"True":u"False";case Type::Currency:{int64_t n=std::get<int64_t>(payload);Decimal d;d.negative=n<0;d.coefficient=n<0?static_cast<unsigned __int128>(-static_cast<__int128>(n)):static_cast<unsigned __int128>(n);d.scale=4;while(d.scale&&d.coefficient%10==0){d.scale--;d.coefficient/=10;}return d.string();}case Type::Decimal:return std::get<Decimal>(payload).string();case Type::Byte:case Type::Integer:case Type::Long:return fromUTF8(std::to_string(std::get<int64_t>(payload)));case Type::Error:return u"Error "+fromUTF8(std::to_string(std::get<int64_t>(payload)));case Type::Date:return generalDateString(*this);case Type::Single:case Type::Double:{std::ostringstream out;out.imbue(std::locale::classic());out<<std::setprecision(type==Type::Single?7:15)<<std::get<double>(payload);return fromUTF8(out.str());}default:fail(13);}
}
ObjectPtr Value::asObject()const{if(type!=Type::Object)fail(424);auto o=std::get<ObjectPtr>(payload);if(!o)fail(91);return o;}
std::shared_ptr<Array> Value::asArray()const{if(type!=Type::Array)fail(13);auto a=std::get<std::shared_ptr<Array>>(payload);if(!a)fail(9);return a;}
std::shared_ptr<Record> Value::asRecord()const{if(type!=Type::Record)fail(13);return std::get<std::shared_ptr<Record>>(payload);}
Type typeCode(const std::string& value){auto s=lower(value);if(s=="byte")return Type::Byte;if(s=="integer")return Type::Integer;if(s=="long")return Type::Long;if(s=="single")return Type::Single;if(s=="double")return Type::Double;if(s=="currency")return Type::Currency;if(s=="date")return Type::Date;if(s=="string")return Type::String;if(s=="boolean")return Type::Boolean;if(s=="object")return Type::Object;if(s=="variant")return Type::Variant;if(s=="decimal")return Type::Decimal;if(s=="error")return Type::Error;return Type::Record;}
std::string typeName(const Value& v){switch(v.type){case Type::Empty:return "Empty";case Type::Null:return "Null";case Type::Byte:return "Byte";case Type::Integer:return "Integer";case Type::Long:return "Long";case Type::Single:return "Single";case Type::Double:return "Double";case Type::Currency:return "Currency";case Type::Date:return "Date";case Type::String:return "String";case Type::Boolean:return "Boolean";case Type::Decimal:return "Decimal";case Type::Error:case Type::Missing:return "Error";case Type::Object:{auto o=std::get<ObjectPtr>(v.payload);return o?o->className():"Nothing";}case Type::Array:{const auto& array=v.asArray();const auto& element=array->displayElementType.empty()?array->elementType:array->displayElementType;static const std::map<std::string,std::string>names={{"byte","Byte"},{"integer","Integer"},{"long","Long"},{"single","Single"},{"double","Double"},{"currency","Currency"},{"date","Date"},{"boolean","Boolean"},{"string","String"},{"object","Object"},{"variant","Variant"}};auto found=names.find(lower(element));return (found==names.end()?element:found->second)+"()";}case Type::Record:{const auto& record=v.asRecord();return record->displayName.empty()?record->name:record->displayName;}default:return "Variant";}}
Value coerce(Value value,const std::string& name,size_t fixed){
  Type type=typeCode(name);if(type==Type::Variant){value=value.copy();value.variant=true;return value;}
  if(value.type==Type::Null)fail(94);
  if(type==Type::String){Text s=value.string();if(fixed){s.resize(fixed,u' ');}return Value::string(std::move(s));}
  if(type==Type::Object){if(value.type!=Type::Object)fail(13);return value;}
  if(type==Type::Record){if(value.type==Type::Record&&lower(value.asRecord()->name)==lower(name))return value.copy();if(value.type==Type::Object){auto o=std::get<ObjectPtr>(value.payload);if(!o)return value;value.payload=o->queryInterface(name);return value;}fail(13);}
  if(type==Type::Date)return parseDate(value);
  if(type==Type::Currency)return Value::integer(currencyRaw(asDecimal(value)),Type::Currency);
  if(type==Type::Decimal)return Value::decimal(asDecimal(value));
  if(type==Type::Error)return value.type==Type::Error?value:Value::integer(value.integral(),Type::Error);
  if(type==Type::Boolean)return Value::boolean(value.truth());
  if(type==Type::Byte||type==Type::Integer||type==Type::Long)return Value::integer(value.integral(),type);
  return Value::real(value.floating(),type);
}
Value unary(const std::string& op,Value v){if(v.type==Type::Null)return v;if(op=="+")return v;if(op=="not"){Type t=v.type;if(t==Type::Boolean)return Value::integer(~v.integral(),t,v.variant);if(t!=Type::Byte&&t!=Type::Integer)t=Type::Long;auto n=coerce(v,t==Type::Long?"long":"integer").integral();int64_t out=~n;if(t==Type::Byte)t=Type::Integer;return Value::integer(out,t,v.variant);}if(op!="-")fail(5);if(v.type==Type::Currency){auto n=std::get<int64_t>(v.payload);if(n==INT64_MIN)fail(6);return Value::integer(-n,Type::Currency,v.variant);}if(v.type==Type::Decimal){auto d=std::get<Decimal>(v.payload);if(d.coefficient)d.negative=!d.negative;return Value::decimal(d);}Type t=v.type;if(t==Type::Boolean||t==Type::Empty||t==Type::Byte)t=Type::Integer;if(t==Type::String)t=Type::Double;return result(-v.number(),t,v.variant);}
Value binary(const std::string& op,Value a,Value b,bool textCompare){
  const bool variant=a.variant||b.variant;
  if(op=="is"){if(a.type!=Type::Object||b.type!=Type::Object)fail(13);return Value::boolean(sameObject(std::get<ObjectPtr>(a.payload),std::get<ObjectPtr>(b.payload)));}
  if(op=="&"){if(a.type==Type::Null&&b.type==Type::Null)return Value::null();return Value::string((a.type==Type::Null?Text():a.string())+(b.type==Type::Null?Text():b.string()),variant);}
  if(a.type==Type::Null||b.type==Type::Null){if(op=="and"&&((a.type!=Type::Null&&!a.truth())||(b.type!=Type::Null&&!b.truth())))return Value::integer(0,Type::Long,true);if(op=="or"&&((a.type!=Type::Null&&a.integral()==-1)||(b.type!=Type::Null&&b.integral()==-1)))return Value::integer(-1,Type::Long,true);return Value::null();}
  if(op=="like")return Value::boolean(like(a.string(),b.string(),textCompare));
  if(op=="="||op=="<>"||op=="<"||op==">"||op=="<="||op==">="){
    int c=0;bool sa=a.type==Type::String,sb=b.type==Type::String;
    if(a.type==Type::Empty){a=sb?Value::string(u""):Value::integer(0,Type::Integer);sa=sb;}
    if(b.type==Type::Empty){b=sa?Value::string(u""):Value::integer(0,Type::Integer);sb=sa;}
    if(sa!=sb&&a.variant&&b.variant)c=sa?1:-1;
    else if((sa&&sb)||(sa&&!a.variant&&b.variant)||(sb&&!b.variant&&a.variant)){Text x=a.string(),y=b.string();if(textCompare){x=foldText(x);y=foldText(y);}c=x<y?-1:x>y?1:0;}
    else if(a.type==Type::Decimal||b.type==Type::Decimal||a.type==Type::Currency||b.type==Type::Currency)c=asDecimal(a).compare(asDecimal(b));
    else {auto x=a.number(),y=b.number();c=x<y?-1:x>y?1:0;}
    auto v=Value::boolean(op=="="?c==0:op=="<>"?c!=0:op=="<"?c<0:op==">"?c>0:op=="<="?c<=0:c>=0);v.variant=variant;return v;
  }
  if(op=="+"&&(a.type==Type::String||a.type==Type::Empty)&&(b.type==Type::String||b.type==Type::Empty)&&(a.type==Type::String||b.type==Type::String))return Value::string(a.string()+b.string(),variant);
  Type t=arithmeticType(a.type,b.type,op);
  if(t==Type::Decimal||t==Type::Currency){Decimal x=asDecimal(a),y=asDecimal(b),d;if(op=="+")d=Decimal::add(x,y);else if(op=="-")d=Decimal::add(x,y,true);else if(op=="*")d=Decimal::multiply(x,y);else if(op=="/")d=Decimal::divide(x,y);else fail(5);if(t==Type::Decimal)return Value::decimal(d);return Value::integer(currencyRaw(d),Type::Currency,variant);}
  long double x=a.number(),y=b.number(),n=0;
  if(op=="+" )n=x+y;else if(op=="-")n=x-y;else if(op=="*")n=x*y;else if(op=="/"){if(y==0)fail(11);n=x/y;}else if(op=="^"){n=std::pow(x,y);if(std::isnan(n))fail(5);}
  else if(op=="\\"||op=="mod"){int64_t i=coerce(a,"long").integral(),j=coerce(b,"long").integral();if(!j)fail(11);n=op=="\\"?i/j:i%j;}
  else {int32_t i=static_cast<int32_t>(coerce(a,"long").integral()),j=static_cast<int32_t>(coerce(b,"long").integral());if(op=="and")n=i&j;else if(op=="or")n=i|j;else if(op=="xor")n=i^j;else if(op=="eqv")n=~(i^j);else if(op=="imp")n=(~i)|j;else fail(5);}
  return result(n,t,variant);
}
bool like(const Text& value,const Text& pattern,bool textCompare){
  const Text s=textCompare?foldText(value):value,p=textCompare?foldText(pattern):pattern;
  struct Token{char16_t kind=0,literal=0;bool negate=false;std::vector<std::pair<char16_t,char16_t>> ranges;};std::vector<Token> tokens;
  for(size_t i=0;i<p.size();i++){Token t;t.kind=p[i];if(t.kind==u'['){i++;if(i==p.size())fail(93);if(p[i]==u'!'){t.negate=true;i++;}while(i<p.size()&&p[i]!=u']'){char16_t a=p[i++],b=a;if(i+1<p.size()&&p[i]==u'-'&&p[i+1]!=u']'){i++;b=p[i++];if(a>b)fail(93);}t.ranges.push_back({a,b});}if(i==p.size())fail(93);if(t.ranges.empty()&&!t.negate)continue;}else if(t.kind!=u'*'&&t.kind!=u'?'&&t.kind!=u'#'){t.literal=t.kind;t.kind=u'=';}tokens.push_back(t);}
  // Linear-space DP avoids exponential wildcard backtracking on untrusted input.
  std::vector<uint8_t> prev(tokens.size()+1),next(tokens.size()+1);prev[0]=1;for(size_t j=0;j<tokens.size();j++)if(tokens[j].kind==u'*')prev[j+1]=prev[j];
  for(char16_t c:s){std::fill(next.begin(),next.end(),0);for(size_t j=0;j<tokens.size();j++){const auto& t=tokens[j];bool match=t.kind==u'?'||(t.kind==u'#'&&c>=u'0'&&c<=u'9')||(t.kind==u'='&&t.literal==c);if(t.kind==u'['){bool found=false;for(auto r:t.ranges)if(c>=r.first&&c<=r.second)found=true;match=found!=t.negate;}next[j+1]=t.kind==u'*'?(next[j]||prev[j+1]):(prev[j]&&match);}prev.swap(next);}return prev.back()!=0;
}
Text printValue(const Value& v){if(v.type==Type::Null)return u"Null";if(v.type==Type::Empty)return u"";Text s=v.string();if(v.type==Type::Byte||v.type==Type::Integer||v.type==Type::Long||v.type==Type::Single||v.type==Type::Double||v.type==Type::Currency||v.type==Type::Decimal){if(v.number()>=0)s.insert(0,1,u' ');s+=u' ';}return s;}
Value Ref::get()const{if(!read)fail(13,"Value is not assignable");return read();}
void Ref::set(Value v,bool objectSet)const{if(!write)fail(451);write(std::move(v),objectSet);}
Cell::Cell(Value v,std::string t,size_t length,bool c,bool array):value(std::move(v)),type(lower(std::move(t))),fixedLength(length),constant(c),arrayStorage(array||(value.type==Type::Array&&type!="variant")){if(!arrayStorage&&type=="string"&&fixedLength)value=coerce(value,type,fixedLength);}
Value Cell::get(){if(lazy&&value.type==Type::Object&&!std::get<ObjectPtr>(value.payload))value=lazy();return value;}
void Cell::set(Value v,bool){
  if(constant)fail(5,"Cannot assign to a constant");
  if(arrayStorage){
    if(v.type!=Type::Array||lower(v.asArray()->elementType)!=type)fail(13,"Array element type mismatch");
    if(value.type==Type::Array&&(!value.asArray()->dynamic||value.asArray()->borrowedElements))fail(10,"This array is fixed or temporarily locked");
    // A value copy must not import the source array's fixed-storage policy.
    // Validate and allocate before replacing the old value (failure atomicity).
    auto copy=v.asArray()->copy();copy->dynamic=true;value=Value::array(std::move(copy));
  }else {if(value.type==Type::Array&&value.asArray()->borrowedElements)fail(10,"This array is temporarily locked");storeNativeValue(value,coerce(std::move(v),type,fixedLength));}
  if(changed)changed(value);
}
Ref cellRef(CellPtr cell){return {[cell]{return cell->get();},[cell](Value v,bool set){cell->set(std::move(v),set);},cell->type,cell->arrayStorage,true,cell->fixedLength};}
Array::Array(std::string type,Bounds dimensions,bool dyn,size_t maxElements,size_t length,std::function<Value()> init,std::string display):elementType(lower(type)),displayElementType(display.empty()?std::move(type):std::move(display)),bounds(std::move(dimensions)),dynamic(dyn),allocated(!bounds.empty()),fixedLength(length),initializer(std::move(init)){
  if(bounds.size()>60)fail(9);size_t count=allocated?1:0;for(auto b:bounds){int64_t width=int64_t(b.second)-b.first+1;if(width<=0||static_cast<uint64_t>(width)>maxElements||count>maxElements/static_cast<size_t>(width))fail(width<=0?9:7);count*=static_cast<size_t>(width);}values.reserve(count);for(size_t i=0;i<count;i++)values.push_back(coerce(initializer?initializer():Value(),elementType,fixedLength));
}
size_t Array::offset(const std::vector<Value>& indices)const{if(!allocated||indices.size()!=bounds.size())fail(9);size_t index=0,stride=1;for(size_t i=0;i<bounds.size();i++){int64_t n=indices[i].integral();if(n<bounds[i].first||n>bounds[i].second)fail(9);index+=static_cast<size_t>(n-bounds[i].first)*stride;stride*=static_cast<size_t>(int64_t(bounds[i].second)-bounds[i].first+1);}if(index>=values.size())fail(9);return index;}
Ref Array::at(const std::vector<Value>& indices){
  const size_t index=offset(indices);auto self=shared_from_this();
  auto borrow=borrowArrayValue(Value::array(self),true);
  return {[self,borrow,index]{return addArrayOwner(self->values.at(index),self);},
    [self,borrow,index](Value v,bool){storeNativeValue(self->values.at(index),coerce(std::move(v),self->elementType,self->fixedLength));},elementType,false,true,fixedLength};
}
std::shared_ptr<Array> Array::resized(Bounds dimensions,bool preserve,size_t maxElements)const{if(!dynamic||borrowedElements)fail(10,"This array is fixed or temporarily locked");if(preserve&&allocated){if(dimensions.size()!=bounds.size())fail(9);for(size_t i=0;i<bounds.size();i++)if(dimensions[i].first!=bounds[i].first||(i+1<bounds.size()&&dimensions[i].second!=bounds[i].second))fail(9);}auto out=std::make_shared<Array>(elementType,std::move(dimensions),true,maxElements,fixedLength,initializer,displayElementType);if(preserve&&allocated)for(size_t i=0;i<std::min(values.size(),out->values.size());i++)out->values[i]=values[i].copy();return out;}
std::shared_ptr<Array> Array::copy()const{auto out=std::make_shared<Array>(elementType,Bounds{},dynamic,1,fixedLength,initializer,displayElementType);out->allocated=allocated;out->bounds=bounds;out->values.reserve(values.size());for(const auto& v:values)out->values.push_back(v.copy());return out;}
void Array::erase(){if(borrowedElements)fail(10,"This array is temporarily locked");if(dynamic){values.clear();bounds.clear();allocated=false;}else for(auto& v:values)v=coerce(initializer?initializer():Value(),elementType,fixedLength);}
std::shared_ptr<Record> Record::copy()const{auto out=std::make_shared<Record>();out->name=name;out->displayName=displayName;out->order=order;for(auto& entry:fields){auto c=entry.second;out->fields[entry.first]=std::make_shared<Cell>(c->value.copy(),c->type,c->fixedLength,c->constant,c->arrayStorage);}return out;}
Ref Record::member(const std::string& name)const{auto it=fields.find(lower(name));if(it==fields.end())fail(438,"Unknown record field: "+name);return cellRef(it->second);}
} // namespace vb6
