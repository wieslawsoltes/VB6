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
  Debug.Assert Err.Number = 453
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
  Debug.Print "LINUX_RICH_PERSISTENCE_OK"
End Sub`;
  return project;
}
