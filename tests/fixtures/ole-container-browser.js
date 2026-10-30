/** Executes against both ESM and the bundled runtime in the existing browser CI. */
export async function validateOleContainerBrowser(api){
  const checks=[],equal=(actual,expected,name)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(name+': '+JSON.stringify(actual)+' != '+JSON.stringify(expected));checks.push(name);};
  const fs=new api.VirtualFileSystem(),downloads=[],events=[];fs.write('/note.txt','Original note');
  let finishImport;const vm={fs,host:{saveFile:(name,bytes)=>downloads.push({name,bytes:[...bytes]}),openFile:()=>new Promise(resolve=>{finishImport=resolve;})},dispatch:(_instance,name,args)=>{events.push({name,args});return Promise.resolve();}};
  const model={id:'ole-control',name:'OLE1',type:'OLE',properties:{Width:5400,Height:3600,Enabled:-1,Visible:-1}};
  const control=new api.BrowserControl(model,{vm});document.body.append(control.node);
  try{
    equal([control.node.classList.contains('vb-unsupported'),control.OLEType],[false,3],'OLE has a real empty container');
    control.CreateEmbed('/note.txt');equal([control.Object.Text,control.Class,control.OLEType],['Original note','VB6.TextDocument',1],'CreateEmbed exposes a typed document');
    equal(control.node.querySelector('textarea').readOnly,true,'inactive text document is read-only');
    control.DoVerb();const editor=control.node.querySelector('textarea');editor.value='Edited through the DOM';editor.dispatchEvent(new Event('input',{bubbles:true}));
    equal([control.Object.Text,control.Modified],['Edited through the DOM',-1],'active document input updates its object');
    control.Close();equal([control.node.querySelector('textarea').readOnly,control.Object.Text],[true,'Edited through the DOM'],'Close keeps content and exits editing');
    control.SaveDocument('/saved.txt');control.ExportDocument();equal([fs.read('/saved.txt'),downloads[0]?.bytes],['Edited through the DOM',[...new TextEncoder().encode('Edited through the DOM')]],'disk save and browser export preserve bytes');
    control.CreateLink('/note.txt');fs.write('/note.txt','Changed source');control.Update();equal([control.OLEType,control.Object.Text],[0,'Changed source'],'linked refresh reads the application disk');
    control.CreateEmbed('','VB6.RichTextDocument');control.Object.TextRTF='{\\rtf1\\ansi Rich {\\b bold} \\u322?}';
    equal([control.Object.Text,!!control.node.querySelector('.vb-rich-span[style*="bold"]')||[...control.node.querySelectorAll('span')].some(n=>n.style.fontWeight==='bold')],['Rich bold ł',true],'rich document renders formatting and Unicode');
    fs.open('/objects.dat','binary',1);control.SaveToFile(1);const original=control.Object.TextRTF;control.Delete();fs.seek(1,1);control.ReadFromFile(1);equal(control.Object.TextRTF,original,'control file-number persistence restores RTF');
    const imported=control.InsertObjDlg();control.CreateEmbed();finishImport({name:'late.txt',bytes:new TextEncoder().encode('stale')});await imported;equal(control.Object.Text,'','late picker result cannot replace a newer document');
    const before=control.Object;control.Delete();let error=0;try{before.Text;}catch(e){error=e.number;}equal(error,462,'removed document references cannot alias another object');
    control.CreateEmbed('','VB6.RichTextDocument');control.Object.Text='Old object content';control.CreateEmbed('','VB6.RichTextDocument');control.DoVerb();control.oleController.rich.undo();equal(control.Object.Text,'','replacement rich documents never inherit the previous undo history');
    const imageBytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
    control.set('SizeMode',2);control.oleController.document.importBytes('pixel.png',imageBytes);const oldImage=control.oleController.image,bounds=[control.Width,control.Height];control.Delete();oldImage.dispatchEvent(new Event('load'));await new Promise(resolve=>setTimeout(resolve,0));equal([control.Width,control.Height],bounds,'late image load cannot affect a replacement document');
    control.set('Enabled',0);control.refresh();equal(control.node.querySelector('.vb-ole-menu').disabled,true,'disabled OLE control disables its actions');
  }finally{control.dispose();}
  equal([control.disposed,control.oleController.closed,control.node.isConnected],[true,true,false],'control disposal releases its document and presentation');
  const formModel={id:'ole-form',name:'Form1',type:'Form',properties:{ClientWidth:6000,ClientHeight:4500},controls:[],menus:[]},form=new api.BrowserForm(formModel,{vm});
  try{const added=form.Controls.Add('VB.OLE','DynamicDocument');added.CreateEmbed();added.Object.Text='Dynamic';equal(added.Object.Text,'Dynamic','Controls.Add accepts intrinsic OLE');form.Controls.Remove('DynamicDocument');equal(added.disposed,true,'dynamic OLE removal disposes the document');}finally{form.dispose();}
  return checks;
}
