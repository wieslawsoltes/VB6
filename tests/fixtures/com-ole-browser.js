/** The same public API contracts run against ESM source and the generated runtime. */
export async function validateComOleBrowser(api) {
  const checks=[];
  const equal=(a,b,name)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(name+': '+JSON.stringify(a)+' != '+JSON.stringify(b));checks.push(name);};
  const C=api.ComOle;
  const clsid='b082ec77-6bdd-497f-a62b-319e52cd80d8';
  const classes=new C.ComClassRegistry(),rot=new C.RunningObjectTable();
  let active;
  const factory=new C.ComClassFactory(()=>{let object;object=new C.DispatchObject([
    {name:'Echo',dispid:1,params:[{name:'value'}],method:([v])=>v},
    {name:'Bump',dispid:2,params:[{name:'value',byRef:true}],method:([v])=>{v.value=api.tagScalar(Number(v.value)+1,'integer');}},
    {name:'Self',dispid:3,params:[],get:()=>object.QueryInterface(C.IID.IDispatch)},
    {name:'Keep',dispid:4,params:[{name:'value',byRef:true}],method:()=>{}}
  ]);return object;});
  classes.RegisterClass(clsid,factory,{progIds:['Test.Component']});factory.Release();
  const moniker=new C.DisplayNameMoniker('active:test');
  try {
    active=classes.CreateInstance('Test.Component',C.IID.IDispatch);rot.Register(1,active,moniker);active.Release();
    const registry=api.createComAutomationRegistry({classes,progIds:['Test.Component'],runningObjects:rot,active:[{className:'Test.Component',moniker:'active:test'}],monikers:[{name:'Doc:One',moniker:'active:test'}]});
    const program=api.compileProject({name:'BrowserCOM',startup:'Sub Main',modules:[{name:'M',kind:'module',code:`Option Explicit
Sub Main()
Dim a As Object, b As Object, n As Integer
Set a = GetObject(, "Test.Component")
Set b = GetObject("Doc:One")
Debug.Print a Is b
n = 4
a.Bump n
Debug.Print n, VarType(a.Echo(CByte(255)))
a.Keep b
Debug.Print a Is b
Set b = a.Echo(b)
Debug.Print a Is b
Set b = a.Self
Debug.Print a Is b
Set b = GetObject("", "Test.Component")
Debug.Print a Is b
On Error Resume Next
Set b = GetObject("file:ungranted")
Debug.Print Err.Number
End Sub`}]});
    equal(program.diagnostics,[],'compiled COM program');
    const output=[],vm=new api.VirtualMachine(program,{automation:registry,print:s=>output.push(s)});
    try{await vm.start();equal(output,['True','5 17','True','True','True','False','429'],'GetObject, typed ByRef, identity and ungranted binding');}
    finally{vm.stop();await vm.automationClose;}
    equal(active.referenceCount,1,'VM Stop keeps only the explicit ROT reference');
  } finally {moniker.Release();rot.Release();classes.close();}
  equal(active.disposed,true,'ROT cleanup releases active object');
  const data=new C.OleDataObject(),stream=new C.MemoryStream(new Uint8Array([1,2,3])),clipboard=new C.OleClipboard();
  try {
    const medium=new C.StgMedium(4,stream);data.SetData({cfFormat:13,tymed:4},medium,true);
    clipboard.OleSetClipboard(data);clipboard.OleFlushClipboard();stream.Seek(0);stream.Write(new Uint8Array([9]));
    const copy=clipboard.OleGetClipboard();try{const out=copy.GetData({cfFormat:13,tymed:4});try{equal([...out.data.toUint8Array()],[1,2,3],'clipboard flush materializes independent stream bytes');}finally{out.release();}}finally{copy.Release();}
    let calls=0;
    const sink=new C.ComObject([[C.IID.IAdviseSink,{OnDataChange(){calls++;}}]]);
    try{data.DAdvise({cfFormat:13,tymed:4},C.ADVF.PRIMEFIRST|C.ADVF.ONLYONCE,sink);data.SetDelayedData({cfFormat:13,tymed:4},()=>new C.StgMedium(4,stream));equal(calls,1,'one-shot advisory notification');equal(sink.referenceCount,1,'one-shot sink ownership');}finally{sink.Release();}
    const events=[],source=new C.DropSource(),target=new C.DropTarget({enter:()=>{events.push('enter');return 1;},over:()=>{events.push('over');return 1;},leave:()=>events.push('leave'),drop:()=>{events.push('drop');return 1;}}),drag=new C.OleDragSession(data,source,1);
    try{drag.enter(target,1,{x:1,y:2});drag.update(false,1,{x:2,y:3});equal(drag.update(false,0,{x:3,y:4}),{hresult:C.HRESULT.DRAGDROP_S_DROP,effect:1},'drag completion');equal(events,['enter','over','drop'],'ordered drag callbacks');}
    finally{drag.cancel();source.Release();target.Release();}
  } finally {clipboard.close();data.Release();stream.Release();}
  return checks;
}
