/**
 * Pascal operations expressed in the shared compiler's source language.
 *
 * These procedures are compiled by the same frontend as the surrounding
 * application. They need neither JavaScript eval nor a Pascal interpreter, and
 * are consequently available to the browser VM and every native AOT backend.
 *
 * Semantic references: Borland, Turbo Pascal 7.0 Language Guide, chapters 4–7;
 * Programmer's Reference, System routines and compiler directives.
 * https://turbopascal.nl/docs/Turbo_Pascal_Version_7.0_Language_Guide_1992.pdf
 * https://turbopascal.nl/docs/Turbo_Pascal_Version_7.0_Programmers_Reference_1992.pdf
 */

export const PASCAL_ORDINAL_TYPES = Object.freeze({
  shortint: Object.freeze({bits: 8, signed: true, min: -128, max: 127, storage: 'Integer'}),
  byte: Object.freeze({bits: 8, signed: false, min: 0, max: 255, storage: 'Byte'}),
  integer: Object.freeze({bits: 16, signed: true, min: -32768, max: 32767, storage: 'Integer'}),
  word: Object.freeze({bits: 16, signed: false, min: 0, max: 65535, storage: 'Long'}),
  longint: Object.freeze({bits: 32, signed: true, min: -2147483648, max: 2147483647, storage: 'Long'}),
  boolean: Object.freeze({bits: 8, signed: false, min: 0, max: 1, storage: 'Boolean'}),
  char: Object.freeze({bits: 8, signed: false, min: 0, max: 255, storage: 'String'}),
});

export const PASCAL_REAL48 = Object.freeze({bytes: 6, significandBits: 40, exponentBias: 129,
  minimumExponent: -128, maximumExponent: 126, storage: 'Double', coercion: '__PascalReal48'});

/** Set values use 32 byte-valued UTF-16 code units, not Unicode/ANSI conversion.
 * The empty VB String is accepted as an uninitialized empty Pascal set. The
 * representation is a value: ordinary String assignment and ByVal parameters
 * retain Pascal set copy semantics without sharing mutable JavaScript objects.
 */
export const PASCAL_SET_LAYOUT = Object.freeze({min: 0, max: 255, bytes: 32, bitsPerByte: 8, storage: 'String'});

const helpers = new Map();
const aliases = new Map();

function define(id, suffix, source, dependencies = []) {
  const helper = Object.freeze({id, name: '__Pascal' + suffix, source: source.trim(), dependencies: Object.freeze([...dependencies])});
  helpers.set(id.toLowerCase(), helper);
  aliases.set(helper.name.toLowerCase(), id.toLowerCase());
  return helper;
}

define('ord', 'Ord', `
Private Function __PascalOrd(ByVal value As Variant) As Long
  Select Case VarType(value)
    Case 8
      If Len(value) <> 1 Then Err.Raise 201, "Turbo Pascal", "Ordinal character requires exactly one byte"
      __PascalOrd = AscW(CStr(value))
      If __PascalOrd < 0 Or __PascalOrd > 255 Then Err.Raise 201, "Turbo Pascal", "Character ordinal out of range"
    Case 11
      If value Then __PascalOrd = 1 Else __PascalOrd = 0
    Case Else
      __PascalOrd = CLng(value)
  End Select
End Function`);

define('chr', 'Chr', `
Private Function __PascalChr(ByVal value As Long) As String
  If value < 0 Or value > 255 Then Err.Raise 201, "Turbo Pascal", "Character ordinal out of range"
  __PascalChr = ChrW(value)
End Function`);

define('upCase', 'UpCase', `
Private Function __PascalUpCase(ByVal value As String) As String
  Dim ordinal As Long
  ordinal = __PascalOrd(value)
  If ordinal >= 97 And ordinal <= 122 Then ordinal = ordinal - 32
  __PascalUpCase = ChrW(ordinal)
End Function`, ['ord']);

