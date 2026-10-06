/** Literal expected results from the binary VBA contracts, not host GPU emulation. */
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export const LIKE_CASES=[
  ['', '', true],['','*',true],['','?',false],['abc','a*',true],['ABC','a*',false],
  ['aM5b','a[L-P]#[!c-e]',true],['aZ5b','a[L-P]#[!c-e]',false],
  ['abc','*b*',true],['abc','*b',false],['abbbc','a*b*c',true],
  ['a.c','a.c',true],['a+c','a+c',true],['a?c','a[?]c',true],
  ['a*c','a[*]c',true],['a#c','a[#]c',true],['[','[[]',true],
  [']',']',true],['','[]',true],['abc','a[]bc',true],
  ['-','[-ab]',true],['-','[ab-]',true],['b','[a-c]',true],['d','[a-c]',false],
  ['d','[!a-c]',true],['a','[!a-c]',false],['!','[a!]',true],
  ['1','#',true],['A','#',false],['１','#',false],['å','[à-ÿ]',true],
  ['abcd','a**?*d',true],['abc','a*d?',false],['abc','a**c',true],
  ['😀','??',true],['😀','?',false]
].map(([text,pattern,result],i)=>({name:'binary Like '+i,source:`Public result As Boolean\nSub Main()\nresult=${quote(text)} Like ${quote(pattern)}\nEnd Sub`,expected:{result}}));
export const ARRAY_STRING_CASES=[
  ['Split repeated/trailing delimiter','a=Split("a,,b,",",")',['a','','b','']],
  ['Split default space','a=Split("a b  c")',['a','b','','c']],
  ['Split empty source','a=Split("",",")',[]],
  ['Split empty delimiter','a=Split("a,b","")',['a,b']],
  ['Split zero limit','a=Split("a,b",",",0)',[]],
  ['Split one limit','a=Split("a,b,c",",",1)',['a,b,c']],
  ['Split two limit','a=Split("a,b,c",",",2)',['a','b,c']],
  ['Split default holes','a=Split("a b",,,0)',['a','b']],
  ['Split multicharacter','a=Split("a--b----c--","--")',['a','b','','c','']],
  ['Split overlapping delimiter','a=Split("aaa","aa")',['','a']],
  ['Split binary case','a=Split("aAaa","A")',['a','aa']],
  ['Split all delimiter','a=Split(",,,",",")',['','','','']],
  ['Split Unicode units','a=Split("猫😀犬😀","😀")',['猫','犬','']],
  ['Split reads aliased source first','ReDim a(0)\na(0)="a,b,c"\na=Split(a(0),",")',['a','b','c']],
  ['Filter include','a=Split("red,green,redder,blue",",")\na=Filter(a,"red")',['red','redder']],
  ['Filter exclude','a=Split("red,green,redder,blue",",")\na=Filter(a,"red",False)',['green','blue']],
  ['Filter noninteger truth','a=Split("red,green",",")\na=Filter(a,"red",0.1!)',['red']],
  ['Filter default holes','a=Split("red,green",",")\na=Filter(a,"red",,0)',['red']],
  ['Filter empty needle include','a=Split("a,,b",",")\na=Filter(a,"")',['a','','b']],
  ['Filter empty needle exclude','a=Split("a,,b",",")\na=Filter(a,"",False)',[]],
  ['Filter absent needle','a=Split("a,b",",")\na=Filter(a,"x")',[]],
  ['Filter binary case','a=Split("a,A,aa",",")\na=Filter(a,"A")',['A']],
  ['Filter empty allocated source','a=Split("")\na=Filter(a,"x")',[]],
  ['empty result can grow with Preserve','a=Split("")\nReDim Preserve a(1)\na(1)="grown"',['','grown']],
  ['Filter source lower bound rebased','ReDim a(5 To 7)\na(5)="yes"\na(6)="no"\na(7)="yes2"\na=Filter(a,"yes")',['yes','yes2']]
].map(([name,body,a])=>({name,source:`Option Explicit\nPublic a() As String\nSub Main()\n${body}\nEnd Sub`,expected:{a}}));
export const EXTRA_STRING_CASES=[...LIKE_CASES,...ARRAY_STRING_CASES,
  {name:'Like Boolean converts to String',source:'Public s As String\nSub Main()\ns="a" Like "*"\nEnd Sub',expected:{s:'True'}}
];
