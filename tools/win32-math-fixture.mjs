/** Native numerical behavior, exact documented VB random sequences and error
 * recovery. Decimal constants are independent vectors, not emitter results. */
export function nativeMathControlFixture(fixture){
 const {add,check,finish}=fixture('AotControlMath');
 add('Dim a As Single,b As Single,c As Single,d As Double,n As Long,i As Long,v As Variant');
 check('Rnd(0)=0.01953125 And VarType(Rnd(0))=vbSingle','Rnd(0) exposes the untouched per-process VB seed without advancing it');
 add('a=Rnd\nb=Rnd(1)\nc=Rnd()');
 check('a=0.7055475115776062 And b=0.5334240198135376 And c=0.5795186161994934','omitted and positive Rnd arguments follow independent first-sequence vectors');
 check('Rnd(0)=c And Rnd(-0.0)=c','zero and negative zero retain the last generated Single');
 add('a=Rnd(-1)\nb=Rnd(-2)\nc=Rnd(-1)');
 check('a=0.2240070104598999 And b=0.7133256793022156 And c=a','negative Rnd arguments reseed from exact IEEE Single bits');
 check('Rnd(-0.5)=0.7240070104598999 And Rnd(-123.5)=0.7974317669868469','negative fractional seed vectors include mantissa and exponent bits');
 add('a=Rnd(-1)\nRandomize 42\na=Rnd\nb=Rnd\nc=Rnd');
 check('a=0.907809317111969 And b=0.6110868453979492 And c=0.16818541288375854','explicit Double Randomize uses its high-word mixer and retains the seed low byte');
 add('d=Rnd(-1)\nRandomize 42');check('Rnd=a And Rnd=b And Rnd=c','negative Rnd followed by the same explicit Randomize repeats a sequence');
 add('sequence=0\nRandomize SeedValue()\na=Rnd');check('sequence=1 And a>=0 And a<1','Randomize evaluates its explicit numeric argument exactly once');
 add('Randomize\na=Rnd');check('sequence=1 And a>=0 And a<1','omitted Randomize uses system time, not a user procedure named Timer');
 check('RGB(255,0,0)=255 And RGB(0,255,0)=65280 And RGB(0,0,255)=16711680 And VarType(RGB(1,2,3))=vbLong','RGB places red in the low byte and returns a Long');
 check('RGB(256,1000,32767)=&HFFFFFF And RGB(1.5,2.5,"3")=&H30202','RGB clamps upper components and performs native numeric argument conversions');
 add('sequence=0\nn=RGB(blue:=ColorValue(3),red:=ColorValue(1),green:=ColorValue(2))');
 check('n=&H30201 And sequence=312','named RGB arguments evaluate lexically while retaining red/green/blue ABI positions');
 // Unsuffixed &H8000..&HFFFF are negative VB Integer literals, not the
 // positive Long COLORREF oracle. Decimal vectors avoid signed-width ambiguity.
 for(const [index,color]of [0,0x800000,0x008000,0x808000,0x000080,0x800080,0x008080,0xc0c0c0,0x808080,0xff0000,0x00ff00,0xffff00,0x0000ff,0xff00ff,0x00ffff,0xffffff].entries())
  check(`QBColor(${index})=${color} And VarType(QBColor(${index}))=vbLong`,'QBColor '+index+' uses the documented DOS palette');
 check('Abs(Sin(1)-0.8414709848078965)<0.000000000001 And Abs(Cos(1)-0.5403023058681398)<0.000000000001','Sin and Cos use radian Double arguments');
 check('Abs(Tan(1)-1.5574077246549023)<0.000000000001 And Abs(Atn(1)-0.7853981633974483)<0.000000000001','Tan and Atn return independently known Double values');
 check('Abs(Exp(1)-2.718281828459045)<0.000000000001 And Abs(Log(2)-0.6931471805599453)<0.000000000001','Exp and Log use natural base Double functions');
 check('Sin(0)=0 And Cos(0)=1 And Tan(0)=0 And Atn(0)=0 And Exp(0)=1 And Log(1)=0','all six intrinsic zero/unit identities');
 check('Abs(Sin(-1)+Sin(1))<0.000000000001 And Abs(Cos(-1)-Cos(1))<0.000000000001','negative angles retain odd and even identities');
 check('VarType(Sin(CSng(1)))=vbDouble And VarType(Log(CCur(2)))=vbDouble And VarType(Atn(CDec(1)))=vbDouble','transcendentals return Double even for Single/Currency/Decimal inputs');
 add('v=1\nd=Sin(number:=v)');check('Abs(d-0.8414709848078965)<0.000000000001 And Sin("0")=0','named and coerced Variant/String operands use the native numeric path');
 add('d=0\nFor i=1 To 2000\n d=d+Sin(0.25)*Sin(0.25)+Cos(0.25)*Cos(0.25)\nNext');
 check('Abs(d-2000)<0.00000001','repeated nested cdecl Double results do not leak the x87 or native argument stack');
 add('On Error Resume Next');
 for(const [expr,error]of [['Log(0)',5],['Log(-1)',5],['Exp(1000)',6],['RGB(-1,0,0)',5],['QBColor(-1)',5],['QBColor(16)',5],['Sin(Null)',94],['Rnd(Null)',94]]){
  add('Err.Clear\nd=99\nd='+expr);check('Err.Number='+error+' And d=99',expr+' raises '+error+' without publishing a failed result');
 }
 add('Err.Clear\nOn Error GoTo 0');check('Sin(0)=0 And Log(1)=0 And Exp(-1000)=0','FPU and structured VB error frames remain usable after domain/overflow errors');
 return finish('Private sequence As Long',`Private Function SeedValue() As Double
 sequence=sequence+1
 SeedValue=42
End Function
Private Function ColorValue(ByVal component As Long) As Long
 sequence=sequence*10+component
 ColorValue=component
End Function
Private Function Timer() As Single
 sequence=sequence+1000
 Timer=-1
End Function`);
}