define('shortString', 'ShortString', `
Private Function __PascalShortString(ByVal value As String, ByVal capacity As Long) As String
  If capacity < 0 Or capacity > 255 Then Err.Raise 201, "Turbo Pascal", "ShortString capacity out of range"
  __PascalShortString = Left$(value, capacity)
End Function`);

define('stringGet', 'StringGet', `
Private Function __PascalStringGet(ByVal value As String, ByVal index As Long) As String
  If index = 0 Then
    __PascalStringGet = __PascalChr(Len(value))
  Else
    If index < 1 Or index > Len(value) Then Err.Raise 201, "Turbo Pascal", "String index out of range"
    __PascalStringGet = Mid$(value, index, 1)
  End If
End Function`, ['chr']);

// Visible-value String storage does not retain bytes beyond its current length.
// The lowering frontend must diagnose physical tail access rather than treating
// this helper as a byte-addressable ShortString memory descriptor.
define('stringSet', 'StringSet', `
Private Sub __PascalStringSet(ByRef value As String, ByVal index As Long, ByVal character As String, Optional ByVal capacity As Long = 255)
  Dim ordinal As Long
  ordinal = __PascalOrd(character)
  If capacity < 0 Or capacity > 255 Then Err.Raise 201, "Turbo Pascal", "ShortString capacity out of range"
  If index = 0 Then
    If ordinal > capacity Then Err.Raise 201, "Turbo Pascal", "String length out of range"
    If ordinal > Len(value) Then value = value & String$(ordinal - Len(value), ChrW(0))
    value = Left$(value, ordinal)
  Else
    If index < 1 Or index > Len(value) Or index > capacity Then Err.Raise 201, "Turbo Pascal", "String index out of range"
    Mid$(value, index, 1) = character
  End If
End Sub`, ['ord']);

define('copy', 'Copy', `
Private Function __PascalCopy(ByVal value As String, ByVal index As Long, ByVal count As Long) As String
  If count <= 0 Or index > Len(value) Then Exit Function
  If index < 1 Then index = 1
  __PascalCopy = Mid$(value, index, count)
End Function`);

define('pos', 'Pos', `
Private Function __PascalPos(ByVal needle As String, ByVal value As String) As Long
  If Len(needle) = 0 Then Exit Function
  __PascalPos = InStr(1, value, needle, 0)
End Function`);

define('insert', 'Insert', `
Private Sub __PascalInsert(ByVal source As String, ByRef target As String, ByVal index As Long, Optional ByVal capacity As Long = 255)
  If index < 1 Then index = 1
  If index > Len(target) + 1 Then index = Len(target) + 1
  target = __PascalShortString(Left$(target, index - 1) & source & Mid$(target, index), capacity)
End Sub`, ['shortString']);

define('delete', 'Delete', `
Private Sub __PascalDelete(ByRef value As String, ByVal index As Long, ByVal count As Long)
  If index < 1 Or index > Len(value) Or count <= 0 Then Exit Sub
  If count >= Len(value) - index + 1 Then
    value = Left$(value, index - 1)
  Else
    value = Left$(value, index - 1) & Mid$(value, index + count)
  End If
End Sub`);

define('ordinal', 'Ordinal', `
Private Function __PascalOrdinal(ByVal value As Double, ByVal bits As Long, ByVal isSigned As Boolean, Optional ByVal checked As Boolean = False) As Long
  Dim modulus As Double, lowerBound As Double, upperBound As Double, result As Double
  If bits <> 8 And bits <> 16 And bits <> 32 Then Err.Raise 201, "Turbo Pascal", "Invalid ordinal width"
  If bits = 32 And Not isSigned Then Err.Raise 201, "Turbo Pascal", "Turbo Pascal has no unsigned 32-bit ordinal"
  modulus = 2 ^ bits
  lowerBound = 0
  upperBound = modulus - 1
  If isSigned Then
    lowerBound = -(modulus / 2)
    upperBound = modulus / 2 - 1
  End If
  value = Fix(value)
  If checked Then
    If value < lowerBound Or value > upperBound Then Err.Raise 201, "Turbo Pascal", "Ordinal range check failed"
  End If
  result = value - Int(value / modulus) * modulus
  If isSigned And result >= modulus / 2 Then result = result - modulus
  __PascalOrdinal = CLng(result)
End Function`);

