'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Never expose ipcRenderer, Node, filesystem paths, or a general-purpose invoke API.
if (process.isMainFrame) contextBridge.exposeInMainWorld('vb6Native', Object.freeze({
  version: 1,
  capabilities: Object.freeze({ applicationCaptions: true }),
  info: () => ipcRenderer.invoke('vb6:info'),
  runtimeDocument: html => ipcRenderer.invoke('vb6:runtime-document', html),
  prepareWindow: options => {
    const result = ipcRenderer.sendSync('vb6:prepare-window', options);
    if (!result.ok) throw new Error(result.error);
    return result.id;
  },
  windowCommand: (id, command, value) => ipcRenderer.invoke('vb6:window-command', id, command, value),
  popupMenu: (id, items, position) => ipcRenderer.invoke('vb6:popup-menu', id, items, position),
  messageBox: options => ipcRenderer.invoke('vb6:message-box', options),
  openFile: options => ipcRenderer.invoke('vb6:open-file', options),
  saveFile: (name, bytes) => ipcRenderer.invoke('vb6:save-file', name, bytes),
  onWindowEvent: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected callback');
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('vb6:window-event', listener);
    return () => ipcRenderer.removeListener('vb6:window-event', listener);
  }
}));
