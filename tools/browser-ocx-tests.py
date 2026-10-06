#!/usr/bin/env python3
"""Classic IDE component workflows; no native-binary or licensed-control certification."""
from pathlib import Path
import functools, http.server, json, os, sys, threading, traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reports'/'ocx-browser';OUT.mkdir(parents=True,exist_ok=True)
SETUP=r'''()=>{
 const A=VB6StudioAPI;window.ocxLog=[];window.deferPages=false;
 const factory=(model,options)=>{const c=new A.BrowserControl(model,options),refresh=c.refresh.bind(c);c.refresh=()=>{refresh();c.node.textContent='Gauge: '+c.props.Value;};c.ocxLifecycle={initProperties(){ocxLog.push('init');},readProperties(b){c.Value=b.ReadProperty('Value',0);ocxLog.push('read');},writeProperties(b){b.WriteProperty('Value',c.Value);ocxLog.push('write');},terminate(){ocxLog.push('terminate');}};c.refresh();return c;};
 window.ocxRegistry=new A.ControlAdapterRegistry().register('Acme.Gauge.1',{designer:factory,runtime:factory,lifecycle:true,metadata:{baseName:'Gauge',displayName:'Acme Gauge',properties:[{name:'Value',default:25,description:'Current instrument reading.'},{name:'Mode',default:0,choices:[{value:0,label:'Automatic'},{value:1,label:'Manual'}]},{name:'Serial',default:'ABC',readOnly:true}],events:[{name:'Changing',params:[{name:'Value',type:'Long'},{name:'Cancel',type:'Boolean',byRef:true}]}],defaultEvent:'Changing'},propertyPages:()=>deferPages?new Promise(resolve=>{window.resolvePages=resolve;}):{Value:75,Mode:1}});
 vb6Studio.loadProject(A.newProject('OcxLab'));vb6Studio.installControlAdapters(ocxRegistry);vb6Studio.toolboxMode='extended';vb6Studio.renderToolbox();
}'''
def check(value,message='Assertion failed'):
    if not value:raise AssertionError(str(message))
def model(page):return page.evaluate('vb6Studio.activeModule.form.controls[0]')
def add(page):page.get_by_role('button',name='Acme.Gauge.1',exact=True).dblclick()
def toolbox(page):
    add(page);c=model(page);check(c['name']=='Gauge1',c);check(c['properties']['Value']==25,c)
    page.evaluate('()=>{vb6Studio.componentsDialog();}');check('Acme Gauge' in page.locator('.ide-modal-cover').inner_text());page.get_by_role('button',name='Close',exact=True).last.click()
def inspector(page):
    add(page);page.get_by_label('Mode',exact=True).select_option('1');check(model(page)['properties']['Mode']==1)
    check(page.get_by_label('Serial',exact=True).is_disabled());page.evaluate('vb6Studio.inspector.setReadOnly(true);vb6Studio.inspector.setReadOnly(false)');check(page.get_by_label('Serial',exact=True).is_disabled())
    error=page.evaluate("()=>{try{vb6Studio.setProperty('Serial','tampered');return '';}catch(e){return e.message;}}")
    check('read-only' in error,error);check(model(page)['properties']['Serial']=='ABC')
    page.get_by_label('Value',exact=True).focus();check('Current instrument reading.' in page.locator('.property-description').inner_text())
def pages(page):
    add(page);page.get_by_role('button',name='Property Pages…',exact=True).click();page.wait_for_function('vb6Studio.activeModule.form.controls[0].properties.Value===75')
    check(model(page)['properties']['Mode']==1);page.evaluate('vb6Studio.command("undo")');check(model(page)['properties']['Value']==25)
def stale(page):
    add(page);page.evaluate("()=>{deferPages=true;window.pageResult=vb6Studio.showControlPropertyPages().then(()=>'',e=>e.message);}")
    page.evaluate("vb6Studio.setProperty('Value',50);resolvePages({Value:999})")
    error=page.evaluate('pageResult');check('changed' in error,error);check(model(page)['properties']['Value']==50)