define('trunc', 'Trunc', `
Private Function __PascalTrunc(ByVal value As Double) As Long
  value = Fix(value)
  If value < -2147483648# Or value > 2147483647# Then Err.Raise 207, "Turbo Pascal", "Invalid floating point conversion"
  __PascalTrunc = CLng(value)
End Function`);

define('round', 'Round', `
Private Function __PascalRound(ByVal value As Double) As Long
  If value < 0 Then
    value = -Int(-value + 0.5)
  Else
    value = Int(value + 0.5)
  End If
  __PascalRound = __PascalTrunc(value)
End Function`, ['trunc']);

define('frac', 'Frac', `
Private Function __PascalFrac(ByVal value As Double) As Double
  __PascalFrac = value - Fix(value)
End Function`);

/** A Double carries every Real48 value exactly. Quantize at Pascal storage and
 * software-arithmetic boundaries; this does not claim a six-byte VB ABI layout.
 */
define('real48', 'Real48', `
Private Function __PascalReal48(ByVal value As Double) As Double
  Dim magnitude As Double, exponent As Long, scale As Double, significand As Double
  If value <> value Then Err.Raise 205, "Turbo Pascal", "Real48 cannot store NaN"
  magnitude = Abs(value)
  If magnitude < 2 ^ (-128) Then Exit Function
  If magnitude >= 2 ^ 127 Then Err.Raise 205, "Turbo Pascal", "Real48 overflow"
  exponent = CLng(Int(Log(magnitude) / Log(2)))
  scale = 2 ^ exponent
  significand = magnitude / scale
  If significand < 1 Then
    significand = significand * 2
    exponent = exponent - 1
    scale = scale / 2
  ElseIf significand >= 2 Then
    significand = significand / 2
    exponent = exponent + 1
    scale = scale * 2
  End If
  significand = Int(significand * 549755813888# + 0.5) / 549755813888#
  If significand >= 2 Then
    significand = 1
    exponent = exponent + 1
    scale = scale * 2
  End If
  If exponent > 126 Then Err.Raise 205, "Turbo Pascal", "Real48 overflow"
  __PascalReal48 = significand * scale
  If value < 0 Then __PascalReal48 = -__PascalReal48
End Function`);

define('valInteger', 'ValInteger', `
Private Sub __PascalValInteger(ByVal text As String, ByRef target As Long, ByRef code As Long)
  Dim index As Long, firstDigit As Long, base As Long, sign As Long, digit As Long, character As Long
  Dim value As Double, limit As Double
  code = 0
  index = 1
  sign = 1
  base = 10
  Do While index <= Len(text)
    character = AscW(Mid$(text, index, 1))
    If character <> 32 And character <> 9 Then Exit Do
    index = index + 1
  Loop
  If index <= Len(text) Then
    character = AscW(Mid$(text, index, 1))
    If character = 43 Or character = 45 Then
      If character = 45 Then sign = -1
      index = index + 1
    End If
  End If
  If Mid$(text, index, 1) = "$" Then
    base = 16
    index = index + 1
  End If
  firstDigit = index
  limit = 2147483647#
  If sign < 0 Then limit = 2147483648#
  If base = 16 Then limit = 4294967295#
  If index > Len(text) Then
    code = index
    Exit Sub
  End If
  For index = firstDigit To Len(text)
    character = AscW(Mid$(text, index, 1))
    digit = -1
    If character >= 48 And character <= 57 Then digit = character - 48
    If base = 16 Then
      If character >= 65 And character <= 70 Then digit = character - 55
      If character >= 97 And character <= 102 Then digit = character - 87
    End If
    If digit < 0 Or digit >= base Then
      code = index
      Exit Sub
    End If
    value = value * base + digit
    If value > limit Then
      code = index
      Exit Sub
    End If
  Next index
  target = __PascalOrdinal(value * sign, 32, True)
End Sub`, ['ordinal']);

