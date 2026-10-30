#include "helpers.hpp"
#include "file-codec.hpp"
#include "lifetime.hpp"
#include <cassert>
#include <iostream>
using namespace vb6;
using namespace vb6::aot;

static void emptyEntry(Scope* scope){vb6_aot_finish(scope);}
template<class F> static void raises(int number,F action){
  bool caught=false;try{action();}catch(const Error&error){caught=true;assert(error.number==number);}assert(caught);
}
int main(){
  Runtime runtime(makeNativeHost());
  // The optional display metadata is absent, as in older metadata producers.
  const std::string json="{\"abi\":"+std::to_string(AbiVersion)+R"(,"name":"RecordDefaults","startup":"Sub Main","maxArrayElements":100,"maxCallDepth":64,"names":[""],"literals":[],"modules":[{"name":"Records","kind":"module","defaultMember":"","optionExplicit":true,"optionBase":0,"textCompare":false,"defaultTypes":{},"interfaces":[],"publicFields":[],"interfaceBindings":{},"initialize":0,"records":[],"procedures":[{"key":"legacyresult","name":"LegacyResult","scope":"public","returnType":"LegacyItem","returnArray":true,"accessor":"","isFunction":true,"isStatic":false,"external":false,"entry":0,"parameters":[]}]}]})";
  initialize(runtime,JsonReader(json).parse(),{emptyEntry});
  auto instance=runtime.instance("Records");
  assert(runtime.modules.at("records").procedures.at("legacyresult").returnDisplayType=="LegacyItem");
  assert(typeName(runtime.invoke(instance,"LegacyResult",{},true))=="LegacyItem()");

  int prototypes=0;
  runtime.modules.at("records").records["records.item"]=[&prototypes](Frame&){
    ++prototypes;auto record=std::make_shared<Record>();record->name="records.item";record->displayName="Item";
    record->order={"value"};record->fields["value"]=std::make_shared<Cell>(Value::integer(0),"long");return Value::record(record);
  };
  auto program=std::make_shared<Program>();
  program->names={"","LegacyItem","Fixed","Long","records.item","rEcOrDs.ItEm","Items","Scalar","Lazy"};
  Value escaped;
  {
    Frame frame(runtime,instance);Scope scope(frame,program);
    runtime.maxCallDepth=1;
    assert(frame.makeArray("long",{{0,0}},false).asArray()->values[0].integral()==0);
    assert(runtime.depth==1); // Storage initialization is not an authored call.
    // Old helper arities leave optional integer registers zero. Empty names
    // preserve the legacy display fallback and nonempty bounds imply fixed.
    const auto legacy=vb6_aot_record(&scope,1);
    assert(typeName(scope.value(legacy))=="LegacyItem");
    const auto fixed=scope.put(Bounds{{0,0}}),empty=scope.put(Bounds{});
    assert(vb6_aot_record_field(&scope,legacy,2,3,fixed,0)!=failed);
    assert(vb6_aot_record_field(&scope,legacy,7,3,empty,0)!=failed);
    assert(typeName(scope.value(legacy).asRecord()->member("Fixed").get())=="Long()");
    assert(typeName(scope.value(legacy).asRecord()->member("Scalar").get())=="Long");
    assert(vb6_aot_declare(&scope,6,3,empty,1,0,0)!=failed);
    assert(typeName(frame.get("Items"))=="Long()");

    const auto record=vb6_aot_record(&scope,4,1);
    assert(typeName(scope.value(record))=="LegacyItem");
    assert(scope.value(record).asRecord()->name=="records.item");
    assert(vb6_aot_record_field(&scope,record,8,4,empty,0,1,5)!=failed);
    escaped=scope.value(record).asRecord()->member("Lazy").get();
    assert(escaped.type==Type::Array&&!escaped.asArray()->allocated&&escaped.asArray()->dynamic);
    assert(escaped.asArray()->elementType=="records.item");
    assert(typeName(escaped)=="rEcOrDs.ItEm()");
    assert(prototypes==0); // Neither an empty field nor its copy needs a value.
    escaped=escaped.copy();assert(prototypes==0);
  }
  assert(runtime.depth==0);
  // The lazy initializer survives the originating Frame without owning it.
  auto resized=escaped.asArray()->resized({{0,1}},false,100);
  assert(prototypes==1&&resized->values.size()==2);
  assert(typeName(Value::array(resized))=="rEcOrDs.ItEm()");
  assert(typeName(resized->values[0])=="Item");
  auto recordCopy=resized->values[0].copy();assert(typeName(recordCopy)=="Item");
  raises(13,[&]{(void)coerce(recordCopy,"other.item");});
  auto preserved=resized->resized({{0,2}},true,100);
  assert(typeName(Value::array(preserved))=="rEcOrDs.ItEm()");
  const auto bytes=encodeVariable(Value::array(resized),{"records.item",0,true},"binary");
  auto decoded=decodeVariable(bytes,{"records.item",0,true},Value::array(resized),"binary",100).first;
  assert(typeName(decoded)=="rEcOrDs.ItEm()"&&typeName(decoded.asArray()->values[0])=="Item");
  Module owner;owner.name="Owner";owner.kind="class";
  owner.initialize=[](Frame&frame){frame.global("Items","records.item",{},1,0,false,false,false,"Records.Item");};
  runtime.modules.emplace("owner",std::move(owner));
  auto object=runtime.instance("Owner",true);std::weak_ptr<Instance> weak=object;
  auto detached=object->fields.at("items")->get();object.reset();
  assert(weak.expired());drainNativeFinalizers(runtime);
  assert(typeName(Value::array(detached.asArray()->resized({{0,0}},false,100)))=="Records.Item()");
  runtime.stop();
  raises(5,[&]{(void)detached.asArray()->resized({{0,0}},false,100);});
  Value expired;
  {
    Runtime temporary(makeNativeHost());Module module;module.name="Temporary";
    temporary.modules.emplace("temporary",std::move(module));
    Frame frame(temporary,temporary.instance("Temporary"));
    expired=frame.makeArray("long",{},true);
  }
  assert(typeName(expired)=="Long()");
  raises(5,[&]{(void)expired.asArray()->resized({{0,0}},false,100);});
  Runtime stopped(makeNativeHost());assert(!stopped.lifetime);stopped.stop();
  raises(5,[&]{(void)nativeLifetime(stopped);});assert(!stopped.lifetime);
  std::cout<<"NATIVE_AOT_RECORD_IDENTITY_DEFAULTS_OK\n";
}
