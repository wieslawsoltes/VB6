// VB6 native runtime ABI. MIT. No COM, JavaScript engine, or browser dependency.
#pragma once
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace vb6 {
using Text = std::u16string;
struct Runtime; struct Frame; struct Object; struct Array; struct Record; struct Cell;
struct Module; struct Procedure; struct Instance; struct NativeHost; struct NativeLifetime;
struct ArrayOwners; struct ArrayBorrow; class NativeResources;
using ObjectPtr = std::shared_ptr<Object>;
using CellPtr = std::shared_ptr<Cell>;
struct Error : std::runtime_error {
  int32_t number; std::string source; int line=0; Text description;
  explicit Error(int32_t number, const std::string& message="", std::string source="", int line=0);
};
struct EndExecution { int code=0; };
[[noreturn]] void fail(int32_t number, const std::string& message="");
std::string lower(std::string value);
Text fromUTF8(const std::string& value);
std::string toUTF8(const Text& value);
Text errorText(int32_t number);
int64_t bankers(long double value);

// Decimal is the exact VB Variant/Decimal 96-bit coefficient and scale 0..28.
struct Decimal {
  unsigned __int128 coefficient=0; uint8_t scale=0; bool negative=false;
  static Decimal parse(const Text& text);
  static Decimal fromNumber(long double number);
  static Decimal add(Decimal a, Decimal b, bool subtract=false);
  static Decimal multiply(Decimal a, Decimal b);
  static Decimal divide(Decimal a, Decimal b);
  int compare(const Decimal& other) const;
  long double number() const;
  Text string() const;
};
enum class Type : uint16_t { Empty=0, Null=1, Integer=2, Long=3, Single=4, Double=5,
  Currency=6, Date=7, String=8, Object=9, Error=10, Boolean=11, Variant=12,
  Decimal=14, Byte=17, Missing=256, Array=8192, Record=16384 };
struct Value {
  Type type=Type::Empty; bool variant=false;
  using Payload=std::variant<std::monostate,int64_t,double,Text,ObjectPtr,std::shared_ptr<Array>,std::shared_ptr<Record>,Decimal>;
  Payload payload;
  // Weak aggregate ancestry is execution metadata, never owned/copied storage.
  std::shared_ptr<const ArrayOwners> arrayOwners{};
  Value()=default;
  static Value integer(int64_t value, Type type=Type::Long, bool variant=false);
  static Value real(double value, Type type=Type::Double, bool variant=false);
  static Value string(Text value, bool variant=false);
  static Value currency(const Text& value);
  static Value decimal(Decimal value);
  static Value object(ObjectPtr value);
  static Value array(std::shared_ptr<Array> value);
  static Value record(std::shared_ptr<Record> value);
  static Value null(); static Value missing(); static Value boolean(bool value);
  Value copy() const;
  int64_t integral() const;
  long double number() const;
  double floating() const { return static_cast<double>(number()); }
  Text string() const;
  bool truth() const;
  bool isNumeric() const;
  ObjectPtr asObject() const;
  std::shared_ptr<Array> asArray() const;
  std::shared_ptr<Record> asRecord() const;
};
std::string typeName(const Value& value);
Type typeCode(const std::string& name);
Value coerce(Value value, const std::string& type, size_t fixedLength=0);
Value unary(const std::string& op, Value value);
Value binary(const std::string& op, Value left, Value right, bool textCompare=false);
bool like(const Text& value, const Text& pattern, bool textCompare=false);
Text printValue(const Value& value);
struct Ref {
  std::function<Value()> read; std::function<void(Value,bool)> write;
  std::string type="variant"; bool array=false, direct=false; size_t fixedLength=0;
  Value get() const; void set(Value value, bool objectSet=false) const;
  explicit operator bool() const { return static_cast<bool>(read); }
};
struct Arg {
  Value value; Ref reference; std::string name; bool nativeByRef=false;
  Arg() : value(Value::missing()) {}
  explicit Arg(Value value, std::string name="") : value(std::move(value)),name(std::move(name)) {}
  explicit Arg(Ref reference, std::string name="", bool directOnly=false) : value(reference.get()),reference(std::move(reference)),name(std::move(name)) { if(directOnly&&!this->reference.direct)this->reference={}; }
  void set(Value value) const { if(reference) reference.set(std::move(value)); }
};
using Args=std::vector<Arg>;
using Bounds=std::vector<std::pair<int32_t,int32_t>>;
struct Cell {
  Value value; std::string type="variant"; size_t fixedLength=0; bool constant=false,arrayStorage=false;
  std::function<Value()> lazy;
  std::function<void(Value)> changed;
  Cell(Value value={},std::string type="variant",size_t fixedLength=0,bool constant=false,bool arrayStorage=false);
  Value get(); void set(Value value,bool objectSet=false);
};
Ref cellRef(CellPtr cell);
struct Array : std::enable_shared_from_this<Array> {
  std::string elementType; Bounds bounds; bool dynamic=true, allocated=false; size_t fixedLength=0;
  size_t borrowedElements=0;
  std::vector<Value> values; std::function<Value()> initializer;
  Array(std::string type, Bounds bounds, bool dynamic, size_t maxElements, size_t fixedLength=0,std::function<Value()> initializer={});
  size_t offset(const std::vector<Value>& indices) const;
  Ref at(const std::vector<Value>& indices);
  std::shared_ptr<Array> resized(Bounds bounds,bool preserve,size_t maxElements) const;
  std::shared_ptr<Array> copy() const;
  void erase();
};
struct Record {
  std::string name; std::map<std::string,CellPtr> fields; std::vector<std::string> order;
  std::shared_ptr<Record> copy() const;
  Ref member(const std::string& name) const;
};
struct Object : std::enable_shared_from_this<Object> {
  virtual ~Object()=default;
  virtual std::string className() const { return "Object"; }
  virtual Value get(Runtime&,const std::string&);
  virtual void set(Runtime&,const std::string&,Value,bool=false);
  virtual Value invoke(Runtime&,const std::string&,Args);
  virtual Ref reference(Runtime&,const std::string&,Args={});
  virtual std::vector<Value> enumerate(Runtime&);
  virtual bool supports(const std::string& name) const;
  virtual ObjectPtr queryInterface(const std::string& name);
  virtual const Object* identity() const noexcept { return this; }
};
// The shared frontend binds interface member keys and parameter names. This is
// a source-level dispatch contract, not a COM vtable or native type-library ABI.
struct InterfaceMember { std::string procedure; std::vector<std::string> parameterNames; };
struct InterfaceContract { std::string defaultMember; std::map<std::string,InterfaceMember> members; };
bool sameObject(const ObjectPtr&,const ObjectPtr&) noexcept;
struct Parameter {
  std::string name,type; bool byRef=true,optional=false,paramArray=false,array=false;
  std::function<Value(Frame&)> initial;
};
// These contracts describe Pascal value objects only. A field-compatible VB
// record is never an ancestor, and no general record downcast is introduced.
struct PascalObjectField {
  std::string name,type; size_t fixedLength=0; bool array=false; Bounds bounds;
  bool operator==(const PascalObjectField& other) const {
    return name==other.name&&type==other.type&&fixedLength==other.fixedLength&&array==other.array&&bounds==other.bounds;
  }
};
struct PascalObjectType {
  std::string identity,parent; int32_t typeId=0; bool hasVmt=false;
  std::vector<PascalObjectField> fields; std::set<std::string> virtualMethods;
};
struct PascalDispatchBranch {
  int32_t typeId=0; std::string runtimeType,targetModule,targetProcedure,viewType;
};
struct PascalDispatch {
  std::string parameter,receiverType,vmtField; std::vector<PascalDispatchBranch> branches;
};
struct Procedure {
  std::string name,returnType="variant",scope="public",accessor;
  bool isFunction=false,isStatic=false,external=false,returnArray=false;
  std::vector<Parameter> parameters;
  std::function<Value(Frame&)> code;
  std::optional<PascalDispatch> pascalDispatch;
};
struct NativeCallback final : Object {
  std::weak_ptr<Instance> owner; std::string procedure;
  NativeCallback(std::shared_ptr<Instance> value,std::string name):owner(std::move(value)),procedure(std::move(name)) {}
  std::string className() const override { return "NativeCallback"; }
  Value invoke(Runtime&,const std::string&,Args) override;
};
struct Property { std::string name; Value value; };
struct ControlSpec {
  std::string name,type,parent; std::vector<Property> properties;
  int index=-1;
};
struct Module {
  std::string name,kind="module",defaultMember,language="vb6";
  bool textCompare=false,optionExplicit=false; int optionBase=0;
  std::vector<std::string> interfaces;
  std::map<std::string,InterfaceContract> interfaceBindings;
  std::map<std::string,std::string> defaultTypes;
  std::set<std::string> publicFields;
  std::map<std::string,Procedure> procedures;
  std::function<void(Frame&)> initialize;
  std::map<std::string,std::function<Value(Frame&)>> records;
  std::optional<ControlSpec> form;
  std::vector<ControlSpec> controls,menus;
};
struct Instance : Object {
  Runtime* runtime; Module* module; std::map<std::string,CellPtr> fields;
  std::map<std::string,std::map<std::string,CellPtr>> statics;
  std::map<std::string,ObjectPtr> controls;
  bool initialized=false,initializing=false,loaded=false,loading=false,unloading=false,formInitialized=false;
  explicit Instance(Runtime& runtime,Module& module):runtime(&runtime),module(&module) {}
  std::string className() const override { return module->name; }
  Value get(Runtime&,const std::string&) override;
  void set(Runtime&,const std::string&,Value,bool=false) override;
  Value invoke(Runtime&,const std::string&,Args) override;
  Ref reference(Runtime&,const std::string&,Args={}) override;
  bool supports(const std::string&) const override;
  bool hasControl(const std::string&) const;
  ObjectPtr queryInterface(const std::string&) override;
  std::map<std::string,std::weak_ptr<Object>> interfaceViews;
};
struct ErrorState { int32_t number=0,lastDllError=0,helpContext=0; Text description,source,helpFile; int32_t erl=0; void clear(); };
struct ForState { Ref variable; Value end,step; };
struct EachState {
  Ref variable; std::vector<Value> values; std::shared_ptr<Array> array;
  std::shared_ptr<ArrayBorrow> borrow; size_t position=0; int start=0,end=0;
};
struct WithState {
  Value value; Ref reference; std::shared_ptr<ArrayBorrow> borrow; int start=0,end=0;
};
struct Frame {
  Runtime& runtime; std::shared_ptr<Instance> self; Module& module; Procedure* procedure;
  std::map<std::string,Ref> locals; std::vector<Arg> arguments;
  std::map<std::string,Value> temps; std::map<std::string,WithState> withScopes;
  std::map<std::string,ForState> fors; std::map<std::string,EachState> each;
  std::vector<int> gosubs;
  int pc=0,site=0,next=0,line=0,labelLine=0,errorSite=0,errorNext=0,errorHandler=-1;
  bool handlerActive=false,errorResumeNext=false;
  Frame(Runtime&,std::shared_ptr<Instance>,Procedure* =nullptr,Args={});
  ~Frame(); Frame(const Frame&)=delete; Frame& operator=(const Frame&)=delete;
  Value get(const std::string& name); Ref ref(const std::string& name);
  Value call(const std::string& name,Args args={});
  Value create(const std::string& type);
  Value callback(const std::string& module,const std::string& procedure);
  void declare(const std::string& name,const std::string& type,Bounds bounds={},int arrayKind=0,size_t fixedLength=0,bool constant=false,bool isStatic=false,bool autoNew=false);
  void initial(const std::string& name,Value value);
  void global(const std::string& name,const std::string& type,Bounds bounds={},int arrayKind=0,size_t fixedLength=0,bool constant=false,bool autoNew=false,bool withEvents=false);
  Ref propertyRef(const std::string&,Args);
  Value result(); Value with(const std::string& id="") const;
  void closeWith(const std::string& id); void unwindWith(size_t count);
  void pushWith(const std::string& id,Value value,int end,Ref reference={});
  void reconcileScopes(int instruction); void clearScopes();
  bool forStart(const std::string& id,Ref variable,Value start,Value end,Value step);
  bool forNext(const std::string& id);
  bool eachStart(const std::string& id,Ref variable,Value iterable,int end); bool eachNext(const std::string& id);
  void closeEach(const std::string& id);
  void redim(Ref reference,Bounds bounds,bool preserve,const std::string& explicitType="");
  void mark(int site,int next,int line);
  bool handle(const Error&); void onError(const std::string& mode,int target);
  void resume(const std::string& mode,int target=-1);
};
struct NativeHost {
  virtual ~NativeHost()=default;
  virtual void attach(Runtime&) {}
  virtual Value createObject(Runtime&,const std::string&);
  virtual Value appProperty(Runtime&,const std::string&);
  virtual void createForm(const std::shared_ptr<Instance>&);
  virtual Value formGet(const std::shared_ptr<Instance>&,const std::string&);
  virtual void formSet(const std::shared_ptr<Instance>&,const std::string&,Value);
  virtual Value formCall(const std::shared_ptr<Instance>&,const std::string&,Args);
  virtual Value api(Runtime&,const std::string&,Args);
  virtual Value builtin(Frame&,const std::string&,Args);
  virtual void graphics(Frame&,Value,const std::string&,std::vector<Value>,Value,bool);
  virtual void log(const Text&,bool newline);
  virtual int run(Runtime&); virtual void pump(); virtual void shutdown();
  virtual bool hasOpenForms() const noexcept { return false; }
};
struct FileState;
struct Subscription { std::weak_ptr<Object> source; std::weak_ptr<Instance> sink; std::string field; };
struct Runtime {
  std::map<std::string,Module> modules;
  std::map<std::string,PascalObjectType> pascalObjects;
  std::map<std::string,std::shared_ptr<Instance>> instances;
  std::map<std::string,Value> constants;
  std::map<std::string,std::function<Value(Frame&,Args)>> builtins;
  std::unique_ptr<NativeHost> host;
  std::shared_ptr<NativeLifetime> lifetime;
  std::shared_ptr<NativeResources> resources;
  std::map<int,std::shared_ptr<FileState>> files;
  std::map<std::string,std::map<std::string,Text>> settings;
  std::vector<std::string> commandLine;
  std::filesystem::path executablePath;
  double lastRandom=0.5;
  std::vector<Subscription> subscriptions;
  ErrorState error;
  size_t maxArrayElements=16777216,maxCallDepth=512,depth=0;
  std::string name="Application",startup;
  uint32_t randomSeed=0x1234abcd; bool ending=false,finished=false,finishing=false;
  explicit Runtime(std::unique_ptr<NativeHost> host);
  ~Runtime(); Runtime(const Runtime&)=delete; Runtime& operator=(const Runtime&)=delete;
  std::shared_ptr<Instance> instance(const std::string& name,bool fresh=false);
  Value create(const std::string& name);
  Value defaultValue(const std::string& type,Frame* frame=nullptr);
  bool pascalObjectReferenceCompatible(const std::string& source,const std::string& target) const;
  Value invoke(const std::shared_ptr<Instance>&,const std::string& name,Args={},bool internal=false);
  Value dispatch(const std::shared_ptr<Instance>&,const std::string&,Args={});
  void load(const std::shared_ptr<Instance>&); void unload(const std::shared_ptr<Instance>&,int16_t mode=1);
  void bindEvents(std::shared_ptr<Instance>,const std::string&,Value);
  void raiseEvent(const std::shared_ptr<Instance>&,const std::string&,Args);
  // Normal completion executes finalizers while module state/host/files are live.
  // Returns false if a finalizer opens a window and the event loop must resume.
  bool finish();
  void stop() noexcept;
  Ref defaultFormRef(const std::string&);
  void run();
};
Value scalar(Runtime&,Value);
Value createLibraryObject(Runtime&,const std::string&);
void assign(Runtime&,Ref,Value,bool objectSet=false);
Value getMember(Runtime&,Value,const std::string&);
Ref memberRef(Runtime&,Value,const std::string&);
Ref objectReference(Runtime&,Value,const std::string&,Args);
Ref indexedRef(Runtime&,Value,std::vector<Value>);
Value callMember(Runtime&,Value,const std::string&,Args);
Value callValue(Runtime&,Value,Args);
void installBuiltins(Runtime&);
void installFileBuiltins(Runtime&);
void installFinancialBuiltins(Runtime&);
void fileOpen(Frame&,Value,const std::string&,Value,Value,const std::string&,const std::string&);
void fileClose(Frame&,std::vector<Value>);
void filePrint(Frame&,Value,std::vector<Value>,bool write,bool newline,const std::vector<std::string>& separators={});
void fileInput(Frame&,Value,std::vector<Ref>,bool line);
void fileGetPut(Frame&,Value,Value,Ref,bool put);
void fileSeek(Frame&,Value,Value);
void fileLock(Frame&,Value,Value,Value,bool);
void fileMoveCopy(Value,Value,bool);
std::unique_ptr<NativeHost> makeNativeHost();
} // namespace vb6