define('valReal', 'ValReal', `
Private Sub __PascalValReal(ByVal text As String, ByRef target As Double, ByRef code As Long, Optional ByVal typeTag As String = "real")
  Dim index As Long, digits As Long, character As Long, exponentDigits As Long, value As Double
  code = 0
  index = 1
  Do While index <= Len(text)
    character = AscW(Mid$(text, index, 1))
    If character <> 32 And character <> 9 Then Exit Do
    index = index + 1
  Loop
  If Mid$(text, index, 1) = "+" Or Mid$(text, index, 1) = "-" Then index = index + 1
  Do While index <= Len(text)
    character = AscW(Mid$(text, index, 1))
    If character < 48 Or character > 57 Then Exit Do
    digits = digits + 1
    index = index + 1
  Loop
  If Mid$(text, index, 1) = "." Then
    index = index + 1
    Do While index <= Len(text)
      character = AscW(Mid$(text, index, 1))
      If character < 48 Or character > 57 Then Exit Do
      digits = digits + 1
      index = index + 1
    Loop
  End If
  If digits = 0 Then
    code = index
    Exit Sub
  End If
  If Mid$(text, index, 1) = "e" Or Mid$(text, index, 1) = "E" Then
    index = index + 1
    If Mid$(text, index, 1) = "+" Or Mid$(text, index, 1) = "-" Then index = index + 1
    Do While index <= Len(text)
      character = AscW(Mid$(text, index, 1))
      If character < 48 Or character > 57 Then Exit Do
      exponentDigits = exponentDigits + 1
      index = index + 1
    Loop
    If exponentDigits = 0 Then
      code = index
      Exit Sub
    End If
  End If
  If index <= Len(text) Then
    code = index
    Exit Sub
  End If
  On Error GoTo ConversionError
  value = CDbl(text)
  If LCase$(typeTag) = "real" Or LCase$(typeTag) = "real87" Then value = __PascalReal48(value)
  If value <> value Or Abs(value) > 1.7976931348623157E+308 Then GoTo ConversionError
  target = value
  Exit Sub
ConversionError:
  code = Len(text)
  If code = 0 Then code = 1
  Err.Clear
End Sub`, ['real48']);

define('div', 'Div', `
Private Function __PascalDiv(ByVal leftValue As Double, ByVal rightValue As Double) As Long
  Dim quotient As Double
  leftValue = Fix(leftValue)
  rightValue = Fix(rightValue)
  If rightValue = 0 Then Err.Raise 200, "Turbo Pascal", "Division by zero"
  quotient = Fix(leftValue / rightValue)
  If quotient < -2147483648# Or quotient > 2147483647# Then Err.Raise 200, "Turbo Pascal", "Integer division overflow"
  __PascalDiv = CLng(quotient)
End Function`);

define('mod', 'Mod', `
Private Function __PascalMod(ByVal leftValue As Double, ByVal rightValue As Double) As Long
  leftValue = Fix(leftValue)
  rightValue = Fix(rightValue)
  If rightValue = 0 Then Err.Raise 200, "Turbo Pascal", "Division by zero"
  __PascalMod = CLng(leftValue - Fix(leftValue / rightValue) * rightValue)
End Function`);

