import {newProject} from './model.js';
import {compileFormXaml} from '../xaml/forms.js';
import {formStamp} from '../xaml/contract.js';

/** An editable application sample using the same Mac vocabulary, collections
 * and event procedures as the designer, browser and native compiler. */
export const MACOS26_PREFERENCES_XAML = `<mac:Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:mac="urn:vb6:macos26"
    x:Name="Form1" Title="macOS 26 Preferences" Width="780" Height="530"
    FontFamily="system-ui" FontSize="13">
  <mac:Window.Resources>
    <Style TargetType="mac:Label"><Setter Property="FontFamily" Value="system-ui"/><Setter Property="FontSize" Value="13"/></Style>
    <Style TargetType="mac:SegmentedControl"><Setter Property="FontFamily" Value="system-ui"/><Setter Property="FontSize" Value="13"/></Style>
    <Style TargetType="mac:TabView"><Setter Property="FontFamily" Value="system-ui"/><Setter Property="FontSize" Value="13"/></Style>
    <Style TargetType="mac:SearchField"><Setter Property="FontFamily" Value="system-ui"/><Setter Property="FontSize" Value="13"/></Style>
    <Style TargetType="mac:Switch"><Setter Property="FontFamily" Value="system-ui"/><Setter Property="FontSize" Value="13"/></Style>
    <Style TargetType="mac:TextEditor"><Setter Property="FontFamily" Value="system-ui"/><Setter Property="FontSize" Value="13"/></Style>
    <Style TargetType="mac:Button"><Setter Property="FontFamily" Value="system-ui"/><Setter Property="FontSize" Value="13"/></Style>
  </mac:Window.Resources>
  <mac:View Width="780" Height="530">
    <mac:Label x:Name="Heading" Text="Make it yours" mac:Canvas.Left="24" mac:Canvas.Top="20"
        Width="732" Height="32" FontSize="24" Foreground="{ThemeResource macOS.labelColor}"/>
    <mac:Label x:Name="Introduction" Text="Choose a layout, select options and try the native controls."
        mac:Canvas.Left="24" mac:Canvas.Top="62" Width="732" Height="24"
        Foreground="{ThemeResource macOS.secondaryLabelColor}"/>
    <mac:Label Text="Layout" mac:Canvas.Left="24" mac:Canvas.Top="110" Width="350" Height="24"/>
    \u003c!-- Each segment is a real Toolbar button, passed to the VB ButtonClick handler. -->
    <mac:SegmentedControl x:Name="LayoutMode" mac:Canvas.Left="24" mac:Canvas.Top="142"
        Width="350" Height="32" ControlSize="large" SelectionMode="Single" SelectedIndex="1"
        Action="LayoutMode_ButtonClick" mac:Accessibility.Label="Layout density">
      <mac:Segment Key="compact" Title="Compact"/>
      <mac:Segment Key="comfortable" Title="Comfortable"/>
      <mac:Segment Key="spacious" Title="Spacious"/>
    </mac:SegmentedControl>
    <mac:Label Text="Show in the workspace" mac:Canvas.Left="24" mac:Canvas.Top="206" Width="350" Height="24"/>
    <mac:SegmentedControl x:Name="Options" mac:Canvas.Left="24" mac:Canvas.Top="238"
        Width="350" Height="32" ControlSize="large" SelectionMode="Multiple"
        Action="Options_ButtonClick" mac:Accessibility.Label="Workspace options">
      <mac:Segment Key="sidebar" Title="Sidebar" IsSelected="True"/>
      <mac:Segment Key="inspector" Title="Inspector" IsSelected="True"/>
      <mac:Segment Key="preview" Title="Preview"/>
    </mac:SegmentedControl>
    <mac:Label Text="Quick actions" mac:Canvas.Left="24" mac:Canvas.Top="302" Width="350" Height="24"/>
    <mac:SegmentedControl x:Name="Actions" mac:Canvas.Left="24" mac:Canvas.Top="334"
        Width="350" Height="32" ControlSize="large" SelectionMode="Momentary"
        Action="Actions_ButtonClick" mac:Accessibility.Label="Quick actions">
      <mac:Segment Key="refresh" Title="Refresh"/>
      <mac:Segment Key="reset" Title="Reset"/>
    </mac:SegmentedControl>
    <mac:TabView x:Name="Pages" mac:Canvas.Left="384" mac:Canvas.Top="110"
        Width="372" Height="256" ControlStyle="segmented" Material="content">
      <mac:TabItem Title="General">
        <mac:View Width="372" Height="232">
        <mac:Label Text="Search settings" mac:Canvas.Left="20" mac:Canvas.Top="24" Width="332" Height="24"/>
        <mac:SearchField x:Name="Search" mac:Canvas.Left="20" mac:Canvas.Top="58"
            Width="332" Height="32" ControlSize="large" PlaceholderString="Filter preferences"
            mac:Accessibility.Label="Search settings" TextChanged="Search_Change"/>
        <mac:Switch x:Name="Notifications" Title="Enable notifications" IsOn="True"
            mac:Canvas.Left="20" mac:Canvas.Top="112" Width="332" Height="28"
            Action="Notifications_Click"/>
        <mac:Label Text="Search and switch values stay live when you change pages."
            mac:Canvas.Left="20" mac:Canvas.Top="156" Width="332" Height="52"
            Foreground="{ThemeResource macOS.secondaryLabelColor}"/>
        </mac:View>
      </mac:TabItem>
      <mac:TabItem Title="Notes">
        <mac:View Width="372" Height="232">
        <mac:Label Text="Notes" mac:Canvas.Left="20" mac:Canvas.Top="24" Width="332" Height="24"/>
        <mac:TextEditor x:Name="Notes" mac:Canvas.Left="20" mac:Canvas.Top="58"
            Width="332" Height="140" PlaceholderString="Add a note about how you like to work."
            mac:Accessibility.Label="Preference notes"/>
        </mac:View>
      </mac:TabItem>
    </mac:TabView>
    <mac:Label x:Name="Status" Text="Ready" mac:Canvas.Left="24" mac:Canvas.Top="404"
        Width="732" Height="28" Foreground="{ThemeResource macOS.secondaryLabelColor}"/>
    <mac:Button x:Name="Apply" Title="Apply" mac:Canvas.Left="24" mac:Canvas.Top="460"
        Width="140" Height="34" ControlSize="large" ControlStyle="default" Action="Apply_Click"/>
  </mac:View>
</mac:Window>`;

