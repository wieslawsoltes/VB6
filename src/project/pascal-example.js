import {newProject,createControl} from './model.js';

/** The same form/control model and event bridge serves both source languages. */
export function createPascalExample(){
  const project=newProject('PascalWelcome',{language:'pascal'}),module=project.modules[0];
  Object.assign(module.form.properties,{Caption:'Turbo Pascal — Forms',ClientWidth:6000,ClientHeight:3000});
  const text=createControl('TextBox','NameText',300,360),button=createControl('CommandButton','GreetButton',3540,360),label=createControl('Label','GreetingLabel',300,1140);
  Object.assign(text.properties,{Text:'Pascal',Width:3000});Object.assign(button.properties,{Caption:'Say hello',Width:1800});Object.assign(label.properties,{Caption:'Enter your name and click Say hello.',Width:5280,Height:720});
  module.form.controls.push(text,button,label);
  module.code="unit Form1;\n\ninterface\n\nimplementation\n\nprocedure Form_Load;\nbegin\n    GreetingLabel.Caption := 'A shared form designer, with Turbo Pascal source.';\nend;\n\nprocedure GreetButton_Click;\nbegin\n    GreetingLabel.Caption := 'Hello, ' + NameText.Text + '!';\nend;\n\nprocedure NameText_KeyPress(var KeyAscii: Integer);\nbegin\n    if KeyAscii = 13 then\n    begin\n        GreetButton_Click;\n        KeyAscii := 0;\n    end;\nend;\n\nend.\n";
  return project;
}