for (const [id, suffix, operator] of [['intAdd', 'IntAdd', '+'], ['intSub', 'IntSub', '-']]) {
  define(id, suffix, `
Private Function __Pascal${suffix}(ByVal leftValue As Long, ByVal rightValue As Long, Optional ByVal bits As Long = 16, Optional ByVal checked As Boolean = False) As Long
  Dim result As Double, limit As Double
  result = CDbl(leftValue) ${operator} CDbl(rightValue)
  If checked Then
    limit = 2 ^ (bits - 1)
    If result < -limit Or result >= limit Then Err.Raise 215, "Turbo Pascal", "Integer overflow"
  End If
  __Pascal${suffix} = __PascalOrdinal(result, bits, True)
End Function`, ['ordinal']);
}

define('intMul', 'IntMul', `
Private Function __PascalIntMul(ByVal leftValue As Long, ByVal rightValue As Long, Optional ByVal bits As Long = 16, Optional ByVal checked As Boolean = False) As Long
  Dim a As Double, b As Double, lowA As Double, lowB As Double, highA As Double, highB As Double, cross As Double, result As Double, limit As Double
  If checked Then
    result = CDbl(leftValue) * CDbl(rightValue)
    limit = 2 ^ (bits - 1)
    If result < -limit Or result >= limit Then Err.Raise 215, "Turbo Pascal", "Integer overflow"
    __PascalIntMul = CLng(result)
    Exit Function
  End If
  a = CDbl(leftValue)
  b = CDbl(rightValue)
  If a < 0 Then a = a + 4294967296#
  If b < 0 Then b = b + 4294967296#
  highA = Int(a / 65536#)
  highB = Int(b / 65536#)
  lowA = a - highA * 65536#
  lowB = b - highB * 65536#
  cross = highA * lowB + lowA * highB
  cross = cross - Int(cross / 65536#) * 65536#
  result = lowA * lowB + cross * 65536#
  __PascalIntMul = __PascalOrdinal(result, bits, True)
End Function`, ['ordinal']);

// Word expressions retain unsigned 16-bit results. Double arithmetic is exact
// for the sum, difference and product of the two bounded Word operands.
for (const [id, suffix, operator] of [['wordAdd', 'WordAdd', '+'], ['wordSub', 'WordSub', '-'], ['wordMul', 'WordMul', '*']]) {
  define(id, suffix, `
Private Function __Pascal${suffix}(ByVal leftValue As Long, ByVal rightValue As Long, Optional ByVal checked As Boolean = False) As Long
  Dim result As Double
  result = CDbl(leftValue) ${operator} CDbl(rightValue)
  If checked Then
    If result < 0 Or result > 65535# Then Err.Raise 215, "Turbo Pascal", "Word overflow"
  End If
  __Pascal${suffix} = __PascalOrdinal(result, 16, False, False)
End Function`, ['ordinal']);
}

define('shiftLeft', 'ShiftLeft', `
Private Function __PascalShiftLeft(ByVal value As Long, ByVal count As Long, Optional ByVal width As Long = 16, Optional ByVal isSigned As Boolean = True) As Long
  Dim result As Double, modulus As Double, i As Long
  If width <> 8 And width <> 16 And width <> 32 Then Err.Raise 201, "Turbo Pascal", "Invalid shift width"
  If count < 0 Then Err.Raise 201, "Turbo Pascal", "Negative shift count"
  If count >= width Then Exit Function
  modulus = 2 ^ width
  result = CDbl(value) - Int(CDbl(value) / modulus) * modulus
  For i = 1 To count
    result = result * 2
    If result >= modulus Then result = result - modulus
  Next i
  __PascalShiftLeft = __PascalOrdinal(result, width, isSigned)
End Function`, ['ordinal']);

define('shiftRight', 'ShiftRight', `
Private Function __PascalShiftRight(ByVal value As Long, ByVal count As Long, Optional ByVal width As Long = 16, Optional ByVal isSigned As Boolean = True) As Long
  Dim result As Double, modulus As Double
  If width <> 8 And width <> 16 And width <> 32 Then Err.Raise 201, "Turbo Pascal", "Invalid shift width"
  If count < 0 Then Err.Raise 201, "Turbo Pascal", "Negative shift count"
  If count >= width Then Exit Function
  modulus = 2 ^ width
  result = CDbl(value) - Int(CDbl(value) / modulus) * modulus
  result = Int(result / (2 ^ count))
  __PascalShiftRight = __PascalOrdinal(result, width, isSigned)
End Function`, ['ordinal']);

