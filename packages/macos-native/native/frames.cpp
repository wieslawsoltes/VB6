// Native VB call frames, reference binding and structured error recovery. MIT.
#include "vb6.hpp"
#include "lifetime.hpp"
namespace vb6 {
bool Runtime::pascalObjectReferenceCompatible(const std::string& source,const std::string& target) const {
  auto current=pascalObjects.find(lower(source));const auto destination=lower(target);
  if(current==pascalObjects.end()||!pascalObjects.count(destination))return false;
  std::set<std::string> visited;
  while(current!=pascalObjects.end()&&visited.size()<128){
    const auto& object=current->second;
    if(!visited.insert(object.identity).second)return false;
    if(object.identity==destination)return true;
    const auto parent=pascalObjects.find(object.parent);
    if(parent==pascalObjects.end()||object.fields.size()<parent->second.fields.size()||
      !std::equal(parent->second.fields.begin(),parent->second.fields.end(),object.fields.begin()))return false;
    current=parent;
  }
  return false;
}
static void checkPascalDispatch(Frame& frame){
  if(!frame.procedure->pascalDispatch)return;
  const auto& contract=*frame.procedure->pascalDispatch;
  const auto receiver=frame.locals.find(contract.parameter);
  if(receiver==frame.locals.end())fail(210,"Invalid Pascal virtual receiver");
  const auto value=receiver->second.get();if(value.type!=Type::Record)fail(210,"Invalid Pascal virtual receiver");
  const auto record=value.asRecord();const auto field=record->fields.find(contract.vmtField);
  if(field==record->fields.end()||field->second->arrayStorage||lower(field->second->type)!="long")fail(210,"Invalid Pascal virtual receiver header");
  const auto tag=field->second->get().integral();
  for(const auto& branch:contract.branches)if(branch.typeId==tag){
    // The backing value keeps its most-derived nominal identity through every
    // ancestor var alias. A tag can select only a view present in that storage.
    if(frame.runtime.pascalObjectReferenceCompatible(record->name,branch.runtimeType)&&
      frame.runtime.pascalObjectReferenceCompatible(record->name,branch.viewType))return;
    break;
  }
  fail(210,"Object not initialized or incompatible virtual receiver");
}
Value Frame::makeArray(const std::string&type,Bounds bounds,bool dynamic,size_t fixed,const std::string&displayType){
  // Do not create a record prototype for an unallocated array. Capture only
  // guarded runtime/module metadata, never a stack Frame or owning Instance
  // (which would keep a class's own array fields alive in a reference cycle).
  auto life=nativeLifetime(runtime);auto*owner=&module;
  auto init=[life,owner,type,prototype=std::optional<Value>{}]()mutable{
    if(!prototype){auto&rt=requireNativeRuntime(life);Frame context(rt,std::make_shared<Instance>(rt,*owner),nullptr,{},false);prototype=rt.defaultValue(type,&context);}
    return prototype->copy();
  };
  return Value::array(std::make_shared<Array>(type,std::move(bounds),dynamic,runtime.maxArrayElements,fixed,std::move(init),displayType));
}
static CellPtr makeCell(Frame& frame,const std::string&type,Bounds bounds,int arrayKind,size_t fixed,bool constant,bool autoNew,const std::string&displayType=""){
  auto&rt=frame.runtime;Value initial;
  if(arrayKind)initial=frame.makeArray(type,std::move(bounds),arrayKind==1,fixed,displayType);
  else initial=rt.defaultValue(type,&frame);
  auto cell=std::make_shared<Cell>(initial,type,fixed,constant,arrayKind!=0);
  if(autoNew)cell->lazy=[&rt,type]{return rt.create(type);};
  return cell;
}
Frame::Frame(Runtime&rt,std::shared_ptr<Instance> object,Procedure*proc,Args args,bool count):runtime(rt),self(std::move(object)),module(*self->module),procedure(proc),counted(count){
  if(counted){if(runtime.depth>=runtime.maxCallDepth)fail(28);++runtime.depth;}
  try{
    if(!proc)return;
    std::vector<std::optional<Arg>> bound(proc->parameters.size());Args extras;size_t position=0;bool named=false;
    for(auto&arg:args){
      if(!arg.name.empty()){
        named=true;auto name=lower(arg.name);size_t i=0;for(;i<proc->parameters.size();++i)if(lower(proc->parameters[i].name)==name)break;
        if(i==bound.size()||proc->parameters[i].paramArray)fail(448);if(bound[i])fail(450);bound[i]=arg;
      }else{
        if(named)fail(448,"Positional argument after named argument");
        if(position<bound.size()&&!proc->parameters[position].paramArray){bound[position++]=arg;}
        else if(!proc->parameters.empty()&&proc->parameters.back().paramArray)extras.push_back(arg);else fail(450);
      }
    }
    for(size_t i=0;i<proc->parameters.size();++i){
      auto&p=proc->parameters[i];auto name=lower(p.name);
      if(p.paramArray){
        auto array=std::make_shared<Array>("variant",Bounds{},true,rt.maxArrayElements);array->bounds={{0,static_cast<int32_t>(extras.size())-1}};array->allocated=true;
        for(auto&a:extras)array->values.push_back(coerce(a.value,"variant"));
        auto cell=std::make_shared<Cell>(Value::array(array));locals[name]=cellRef(cell);continue;
      }
      Arg arg=bound[i]?*bound[i]:Arg();
      if(arg.value.type==Type::Missing){if(!p.optional)fail(449);if(p.initial)arg=Arg(p.initial(*this));else if(lower(p.type)!="variant")arg=Arg(rt.defaultValue(p.type,this));}
      if(proc->external){arg.nativeByRef=p.byRef;if(!(arg.value.type==Type::Object&&std::dynamic_pointer_cast<NativeCallback>(std::get<ObjectPtr>(arg.value.payload)))&&lower(p.type)!="any"&&arg.value.type!=Type::Record&&arg.value.type!=Type::Array)arg.value=coerce(arg.value,p.type);arguments.push_back(arg);continue;}
      if(p.array && (arg.value.type!=Type::Array||lower(arg.value.asArray()->elementType)!=lower(p.type)))fail(13,"Matching array argument required");
      if(p.byRef&&arg.reference&&arg.reference.direct){
        auto sourceType=lower(arg.reference.type),target=lower(p.type);
        const bool pascalTarget=!p.array&&runtime.pascalObjects.count(target);
        const bool pascalReference=pascalTarget&&arg.value.type==Type::Record&&sourceType==lower(arg.value.asRecord()->name)&&runtime.pascalObjectReferenceCompatible(sourceType,target);
        if(pascalTarget&&!pascalReference)fail(13,"ByRef Pascal object type mismatch: "+p.name);
        if(!p.array&&target!="variant"&&target!=sourceType&&!pascalReference&&!(arg.value.type==Type::Object&&(!std::get<ObjectPtr>(arg.value.payload)||std::get<ObjectPtr>(arg.value.payload)->supports(target))))fail(13,"ByRef argument type mismatch: "+p.name);
        if(p.array&&lower(arg.value.asArray()->elementType)!=target)fail(13,"ByRef array element type mismatch");
        if(!p.array&&arg.value.type==Type::Object&&target!="variant"&&target!="object"){
          // A ByRef interface formal aliases the caller's cell but reads through
          // the formal contract. Writes retain the caller's storage type check.
          auto original=arg.reference;(void)coerce(original.get(),target);
          locals[name]={[original,target]{return coerce(original.get(),target);},
            [original,target](Value value,bool set){original.set(coerce(std::move(value),target),set);},target,false,true};
        }else if(target=="variant"&&arg.value.type!=Type::Array&&arg.value.type!=Type::Record&&arg.value.type!=Type::Object){auto original=arg.reference;locals[name]={[original]{auto v=original.get();v.variant=true;return v;},original.write,"variant",false,true};}else locals[name]=arg.reference;
      }else{
        Value value=arg.value;
        if(value.type!=Type::Missing&&!p.array)value=coerce((lower(p.type)=="variant"||typeCode(p.type)==Type::Object||typeCode(p.type)==Type::Record)?value:scalar(rt,value),p.type);
        if(p.array){value=value.copy();value.asArray()->dynamic=true;}
        auto cell=std::make_shared<Cell>(value,p.type,0,false,p.array);locals[name]=cellRef(cell);
      }
    }
    checkPascalDispatch(*this);
    // Function result storage is always per invocation, even in a Static
    // procedure. Typed array results start as unallocated dynamic arrays.
    if(proc->isFunction)locals[lower(proc->name)]=cellRef(makeCell(*this,proc->returnType,{},proc->returnArray?1:0,0,false,false,proc->returnDisplayType));
  }catch(...){if(counted)--runtime.depth;throw;}
}
Frame::~Frame(){if(counted)--runtime.depth;}
void Frame::declare(const std::string&raw,const std::string&type,Bounds bounds,int arrayKind,size_t fixed,bool constant,bool isStatic,bool autoNew,const std::string&displayType){
  auto name=lower(raw);if(locals.count(name))return;
  if((isStatic||(procedure&&procedure->isStatic))&&procedure){auto&store=self->statics[lower(procedure->name)+procedure->accessor];if(!store.count(name))store[name]=makeCell(*this,type,bounds,arrayKind,fixed,constant,autoNew,displayType);locals[name]=cellRef(store.at(name));}
  else locals[name]=cellRef(makeCell(*this,type,bounds,arrayKind,fixed,constant,autoNew,displayType));
}
void Frame::global(const std::string&raw,const std::string&type,Bounds bounds,int arrayKind,size_t fixed,bool constant,bool autoNew,bool withEvents,const std::string&displayType){
  auto name=lower(raw);if(self->fields.count(name))return;
  auto cell=makeCell(*this,type,bounds,arrayKind,fixed,constant,autoNew,displayType);self->fields[name]=cell;
  if(withEvents){std::weak_ptr<Instance> weak=self;auto*rt=&runtime;cell->changed=[weak,rt,name](Value v){if(auto instance=weak.lock())rt->bindEvents(instance,name,v);};}
}
void Frame::initial(const std::string&raw,Value value){
  auto name=lower(raw);
  // Constants were bound by the shared frontend and are installed only once.
  if(auto it=self->fields.find(name);it!=self->fields.end()&&!procedure){auto c=it->second;bool immutable=c->constant;c->constant=false;c->set(value,value.type==Type::Object);c->constant=immutable;return;}
  auto ref=locals.at(name);if(ref.direct){auto cell=std::make_shared<Cell>(value,ref.type,0,true);locals[name]=cellRef(cell);}else ref.set(value,value.type==Type::Object);
}
Ref Frame::ref(const std::string&raw){
  auto name=lower(raw);
  if(auto it=locals.find(name);it!=locals.end())return it->second;
  if(auto it=self->fields.find(name);it!=self->fields.end())return cellRef(it->second);
  if(module.procedures.count(name+":get")||module.procedures.count(name+":let")||module.procedures.count(name+":set")){
    auto object=self;auto*rt=&runtime;
    return {[object,rt,name]{return rt->invoke(object,name+":get",{},true);},[object,rt,name](Value v,bool set){rt->invoke(object,name+(set?":set":":let"),{Arg(v)},true);},"variant",false,false};
  }
  std::shared_ptr<Instance> owner;
  for(auto&entry:runtime.modules){auto&m=entry.second;if(m.kind=="module"&&m.publicFields.count(name)){
    if(owner)fail(5,"Ambiguous global: "+raw);owner=runtime.instance(entry.first);
  }}
  if(owner)return cellRef(owner->fields.at(name));
  if(module.kind=="form"){
    if(name=="caption"||name=="left"||name=="top"||name=="width"||name=="height"||name=="visible"||name=="enabled"||name=="backcolor"||name=="forecolor")return self->reference(runtime,name);
  }
  if(auto found=runtime.modules.find(name);found!=runtime.modules.end()&&found->second.kind=="form")return runtime.defaultFormRef(name);
  if(module.optionExplicit)fail(5,"Variable not defined: "+raw);
  std::string type="variant";if(!raw.empty()){auto suffix=raw.back();type=suffix=='$'?"string":suffix=='%'?"integer":suffix=='&'?"long":suffix=='!'?"single":suffix=='#'?"double":suffix=='@'?"currency":module.defaultTypes.count(name.substr(0,1))?module.defaultTypes.at(name.substr(0,1)):"variant";}declare(raw,type);return locals.at(name);
}
Value Frame::get(const std::string&raw){
  auto name=lower(raw);if(name=="me")return Value::object(self);if(name=="erl")return Value::integer(runtime.error.erl);
  if(auto it=locals.find(name);it!=locals.end())return it->second.get();
  if(auto it=self->fields.find(name);it!=self->fields.end())return it->second->get();
  if(auto it=runtime.constants.find(name);it!=runtime.constants.end())return it->second;
  if(module.procedures.count(name+":get"))return runtime.invoke(self,name+":get",{},true);
  if(module.procedures.count(name))return runtime.invoke(self,name,{},true);
  if(module.kind=="form"&&self->hasControl(name)){runtime.load(self);if(auto it=self->controls.find(name);it!=self->controls.end())return Value::object(it->second);}
  if(runtime.modules.count(name))return Value::object(runtime.instance(name));
  for(auto&entry:runtime.modules)if(entry.second.kind=="module"&&entry.second.publicFields.count(name))return ref(name).get();
  if(runtime.builtins.count(name))return call(name);
  if(module.kind=="form"){runtime.load(self);try{return runtime.host->formGet(self,name);}catch(const Error&e){if(e.number!=438)throw;}}
  return ref(raw).get();
}
Value Frame::call(const std::string&raw,Args args){
  auto name=lower(raw);
  if(procedure&&procedure->returnArray&&name==lower(procedure->name)){
    const auto value=locals.at(name).get();
    return args.empty()?value:callValue(runtime,value,std::move(args));
  }
  if(module.procedures.count(name))return runtime.invoke(self,name,std::move(args),true);
  if(module.procedures.count(name+":get"))return runtime.invoke(self,name+":get",std::move(args),true);
  if(auto it=locals.find(name);it!=locals.end())return callValue(runtime,it->second.get(),std::move(args));
  if(auto it=self->fields.find(name);it!=self->fields.end())return callValue(runtime,it->second->get(),std::move(args));
  if(module.kind=="form"&&self->hasControl(name)){runtime.load(self);if(self->controls.count(name))return callValue(runtime,Value::object(self->controls.at(name)),std::move(args));}
  std::shared_ptr<Instance> owner;
  for(auto&entry:runtime.modules){auto&m=entry.second;if(m.kind=="module"&&m.procedures.count(name)&&m.procedures.at(name).scope!="private"){
    if(owner)fail(5,"Ambiguous procedure: "+raw);owner=runtime.instance(entry.first);
  }}
  if(owner)return runtime.invoke(owner,name,std::move(args));
  auto builtin=runtime.builtins.find(name);if(builtin!=runtime.builtins.end())return builtin->second(*this,std::move(args));
  if(module.kind=="form"){runtime.load(self);return runtime.host->formCall(self,name,std::move(args));}
  fail(453,"Unknown procedure: "+raw);
}
Value Frame::create(const std::string&type){return runtime.create(type);}
Value Frame::callback(const std::string&module,const std::string&procedure){auto instance=runtime.instance(module);if(instance->module->kind!="module")fail(5,"AddressOf requires a standard module");auto found=instance->module->procedures.find(lower(procedure));if(found==instance->module->procedures.end()||found->second.external)fail(453,"Invalid callback procedure");return Value::object(std::make_shared<NativeCallback>(instance,lower(procedure)));}
Value NativeCallback::invoke(Runtime&rt,const std::string&,Args args){auto instance=owner.lock();if(!instance)fail(91,"Native callback owner has been released");return rt.invoke(instance,procedure,std::move(args),true);}
Ref Frame::propertyRef(const std::string&raw,Args args){auto name=lower(raw);auto object=self;auto*rt=&runtime;return {[object,rt,name,args]{return rt->invoke(object,name+":get",args,true);},[object,rt,name,args](Value value,bool set){auto all=args;all.emplace_back(value);rt->invoke(object,name+(set?":set":":let"),all,true);},"variant",false,false};}
Value Frame::result(){clearScopes();drainNativeFinalizers(runtime);if(handlerActive)runtime.error.clear();return procedure&&procedure->isFunction?locals.at(lower(procedure->name)).get():Value{};}
bool Frame::forStart(const std::string&id,Ref variable,Value start,Value end,Value step){
  start=scalar(runtime,start);end=scalar(runtime,end);step=scalar(runtime,step);variable.set(start);fors[id]={variable,end,step};return binary(step.number()>=0?"<=":">=",variable.get(),end,module.textCompare).truth();
}
bool Frame::forNext(const std::string&id){auto&state=fors.at(id);state.variable.set(binary("+",state.variable.get(),state.step,module.textCompare));return binary(state.step.number()>=0?"<=":">=",state.variable.get(),state.end,module.textCompare).truth();}
void Frame::redim(Ref ref,Bounds bounds,bool preserve,const std::string&explicitType,const std::string&displayType){
  auto old=ref.get();
  const auto type=explicitType.empty()?(old.type==Type::Array?old.asArray()->elementType:ref.array?ref.type:"variant"):lower(explicitType);
  if(ref.array&&lower(type)!=lower(ref.type))fail(13,"ReDim cannot change declared array element type");
  if(old.type==Type::Array){
    auto array=old.asArray();
    if(lower(type)==lower(array->elementType)){
      // Construct first; invalid bounds/allocation must leave every alias intact.
      // Commit in place so an existing whole-array ByRef alias sees the resize,
      // without a redundant deep copy through Cell::set.
      auto next=array->resized(std::move(bounds),preserve,runtime.maxArrayElements);
      array->bounds.swap(next->bounds);array->values.swap(next->values);array->allocated=next->allocated;
      return;
    }
    if(ref.array||preserve)fail(13,"ReDim cannot change array element type with Preserve");
  }else if(old.type!=Type::Empty||lower(ref.type)!="variant")fail(13,"ReDim requires an array or an Empty Variant");
  ref.set(makeArray(type,std::move(bounds),true,0,displayType));
}
void Frame::mark(int current,int nextInstruction,int sourceLine){site=current;next=nextInstruction;line=sourceLine;reconcileScopes(current);drainNativeFinalizers(runtime);}
bool Frame::handle(const Error& e){
  if(handlerActive||(!errorResumeNext&&errorHandler<0))return false;
  runtime.error.number=e.number;runtime.error.description=e.description;runtime.error.source=fromUTF8(e.source.empty()?module.name:e.source);runtime.error.erl=labelLine;
  errorSite=site;errorNext=next;
  if(errorResumeNext){pc=next;return true;}handlerActive=true;pc=errorHandler;return true;
}
void Frame::onError(const std::string&mode,int target){errorResumeNext=mode=="next";errorHandler=mode=="goto"?target:-1;handlerActive=false;errorSite=-1;}
void Frame::resume(const std::string&mode,int target){if(errorSite<0||!handlerActive)fail(20);pc=mode=="retry"?errorSite:mode=="next"?errorNext:target;handlerActive=false;errorSite=-1;runtime.error.clear();}

} // namespace vb6