export function macOS26Example() {
  const project = newProject('MacOS26Preferences'), module = project.modules[0];
  Object.assign(project.settings,{theme:'macos26',renderer:'canvas2d',xaml:true,showGrid:false,snapToGrid:false});
  const compiled = compileFormXaml(MACOS26_PREFERENCES_XAML,{form:module.form,settings:project.settings});
  if (!compiled.success) throw new Error('The macOS sample XAML is invalid: '+JSON.stringify(compiled.diagnostics));
  module.form = compiled.form;
  module.xaml = {version:1,revision:0,text:MACOS26_PREFERENCES_XAML,appliedText:MACOS26_PREFERENCES_XAML,base:formStamp(module.form),conflict:false};
  module.code = `Option Explicit

Private Sub LayoutMode_ButtonClick(ByVal Button As Object)
    Status.Caption = "Layout: " & Button.Caption
End Sub

Private Sub Options_ButtonClick(ByVal Button As Object)
    Status.Caption = Button.Caption & ": " & IIf(Button.Value = 1, "shown", "hidden")
End Sub

Private Sub Actions_ButtonClick(ByVal Button As Object)
    If Button.Key = "reset" Then
        LayoutMode.Buttons("comfortable").Value = 1
        Options.Buttons("sidebar").Value = 1
        Options.Buttons("inspector").Value = 1
        Options.Buttons("preview").Value = 0
        If Search.Text <> "" Then
            Search.Tag = "reset"
            Search.Text = ""
        End If
        Notes.Text = ""
        Notifications.Value = 1
    End If
    Status.Caption = Button.Caption & " complete"
End Sub

Private Sub Search_Change()
    If Search.Tag = "reset" Then
        Search.Tag = ""
        If Search.Text = "" Then Exit Sub
    End If
    Status.Caption = "Search: " & Search.Text
End Sub

Private Sub Notifications_Click()
    Status.Caption = "Notifications: " & IIf(Notifications.Value = 1, "enabled", "disabled")
End Sub

Private Sub Apply_Click()
    Dim Button As Object
    For Each Button In LayoutMode.Buttons
        If Button.Value = 1 Then
            Status.Caption = "Applied: " & Button.Caption
            Exit Sub
        End If
    Next
    Status.Caption = "Applied"
End Sub
`;
  return project;
}

export const MACOS26_EXAMPLE = {id:'macos26-preferences',name:'macOS 26 Preferences',
  description:'Editable macOS XAML with segmented selection, tab pages, search, switches and native AppKit export.',create:macOS26Example};