define('setEmpty', 'SetEmpty', `
Private Function __PascalSetEmpty() As String
  __PascalSetEmpty = String$(32, ChrW(0))
End Function`);

define('setNormalize', 'SetNormalize', `
Private Function __PascalSetNormalize(ByVal value As String) As String
  __PascalSetNormalize = Left$(value & String$(32, ChrW(0)), 32)
End Function`);

define('setContains', 'SetContains', `
Private Function __PascalSetContains(ByVal value As String, ByVal ordinal As Long) As Boolean
  Dim index As Long, mask As Long
  If ordinal < 0 Or ordinal > 255 Then Exit Function
  index = ordinal \\ 8 + 1
  If index > Len(value) Then Exit Function
  mask = CLng(2 ^ (ordinal Mod 8))
  __PascalSetContains = (AscW(Mid$(value, index, 1)) And mask) <> 0
End Function`);

for (const [id, suffix, operator] of [['setInclude', 'SetInclude', 'Or mask'], ['setExclude', 'SetExclude', 'And (255 Xor mask)']]) {
  define(id, suffix, `
Private Sub __Pascal${suffix}(ByRef value As String, ByVal ordinal As Long)
  Dim index As Long, mask As Long
  If ordinal < 0 Or ordinal > 255 Then Err.Raise 201, "Turbo Pascal", "Set ordinal out of range"
  value = __PascalSetNormalize(value)
  index = ordinal \\ 8 + 1
  mask = CLng(2 ^ (ordinal Mod 8))
  Mid$(value, index, 1) = ChrW(AscW(Mid$(value, index, 1)) ${operator})
End Sub`, ['setNormalize']);
}

for (const [id, suffix, dependency, operation] of [['setWith', 'SetWith', 'setInclude', 'SetInclude'], ['setWithout', 'SetWithout', 'setExclude', 'SetExclude']]) {
  define(id, suffix, `
Private Function __Pascal${suffix}(ByVal value As String, ByVal ordinal As Long) As String
  Call __Pascal${operation}(value, ordinal)
  __Pascal${suffix} = value
End Function`, [dependency]);
}

define('setRange', 'SetRange', `
Private Function __PascalSetRange(ByVal first As Long, ByVal last As Long) As String
  Dim value As String, firstByte As Long, lastByte As Long, index As Long, firstBit As Long, lastBit As Long, mask As Long
  value = __PascalSetEmpty()
  If first <= last Then
    If first < 0 Or last > 255 Then Err.Raise 201, "Turbo Pascal", "Set range out of bounds"
    firstByte = first \\ 8 + 1
    lastByte = last \\ 8 + 1
    For index = firstByte To lastByte
      firstBit = 0
      lastBit = 7
      If index = firstByte Then firstBit = first Mod 8
      If index = lastByte Then lastBit = last Mod 8
      mask = CLng(2 ^ (lastBit + 1) - 2 ^ firstBit)
      Mid$(value, index, 1) = ChrW(mask)
    Next index
  End If
  __PascalSetRange = value
End Function`, ['setEmpty']);

for (const [id, suffix, operator] of [
  ['setUnion', 'SetUnion', 'a Or b'],
  ['setIntersect', 'SetIntersect', 'a And b'],
  ['setDifference', 'SetDifference', 'a And (255 Xor b)'],
  ['setSymmetricDifference', 'SetSymmetricDifference', 'a Xor b'],
]) {
  define(id, suffix, `
Private Function __Pascal${suffix}(ByVal leftValue As String, ByVal rightValue As String) As String
  Dim value As String, index As Long, a As Long, b As Long
  leftValue = __PascalSetNormalize(leftValue)
  rightValue = __PascalSetNormalize(rightValue)
  value = __PascalSetEmpty()
  For index = 1 To 32
    a = AscW(Mid$(leftValue, index, 1))
    b = AscW(Mid$(rightValue, index, 1))
    Mid$(value, index, 1) = ChrW(${operator})
  Next index
  __Pascal${suffix} = value
End Function`, ['setNormalize', 'setEmpty']);
}

