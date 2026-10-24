#pragma once
#include "vb6.hpp"
#include "library.hpp"
#include "json.hpp"
#include <deque>
#include <exception>
#include <limits>
namespace vb6::aot {
inline constexpr int AbiVersion = 5;
using Word=uint64_t;
constexpr Word failed=std::numeric_limits<Word>::max();
struct Scope;
using Entry=void(*)(Scope*);
struct Program {
  std::vector<std::string> names;std::vector<Value> literals;std::vector<Entry> entries;
};
struct Scope {
  Frame& frame;std::shared_ptr<Program> program;Value result;std::exception_ptr error;Word redirect=failed;
  using Item=std::variant<Value,Ref,Args,Bounds,std::vector<Value>,std::vector<Ref>,std::shared_ptr<ArrayBorrow>>;
  std::deque<Item> items;
  Scope(Frame& f,std::shared_ptr<Program> p):frame(f),program(std::move(p)){}
  template<class T> Word put(T value){if(items.size()>=65536)fail(7,"AOT expression temporary limit exceeded");items.emplace_back(std::move(value));return items.size();}
  template<class T> T& get(Word handle){if(!handle||handle>items.size())fail(5,"Invalid AOT temporary");return std::get<T>(items.at(size_t(handle-1)));}
  Value value(Word h){return get<Value>(h);}
  Value scalarValue(Word h){return scalar(frame.runtime,value(h));}
  const std::string& name(Word id) const {return program->names.at(size_t(id));}
};
Value execute(Frame&,std::shared_ptr<Program>,Entry);
void initialize(Runtime&,const Json&,const std::vector<Entry>&);
int run(const std::string& metadata,const std::vector<Entry>& entries,int argc,char** argv);
}
