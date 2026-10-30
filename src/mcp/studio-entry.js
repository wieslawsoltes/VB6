import {installInputModes} from '../ide/input-modes.js';
import {installDOSWorkspace} from '../ide/dos-mode.js';
import {installFigmaMode} from '../ide/figma-mode.js';
import {installAdvancedEditor} from '../ide/advanced-editor.js';
import {installWebBrowser} from '../ide/webbrowser.js';
import {installIntelligentUI} from '../intelligent-ui/studio.js';
import {installXaml} from '../ide/xaml.js';
import {installClassicExport} from '../ide/classic-build.js';
import {installMacOSExport} from '../ide/macos-build.js';
import {installLinuxExport} from '../ide/linux-build.js';
import {installStudioRendering} from '../rendering/studio.js';
import {VB6Studio, StudioAPI} from '../ide/main.js';
import {installApplicationExport} from '../ide/application-export.js';
import {installVbNetExport} from '../ide/vbnet-export.js';
import {installMcp} from './studio.js';
import {installAutoLayout} from '../ide/auto-layout.js';
import {installCodingAgents} from '../agents/studio.js';
if (globalThis.vb6Studio) {
  installWebBrowser(globalThis.vb6Studio);
  installClassicExport(globalThis.vb6Studio, StudioAPI);
  installMacOSExport(globalThis.vb6Studio, StudioAPI);
  installLinuxExport(globalThis.vb6Studio, StudioAPI);
  installApplicationExport(globalThis.vb6Studio, StudioAPI);
  installVbNetExport(globalThis.vb6Studio, StudioAPI);
  installMcp(globalThis.vb6Studio, StudioAPI);
  installCodingAgents(globalThis.vb6Studio, StudioAPI);
  installIntelligentUI(globalThis.vb6Studio, StudioAPI);
  installAutoLayout(globalThis.vb6Studio);
  installXaml(globalThis.vb6Studio);
  installStudioRendering(globalThis.vb6Studio);
  installAdvancedEditor(globalThis.vb6Studio);
  installFigmaMode(globalThis.vb6Studio);
  installDOSWorkspace(globalThis.vb6Studio);
  installInputModes(globalThis.vb6Studio);
}

export {installInputModes, installDOSWorkspace, installFigmaMode, installXaml, installStudioRendering, installAutoLayout, VB6Studio, StudioAPI, installMcp};