define('setEqual', 'SetEqual', `
Private Function __PascalSetEqual(ByVal leftValue As String, ByVal rightValue As String) As Boolean
  __PascalSetEqual = StrComp(__PascalSetNormalize(leftValue), __PascalSetNormalize(rightValue), 0) = 0
End Function`, ['setNormalize']);

define('setSubset', 'SetSubset', `
Private Function __PascalSetSubset(ByVal leftValue As String, ByVal rightValue As String) As Boolean
  Dim index As Long, a As Long, b As Long
  leftValue = __PascalSetNormalize(leftValue)
  rightValue = __PascalSetNormalize(rightValue)
  For index = 1 To 32
    a = AscW(Mid$(leftValue, index, 1))
    b = AscW(Mid$(rightValue, index, 1))
    If (a And (255 Xor b)) <> 0 Then Exit Function
  Next index
  __PascalSetSubset = True
End Function`, ['setNormalize']);

define('setCount', 'SetCount', `
Private Function __PascalSetCount(ByVal value As String) As Long
  Dim index As Long, bits As Long, count As Long
  For index = 1 To Len(value)
    bits = AscW(Mid$(value, index, 1)) And 255
    Do While bits <> 0
      bits = bits And (bits - 1)
      count = count + 1
    Loop
  Next index
  __PascalSetCount = count
End Function`);

define('unsignedDecimal', 'UnsignedDecimal', `
Private Function __PascalUnsignedDecimal(ByVal value As Double) As String
  Dim quotient As Double, digit As Long, result As String
  value = Fix(value)
  If value = 0 Then
    __PascalUnsignedDecimal = "0"
    Exit Function
  End If
  If value < 0 Or value > 1000000000000# Then Err.Raise 207, "Turbo Pascal", "Invalid decimal conversion"
  Do While value >= 1
    quotient = Fix(value / 10)
    digit = CLng(value - quotient * 10)
    result = ChrW(48 + digit) & result
    value = quotient
  Loop
  __PascalUnsignedDecimal = result
End Function`);

define('formatReal', 'FormatReal', `
Private Function __PascalFormatReal(ByVal value As Double, Optional ByVal width As Long = -1, Optional ByVal precision As Long = -1, Optional ByVal coprocessor As Boolean = False) As String
  Dim result As String, pattern As String, mantissa As String, exponentText As String, signText As String, exponentSign As String
  Dim normalized As Double, scale As Double, rounded As Double
  Dim exponent As Long, decimals As Long, exponentDigits As Long
  If value <> value Then Err.Raise 207, "Turbo Pascal", "Invalid floating point value"
  If Abs(value) > 1.7976931348623157E+308 Then Err.Raise 205, "Turbo Pascal", "Floating point overflow"
  If precision >= 0 Then
    If precision > 11 Then precision = 11
    pattern = "0"
    If precision > 0 Then pattern = pattern & "." & String$(precision, "0")
    result = Replace$(Format$(value, pattern), ",", ".")
  Else
    exponentDigits = 2
    If coprocessor Then exponentDigits = 4
    If width < 0 Then width = 17
    If width < exponentDigits + 6 Then width = exponentDigits + 6
    decimals = width - exponentDigits - 5
    If decimals > 10 Then decimals = 10
    normalized = Abs(value)
    If normalized <> 0 Then
      Do While normalized >= 10
        normalized = normalized / 10
        exponent = exponent + 1
      Loop
      Do While normalized < 1
        normalized = normalized * 10
        exponent = exponent - 1
      Loop
    End If
    scale = 10 ^ decimals
    rounded = Int(normalized * scale + 0.5)
    If rounded >= scale * 10 Then
      rounded = scale
      exponent = exponent + 1
    End If
    mantissa = __PascalUnsignedDecimal(rounded)
    If Len(mantissa) < decimals + 1 Then mantissa = String$(decimals + 1 - Len(mantissa), "0") & mantissa
    exponentText = __PascalUnsignedDecimal(Abs(exponent))
    If Len(exponentText) < exponentDigits Then exponentText = String$(exponentDigits - Len(exponentText), "0") & exponentText
    signText = " "
    If value < 0 Then signText = "-"
    exponentSign = "+"
    If exponent < 0 Then exponentSign = "-"
    result = signText & Left$(mantissa, 1) & "." & Mid$(mantissa, 2) & "E" & exponentSign & exponentText
  End If
  If width > Len(result) Then result = Space$(width - Len(result)) & result
  __PascalFormatReal = result
End Function`, ['unsignedDecimal']);