def event_handler(page):
    add(page);page.evaluate("vb6Studio.setProperty('Index',2);vb6Studio.command('defaultEvent')")
    code=page.evaluate('vb6Studio.editor.text');check('Private Sub Gauge1_Changing(Index As Integer, ByVal Value As Long, ByRef Cancel As Boolean)' in code,code)
    page.evaluate("vb6Studio.editor.objects.value='Gauge1';vb6Studio.editor.selectedObject='Gauge1';vb6Studio.editor.updateSelectors(false,true)")
    check('Changing' in page.evaluate('vb6Studio.editor.procedures.textContent'))
def lifecycle(page):
    data=page.evaluate("""()=>{const m=VB6StudioAPI.createControl('Acme.Gauge.1','RuntimeGauge'),c=ocxRegistry.create(m);c.Value=91;m.ocxState=ocxRegistry.save(c);const snapshot=JSON.parse(JSON.stringify(m));c.dispose();const other=ocxRegistry.create(snapshot);const value=other.Value,mode=VB6StudioAPI.ocxControlSite(other).Ambient.UserMode;other.dispose();return {value,mode,log:ocxLog};}""")
    check(data['value']==91,data);check(data['mode']==-1,data);check(data['log']==['init','write','terminate','read','terminate'],data)
def container_keyboard(page):
    page.evaluate("""()=>{
      const A=VB6StudioAPI,root=document.createElement('div');root.id='ocx-keyboard-lab';root.style='position:fixed;top:70px;right:20px;z-index:999999;background:white;padding:15px';document.body.append(root);
      const registry=new A.ControlAdapterRegistry().register('Lab.Focus',{lifecycle:true,runtime:model=>{const node=document.createElement('button');node.id=model.name;node.textContent=model.name;return {__control:true,model,node,props:model.properties,refresh(){node.disabled=this.props.Enabled===0;node.hidden=this.props.Visible===0;},dispose(){node.remove();},ocxLifecycle:{mnemonic:e=>{if(e.key.toLowerCase()==='g'){window.ocxMnemonic=(window.ocxMnemonic||0)+1;return true;}return false;}}};}});
      window.ocxKeyboard=new A.OcxContainer({node:root});window.ocxKeys=[];
      for(let i=0;i<3;i++){const model={id:'key'+i,name:'key'+i,type:'Lab.Focus',properties:{TabIndex:i,TabStop:-1,Width:100,Height:100,Visible:-1,Enabled:-1}},control=registry.create(model,{container:ocxKeyboard});root.append(control.node);ocxKeys.push(control);}
      ocxKeyboard.focusNext();
    }""")
    check(page.evaluate('document.activeElement.id')=='key0');page.keyboard.press('Tab');check(page.evaluate('document.activeElement.id')=='key1')
    page.keyboard.press('Shift+Tab');check(page.evaluate('document.activeElement.id')=='key0')
    page.evaluate('ocxKeys[1].props.Enabled=0;ocxKeys[1].refresh()');page.keyboard.press('Tab');check(page.evaluate('document.activeElement.id')=='key2')
    page.keyboard.press('Alt+g');check(page.evaluate('ocxMnemonic')==1)
    page.evaluate('ocxKeyboard.close()');check(page.evaluate('ocxKeyboard.Count')==0)

