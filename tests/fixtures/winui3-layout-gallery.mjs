/** Real exported-app fixture for resolved WinUI font and box geometry. */
import {newProject,normalizeProject} from '../../src/project/model.js';
import {compileFormXaml} from '../../src/xaml/forms.js';
import {formStamp} from '../../src/xaml/contract.js';

export const WINUI3_LAYOUT_XAML=`<Page xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
 xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="Form1" Width="480" Height="420">
  <Page.Resources>
    <ResourceDictionary>
      <ResourceDictionary.ThemeDictionaries>
        <ResourceDictionary x:Key="Light">
          <FontFamily x:Key="LiveFamily">Arial</FontFamily>
          <x:Double x:Key="LiveSize">16</x:Double>
          <FontWeight x:Key="LiveWeight">Normal</FontWeight>
          <Thickness x:Key="LivePadding">2,3,4,5</Thickness>
          <Thickness x:Key="LiveStroke">1,2,3,4</Thickness>
          <Thickness x:Key="ScopePadding">5,7,11,13</Thickness>
          <Thickness x:Key="ScopeStroke">2,3,4,5</Thickness>
        </ResourceDictionary>
        <ResourceDictionary x:Key="Default">
          <FontFamily x:Key="LiveFamily">Courier New</FontFamily>
          <x:Double x:Key="LiveSize">24</x:Double>
          <FontWeight x:Key="LiveWeight">Bold</FontWeight>
          <Thickness x:Key="LivePadding">10,7,14,9</Thickness>
          <Thickness x:Key="LiveStroke">3,4,5,6</Thickness>
          <Thickness x:Key="ScopePadding">10,2,20,4</Thickness>
          <Thickness x:Key="ScopeStroke">1,2,3,4</Thickness>
        </ResourceDictionary>
      </ResourceDictionary.ThemeDictionaries>
    </ResourceDictionary>
  </Page.Resources>
  <Canvas x:Name="Layout" Width="480" Height="420">
    <Border x:Name="Scope" Canvas.Left="24" Canvas.Top="24" Width="320" Height="350"
      Padding="{ThemeResource ScopePadding}" BorderThickness="{ThemeResource ScopeStroke}" BorderBrush="#FF42668A">
      <StackPanel x:Name="Flow" Spacing="8">
        <Button x:Name="Hug" HorizontalAlignment="Left" MinWidth="0" MinHeight="0" Content="Live geometry"
          FontFamily="{ThemeResource LiveFamily}" FontSize="{ThemeResource LiveSize}" FontWeight="{ThemeResource LiveWeight}"
          Padding="{ThemeResource LivePadding}" BorderThickness="{ThemeResource LiveStroke}" BorderBrush="#FF42668A"/>
        <TextBlock x:Name="Wrapped" Text="Live font changes keep constrained wrapping inside the available content width."
          TextWrapping="Wrap" FontFamily="{ThemeResource LiveFamily}" FontSize="{ThemeResource LiveSize}" FontWeight="{ThemeResource LiveWeight}"/>
        <Button x:Name="Fixed" Width="160" Height="44" HorizontalAlignment="Left" Content="Fixed bounds"
          FontFamily="{ThemeResource LiveFamily}" FontSize="{ThemeResource LiveSize}" FontWeight="{ThemeResource LiveWeight}"/>
      </StackPanel>
    </Border>
  </Canvas>
</Page>`;

export function winui3LayoutGallery() {
  const project=newProject('WinUI3Layout'),module=project.modules[0];
  Object.assign(project.settings,{xaml:true,renderer:'canvas2d',anchoring:true,showGrid:false,snapToGrid:false,
    theme:'fluent',themeOptions:{followSystemTheme:false,reduceMotion:true,reduceTransparency:true}});
  const compiled=compileFormXaml(WINUI3_LAYOUT_XAML,{form:module.form,settings:project.settings});
  if(!compiled.success)throw new Error('WinUI layout fixture compilation failed: '+compiled.diagnostics.map(d=>d.code+': '+d.message).join('\n'));
  module.form=compiled.form;module.name=module.form.name;module.code='Option Explicit\n';project.startup=module.name;
  module.xaml={version:1,text:WINUI3_LAYOUT_XAML,appliedText:WINUI3_LAYOUT_XAML,revision:0,conflict:false,base:formStamp(module.form)};
  return normalizeProject(project);
}
