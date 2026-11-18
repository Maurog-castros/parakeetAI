'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  config: () => ipcRenderer.invoke('config'),
  suggest: (transcript) => ipcRenderer.invoke('suggest', transcript),
  getContext: () => ipcRenderer.invoke('get-context'),
  saveContext: (data) => ipcRenderer.invoke('save-context', data),
  setClickThrough: (on) => ipcRenderer.send('set-click-through', on),
  quit: () => ipcRenderer.send('quit'),
});