def canvas_windowless(page):
    data=page.evaluate("""async()=>{
      const A=VB6StudioAPI,canvas=document.createElement('canvas');canvas.id='ocx-windowless-lab';canvas.style='position:fixed;top:80px;right:30px;z-index:999999;background:white';document.body.append(canvas);
      const container=new A.OcxContainer(),events=[],failures=[],registry=new A.ControlAdapterRegistry().register('Lab.Draw',{lifecycle:true,runtime:model=>({__control:true,model,props:model.properties,node:document.createElement('span'),refresh(){},dispose(){},event(name,args){events.push([name,...args]);},ocxLifecycle:{paint(context){context.fillStyle='#c00000';context.fillRect(0,0,100,100);}}})});
      const control=registry.create({id:'paint',name:'Paint1',type:'Lab.Draw',properties:{Left:0,Top:0,Width:750,Height:750,Visible:-1,Enabled:-1}},{container}),surface=new A.OcxWindowlessSurface(container,canvas,{onError:e=>failures.push(e.message)});surface.resize(180,100);surface.flush();
      const pixel=(x,y)=>[...canvas.getContext('2d').getImageData(x,y,1,1).data],initial=pixel(10,10),clipped=pixel(70,10);control.props.Left=900;control.refresh();surface.flush();const erased=pixel(10,10),moved=pixel(70,10);
      window.ocxCanvasState={container,canvas,control,surface,events,failures,pixel};return {initial,clipped,erased,moved};
    }""")
    check(data['initial']==[192,0,0,255],data);check(data['clipped'][3]==0,data);check(data['erased'][3]==0,data);check(data['moved']==[192,0,0,255],data)
    box=page.locator('#ocx-windowless-lab').bounding_box();page.mouse.move(box['x']+70,box['y']+10);page.mouse.down();page.mouse.move(box['x']+170,box['y']+90);page.mouse.up()
    page.wait_for_function("ocxCanvasState.events.some(e=>e[0]==='MouseUp')")
    events=page.evaluate('ocxCanvasState.events');down=next(e for e in events if e[0]=='MouseDown');up=next(e for e in events if e[0]=='MouseUp')
    check(down[1:]==[1,0,150,150],events);check(up[1:]==[1,0,1650,1350],events)
    check(page.evaluate('ocxCanvasState.failures')==[]);page.evaluate('ocxCanvasState.surface.close();ocxCanvasState.container.close();ocxCanvasState.canvas.remove()')

def multiselection_pages(page):
    result=page.evaluate("""()=>{
      const A=VB6StudioAPI,a=A.createControl('Acme.Gauge.1','First'),b=A.createControl('Acme.Gauge.1','Second');ocxRegistry.initializeModel(a);ocxRegistry.initializeModel(b);let applied=0;
      const page=ocxRegistry.createPropertyPageSession([a,b],{onApply:entries=>{if(entries.length!==2)throw Error('selection mismatch');applied++;}});page.edit({Value:61,Mode:1});const dirty=page.IsPageDirty;page.Apply();const values=[a.properties.Value,b.properties.Value],modes=[a.properties.Mode,b.properties.Mode];
      page.edit({Value:13});a.properties.Value=70;let stale=false;try{page.Apply();}catch(e){stale=/changed/.test(e.message);}page.Cancel();return {dirty,values,modes,applied,stale,after:[a.properties.Value,b.properties.Value]};
    }""")
    check(result=={'dirty':True,'values':[61,61],'modes':[1,1],'applied':1,'stale':True,'after':[70,61]},result)

def ide_multiselection_pages(page):
    add(page);add(page)
    page.evaluate("()=>{vb6Studio.designer.selection=new Set(vb6Studio.activeModule.form.controls.map(c=>c.id));vb6Studio.inspector.render();}")
    # Use the same visible classic property-page button, not only the SDK helper.
    page.get_by_role('button',name='Property Pages…',exact=True).click()
    page.wait_for_function('vb6Studio.activeModule.form.controls.every(c=>c.properties.Value===75)')
    page.evaluate('vb6Studio.command("undo")')
    check(page.evaluate('vb6Studio.activeModule.form.controls.map(c=>c.properties.Value)')==[25,25])

def source_control_execution(page):
    result=page.evaluate(r"""async()=>{
      const A=VB6StudioAPI,code=`Option Explicit
Private mValue As Long
Public Trace As String
Public Event Changing(ByVal Proposed As Long, ByRef Cancel As Boolean)
Private Sub UserControl_Initialize()
 Trace = "I"
End Sub
Private Sub UserControl_InitProperties()
 mValue = 4
 Trace = Trace & "N"
End Sub
Private Sub UserControl_Resize()
 Trace = Trace & "R"
End Sub
Private Sub UserControl_Show()
 Trace = Trace & "S"
End Sub
Private Sub UserControl_WriteProperties(PropBag As PropertyBag)
 PropBag.WriteProperty "Value", mValue, 4&
End Sub
Private Sub UserControl_ReadProperties(PropBag As PropertyBag)
 mValue = PropBag.ReadProperty("Value", 4&)
End Sub
Public Property Get Value() As Long
 Value = mValue
End Property
Public Property Let Value(ByVal Proposed As Long)
 Dim Cancel As Boolean
 RaiseEvent Changing(Proposed, Cancel)
 If Cancel Then Exit Property
 mValue = Proposed
 UserControl.PropertyChanged "Value"
End Property`;
      const project={name:'ControlsLab',modules:[{name:'Gauge',kind:'form',form:{name:'Gauge',type:'UserControl',properties:{Width:1500,Height:750}},code}]};
      const c=await A.SourceUserControl.create(project,'Gauge');try{
        const trace=await c.get('Trace');const stop=c.subscribe(async(name,args,context)=>{if(await context.get('Value')!==4)throw Error('reentrant getter');args[1].ref.set(-1);});await c.set('Value',90);const cancelled=await c.get('Value');stop();await c.set('Value',29);const dirty=c.Dirty,state=await c.save();
        const copy=await A.SourceUserControl.create(project,'Gauge',{state:JSON.parse(JSON.stringify(state))});try{return {trace,cancelled,dirty,saved:c.Dirty,loaded:await copy.get('Value'),type:state.properties[0].value.vt};}finally{await copy.close();}
      }finally{await c.close();}
    }""")
    check(result=={'trace':'INRS','cancelled':4,'dirty':True,'saved':False,'loaded':29,'type':3},result)

