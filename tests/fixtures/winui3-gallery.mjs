/** Owned acceptance fixture compiled from authored WinUI XAML. All resources
 * are local or from the pinned WinUI catalog; exports need no network assets. */
import {newProject,normalizeProject} from '../../src/project/model.js';
import {compileFormXaml} from '../../src/xaml/forms.js';
import {formStamp} from '../../src/xaml/contract.js';

export const WINUI3_GALLERY_XAML=`<Page xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
 xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
 xmlns:controls="using:Microsoft.UI.Xaml.Controls"
 x:Name="Form1" Width="920" Height="700" Background="{ThemeResource PageBrush}">
  <Page.Resources>
    <ResourceDictionary>
      <ResourceDictionary.MergedDictionaries><controls:XamlControlsResources/></ResourceDictionary.MergedDictionaries>
      <ResourceDictionary.ThemeDictionaries>
        <ResourceDictionary x:Key="Default">
          <SolidColorBrush x:Key="PageBrush" Color="#FF202020"/>
          <SolidColorBrush x:Key="PanelBrush" Color="#C0406080"/>
          <SolidColorBrush x:Key="InkBrush" Color="#FFE8EDF5"/>
        </ResourceDictionary>
        <ResourceDictionary x:Key="Light">
          <SolidColorBrush x:Key="PageBrush" Color="#FFF3F3F3"/>
          <SolidColorBrush x:Key="PanelBrush" Color="#80402010"/>
          <SolidColorBrush x:Key="InkBrush" Color="#FF102040"/>
        </ResourceDictionary>
        <ResourceDictionary x:Key="Dark">
          <SolidColorBrush x:Key="PageBrush" Color="#FF202020"/>
          <SolidColorBrush x:Key="PanelBrush" Color="#C0406080"/>
          <SolidColorBrush x:Key="InkBrush" Color="#FFE8EDF5"/>
        </ResourceDictionary>
        <ResourceDictionary x:Key="HighContrast">
          <SolidColorBrush x:Key="PageBrush" Color="#FF000000"/>
          <SolidColorBrush x:Key="PanelBrush" Color="#8000FF00"/>
          <SolidColorBrush x:Key="InkBrush" Color="#FFFFFF00"/>
        </ResourceDictionary>
      </ResourceDictionary.ThemeDictionaries>
      <LinearGradientBrush x:Key="PreviewGradient" StartPoint="0,0" EndPoint="0,1">
        <GradientStop Color="#FF0F4669" Offset="0"/>
        <GradientStop Color="#FF4DBAD1" Offset="1"/>
      </LinearGradientBrush>
    </ResourceDictionary>
  </Page.Resources>
  <Canvas x:Name="Layout" Width="920" Height="700" Background="{ThemeResource PageBrush}">
    <!-- Preserve the resources, vocabulary, comments and handlers through Inspector edits. -->
    <TextBlock x:Name="Heading" Canvas.Left="24" Canvas.Top="20" Width="850" Height="32" FontSize="24" Text="WinUI 3 imported XAML" Foreground="{ThemeResource InkBrush}"/>
    <TextBox x:Name="LiveText" Canvas.Left="24" Canvas.Top="72" Width="330" Height="32" Text="Ready" FontFamily="Courier New" FontSize="16" Padding="6,4,6,4" CornerRadius="4" Background="{ThemeResource PanelBrush}" Foreground="{ThemeResource InkBrush}" TextChanged="LiveText_Change"/>
    <Canvas x:Name="MovingScope" Canvas.Left="380" Canvas.Top="72" Width="240" Height="32">
      <TextBox x:Name="PaintSample" Canvas.Left="0" Canvas.Top="0" Width="240" Height="32" Text="Live alpha brush" Background="{ThemeResource PanelBrush}" Foreground="{ThemeResource InkBrush}"/>
    </Canvas>
    <TextBlock x:Name="TextStatus" Canvas.Left="640" Canvas.Top="76" Width="240" Height="24" Text="0:Ready" Tag="0"/>
    <Canvas x:Name="ShadowScope" Canvas.Left="24" Canvas.Top="134" Width="300" Height="110">
      <Canvas.Resources><SolidColorBrush x:Key="PanelBrush" Color="#802060A0"/></Canvas.Resources>
      <TextBlock x:Name="ScopeHeading" Canvas.Left="12" Canvas.Top="4" Width="275" Height="22" Text="Local resource shadows Page" Foreground="#FF0000FF"/>
      <TextBox x:Name="ShadowText" Canvas.Left="12" Canvas.Top="34" Width="260" Height="32" Text="Local brush" Background="{ThemeResource PanelBrush}"/>
    </Canvas>
    <Canvas x:Name="DarkScope" Canvas.Left="360" Canvas.Top="134" Width="520" Height="110" RequestedTheme="Dark" Background="{ThemeResource PageBrush}">
      <TextBlock Canvas.Left="12" Canvas.Top="4" Width="235" Height="22" Text="RequestedTheme: Dark" Foreground="{ThemeResource InkBrush}"/>
      <TextBox x:Name="DarkText" Canvas.Left="12" Canvas.Top="34" Width="230" Height="32" Text="Always dark" Background="{ThemeResource PanelBrush}"/>
      <ComboBox x:Name="ScopeChoices" Canvas.Left="12" Canvas.Top="74" Width="230" Height="30" SelectedIndex="0"><x:String>Alpha</x:String><x:String>Beta</x:String><x:String>Gamma</x:String></ComboBox>
      <Canvas x:Name="LightScope" Canvas.Left="270" Canvas.Top="12" Width="240" Height="86" RequestedTheme="Light" Background="{ThemeResource PageBrush}">
        <TextBlock Canvas.Left="8" Canvas.Top="2" Width="224" Height="22" Text="Nested request: Light" Foreground="{ThemeResource InkBrush}"/>
        <TextBox x:Name="LightText" Canvas.Left="8" Canvas.Top="30" Width="220" Height="32" Text="Always light" Background="{ThemeResource PanelBrush}"/>
      </Canvas>
    </Canvas>
    <Button x:Name="DefaultButton" Canvas.Left="24" Canvas.Top="278" Width="130" Height="32" Content="Default style" Click="DefaultButton_Click"/>
    <Button x:Name="AccentButton" Canvas.Left="174" Canvas.Top="278" Width="130" Height="32" Style="{StaticResource AccentButtonStyle}" Content="Accent style" Click="AccentButton_Click"/>
    <Button x:Name="SubtleButton" Canvas.Left="324" Canvas.Top="278" Width="130" Height="32" Style="{StaticResource SubtleButtonStyle}" Content="Subtle style"/>
    <HyperlinkButton x:Name="HelpLink" Canvas.Left="474" Canvas.Top="278" Width="160" Height="32" Content="Help in this app" Click="HelpLink_Click"/>
    <ToggleButton x:Name="Pin" Canvas.Left="674" Canvas.Top="278" Width="170" Height="32" Content="Pin" IsChecked="False" Click="Pin_Click"/>
    <ToggleSwitch x:Name="Notifications" Canvas.Left="24" Canvas.Top="340" Width="300" Height="68" Header="Notifications" OnContent="Enabled" OffContent="Disabled" IsOn="True" Toggled="Notifications_Click"/>
    <TextBlock x:Name="ToggleStatus" Canvas.Left="340" Canvas.Top="364" Width="130" Height="24" Text="0:1" Tag="0"/>
    <TextBlock x:Name="PinStatus" Canvas.Left="500" Canvas.Top="364" Width="130" Height="24" Text="0:0" Tag="0"/>
    <ProgressBar x:Name="Progress" Canvas.Left="24" Canvas.Top="446" Width="320" Height="20" Minimum="0" Maximum="100" Value="42"/>
    <ProgressBar x:Name="Waiting" Canvas.Left="380" Canvas.Top="446" Width="240" Height="20" IsIndeterminate="True"/>
    <Slider x:Name="Gain" Canvas.Left="24" Canvas.Top="492" Width="320" Height="32" Minimum="0" Maximum="100" Value="40" StepFrequency="5" ValueChanged="Gain_Change"/>
    <TextBlock x:Name="RangeStatus" Canvas.Left="380" Canvas.Top="496" Width="240" Height="24" Text="40"/>
    <Border x:Name="GradientCard" Canvas.Left="660" Canvas.Top="432" Width="200" Height="92" Background="{StaticResource PreviewGradient}" BorderBrush="#FF304050" BorderThickness="2" CornerRadius="6"/>
    <Canvas x:Name="StateScope" Canvas.Left="24" Canvas.Top="558" Width="290" Height="54">
      <Canvas.Resources>
        <SolidColorBrush x:Key="ButtonBackgroundPointerOver" Color="#FFBE2266"/>
        <SolidColorBrush x:Key="ButtonBackgroundPressed" Color="#FF663399"/>
        <SolidColorBrush x:Key="ButtonBackgroundDisabled" Color="#FF787878"/>
      </Canvas.Resources>
      <Button x:Name="StateButton" Canvas.Left="0" Canvas.Top="0" Width="230" Height="32" Content="Scoped state resources"/>
    </Canvas>
    <TextBlock x:Name="ActionStatus" Canvas.Left="340" Canvas.Top="562" Width="520" Height="28" Text="No action"/>
    <Button x:Name="ReleaseColor" Canvas.Left="24" Canvas.Top="598" Width="230" Height="32" Content="Use explicit VB color" Click="ReleaseColor_Click"/>
    <RichEditBox x:Name="RichDocument" Canvas.Left="380" Canvas.Top="606" Width="240" Height="42" Background="{ThemeResource PanelBrush}"/>
    <TextBlock Canvas.Left="24" Canvas.Top="660" Width="840" Height="26" Text="Source-backed browser compatibility. Native Windows pixel parity is a separate acceptance target." TextWrapping="Wrap"/>
  </Canvas>
</Page>`;

