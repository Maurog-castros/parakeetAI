'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  config: () => ipcRenderer.invoke('config'),
  suggest: (transcript) => ipcRenderer.invoke('suggest', transcript),
  practiceQuestion: (history) => ipcRenderer.invoke('practice-question', history),
  evaluatePractice: (history) => ipcRenderer.invoke('practice-evaluate', history),
  speak: (text) => ipcRenderer.invoke('tts', text),
  getContext: () => ipcRenderer.invoke('get-context'),
  saveContext: (data) => ipcRenderer.invoke('save-context', data),
  setClickThrough: (on) => ipcRenderer.send('set-click-through', on),
  setPracticeMode: (on) => ipcRenderer.send('set-practice-mode', on),
  minimize: () => ipcRenderer.send('minimize'),
  quit: () => ipcRenderer.send('quit'),
  setCaptureVisible: (on) => ipcRenderer.invoke('set-capture-visible', on),
  onClickThroughChanged: (cb) => ipcRenderer.on('click-through-changed', (_e, on) => cb(!!on)),
});
