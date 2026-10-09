import {KEYWORDS} from '../language-service.js';

export function registerAdvancedLanguages(monaco) {
  const items=[];
  for(const [id,extensions]of [['vb6',['.bas','.cls','.frm','.ctl']],['xaml',['.xaml']]])if(!monaco.languages.getLanguages().some(l=>l.id===id))items.push(monaco.languages.register({id,extensions}));
  items.push(monaco.languages.setMonarchTokensProvider('vb6',{
    ignoreCase:true,keywords:KEYWORDS,defaultToken:'',
    tokenizer:{root:[
      [/\s+/,'white'],[/'.*$/,'comment'],[/\bRem(?:\s.*)?$/,'comment'],[/^\s*#(?:If|ElseIf|Else|End If|Const|Region|End Region)\b/,'keyword'],
      [/#(?:[^#\r\n]+)#/,'number'],[/"/,{token:'string.quote',next:'@string'}],
      [/&[hH][\da-fA-F]+[&%]?|&[oO][0-7]+[&%]?|\d+(?:\.\d*)?(?:[eEdD][+-]?\d+)?[%&!#@]?|\.\d+(?:[eEdD][+-]?\d+)?[!#@]?/,'number'],
      [/\[[^\]\r\n]+\][$%&!#@]?/,'identifier'],[/[a-zA-Z_\u0080-\uffff][\w\u0080-\uffff]*[$%&!#@]?/,{cases:{'@keywords':'keyword','@default':'identifier'}}],
      [/[()]/,'@brackets'],[/[+\-*/\\^&=<>]+/,'operator'],[/[:,.]/,'delimiter'],
    ],string:[[/""/,'string.escape'],[/"/,{token:'string.quote',next:'@pop'}],[/[^"\r\n]+/,'string'],[/$/,'invalid','@pop']]},
  }));
  items.push(monaco.languages.setLanguageConfiguration('vb6',{
    comments:{lineComment:"'"},brackets:[['(',')']],autoClosingPairs:[{open:'(',close:')',notIn:['string','comment']},{open:'"',close:'"',notIn:['string','comment']}],
    wordPattern:/\[?[_a-zA-Z\u0080-\uffff][\w\u0080-\uffff]*\]?[$%&!#@]?/g,
    indentationRules:{increaseIndentPattern:/^\s*(?:(?:(?:Public|Private|Friend|Static)\s+)*(?:Sub|Function|Property\s+(?:Get|Let|Set)|Type|Enum)\b.*|(?:For|Do|While|With|Select Case)\b.*|If\b.*\bThen\s*)$/i,decreaseIndentPattern:/^\s*(?:End\s+(?:Sub|Function|Property|Type|Enum|If|Select|With)|Next|Loop|Wend|Else(?:If)?|Case)\b/i},
    folding:{markers:{start:/^\s*'\s*#region\b/i,end:/^\s*'\s*#endregion\b/i}},
  }));
  items.push(monaco.languages.setMonarchTokensProvider('xaml',{
    tokenizer:{root:[[/<!--/,'comment','@comment'],[/<!\[CDATA\[/,'string','@cdata'],[/<\?/,'metatag','@processing'],[/<\/?[\w.:-]+/,'type','@tag'],[/&[\w#]+;/,'string.escape'],[/[^<&]+/,'']],
      tag:[[/\s+/,'white'],[/\/?\s*>/,'delimiter','@pop'],[/[\w.:-]+(?=\s*=)/,'attribute.name'],[/=/,'delimiter'],[/"/,'string','@double'],[/'/,'string','@single']],
      double:[[/"/,'string','@pop'],[/&[\w#]+;/,'string.escape'],[/[{}]/,'delimiter.bracket'],[/[^"&{}]+/,'string'],[/&/,'string']],
      single:[[/\'/,'string','@pop'],[/&[\w#]+;/,'string.escape'],[/[{}]/,'delimiter.bracket'],[/[^'&{}]+/,'string'],[/&/,'string']],
      comment:[[/-->/,'comment','@pop'],[/[^-]+/,'comment'],[/-/,'comment']],cdata:[[/\]\]>/,'string','@pop'],[/[^\]]+/,'string'],[/\]/,'string']],processing:[[/\?>/,'metatag','@pop'],[/[^?]+/,'metatag'],[/\?/,'metatag']]},
  }));
  items.push(monaco.languages.setLanguageConfiguration('xaml',{comments:{blockComment:['<!--','-->']},brackets:[['<','>'],['{','}']],autoClosingPairs:[{open:'"',close:'"'},{open:"'",close:"'"},{open:'{',close:'}'}],wordPattern:/[\w.:-]+/g}));
  return {dispose:()=>items.forEach(d=>d?.dispose?.())};
}

export function applyAdvancedTheme(monaco,ide) {
  const css=ide.root.ownerDocument.defaultView.getComputedStyle(ide.root),colors=ide.appearance.codeColors||{};
  const hex=(value,fallback)=>{value=String(value||'').trim();if(/^#[\da-f]{6}$/i.test(value))return value;const m=value.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);return m?'#'+m.slice(1,4).map(n=>(+n).toString(16).padStart(2,'0')).join(''):fallback;};
  const bg=hex(colors.background||css.getPropertyValue('--vb-window'),'#ffffff'),fg=hex(colors.text||css.getPropertyValue('--vb-window-text'),'#000000'),dark=parseInt(bg.slice(1,3),16)*.299+parseInt(bg.slice(3,5),16)*.587+parseInt(bg.slice(5,7),16)*.114<128;
  monaco.editor.defineTheme('vb6-advanced',{base:dark?'vs-dark':'vs',inherit:true,rules:[
    {token:'keyword',foreground:hex(colors.keyword||css.getPropertyValue('--vb-keyword'),dark?'#569cd6':'#000080').slice(1)},
    {token:'comment',foreground:hex(colors.comment||css.getPropertyValue('--vb-comment'),dark?'#6a9955':'#008000').slice(1)},
    {token:'type',foreground:dark?'4EC9B0':'267F99'},{token:'parameter',foreground:dark?'9CDCFE':'001080'},{token:'string',foreground:dark?'CE9178':'A31515'},
  ],colors:{'editor.background':bg,'editor.foreground':fg,'editor.selectionBackground':hex(colors.selection||css.getPropertyValue('--vb-selection'),dark?'#264f78':'#add6ff')}});
  monaco.editor.setTheme('vb6-advanced');
}
