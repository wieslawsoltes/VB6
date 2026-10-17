/** Owned integration fixture: actual VB controls and handlers, no Apple assets. */
import {newProject,createControl} from '../../src/project/model.js';

export const MACOS26_COMPAT_XAML=`<mac:Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
 xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:mac="urn:vb6:macos26"
 x:Name="Form1" Title="macOS preferences" Width="760" Height="640">
  <!-- Keep this authored macOS vocabulary when the Inspector edits a value. -->
  <mac:Grid x:Name="Layout" Width="760" Height="640">
    <mac:Grid.ColumnDefinitions><mac:ColumnDefinition Width="200"/><mac:ColumnDefinition Width="*"/></mac:Grid.ColumnDefinitions>
    <mac:Outline x:Name="Navigation" Material="sidebar">
      <mac:OutlineNode Key="general" Text="General" IsExpanded="True"><mac:OutlineNode Key="appearance" Text="Appearance"/></mac:OutlineNode>
      <mac:OutlineNode Key="advanced" Text="Advanced"/>
    </mac:Outline>
    <mac:StackView x:Name="Content" mac:Grid.Column="1" Padding="16" Spacing="8">
      <mac:Label x:Name="Heading" Text="Preferences" Height="24" FontSize="18" Foreground="{ThemeResource macOS.labelColor}"/>
      <mac:SearchField x:Name="Search" StringValue="Ready" Height="32" ControlSize="large" PlaceholderString="Filter settings" Foreground="{ThemeResource macOS.secondaryLabelColor}" mac:Accessibility.Label="Search settings"/>
      <mac:SecureField x:Name="Secret" StringValue="secret" Height="28" PlaceholderString="Password"/>
      <mac:Switch x:Name="Notifications" Title="Enable notifications" IsOn="True" Height="28"/>
      <mac:PopUpButton x:Name="Choices" SelectedIndex="1" Height="30"><mac:MenuItem Content="Light"/><mac:MenuItem Content="Dark"/><mac:MenuItem Content="System"/></mac:PopUpButton>
      <mac:Stepper x:Name="Counter" Width="100" Height="28" Minimum="0" Maximum="10" Value="2" Increment="2" Orientation="Horizontal"/>
      <mac:DatePicker x:Name="Meeting" Date="2026-10-16" Height="28"/>
      <mac:ProgressIndicator x:Name="Progress" Minimum="0" Maximum="100" Value="42" IsIndeterminate="True" Height="12" mac:Accessibility.Label="Import progress"/>
      <mac:TabView x:Name="Pages" Height="84">
        <mac:TabItem Title="General"><mac:Label x:Name="GeneralPage" Text="General settings"/></mac:TabItem>
        <mac:TabItem Title="Advanced"><mac:Label x:Name="AdvancedPage" Text="Advanced settings"/></mac:TabItem>
      </mac:TabView>
      <mac:Button x:Name="Save" Title="Save preferences" Height="32" ControlStyle="default" ControlSize="large" Action="Save_Click"/>
      <mac:Label x:Name="ActionStatus" Text="Not saved" Height="24"/>
    </mac:StackView>
  </mac:Grid>
</mac:Window>`;

export function macos26CompatibilityGallery() {
  const project=newProject('MacOS26Compatibility'),module=project.modules[0],form=module.form;
  project.id='macos26-compatibility';module.id='macos26-module';form.id='macos26-form';
  Object.assign(project.settings,{renderer:'canvas2d',showGrid:false,snapToGrid:false,theme:'macos26',themeOptions:{reduceMotion:true,reduceTransparency:false,followSystemTheme:false}});
  Object.assign(form.properties,{Caption:'macOS 26 compatibility',StartUpPosition:0,Left:120,Top:120,ClientWidth:12000,ClientHeight:8400,Width:12120,Height:8850});
  const add=(type,name,x,y,width,height,properties={})=>{
    const control=createControl(type,name,x*15,y*15);control.id='macos26-'+name;
    Object.assign(control.properties,{Width:width*15,Height:height*15,TabIndex:form.controls.length,...properties});
    form.controls.push(control);return control;
  };
  add('TextBox','Search',24,24,320,32,{Text:'Ready',MacOSControlStyle:'search',MacOSControlSize:'large',PlaceholderText:'Filter settings',MacOSAccessibilityLabel:'Search settings',MacOSAccessibilityHelp:'Type a setting name. Escape clears the search.',MacOSAccessibilityIdentifier:'settings-search'});
  add('Label','SearchStatus',24,68,720,24,{Caption:'0:Ready',Tag:'0'});
  add('CheckBox','Notifications',24,108,320,28,{Caption:'Enable notifications',Value:1,MacOSControlStyle:'switch',MacOSAccessibilityLabel:'Enable notifications'});
  add('Label','ToggleStatus',370,108,220,24,{Caption:'1'});
  add('ProgressBar','Progress',24,154,320,16,{Min:0,Max:100,Value:42,MacOSIndeterminate:-1,MacOSAccessibilityLabel:'Import progress',MacOSAccessibilityHelp:'Waiting for the next file',MacOSAccessibilityIdentifier:'import-progress'});
  add('CommandButton','Save',24,198,140,32,{Caption:'Save',Default:0,MacOSControlStyle:'default',MacOSControlSize:'large'});
  add('CommandButton','Cancel',184,198,140,32,{Caption:'Cancel',Cancel:-1});
  add('Label','ActionStatus',24,246,720,24,{Caption:'Not saved'});
  add('Label','CancelStatus',24,278,720,24,{Caption:'cancel 0',Tag:'0'});
  // Explicit OLE fallbacks let the browser regression distinguish semantic paint
  // from inherited system paint and verify removal even when the value is equal.
  add('TextBox','SemanticText',24,326,320,32,{Text:'Semantic colors',ForeColor:0x00332211,BackColor:0x00665544,MacOSForegroundRole:'secondaryLabelColor',MacOSBackgroundRole:'textBackgroundColor'});
  add('PictureBox','Sidebar',370,24,380,176,{MacOSMaterial:'sidebar',BackColor:-2147483633});
  add('ComboBox','Choices',370,326,280,30,{Style:2,List:['Light','Dark','System'],ListIndex:1,MacOSAccessibilityLabel:'Appearance'});
  module.code='Option Explicit\n\nPrivate Sub Search_Change()\n    SearchStatus.Tag = CStr(Val(SearchStatus.Tag) + 1)\n    SearchStatus.Caption = SearchStatus.Tag & ":" & Search.Text\nEnd Sub\n\nPrivate Sub Notifications_Click()\n    ToggleStatus.Caption = CStr(Notifications.Value)\nEnd Sub\n\nPrivate Sub Save_Click()\n    ActionStatus.Caption = "saved:" & Search.Text\nEnd Sub\n\nPrivate Sub Cancel_Click()\n    CancelStatus.Tag = CStr(Val(CancelStatus.Tag) + 1)\n    CancelStatus.Caption = "cancel " & CancelStatus.Tag\nEnd Sub\n';
  return project;
}