const CODE=`Option Explicit

Private Sub LiveText_Change()
    TextStatus.Tag = CStr(Val(TextStatus.Tag) + 1)
    TextStatus.Caption = TextStatus.Tag & ":" & LiveText.Text
End Sub

Private Sub Notifications_Click()
    ToggleStatus.Tag = CStr(Val(ToggleStatus.Tag) + 1)
    ToggleStatus.Caption = ToggleStatus.Tag & ":" & CStr(Notifications.Value)
End Sub

Private Sub Pin_Click()
    PinStatus.Tag = CStr(Val(PinStatus.Tag) + 1)
    PinStatus.Caption = PinStatus.Tag & ":" & CStr(Pin.Value)
End Sub

Private Sub DefaultButton_Click()
    ActionStatus.Caption = "default:" & LiveText.Text
End Sub

Private Sub AccentButton_Click()
    ActionStatus.Caption = "accent:" & LiveText.Text
End Sub

Private Sub HelpLink_Click()
    ActionStatus.Caption = "help opened locally"
End Sub

Private Sub Gain_Change()
    RangeStatus.Caption = CStr(Gain.Value)
End Sub

Private Sub ReleaseColor_Click()
    PaintSample.BackColor = PaintSample.BackColor
    ActionStatus.Caption = "VB color assigned"
End Sub
`;

