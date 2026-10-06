import fs from 'node:fs';import path from 'node:path';
import {newProject,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {LayoutEngine,solveAnchor} from '../packages/auto-layout/src/index.js';
import {formNodes,layoutOptions} from '../src/layout/model.js';
const directory=path.resolve(process.argv[2]||'reports/layout/native');fs.mkdirSync(directory,{recursive:true});
const cases=[];
function make(name,mode){const p=newProject(name);p.settings.anchoring=true;const m=p.modules[0],f=m.form;Object.assign(f.properties,{ClientWidth:9600,ClientHeight:7200,Width:9720,Height:7650,StartUpPosition:0,Left:300,Top:300,LayoutMode:mode,LayoutGap:120,LayoutPadding:60});m.code='Private Sub Form_Load()\nMe.Caption="Layout ready"\nEnd Sub\n';return p;}
function save(p,live=false){const f=p.modules[0].form,engine=new LayoutEngine(formNodes(f),layoutOptions(f)),steps=[];for(const [width,height]of [[9600,7200],[12000,8400],[7200,6000],[13500,9900],[9600,7200]]){engine.arrange(width,height);steps.push({width,height,bounds:f.controls.map(c=>({name:c.name,...engine.getBounds(c.id)}))});}
 const result=compileWin32(p);fs.writeFileSync(path.join(directory,p.name+'.exe'),result.bytes);fs.writeFileSync(path.join(directory,p.name+'.vb6web'),JSON.stringify(p,null,2));fs.writeFileSync(path.join(directory,p.name+'-build.json'),JSON.stringify(result.report,null,2));
 cases.push({name:p.name,live,controls:f.controls.map((c,i)=>({name:c.name,id:100+i,parent:c.parent||null})),steps});}
const anchored=make('NativeAnchors',0),f=anchored.modules[0].form;
for(let i=0;i<16;i++){const c=createControl('CommandButton','B'+i,150+(i%4)*1800,150+Math.floor(i/4)*1050);Object.assign(c.properties,{Anchor:i,Width:1200,Height:600,MinimumWidth:450,MinimumHeight:300,MaximumWidth:1800,MaximumHeight:1200,Caption:'Anchor '+i});f.controls.push(c);}
const frame=createControl('Frame','Frame1',7350,900);Object.assign(frame.properties,{Anchor:15,Width:1950,Height:4800,LayoutPadding:30});f.controls.push(frame);const child=createControl('CommandButton','Nested',150,450);child.parent='Frame1';Object.assign(child.properties,{Anchor:15,Width:1200,Height:1800,MinimumWidth:450,MinimumHeight:300});f.controls.push(child);save(anchored);
for(let mode=1;mode<=3;mode++){const p=make('NativeFlow'+mode,mode),f=p.modules[0].form;for(let i=0;i<6;i++){const c=createControl('CommandButton','B'+i);Object.assign(c.properties,{Width:900+i*300,Height:450+i*120,LayoutGrow:i%2,LayoutMargin:45,LayoutShrink:1,LayoutAlign:i%4,MaximumWidth:i===1?1500:0,MinimumWidth:450,Caption:'Flow '+i});f.controls.push(c);}const frame=createControl('Frame','Panel',0,0);Object.assign(frame.properties,{Width:2100,Height:1650,LayoutMode:mode,LayoutGap:45,LayoutPadding:75});f.controls.push(frame);for(let i=0;i<3;i++){const c=createControl('CommandButton','N'+i,0,0);c.parent='Panel';Object.assign(c.properties,{Width:600,Height:450,LayoutGrow:1,LayoutMargin:15,Dock:i===0?1:0});f.controls.push(c);}save(p);}
const live=make('NativeLayoutCode',0),m=live.modules[0];const target=createControl('CommandButton','Target',300,300);Object.assign(target.properties,{Width:1500,Height:450,Anchor:10});const trigger=createControl('CommandButton','Change',300,1800);trigger.properties.Caption='Exercise layout code';m.form.controls=[target,trigger];m.code=`Private Sub Form_Load()
 Me.Caption="Layout ready"
End Sub
Private Sub Change_Click()
 Dim a As AnchorStyles
 a=vbAnchorBottom Or vbAnchorRight
 Me.SuspendLayout
 Me.SuspendLayout
 Target.Dock=vbDockFill
 Target.Anchor=a
 Target.Move 450, 600, 1500, 450
 Target.MinimumWidth=900
 Target.MaximumWidth=1800
 Me.ClientWidth=12000
 Me.ClientHeight=8400
 Me.ResumeLayout
 Me.ResumeLayout False
 If Target.Left<>450 Then
  Me.Caption="Failed: early layout"
  Exit Sub
 End If
 Me.PerformLayout
 If Target.Anchor<>10 Or Target.Dock<>0 Or Target.Left<>2850 Or Target.Top<>1800 Then
  Me.Caption="Failed: final layout"
  Exit Sub
 End If
 Me.Caption="Layout code passed"
End Sub
`;save(live,true);
fs.writeFileSync(path.join(directory,'cases.json'),JSON.stringify(cases,null,2));console.log('Wrote '+cases.length+' isolated PE32 layout fixtures to '+directory);

fs.writeFileSync(path.join(directory,'winforms-reference.json'),JSON.stringify(Array.from({length:16},(_,mask)=>({mask,steps:[[240,180],[360,240],[120,90],[241,181],[480,300],[240,180]].map(([width,height])=>({width,height,bounds:solveAnchor({x:20,y:30,width:80,height:45},{width:240,height:180},{width,height},mask)}))})),null,2));
