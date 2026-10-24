import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,createModule,normalizeProject} from '../src/project/model.js';
import {moduleLanguage,sourceExtension} from '../src/project/language.js';
import {createPascalExample} from '../src/project/pascal-example.js';
import {sourceFiles,importFiles} from '../src/project/formats.js';
import {mergedProject} from '../src/project/import-merge.js';
import {scanPascalDeclarations,pascalProcedureEdit,pascalParameters,pascalHighlightSpans,renamePascalSymbol,formatPascalCode,pascalCallContext} from '../src/editor/pascal-service.js';

test('legacy projects retain the default VB language while Pascal factories and mixed overrides are explicit',()=>{
  const legacy=newProject();assert.equal(legacy.language,undefined);assert.equal(legacy.modules[0].language,undefined);assert.equal(moduleLanguage(legacy.modules[0],legacy),'vb6');
  const project=newProject('PascalForms',{language:'pascal'});assert.match(project.modules[0].code,/^unit Form1;/);assert.equal(sourceExtension(project.modules[0],project),'.pas');
  project.modules.push(createModule('SharedVB','module',{language:'vb6'}));const normalized=normalizeProject(project);assert.equal(moduleLanguage(normalized.modules[1],normalized),'vb6');
  assert.throws(()=>normalizeProject({...project,language:'unknown'}),/Unsupported source language/);
});

test('Pascal form source bundles preserve all designer data and honor external unit edits',async()=>{
  const project=createPascalExample(),before=JSON.stringify(project),files=sourceFiles(project);
  assert.deepEqual(Object.keys(files).sort(),['Form1.pas','Form1.pas.form.json','PascalWelcome.vb6web']);assert.equal(JSON.stringify(project),before);
  files['Form1.pas']=files['Form1.pas'].replace("'Hello, '","'Welcome, '");
  const result=await importFiles(new Map(Object.entries(files)));assert.equal(result.project.language,'pascal');assert.match(result.project.modules[0].code,/'Welcome, '/);assert.deepEqual(result.project.modules[0].form,project.modules[0].form);
  const standalone=await importFiles(new Map([['Form1.pas',files['Form1.pas']],['Form1.pas.form.json',files['Form1.pas.form.json']]]));assert.equal(standalone.project.modules[0].kind,'form');assert.equal(standalone.project.modules[0].form.controls.length,3);
});

test('source bundle imports preserve module language when merging with a different project default',async()=>{
  const incoming=await importFiles(new Map([['Utilities.pas','unit Utilities; interface implementation end.']]));
  const vb=mergedProject(newProject(),incoming.project);assert.equal(moduleLanguage(vb.modules[1],vb),'pascal');
  const legacy=newProject();legacy.modules[0].name='VBForm';legacy.modules[0].form.name='VBForm';legacy.startup='VBForm';
  const pascal=mergedProject(createPascalExample(),legacy);assert.equal(moduleLanguage(pascal.modules[1],pascal),'vb6');
});

test('Pascal lexer-based renaming excludes all comments, directives and escaped string literals',()=>{
  const source="{$IFDEF old}\n{ old\n old_Click }\n(* old *)\n// old\nprocedure old_Click; begin WriteLn('old isn''t a name', old); end;";
  const next=renamePascalSymbol(source,'old','New');assert.equal(next,source.replace('procedure old_Click','procedure New_Click').replace(", old);",", New);"));
  const spans=pascalHighlightSpans(source);assert.ok(spans.some(s=>s.kind==='comment'&&source.slice(s.start,s.end).includes('old_Click')));assert.ok(spans.some(s=>s.kind==='string'&&source.slice(s.start,s.end)==="'old isn''t a name'"));
});

test('Pascal declaration scopes handle nested routines and incomplete unit input',()=>{
  const code='unit Sample;\ninterface\nprocedure Outer;\nimplementation\nprocedure Outer;\nvar x: Integer;\nprocedure Inner;\nbegin\n  x := 1;\nend;\nbegin\n  Inner;\nend;\nend.\n';
  const index=scanPascalDeclarations({id:'m',name:'Sample',code});assert.deepEqual(index.procedures.map(p=>p.name),['Outer','Inner']);assert.equal(index.procedures[0].end,13);assert.equal(index.procedures[1].end,10);assert.equal(index.procedures[0].scope,'public');assert.equal(index.symbols.filter(s=>s.name==='Outer').length,1);assert.equal(index.symbols.find(s=>s.name==='x').owner,'Outer');
  assert.equal(scanPascalDeclarations({code:'unit Pending; interface implementation procedure Typing; begin'}).procedures[0].name,'Typing');
});

test('shared form event signatures preserve Pascal var semantics and insert before the unit terminator',()=>{
  const module=createPascalExample().modules[0],parameters=pascalParameters(['Index As Integer','KeyCode As Integer','Shift As Integer','ByVal Node As Object']);
  assert.equal(parameters,'var Index: Integer; var KeyCode: Integer; var Shift: Integer; Node: Object');
  const edit=pascalProcedureEdit(module,{name:'NameText_KeyDown',parameters,tabWidth:2});assert.equal(module.code.slice(edit.start).trim(),'end.');
  assert.match(edit.text,/procedure NameText_KeyDown\(var Index: Integer;/);assert.equal(edit.text.slice(edit.caret-edit.start-2,edit.caret-edit.start),'  ');
  assert.throws(()=>pascalParameters('value As Integer); evil'),/Invalid event parameter/);
});

test('Pascal formatting is idempotent and keeps comment/string contents intact',()=>{
  const code="unit Demo;\ninterface\nimplementation\nprocedure Run;\nbegin\nif True then\nbegin\nWriteLn('End Sub', '{still a string}');\nend;\n(* Text\n     remains untouched. *)\nend;\nend.\n";
  const formatted=formatPascalCode(code,2);assert.equal(formatPascalCode(formatted,2),formatted);assert.match(formatted,/  WriteLn\('End Sub', '\{still a string\}'\);/);assert.match(formatted,/\(\* Text\n     remains untouched\. \*\)/);assert.doesNotMatch(formatted,/Option Explicit/);
});

test('Pascal call contexts distinguish incomplete and multiline declarations from invocation arguments',()=>{
  for(const header of [
    'procedure Run(var Value: Integer; ',
    'function Run\n  (\n    Value: Integer; ',
    'constructor TItem.Init {note} (Initial: Integer; ',
    'destructor TItem.Done(Flag: Boolean; ',
    'procedure TItem.\n  Move\n  (var X: Integer; ',
    'type TCallback = procedure(Value: Integer; ',
    'program Console(Input, ',
  ])assert.equal(pascalCallContext(header,header.length),null,header);
  const call="procedure Run(var Value: Integer); begin Run(Next('), ('), ";
  const context=pascalCallContext(call,call.length);assert.equal(context.name,'Run');assert.equal(context.comma,1);assert.deepEqual(context.args,["Next('), (')",' ']);
  const indexed='Items(.Index + 1';assert.equal(pascalCallContext(indexed,indexed.length).name,'Items');
});
