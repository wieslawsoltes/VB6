import {registerWebBrowserControls} from '../controls/webbrowser-control.js';

/** Install through the existing trusted-adapter UI and runtime registry. */
export function installWebBrowser(ide){
  const install=ide.installControlAdapters.bind(ide);
  ide.installControlAdapters=registry=>install(registerWebBrowserControls(registry));
  ide.installControlAdapters(ide.controlRegistry);
}
