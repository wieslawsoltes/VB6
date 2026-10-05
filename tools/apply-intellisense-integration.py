from pathlib import Path
import subprocess
p=Path('src/editor/editor.js');s=p.read_text()
start=s.index('    if(!this.composing&&!this.acceptingCompletion){');end=s.index('  prepareDocumentTransfer()',start)
body=s[start:end];s=s[:start]+'''    this.refreshAssistance();
  }
  refreshAssistance(){
    const start=this.cursor().offset;
'''+body+s[end:]
start=s.index("  replaceGlobal(text,start,end,kind='command')");end=s.index('  toggleSplit(',start)
s=s[:start]+'''  replaceGlobal(text,start,end,kind='command'){
    if(this.readOnly)return;this.changingSource=true;
    try{
      const oldText=this.text,newText=oldText.slice(0,start)+text+oldText.slice(end),change=replacementChange(start,end,text.length),cursor=start+text.length;
      this.assignSource(newText,{start:cursor,end:cursor},change);this.emit('change',{module:this.module,oldText,newText,change,kind});this.updateSelectors(false);
      this.goToLine(positionAt(this.index,cursor).line,positionAt(this.index,cursor).column);this.refreshAssistance();
    }finally{this.changingSource=false;}
  }
'''+s[end:]
s=s.replace('setReadOnly(value){this.readOnly=!!value;', 'setReadOnly(value){if(value){this.closeCompletion();this.closeInfo();}this.readOnly=!!value;')
p.write_text(s)
p=Path('src/editor/virtual-input.js');s=p.read_text().replace("this.editor.completion&&['ArrowUp','ArrowDown','Enter','Tab','Escape']", "this.editor.completion&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Enter','Tab','Escape']");p.write_text(s)
p=Path('tools/browser-intellisense-tests.py');s=p.read_text().replace('.endswith(','.endsWith(');p.write_text(s)
subprocess.run(['git','add','tools/browser-intellisense-tests.py'],check=True)
