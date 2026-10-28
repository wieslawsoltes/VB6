/** Native acceptance for the built-in XAML sample. Keep the authored form and
 * source sidecar intact; only append executable checks and a bounded entry. */
import {macOS26Example} from '../src/project/macos26-example.js';

export const MACOS26_NATIVE_SAMPLE_MARKER = 'NATIVE_MACOS26_SAMPLE_OK';

export function macOS26NativeSampleProject(input = macOS26Example()) {
  const project = structuredClone(input), form = project.modules.find(module => module.name === 'Form1');
  if (!form?.form) throw new Error('The macOS 26 native acceptance sample requires Form1.');
  project.name = 'NativeMacOS26Sample';
  project.startup = 'Sub Main';
  form.code += `
Private Sub Form_Load()
    Dim Button As Object
    Dim NotesHandle As Long
    Dim NotesText As String
    Debug.Assert LayoutMode.Buttons.Count = 3
    Debug.Assert Options.Buttons.Count = 3
    Debug.Assert Actions.Buttons.Count = 2
    Debug.Assert LayoutMode.MacOSControlStyle = "segmented"
    Debug.Assert Options.MacOSControlStyle = "segmented"
    Debug.Assert Actions.MacOSControlStyle = "segmented"
    For Each Button In LayoutMode.Buttons
        Debug.Assert Button.Style = 2
    Next
    For Each Button In Options.Buttons
        Debug.Assert Button.Style = 1
    Next
    For Each Button In Actions.Buttons
        Debug.Assert Button.Style = 0
        Debug.Assert Button.Value = 0
    Next
    Debug.Assert LayoutMode.Buttons("compact").Value = 0
    Debug.Assert LayoutMode.Buttons("comfortable").Value = 1
    Debug.Assert LayoutMode.Buttons("spacious").Value = 0
    Debug.Assert Options.Buttons("sidebar").Value = 1
    Debug.Assert Options.Buttons("inspector").Value = 1
    Debug.Assert Options.Buttons("preview").Value = 0

    LayoutMode.Buttons("compact").Value = 1
    Debug.Assert LayoutMode.Buttons("compact").Value = 1
    Debug.Assert LayoutMode.Buttons("comfortable").Value = 0
    Debug.Assert LayoutMode.Buttons("spacious").Value = 0
    LayoutMode.Buttons("spacious").Value = 1
    Debug.Assert LayoutMode.Buttons("compact").Value = 0
    Debug.Assert LayoutMode.Buttons("comfortable").Value = 0
    Debug.Assert LayoutMode.Buttons("spacious").Value = 1

    Options.Buttons("preview").Value = 1
    Debug.Assert Options.Buttons("sidebar").Value = 1
    Debug.Assert Options.Buttons("inspector").Value = 1
    Debug.Assert Options.Buttons("preview").Value = 1
    Options.Buttons("sidebar").Value = 0
    Debug.Assert Options.Buttons("sidebar").Value = 0
    Debug.Assert Options.Buttons("inspector").Value = 1
    Debug.Assert Options.Buttons("preview").Value = 1

    Debug.Assert Pages.Tabs = 2
    Debug.Assert Pages.Tab = 0
    Debug.Assert Pages.TabCaption(0) = "General"
    Debug.Assert Pages.TabCaption(1) = "Notes"
    Debug.Assert Pages.MacOSControlStyle = "segmented"
    Debug.Assert Search.MacOSControlStyle = "search"
    Debug.Assert Notifications.MacOSControlStyle = "switch"
    Debug.Assert Notifications.Value = 1
    Debug.Assert Notes.MultiLine <> 0
    Search.Text = "Native preferences"
    Notifications.Value = 0

    NotesHandle = Notes.hWnd
    NotesText = "Retained native notes" & vbLf & "Second line"
    Pages.Tab = 1
    Notes.Text = NotesText
    Notes.SelStart = 9
    Notes.SelLength = 6
    Debug.Assert Notes.SelText = "native"
    Pages.Tab = 0
    Debug.Assert Search.Text = "Native preferences"
    Debug.Assert Notifications.Value = 0
    Debug.Assert Notes.Text = NotesText
    Pages.Tab = 1
    Debug.Assert Notes.hWnd = NotesHandle
    Debug.Assert Notes.Text = NotesText
    Debug.Assert Notes.SelStart = 9
    Debug.Assert Notes.SelLength = 6
    Debug.Assert Notes.SelText = "native"
End Sub
`;
  project.modules.push({name:'Entry',kind:'module',code:`Option Explicit

Public Sub Main()
    Load Form1
    Unload Form1
    Debug.Print "${MACOS26_NATIVE_SAMPLE_MARKER}"
End Sub
`});
  return project;
}