def source_design_consent(page):
    result=page.evaluate(r"""async()=>{
      const A=VB6StudioAPI,project={name:'ControlsLab',modules:[{name:'Gauge',kind:'form',form:{name:'Gauge',type:'UserControl',properties:{}},code:`Public Events As Long
Public Event Changed()
Public Sub Fire()
 RaiseEvent Changed
End Sub`}]};
      let refused=false;try{await A.SourceUserControl.create(project,'Gauge',{design:true});}catch(error){refused=/consent/.test(error.message);}
      const control=await A.SourceUserControl.create(project,'Gauge',{design:true,allowDesignCode:true});let events=0;control.subscribe(()=>events++);try{await control.invoke('Fire');const inDesign=events;await control.setDesignMode(false);await control.invoke('Fire');return {refused,inDesign,events,userMode:control.Ambient.UserMode};}finally{await control.close();}
    }""")
    check(result=={'refused':True,'inDesign':0,'events':1,'userMode':-1},result)

CASES=[toolbox,inspector,pages,stale,event_handler,lifecycle,container_keyboard,canvas_windowless,multiselection_pages,ide_multiselection_pages,source_control_execution,source_design_consent]
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
def main():
    kind=os.environ.get('VB6_BROWSER','chromium');origins=os.environ.get('VB6_OCX_ORIGINS','modular,http,file').split(',');results=[]
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
      with sync_playwright() as pw:
        browser=getattr(pw,kind).launch(**({'args':['--no-sandbox'],**({'executable_path':os.environ['VB6_CHROMIUM']} if os.environ.get('VB6_CHROMIUM') else {})} if kind=='chromium' else {}));version=browser.version
        for origin in origins:
          url=(ROOT/'dist/VB6-Studio-Web.html').as_uri() if origin=='file' else f'http://127.0.0.1:{server.server_port}/dist/'+('index.html' if origin=='modular' else 'VB6-Studio-Web.html')
          for case in CASES:
            page=browser.new_page(viewport={'width':1440,'height':960});errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.set_default_timeout(12000)
            try:
              page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text()) if origin=='inline' else page.goto(url,wait_until='load');page.wait_for_function('!!globalThis.vb6Studio?.editor');page.evaluate(SETUP);case(page);check(not errors,errors)
              results.append({'origin':origin,'name':case.__name__,'passed':True});print('PASS',origin,case.__name__,flush=True)
              if case==inspector:page.screenshot(path=str(OUT/f'{kind}-{origin}-inspector.png'),caret='hide')
            except Exception as error:
              results.append({'origin':origin,'name':case.__name__,'passed':False,'error':str(error),'pageErrors':errors});print('FAIL',origin,case.__name__,error,flush=True);traceback.print_exc(limit=2)
              try:page.screenshot(path=str(OUT/f'{kind}-{origin}-{case.__name__}-failed.png'))
              except Exception:pass
            finally:page.close()
        browser.close()
    finally:server.shutdown();server.server_close();thread.join()
    report={'browser':kind,'version':version,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'tests':results};(OUT/f'{kind}.json').write_text(json.dumps(report,indent=2)+'\n');return bool(report['failed'])
if __name__=='__main__':sys.exit(main())