export function winui3Gallery() {
  const project=newProject('WinUI3Gallery'),module=project.modules[0];
  project.id='winui3-gallery';module.id='winui3-module';
  Object.assign(project.settings,{xaml:true,renderer:'canvas2d',anchoring:true,showGrid:false,snapToGrid:false,
    theme:'fluent',themeOptions:{followSystemTheme:false,reduceMotion:true,reduceTransparency:true}});
  const compiled=compileFormXaml(WINUI3_GALLERY_XAML,{form:module.form,settings:project.settings});
  if(!compiled.success)throw new Error('WinUI gallery compilation failed: '+compiled.diagnostics.map(d=>d.code+': '+d.message).join('\n'));
  module.form=compiled.form;module.form.id='winui3-form';module.name=module.form.name;project.startup=module.name;
  const ids=new Map(module.form.controls.map(control=>[control.id,'winui3-'+control.name]));
  for(const control of module.form.controls) {
    control.id=ids.get(control.id);
    if(control.nativeParentId)control.nativeParentId=ids.get(control.nativeParentId)??control.nativeParentId;
  }
  module.code=CODE;
  module.xaml={version:1,text:WINUI3_GALLERY_XAML,appliedText:WINUI3_GALLERY_XAML,revision:0,
    conflict:false,base:formStamp(module.form)};
  return normalizeProject(project);
}
