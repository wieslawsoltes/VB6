/** Physical-to-logical declaration mapping for native hidden-attribute placement.
 * This does not compile/evaluate source or conditional-compilation expressions.
 */
import {linesOf, lineBody, commentAt} from './native-text.js';

export const nativeAttributeKey = line =>
  line.match(/^\s*Attribute\s+([^=]+?)\s*=/i)?.[1].trim().toLowerCase();

const identifier = '(?:\\[([^\\]\\r\\n]+)\\]|([A-Za-z_]\\w*))';
const procedure = new RegExp('^\\s*(?:(?:Public|Private|Friend|Static)\\s+)*' +
  '(?:(Declare)\\s+(?:PtrSafe\\s+)?)?(Sub|Function|Property\\s+(?:Get|Let|Set)|Event)\\s+' + identifier, 'i');
const variable = new RegExp('^\\s*' + identifier);

function variableNames(text) {
  const match = text.match(/^\s*(?:Public|Private|Friend|Dim|Global|Static)\s+(?:(?:WithEvents|Const)\s+)?(.*)$/i);
  if (!match || /^(?:Type|Enum|Declare)\b/i.test(match[1])) return [];
  const parts = []; let start = 0, depth = 0, quoted = false;
  for (let i = 0; i < match[1].length; i++) {
    const ch = match[1][i];
    if (ch === '"') {
      if (quoted && match[1][i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) { parts.push(match[1].slice(start, i)); start = i + 1; }
    }
  }
  parts.push(match[1].slice(start));
  return parts.map(part => part.match(variable)).filter(Boolean).map(m => (m[1] || m[2]).toLowerCase());
}

export function nativeCodeStatements(text) {
  const result = [], conditions = [], counts = new Map();
  let raw = '', logical = '', inProcedure = false, inType = false;
  const finish = () => {
    const statement = {raw, text: logical, anchors: []};
    // Preserve distinct owners in conditional branches without executing #If.
    if (/^\s*#If\b/i.test(logical)) conditions.push(logical.trim().replace(/\s+/g, ' ').toLowerCase());
    else if (/^\s*#(?:ElseIf|Else)\b/i.test(logical) && conditions.length) {
      conditions[conditions.length - 1] += ' / ' + logical.trim().replace(/\s+/g, ' ').toLowerCase();
    } else if (/^\s*#End\s+If\b/i.test(logical)) conditions.pop();
    const anchor = (kind, name) => {
      const base = kind.toLowerCase().replace(/\s+/g, ' ') + ' ' + name;
      const context = base + ' [' + conditions.join(' > ') + ']';
      const n = counts.get(context) || 0; counts.set(context, n + 1);
      statement.anchors.push({key: context + ' #' + n, name, base});
    };
    const m = logical.match(procedure);
    if (m) {
      anchor((m[1] ? 'declare ' : '') + m[2], (m[3] || m[4]).toLowerCase());
      if (!m[1] && !/^event$/i.test(m[2])) inProcedure = true;
    } else if (/^\s*End\s+(?:Sub|Function|Property)\b/i.test(logical)) inProcedure = false;
    else if (/^\s*(?:(?:Public|Private)\s+)?(?:Type|Enum)\b/i.test(logical)) inType = true;
    else if (/^\s*End\s+(?:Type|Enum)\b/i.test(logical)) inType = false;
    else if (!inProcedure && !inType) for (const name of variableNames(logical)) anchor('declaration', name);
    result.push(statement); raw = ''; logical = '';
  };
  for (const line of linesOf(text)) {
    const body = lineBody(line), at = commentAt(body);
    const code = at < 0 ? body : body.slice(0, at);
    const comment = /^\s*(?:'|Rem(?:\s|$))/i.test(body);
    const continued = !comment && /[ \t]_[ \t]*$/.test(code);
    raw += line;
    logical += (continued ? code.replace(/[ \t]_[ \t]*$/, ' ') : code);
    if (!continued) finish();
  }
  if (raw) finish();
  return result;
}
