import {newProject, createControl, newId} from './model.js';

/** A complete two-unit Pascal application using the ordinary form/file hosts. */
export function createPascalNumberLab() {
  const project = newProject('PascalNumberLab', {language:'pascal'}), form = project.modules[0];
  project.description = 'Turbo Pascal form events, typed units, numeric validation and portable text-file output.';
  Object.assign(form.form.properties, {Caption:'Turbo Pascal — Number Lab', ClientWidth:7200, ClientHeight:4500});
  const control = (type, name, x, y, width, height, properties) => {
    const item = createControl(type, name, x, y);
    Object.assign(item.properties, {Width:width, Height:height, ...properties});
    form.form.controls.push(item);
  };
  control('Label','IntroLabel',300,240,6600,600,{Caption:'Two Pascal units, shared form controls, and portable file I/O.',FontBold:-1});
  control('Label','InputLabel',300,1020,1800,300,{Caption:'Enter N (0 to 40):'});
  control('TextBox','InputText',2100,960,1500,360,{Text:'10',TabIndex:0});
  control('CommandButton','CalculateButton',3900,930,3000,420,{Caption:'&Calculate',Default:-1,TabIndex:1});
  control('ListBox','ResultsList',300,1620,6600,1500,{List:[],TabIndex:2});
  control('CommandButton','SaveButton',300,3360,2550,420,{Caption:'&Save results',TabIndex:3});
  control('Label','StatusLabel',300,3960,6600,300,{Caption:'Ready'});
  form.code = `unit Form1;

interface

implementation

uses NumberSeries;

var
    NumberText, FibonacciText, TriangleText: String;
    HasResults: Boolean;

procedure CalculateButton_Click;
var
    N, ErrorCode: Integer;
begin
    HasResults := False;
    Val(InputText.Text, N, ErrorCode);
    if (ErrorCode <> 0) or (N < 0) or (N > 40) then
    begin
        StatusLabel.Caption := 'Enter a whole number from 0 to 40.';
        InputText.SetFocus;
        Exit;
    end;
    Str(N, NumberText);
    Str(Fibonacci(N), FibonacciText);
    Str(Triangular(N), TriangleText);
    ResultsList.Clear;
    ResultsList.AddItem('N = ' + NumberText);
    ResultsList.AddItem('Fibonacci(N) = ' + FibonacciText);
    ResultsList.AddItem('1 + ... + N = ' + TriangleText);
    HasResults := True;
    StatusLabel.Caption := 'Calculated by the NumberSeries Pascal unit.';
end;

procedure Form_Load;
begin
    CalculateButton_Click;
end;

procedure InputText_KeyPress(var KeyAscii: Integer);
begin
    if KeyAscii = 13 then
    begin
        CalculateButton_Click;
        KeyAscii := 0;
    end;
end;

procedure SaveButton_Click;
var
    OutputFile: Text;
    ErrorCode: Integer;
begin
    if not HasResults then
    begin
        StatusLabel.Caption := 'Calculate valid results before saving.';
        Exit;
    end;
    Assign(OutputFile, 'Pascal-Results.txt');
    {$I-}
    Rewrite(OutputFile);
    ErrorCode := IOResult;
    if ErrorCode = 0 then
    begin
        WriteLn(OutputFile, 'TURBO PASCAL NUMBER LAB');
        WriteLn(OutputFile, 'N = ', NumberText);
        WriteLn(OutputFile, 'Fibonacci(N) = ', FibonacciText);
        WriteLn(OutputFile, '1 + ... + N = ', TriangleText);
        ErrorCode := IOResult;
        Close(OutputFile);
        if ErrorCode = 0 then ErrorCode := IOResult;
    end;
    {$I+}
    if ErrorCode = 0 then
        StatusLabel.Caption := 'Saved Pascal-Results.txt.'
    else
        StatusLabel.Caption := 'The results file could not be saved.';
end;

end.
`;
  project.modules.push({id:newId(),name:'NumberSeries',kind:'module',language:'pascal',code:`unit NumberSeries;

interface

function Fibonacci(N: Integer): LongInt;
function Triangular(N: Integer): LongInt;

implementation

function Fibonacci(N: Integer): LongInt;
var
    I: Integer;
    A, B, Next: LongInt;
begin
    A := 0;
    B := 1;
    for I := 1 to N do
    begin
        Next := A + B;
        A := B;
        B := Next;
    end;
    Fibonacci := A;
end;

function Triangular(N: Integer): LongInt;
begin
    Triangular := LongInt(N) * (N + 1) div 2;
end;

end.
`});
  return project;
}
