#include "runtime.hpp"
#include <iostream>
namespace vb6::aot {
namespace {
Value literal(const Json& j){
  auto type=j.at("type").str();bool variant=j.at("variant").boolean();
  if(type=="empty")return {};if(type=="null")return Value::null();if(type=="missing")return Value::missing();if(type=="nothing")return Value::object(nullptr);
  if(type=="string")return Value::string(j.at("value").text(),variant);
  if(type=="array"){std::vector<Value>values;for(const auto& item:j.at("value").list())values.push_back(literal(item));return arrayValue(values);}
  if(type=="currency")return Value::currency(j.at("value").text());
  if(type=="decimal")return Value::decimal(Decimal::parse(j.at("value").text()));
  auto code=typeCode(type);if(code==Type::Integer||code==Type::Long||code==Type::Byte||code==Type::Boolean||code==Type::Error)return Value::integer(std::stoll(j.at("value").str()),code,variant);
  std::istringstream stream(j.at("value").str());stream.imbue(std::locale::classic());double n=0;stream>>n;
  if(stream.fail()||!stream.eof()||!std::isfinite(n))throw std::runtime_error("Invalid AOT scalar literal");
  return Value::real(n,code,variant);
}
ControlSpec control(const Json& j,const Program&p){
  ControlSpec result;result.name=j.at("name").str();result.type=j.at("type").str();result.parent=j.at("parent").str();result.index=j.at("index").integer();
  for(const auto& property:j.at("properties").list())result.properties.push_back({property.at(size_t(0)).str(),p.literals.at(size_t(property.at(size_t(1)).integer()))});return result;
}
[[noreturn]] void invalidPascal(){throw std::runtime_error("Invalid AOT Pascal object metadata");}
PascalObjectType pascalObject(const Json& j,const std::string& name,const Module& module){
  PascalObjectType out;out.identity=lower(j.at("identity").str());out.parent=lower(j.at("parent").str());out.typeId=j.at("typeId").integer();out.hasVmt=j.at("hasVmt").boolean();
  if(module.language!="pascal"||out.identity!=lower(name)||out.identity!=lower(module.name)+'.'+lower(j.at("name").str())||out.typeId<1)invalidPascal();
  std::set<std::string> names;
  for(const auto& field:j.at("fields").list()){
    PascalObjectField item;item.name=lower(field.at("name").str());item.type=lower(field.at("type").str());const auto length=field.at("fixedLength").integer();
    if(item.name.empty()||item.type.empty()||length<0||!names.insert(item.name).second)invalidPascal();item.fixedLength=size_t(length);
    const auto& bounds=field.at("bounds");item.array=!std::holds_alternative<std::monostate>(bounds.value);
    if(item.array){if(bounds.list().empty()||bounds.list().size()>60)invalidPascal();for(const auto& pair:bounds.list()){
      if(pair.list().size()!=2)invalidPascal();auto low=pair.at(size_t(0)).integer(),high=pair.at(size_t(1)).integer();if(low>high)invalidPascal();item.bounds.emplace_back(low,high);
    }}
    out.fields.push_back(std::move(item));
  }
  if(out.fields.empty()||out.fields[0].name!="__pascaltypeid"||out.fields[0].type!="long"||out.fields[0].array||out.fields[0].fixedLength)invalidPascal();
  for(const auto& method:j.at("virtualMethods").list())if(!out.virtualMethods.insert(lower(method.str())).second)invalidPascal();
  return out;
}
PascalDispatch pascalDispatch(const Json& j){
  PascalDispatch out;const auto& receiver=j.at("receiver");out.parameter=lower(receiver.at("parameter").str());out.receiverType=lower(receiver.at("identity").str());out.vmtField=lower(receiver.at("vmtField").str());
  if(out.parameter.empty()||out.vmtField!="__pascaltypeid")invalidPascal();
  std::set<int32_t> tags;
  for(const auto& branch:j.at("branches").list()){
    PascalDispatchBranch item;item.typeId=branch.at("typeId").integer();item.runtimeType=lower(branch.at("runtimeType").str());item.targetModule=lower(branch.at("targetModule").str());item.targetProcedure=lower(branch.at("targetProcedure").str());item.viewType=lower(branch.at("viewType").str());
    if(item.typeId<1||!tags.insert(item.typeId).second)invalidPascal();out.branches.push_back(std::move(item));
  }
  if(out.branches.empty())invalidPascal();return out;
}
bool receiverParameter(const Procedure& procedure,const std::string& identity){
  return !procedure.external&&!procedure.parameters.empty()&&procedure.parameters[0].byRef&&!procedure.parameters[0].array&&lower(procedure.parameters[0].type)==identity;
}
void validatePascalMetadata(const Runtime& rt){
  std::set<int32_t> tags;
  for(const auto& [identity,object]:rt.pascalObjects){
    if(!tags.insert(object.typeId).second)invalidPascal();
    std::set<std::string> ancestors;const PascalObjectType* current=&object;
    while(current){
      if(ancestors.size()>=128||!ancestors.insert(current->identity).second)invalidPascal();
      if(current->parent.empty())break;
      const auto parent=rt.pascalObjects.find(current->parent);
      if(parent==rt.pascalObjects.end()||!rt.pascalObjectReferenceCompatible(current->identity,parent->first)||(parent->second.hasVmt&&!current->hasVmt))invalidPascal();
      current=&parent->second;
    }
    const auto owner=identity.substr(0,identity.find('.'));const auto module=rt.modules.find(owner);
    if(module==rt.modules.end()||module->second.language!="pascal"||!module->second.records.count(identity))invalidPascal();
    for(const auto& method:object.virtualMethods){
      if(!object.hasVmt||method.rfind(owner+".__pascalmethod_",0)!=0)invalidPascal();
      const auto procedure=module->second.procedures.find(method.substr(owner.size()+1));
      if(procedure==module->second.procedures.end()||!receiverParameter(procedure->second,identity))invalidPascal();
    }
  }
  for(const auto& [moduleName,module]:rt.modules)for(const auto& [name,procedure]:module.procedures){
    if(!procedure.pascalDispatch)continue;const auto& contract=*procedure.pascalDispatch;
    const auto receiver=rt.pascalObjects.find(contract.receiverType);
    if(module.language!="pascal"||name.rfind("__pascaldispatch_",0)!=0||lower(procedure.name)!=name||receiver==rt.pascalObjects.end()||!receiver->second.hasVmt||!receiverParameter(procedure,contract.receiverType)||lower(procedure.parameters[0].name)!=contract.parameter)invalidPascal();
    for(const auto& branch:contract.branches){
      const auto runtime=rt.pascalObjects.find(branch.runtimeType),view=rt.pascalObjects.find(branch.viewType);const auto target=rt.modules.find(branch.targetModule);
      if(runtime==rt.pascalObjects.end()||view==rt.pascalObjects.end()||target==rt.modules.end()||target->second.language!="pascal"||branch.targetProcedure.rfind("__pascalmethod_",0)!=0||!runtime->second.hasVmt||runtime->second.typeId!=branch.typeId||!view->second.virtualMethods.count(branch.targetModule+'.'+branch.targetProcedure)||!rt.pascalObjectReferenceCompatible(branch.runtimeType,contract.receiverType)||!rt.pascalObjectReferenceCompatible(branch.runtimeType,branch.viewType))invalidPascal();
      const auto implementation=target->second.procedures.find(branch.targetProcedure);
      if(implementation==target->second.procedures.end()||!receiverParameter(implementation->second,branch.viewType))invalidPascal();
    }
  }
}
}
Value execute(Frame&f,std::shared_ptr<Program>p,Entry entry){
  if(!entry)throw std::runtime_error("Missing native AOT procedure entry");
  Scope scope(f,std::move(p));entry(&scope);
  // Every helper catches exceptions before returning across generated frames.
  // Propagation resumes here, where the system C++ unwinder has ordinary metadata.
  scope.items.clear();if(scope.error)std::rethrow_exception(scope.error);return std::move(scope.result);
}
void initialize(Runtime&rt,const Json&root,const std::vector<Entry>&entries){
  if(root.at("abi").integer()!=AbiVersion)throw std::runtime_error("AOT runtime ABI mismatch");
  auto p=std::make_shared<Program>();p->entries=entries;
  for(const auto&name:root.at("names").list())p->names.push_back(name.str());
  for(const auto&item:root.at("literals").list())p->literals.push_back(literal(item));
  rt.name=root.at("name").str();rt.startup=root.at("startup").str();
  auto maxArray=root.at("maxArrayElements").integer(),maxDepth=root.at("maxCallDepth").integer();
  if(maxArray<1||maxArray>67108864||maxDepth<1||maxDepth>4096)throw std::runtime_error("Invalid AOT runtime limits");
  rt.maxArrayElements=size_t(maxArray);rt.maxCallDepth=size_t(maxDepth);
  for(const auto&j:root.at("modules").list()){
    Module m;m.name=j.at("name").str();m.kind=j.at("kind").str();m.defaultMember=j.at("defaultMember").str();m.optionExplicit=j.at("optionExplicit").boolean();m.optionBase=j.at("optionBase").integer();m.textCompare=j.at("textCompare").boolean();if(j.has("language"))m.language=lower(j.at("language").str());
    for(const auto&[key,value]:j.at("defaultTypes").dict())m.defaultTypes[key]=value.str();
    for(const auto&name:j.at("interfaces").list())m.interfaces.push_back(name.str());
    for(const auto&name:j.at("publicFields").list())m.publicFields.insert(name.str());
    for(const auto&[name,contract]:j.at("interfaceBindings").dict()){
      InterfaceContract result;result.defaultMember=contract.at("defaultMember").str();
      for(const auto&[key,member]:contract.at("members").dict()){
        InterfaceMember item;item.procedure=member.at("procedure").str();for(const auto&parameter:member.at("parameters").list())item.parameterNames.push_back(parameter.str());result.members[key]=std::move(item);
      }m.interfaceBindings[name]=std::move(result);
    }
    auto init=p->entries.at(size_t(j.at("initialize").integer()));m.initialize=[p,init](Frame&f){(void)execute(f,p,init);};
    for(const auto&record:j.at("records").list()){
      const auto name=lower(record.at("name").str());auto entry=p->entries.at(size_t(record.at("entry").integer()));
      if(!m.records.emplace(name,[p,entry](Frame&f){return execute(f,p,entry);}).second)throw std::runtime_error("Duplicate AOT record metadata");
      if(record.has("pascalObject")){auto object=pascalObject(record.at("pascalObject"),name,m);if(!rt.pascalObjects.emplace(name,std::move(object)).second)invalidPascal();}
    }
    for(const auto&proc:j.at("procedures").list()){
      Procedure out;out.name=proc.at("name").str();out.scope=proc.at("scope").str();out.returnType=proc.at("returnType").str();out.returnDisplayType=proc.has("returnDisplayType")?proc.at("returnDisplayType").str():out.returnType;out.returnArray=proc.at("returnArray").boolean();out.accessor=proc.at("accessor").str();out.isFunction=proc.at("isFunction").boolean();out.isStatic=proc.at("isStatic").boolean();out.external=proc.at("external").boolean();
      auto entry=p->entries.at(size_t(proc.at("entry").integer()));out.code=[p,entry](Frame&f){return execute(f,p,entry);};
      for(const auto&parameter:proc.at("parameters").list()){
        Parameter item;item.name=parameter.at("name").str();item.type=parameter.at("type").str();item.byRef=parameter.at("byRef").boolean();item.optional=parameter.at("optional").boolean();item.paramArray=parameter.at("paramArray").boolean();item.array=parameter.at("array").boolean();
        if(parameter.has("initial")){auto value=p->literals.at(size_t(parameter.at("initial").integer()));item.initial=[value](Frame&){return value;};}
        out.parameters.push_back(std::move(item));
      }
      if(proc.has("pascalDispatch"))out.pascalDispatch=pascalDispatch(proc.at("pascalDispatch"));
      if(!m.procedures.emplace(proc.at("key").str(),std::move(out)).second)throw std::runtime_error("Duplicate AOT procedure metadata");
    }
    if(j.has("form")){m.form=control(j.at("form"),*p);for(const auto&c:j.at("controls").list())m.controls.push_back(control(c,*p));for(const auto&c:j.at("menus").list())m.menus.push_back(control(c,*p));}
    if(!rt.modules.emplace(lower(m.name),std::move(m)).second)throw std::runtime_error("Duplicate AOT module metadata");
  }
  validatePascalMetadata(rt);
}
int run(const std::string&metadata,const std::vector<Entry>&entries,int argc,char**argv){
  try {
    Runtime rt(makeNativeHost());if(argc>0)rt.executablePath=std::filesystem::absolute(argv[0]);for(int i=1;i<argc;++i)rt.commandLine.emplace_back(argv[i]);
    initialize(rt,JsonReader(metadata).parse(),entries);rt.run();return 0;
  }catch(const EndExecution&e){return e.code;}
  catch(const Error&e){std::cerr<<"VB6 error "<<e.number<<": "<<e.what()<<"\n";return 1;}
  catch(const std::exception&e){std::cerr<<"Native AOT failure: "<<e.what()<<"\n";return 2;}
}
}