/** Formatting is one expression per argument, so the frontend can concatenate
 * results before printing without VB's comma/semicolon spacing semantics.
 * Explicit type tags preserve Pascal Boolean and real behavior through Variant
 * boxing. Field width is a minimum, never a truncation limit.
 */
define('format', 'Format', `
Private Function __PascalFormat(ByVal value As Variant, Optional ByVal width As Long = -1, Optional ByVal precision As Long = -1, Optional ByVal typeTag As String = "") As String
  Dim result As String, tag As String, realValue As Boolean, coprocessor As Boolean
  tag = LCase$(typeTag)
  realValue = tag = "real" Or tag = "real87" Or tag = "single" Or tag = "double" Or tag = "extended" Or tag = "comp"
  coprocessor = tag = "real87" Or tag = "single" Or tag = "double" Or tag = "extended" Or tag = "comp"
  If tag = "boolean" Or VarType(value) = 11 Then
    If value Then result = "TRUE" Else result = "FALSE"
  ElseIf tag = "char" Or tag = "string" Or VarType(value) = 8 Then
    result = CStr(value)
  ElseIf precision >= 0 Or realValue Then
    result = __PascalFormatReal(CDbl(value), width, precision, coprocessor)
  Else
    result = CStr(value)
  End If
  If width > Len(result) Then result = Space$(width - Len(result)) & result
  __PascalFormat = result
End Function`, ['formatReal']);

// Conventional source spellings are accepted alongside the canonical IDs.
for (const [alias, canonical] of Object.entries({
  shl: 'shiftLeft', shr: 'shiftRight', integerDivide: 'div', modulo: 'mod',
  setIntersection: 'setIntersect', setEquals: 'setEqual', setMember: 'setContains',
})) aliases.set(alias.toLowerCase(), canonical.toLowerCase());

/** Resolve a helper by canonical ID or its emitted procedure name. */
export function getPascalHelper(name) {
  const key = String(name).toLowerCase();
  const helper = helpers.get(aliases.get(key) ?? key);
  if (!helper) throw new RangeError(`Unknown Turbo Pascal runtime helper: ${name}`);
  return helper;
}

/** Deterministic dependency order; a helper is emitted only once per module. */
export function getPascalRuntimeHelpers(names = []) {
  const requested = typeof names === 'string' ? [names] : names;
  const resolved = [], visited = new Set();
  function visit(name) {
    const helper = getPascalHelper(name);
    if (visited.has(helper.id)) return;
    visited.add(helper.id);
    for (const dependency of helper.dependencies) visit(dependency);
    resolved.push(helper);
  }
  for (const name of requested) visit(name);
  return resolved;
}

export function getPascalRuntimeSource(names = []) {
  return getPascalRuntimeHelpers(names).map(helper => helper.source).join('\n\n');
}

export const PASCAL_RUNTIME_HELPERS = Object.freeze([...helpers.values()]);
