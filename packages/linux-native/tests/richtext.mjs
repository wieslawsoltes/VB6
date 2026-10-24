/** Reuse native selection parity, then exercise Linux RTF persistence in AOT VB. */
import {richTextProject} from '../../macos-native/tests/richtext.mjs';

export function linuxRichTextProject() {
  const project=richTextProject();project.name='LinuxRichText';
  const form=project.modules.find(module=>module.kind==='form');
  form.code=form.code.replace(/\nEnd Sub\s*$/,'\n  LinuxPersistence\nEnd Sub');
  form.code+=String.raw`

Private Sub LinuxPersistence()
  Dim document As String, original As String, chosen As Long
  Editor.TextRTF = "{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0 Arial;}{\f1\fcharset128 MS Gothic;}}{\colortbl;\red255\green0\blue0;}{\stylesheet{\s0\fs20 Normal;}{\s1\sbasedon0\b Heading;}}\s1 One\par\pard\plain\f1\'82\'a0\'82\'a2\f0\uc1\u-10179?\u-8704?}"
  Debug.Assert Editor.Text = "One" & vbLf & ChrW(&H3042) & ChrW(&H3044) & ChrW(-10179) & ChrW(-8704)
  Editor.SelStart = 0
  Editor.SelLength = 3
  Debug.Assert Editor.SelBold
  Debug.Assert Editor.SelFontSize = 10
  Editor.SelIndent = 360
  Editor.SelHangingIndent = 180
  Editor.SelRightIndent = 90
  Editor.SelAlignment = 2
  Editor.SelTabCount = 2
  Editor.SelTabs(0) = 600
  Editor.SelCharOffset = 20
  Editor.SelProtected = True
  Debug.Assert Editor.SelIndent = 360
  Debug.Assert Editor.SelHangingIndent = 180
  Debug.Assert Editor.SelRightIndent = 90
  Debug.Assert Editor.SelTabs(0) = 600
  Debug.Assert Editor.SelTabs(1) = 1440
  Debug.Assert Editor.SelCharOffset = 20
  Debug.Assert Editor.SelProtected
  document = Editor.TextRTF
  original = Editor.Text
  Editor.SaveFile "linux-richtext.rtf"
  Debug.Assert Not Editor.Modified
  Editor.Text = "replacement"
  Editor.LoadFile "linux-richtext.rtf"
  Debug.Assert Editor.Text = original
  Debug.Assert Editor.TextRTF = document
  Editor.SelStart = 0
  Editor.SelLength = 3
  Debug.Assert Editor.SelBold
  Debug.Assert Editor.SelAlignment = 2
  Debug.Assert Editor.SelProtected
  Debug.Assert Editor.SelCharOffset = 20
  On Error Resume Next
  Editor.TextRTF = "{\rtf1{\pict\pngblip 00}}"
  Debug.Assert Err.Number = 380
  Err.Clear
  Editor.SelRTF = "{\rtf1 malformed"
  Debug.Assert Err.Number = 380
  Err.Clear
  Editor.SelTabs(0) = 2000
  Debug.Assert Err.Number = 380
  Err.Clear
  Editor.SaveFile "linux-richtext.rtf", 99
  Debug.Assert Err.Number = 380
  Err.Clear
  On Error GoTo 0
  Debug.Assert Editor.TextRTF = document
  Debug.Assert Editor.SelStart = 0
  Debug.Assert Editor.SelLength = 3
  Editor.SelStart = 4
  Editor.SelLength = 2
  Editor.SelBullet = True
  Debug.Assert Editor.SelBullet
  chosen = Editor.Find(ChrW(-10179) & ChrW(-8704))
  Debug.Assert chosen = 6
  Debug.Assert Editor.SelStart = 6
  Debug.Assert Editor.SelLength = 2
  Editor.SelText = "word"
  Debug.Assert Editor.SelStart = 10
  Editor.SelStart = 0
  Editor.SelLength = 3
  Debug.Assert Editor.SelBold
  original = Editor.Text
  Editor.SaveFile "linux-richtext-plain.txt", 1
  Editor.Text = ""
  Editor.LoadFile "linux-richtext-plain.txt", 1
  Debug.Assert Editor.Text = original
  Editor.SelStart = 0
  Editor.SelLength = 3
  Debug.Assert Not Editor.SelBold
  Kill "linux-richtext.rtf"
  Kill "linux-richtext-plain.txt"
  LinuxStructuredRTF
  Debug.Print "LINUX_RICH_PERSISTENCE_OK"
End Sub

Private Sub LinuxStructuredRTF()
  Dim document As String, selected As String
  Editor.TextRTF = "{\rtf1 before{\pict\pngblip\picwgoal300\pichgoal300 89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082}after}"
  Debug.Assert Editor.Text = "before" & ChrW(-4) & "after"
  Editor.SelStart = 6
  Editor.SelLength = 1
  selected = Editor.SelRTF
  Editor.SelText = "image"
  Debug.Assert Editor.Text = "beforeimageafter"
  Editor.SelStart = 6
  Editor.SelLength = 5
  Editor.SelRTF = selected
  Debug.Assert Editor.Text = "before" & ChrW(-4) & "after"
  document = Editor.TextRTF
  Editor.SaveFile "linux-richtext-image.rtf"
  Editor.Text = ""
  Editor.LoadFile "linux-richtext-image.rtf"
  Debug.Assert Editor.TextRTF = document
  Kill "linux-richtext-image.rtf"
  Editor.TextRTF = "{\rtf1{\trowd\trgaph60\cellx1440\cellx2880\b Left\cell\b0 Right\cell\row}after}"
  Debug.Assert Editor.Text = ChrW(-4) & vbLf & "after"
  document = Editor.TextRTF
  Editor.Text = ""
  Editor.TextRTF = document
  Debug.Assert Editor.TextRTF = document
  Editor.TextRTF = "{\rtf1 before {\field\fldlock{\*\fldinst HYPERLINK ""https://example.org""}{\fldrslt\b example}} after}"
  Debug.Assert Editor.Text = "before example after"
  Editor.SelStart = 7
  Editor.SelLength = 7
  Debug.Assert Editor.SelBold
  selected = Editor.SelRTF
  Debug.Assert InStr(selected, "\fldinst") > 0
  Editor.Text = ""
  Editor.SelRTF = selected
  Debug.Assert Editor.Text = "example"
  Editor.TextRTF = "{\rtf1\sl480\slmult1\tqr\tx720\tqc\tx1440\tqdec\tx2160 one\tab two\tab 3.14}"
  Debug.Assert Editor.SelTabCount = 3
  document = Editor.TextRTF
  Editor.TextRTF = document
  Debug.Assert Editor.TextRTF = document
  Editor.TextRTF = "{\rtf1{\header\b Heading}body{\footnote note}{\object\objemb{\*\objclass Test.Class}{\*\objdata 0102}{\result cached}}}"
  document = Editor.TextRTF
  Editor.SaveFile "linux-richtext-objects.rtf"
  Editor.Text = ""
  Editor.LoadFile "linux-richtext-objects.rtf"
  Debug.Assert Editor.TextRTF = document
  Debug.Assert InStr(Editor.TextRTF, "cached") > 0
  Debug.Assert InStr(Editor.TextRTF, "\objdata 0102") > 0
  Kill "linux-richtext-objects.rtf"
  LinuxListRTF
  Debug.Print "LINUX_RICH_DOCUMENTS_OK"
End Sub

Private Sub LinuxListRTF()
  Dim header As String, document As String, selected As String, priorModified As Boolean
  header = "{\rtf1\deff0{\fonttbl{\f0 Sans;}{\f1 Serif;}}{\colortbl;\red255\green0\blue0;}{\*\listtable{\list\listhybrid{\listlevel\levelnfc1\levelstartat4\leveljc2{\leveltext\'02\'00.;}{\levelnumbers\'01;}\f1\fs28\b\cf1\li720\fi-360\tx720}{\listlevel\levelnfc0\levelstartat2\levellegal1{\leveltext\'04\'00.\'01);}{\levelnumbers\'01\'03;}\li1440\fi-360\tx1440}\listid11}}{\*\listoverridetable{\listoverride\listid11\listoverridecount0\ls1}}"
  Editor.TextRTF = header & "\ls1 First\par\ilvl1 Child\par\ilvl0 Second\par\ilvl1 Reset}"
  Debug.Assert Editor.Text = "First" & vbLf & "Child" & vbLf & "Second" & vbLf & "Reset"
  document = Editor.TextRTF
  Debug.Assert InStr(document, "\u73?\u86?\u46?") > 0
  Debug.Assert InStr(document, "\u52?\u46?\u50?\u41?") > 0
  Debug.Assert InStr(document, "\u53?\u46?\u50?\u41?") > 0
  Debug.Assert InStr(document, "\pnfs28") > 0
  Debug.Assert InStr(document, "\pnqr") > 0
  Editor.SelStart = 0
  Editor.SelLength = 5
  Debug.Assert Editor.SelIndent = 360
  Debug.Assert Editor.SelHangingIndent = 360
  selected = Editor.SelRTF
  Editor.SaveFile "linux-richtext-lists.rtf"
  Editor.Text = ""
  Editor.LoadFile "linux-richtext-lists.rtf"
  Debug.Assert Editor.TextRTF = document
  Kill "linux-richtext-lists.rtf"
  Editor.SelStart = 0
  Editor.SelLength = 5
  priorModified = Editor.Modified
  On Error Resume Next
  Editor.TextRTF = Replace(header, "\levelnfc1", "\levelnfc1\levelfollow1") & "\ls1 Rejected}"
  Debug.Assert Err.Number = 453
  Err.Clear
  Editor.SelRTF = header & "\ls1\ilvl8 Rejected}"
  Debug.Assert Err.Number = 380
  Err.Clear
  Editor.TextRTF = "{\rtf1{\fonttbl{\f0\fcharset2 Symbol;}}\f0\'e6}"
  Debug.Assert Err.Number = 453
  Err.Clear
  On Error GoTo 0
  Debug.Assert Editor.TextRTF = document
  Debug.Assert Editor.SelStart = 0
  Debug.Assert Editor.SelLength = 5
  Debug.Assert Editor.Modified = priorModified
  Editor.Text = ""
  Editor.SelRTF = selected
  Debug.Assert Editor.Text = "First"
  Debug.Assert InStr(Editor.TextRTF, "\u73?\u86?\u46?") > 0
  Editor.TextRTF = "{\rtf1{\fonttbl{\f0\fcharset2 Symbol;}}\f0 ABab\'b7\'a5\'e5\\\u92?}"
  Debug.Assert Editor.Text = ChrW(&H391) & ChrW(&H392) & ChrW(&H3B1) & ChrW(&H3B2) & ChrW(&H2022) & ChrW(&H221E) & ChrW(&H2211) & ChrW(&H2234) & "\"
  document = Editor.TextRTF
  Editor.TextRTF = document
  Debug.Assert Editor.TextRTF = document
  Debug.Print "LINUX_RICH_LISTS_OK"
End Sub`;
  return project;
}
