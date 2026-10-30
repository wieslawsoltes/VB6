// VB6 Binary/Random records and sequential Input/Write. No host struct packing.
#include "file-codec.hpp"
#include "library.hpp"
#include "calendar.hpp"
#include <cstring>
#include <regex>
namespace vb6 {
namespace {
constexpr std::array<char16_t,32> c1={0x20AC,0x81,0x201A,0x192,0x201E,0x2026,0x2020,0x2021,0x2C6,0x2030,0x160,0x2039,0x152,0x8D,0x17D,0x8F,0x90,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x2DC,0x2122,0x161,0x203A,0x153,0x9D,0x17E,0x178};
size_t scalarSize(const std::string& type){
  if(type=="byte")return 1;if(type=="integer"||type=="boolean")return 2;
  if(type=="long"||type=="single"||type=="error")return 4;
  if(type=="double"||type=="date"||type=="currency")return 8;
  if(type=="decimal"||type=="variant")return 16;
  return 0;
}
std::vector<std::string> ordered(const std::shared_ptr<Record>&record){
  if(!record->order.empty())return record->order;
  std::vector<std::string> names;for(auto&entry:record->fields)names.push_back(entry.first);return names;
}
struct Writer {
  Bytes bytes;
  void append(const uint8_t*data,size_t size){if(size>MaxRecordBytes-bytes.size())fail(7,"Binary record exceeds 20 MiB");if(size)bytes.insert(bytes.end(),data,data+size);}
  void uint(uint64_t value,size_t size){uint8_t data[8];for(size_t i=0;i<size;i++)data[i]=uint8_t(value>>(i*8));append(data,size);}
  void floating(double value,bool single){if(single){float f=static_cast<float>(value);uint32_t bits;std::memcpy(&bits,&f,4);uint(bits,4);}else{uint64_t bits;std::memcpy(&bits,&value,8);uint(bits,8);}}
};
struct Reader {
  const Bytes&bytes;size_t position=0;
  const uint8_t*read(size_t size){if(size>bytes.size()-position)fail(62);auto*p=bytes.data()+position;position+=size;return p;}
  uint64_t uint(size_t size){auto*p=read(size);uint64_t value=0;for(size_t i=0;i<size;i++)value|=uint64_t(p[i])<<(8*i);return value;}
  int64_t sint(size_t size){uint64_t n=uint(size);if(size<8&&(n&(uint64_t(1)<<(size*8-1))))n|=(~uint64_t(0))<<(size*8);int64_t result;std::memcpy(&result,&n,8);return result;}
  double floating(bool single){if(single){uint32_t bits=uint32_t(uint(4));float n;std::memcpy(&n,&bits,4);return n;}uint64_t bits=uint(8);double n;std::memcpy(&n,&bits,8);return n;}
};
void put(Writer&w,Value value,FileSchema schema,const std::string&mode,bool inRecord=false,int depth=0){
  if(depth>32)fail(7,"Record nesting exceeds 32 levels");auto type=lower(schema.type);
  if(value.type==Type::Array){
    if(!schema.array)fail(458,"Scalar Variant containing an array cannot be written by Put");auto a=value.asArray();if(!a->allocated||a->bounds.empty())fail(9);
    if(a->dynamic&&(mode=="random"||inRecord)){w.uint(a->bounds.size(),2);for(auto[lo,hi]:a->bounds){w.uint(uint64_t(int64_t(hi)-lo+1),4);w.uint(uint32_t(lo),4);}}
    for(auto&v:a->values)put(w,v,{a->elementType,a->fixedLength,false},mode,inRecord,depth+1);return;
  }
  if(value.type==Type::Record){auto record=value.asRecord();for(auto&name:ordered(record)){auto cell=record->fields.at(name);put(w,cell->get(),{cell->type,cell->fixedLength,cell->value.type==Type::Array},mode,true,depth+1);}return;}
  if(value.type==Type::Object||type=="object")fail(458,"Objects cannot be written by Put");
  if(type=="variant"){
    if(value.type==Type::Missing||value.type==Type::Array||value.type==Type::Record)fail(458);
    w.uint(static_cast<uint16_t>(value.type),2);if(value.type==Type::Empty||value.type==Type::Null)return;
    put(w,value,{typeName(value),0,false},mode,inRecord||value.type==Type::String,depth+1);return;
  }
  if(type=="string"){
    auto bytes=encodeANSI(coerce(value,"string",schema.fixedLength).string());
    if(!schema.fixedLength&&(mode=="random"||inRecord)){if(bytes.size()>65535)fail(63);w.uint(bytes.size(),2);}
    w.append(bytes.data(),bytes.size());return;
  }
  value=coerce(value,type);
  if(type=="decimal"){
    auto d=std::get<Decimal>(value.payload);w.uint(0,2);w.uint(d.scale,1);w.uint(d.negative?128:0,1);w.uint(uint32_t(d.coefficient>>64),4);w.uint(uint64_t(d.coefficient),8);return;
  }
  if(type=="single"||type=="double"||type=="date"){w.floating(value.floating(),type=="single");return;}
  auto size=scalarSize(type);if(!size)fail(458,"Unsupported file data type: "+type);
  w.uint(uint64_t(std::get<int64_t>(value.payload)),size);
}
Value get(Reader&r,FileSchema schema,Value current,const std::string&mode,size_t maxArrayElements,bool inRecord=false,int depth=0){
  if(depth>32)fail(7,"Record nesting exceeds 32 levels");auto type=lower(schema.type);
  if(current.type==Type::Array||schema.array){
    if(!schema.array)fail(458,"Scalar Variant containing an array cannot be read by Get");
    auto previous=current.asArray();Bounds bounds=previous->bounds;
    if(previous->dynamic&&(mode=="random"||inRecord)){
      auto rank=r.sint(2);if(rank<1||rank>32)fail(63,"Invalid array descriptor");bounds.clear();
      for(int i=0;i<rank;i++){auto count=r.sint(4),lo=r.sint(4);if(count<1||lo+count-1>INT32_MAX)fail(63,"Invalid array extent");bounds.emplace_back(int32_t(lo),int32_t(lo+count-1));}
    }
    if(bounds.empty())fail(9,"Dimension the array before Binary Get");
    auto array=std::make_shared<Array>(previous->elementType,bounds,previous->dynamic,maxArrayElements,previous->fixedLength,previous->initializer,previous->displayElementType);
    for(auto&v:array->values)v=get(r,{array->elementType,array->fixedLength,false},v,mode,maxArrayElements,inRecord,depth+1);
    return Value::array(array);
  }
  if(current.type==Type::Record){
    auto previous=current.asRecord(),record=std::make_shared<Record>();record->name=previous->name;record->displayName=previous->displayName;record->order=ordered(previous);
    for(auto&name:record->order){auto cell=previous->fields.at(name);auto value=get(r,{cell->type,cell->fixedLength,cell->value.type==Type::Array},cell->get(),mode,maxArrayElements,true,depth+1);record->fields[name]=std::make_shared<Cell>(value,cell->type,cell->fixedLength);}
    return Value::record(record);
  }
  if(type=="object"||current.type==Type::Object)fail(458,"Objects cannot be read by Get");
  if(type=="variant"){
    auto kind=Type(r.uint(2));if(kind==Type::Empty){Value v;v.variant=true;return v;}if(kind==Type::Null)return Value::null();
    switch(kind){case Type::Integer:case Type::Long:case Type::Single:case Type::Double:case Type::Currency:case Type::Date:case Type::String:case Type::Error:case Type::Boolean:case Type::Decimal:case Type::Byte:break;default:fail(458,"Unsupported Variant file descriptor");}
    Value tag;tag.type=kind;auto value=get(r,{typeName(tag),0,false},{},mode,maxArrayElements,inRecord||kind==Type::String,depth+1);value.variant=true;return value;
  }
  if(type=="string"){
    auto size=schema.fixedLength?schema.fixedLength:(mode=="random"||inRecord)?size_t(r.uint(2)):current.string().size();auto*data=r.read(size);return Value::string(decodeANSI(data,size));
  }
  if(type=="decimal"){
    auto reserved=r.uint(2),scale=r.uint(1),sign=r.uint(1),hi=r.uint(4),lo=r.uint(8);if(reserved||scale>28||(sign!=0&&sign!=128))fail(63,"Invalid Decimal record");
    Decimal d;d.coefficient=(static_cast<unsigned __int128>(hi)<<64)|lo;d.scale=uint8_t(scale);d.negative=sign==128&&d.coefficient;return Value::decimal(d);
  }
  if(type=="single"||type=="double"||type=="date")return Value::real(r.floating(type=="single"),typeCode(type));
  auto size=scalarSize(type);if(!size)fail(458,"Unsupported file data type: "+type);
  return Value::integer(type=="byte"?int64_t(r.uint(1)):r.sint(size),typeCode(type));
}
Text trim(Text value){auto begin=value.find_first_not_of(u" \t\r\n"),end=value.find_last_not_of(u" \t\r\n");return begin==Text::npos?Text{}:value.substr(begin,end-begin+1);}
}
Bytes encodeANSI(const Text&text){
  Bytes out;out.reserve(text.size());for(auto c:text){if(c<128||(c>=160&&c<=255)){out.push_back(uint8_t(c));continue;}auto found=std::find(c1.begin(),c1.end(),c);if(found==c1.end())fail(5,"Character is not representable in the Windows-1252 file encoding");out.push_back(uint8_t(128+(found-c1.begin())));}return out;
}
Text decodeANSI(const uint8_t*data,size_t size){Text text;text.reserve(size);for(size_t i=0;i<size;i++){auto c=data[i];text.push_back(c>=128&&c<160?c1[c-128]:char16_t(c));}return text;}
Bytes encodeVariable(Value value,FileSchema schema,const std::string&mode){Writer writer;put(writer,value,schema,mode);return writer.bytes;}
std::pair<Value,size_t>decodeVariable(const Bytes&bytes,FileSchema schema,Value current,const std::string&mode,size_t maximum){Reader reader{bytes};auto value=get(reader,schema,current,mode,maximum);return {value,reader.position};}
size_t recordByteLength(const Value&value,bool padded){
  size_t size=0,alignment=1;
  if(value.type==Type::Record){auto record=value.asRecord();for(auto&name:ordered(record)){auto cell=record->fields.at(name);auto v=cell->get();size_t field=v.type==Type::Record||v.type==Type::Array?recordByteLength(v,padded):lower(cell->type)=="string"?(cell->fixedLength?cell->fixedLength:v.string().size())*(padded?2:1):scalarSize(lower(cell->type));if(!field&&v.type!=Type::String)fail(458);auto align=padded?std::min(size_t(4),std::max(size_t(1),scalarSize(lower(cell->type)))):1;alignment=std::max(alignment,align);size=(size+align-1)/align*align;size+=field;if(size>MaxRecordBytes)fail(7);}return (size+alignment-1)/alignment*alignment;}
  if(value.type==Type::Array){auto a=value.asArray();for(auto&v:a->values){size+=v.type==Type::Record?recordByteLength(v,padded):lower(a->elementType)=="string"?(a->fixedLength?a->fixedLength:v.string().size())*(padded?2:1):scalarSize(lower(a->elementType));if(size>MaxRecordBytes)fail(7);}return size;}
  if(value.type==Type::String)return value.string().size()*(padded?2:1);return scalarSize(lower(typeName(value)));
}
std::pair<Value,size_t>readInputField(const Text&text,size_t start,const std::string&raw){
  if(start>text.size())fail(5);size_t i=start;while(i<text.size()&&(text[i]==u' '||text[i]==u'\t'))++i;if(i==text.size())fail(62);
  bool quoted=text[i]==u'"';Text token;
  if(quoted){auto end=text.find(u'"',i+1);if(end==Text::npos)fail(62);token=text.substr(i+1,end-i-1);i=end+1;}
  else{auto begin=i;while(i<text.size()&&text[i]!=u','&&text[i]!=u'\r'&&text[i]!=u'\n')++i;if(i==text.size())fail(62);token=trim(text.substr(begin,i-begin));}
  while(i<text.size()&&(text[i]==u' '||text[i]==u'\t'))++i;
  if(i<text.size()&&text[i]==u',')++i;else if(i<text.size()&&text[i]==u'\r'){++i;if(i<text.size()&&text[i]==u'\n')++i;}else if(i<text.size()&&text[i]==u'\n')++i;
  auto type=lower(raw);Value value;
  if(type=="string")value=Value::string(token);
  else if(quoted)value=type=="variant"?Value::string(token,true):coerce({},type);
  else if(token.empty())value={};
  else if(token==u"#NULL#")value=Value::null();
  else if(token==u"#TRUE#"||token==u"#FALSE#")value=Value::boolean(token==u"#TRUE#");
  else if(token.size()>8&&token.substr(0,7)==u"#ERROR "&&token.back()==u'#')value=Value::integer(coerce(Value::string(token.substr(7,token.size()-8)),"long").integral(),Type::Error);
  else if(token.size()>1&&token.front()==u'#'&&token.back()==u'#')value=parseDate(Value::string(token.substr(1,token.size()-2)));
  else if(type=="boolean"||type=="date")fail(6);
  else{static const std::regex number(R"([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)");auto s=toUTF8(token);if(std::regex_match(s,number))value=coerce(Value::string(token),"double");else value=type=="variant"?Value::string(token):coerce({},type);}
  value.variant=true;return {value,i};
}
Text writeInputValue(const Value&value){
  if(value.type==Type::String)return u"\""+value.string()+u"\"";
  if(value.type==Type::Null)return u"#NULL#";if(value.type==Type::Empty)return {};
  if(value.type==Type::Boolean)return value.truth()?u"#TRUE#":u"#FALSE#";
  if(value.type==Type::Error)return u"#ERROR "+fromUTF8(std::to_string(std::get<int64_t>(value.payload)))+u"#";
  if(value.type==Type::Date)return u"#"+formatDate(value,u"yyyy-mm-dd hh:nn:ss")+u"#";
  return value.string();
}
} // namespace vb6
