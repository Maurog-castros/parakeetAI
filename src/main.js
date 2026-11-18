'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const llm = require('./llm');

// --- minimal .env loader (no dependency) ---
function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

let win = null;
let clickThrough = false;

// --- interview context (CV + job description), persisted in userData ---
let context = {
  cv: '',
  jd: '',
  responseChars: 500,
  responseFormat: 'bullets',
  responseInstructions: '',
  shareInterfaceVisible: false,
};
function contextFile() { return path.join(app.getPath('userData'), 'parakeet-context.json'); }
function loadContext() {
  try { context = Object.assign(context, JSON.parse(fs.readFileSync(contextFile(), 'utf8'))); } catch (_) {}
  context.responseChars = llm.normalizeResponseChars(context.responseChars);
  context.responseFormat = llm.normalizeResponseFormat(context.responseFormat);
  context.responseInstructions = llm.normalizeResponseInstructions(context.responseInstructions);
  context.shareInterfaceVisible = context.shareInterfaceVisible === true;
}
function saveContextToDisk() {
  try { fs.writeFileSync(contextFile(), JSON.stringify(context), 'utf8'); } catch (e) { console.log('[ctx] save err', e.message); }
}

function applyShareVisibility() {
  if (!win) return;
  try { win.setContentProtection(!context.shareInterfaceVisible); } catch (_) {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 440,
    height: 620,
    x: undefined,
    y: undefined,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  applyShareVisibility();

  win.webContents.on('console-message', (_e, level, message) => {
    console.log('[renderer]', message);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// System-audio loopback: when the renderer calls getDisplayMedia, grant a screen
// source for video (required by the API) plus 'loopback' audio (Windows system audio).
function installLoopbackHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      }).catch(() => callback({}));
    },
    { useSystemPicker: false }
  );
}

app.whenReady().then(() => {
  loadContext();
  installLoopbackHandler();
  createWindow();

  // Probe the gateway and print available models to the console (dev aid).
  llm.probe().then((info) => {
    console.log('[iamiko] base:', llm.cfg().baseUrl, '| key:', llm.cfg().hasKey ? 'set' : 'MISSING');
    if (info && info.models) console.log('[iamiko] models:', info.models.join(', '));
    if (info && info.error) console.log('[iamiko] probe error:', info.error);
  });

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!win) return;
    if (win.isVisible()) win.hide(); else win.show();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

// --- IPC ---
ipcMain.handle('config', () => {
  const c = llm.cfg();
  return {
    hasKey: c.hasKey,
    chatModel: c.chatModel,
    sttLang: c.sttLang,
    deepgramKey: c.deepgramKey,
    deepgramModel: c.deepgramModel,
  };
});

ipcMain.handle('suggest', async (_e, transcript) => {
  try {
    const text = await llm.suggest(transcript, context);
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('get-context', () => context);
ipcMain.handle('save-context', (_e, data) => {
  context = {
    cv: String(data && data.cv || ''),
    jd: String(data && data.jd || ''),
    responseChars: llm.normalizeResponseChars(data && data.responseChars),
    responseFormat: llm.normalizeResponseFormat(data && data.responseFormat),
    responseInstructions: llm.normalizeResponseInstructions(data && data.responseInstructions),
    shareInterfaceVisible: data && data.shareInterfaceVisible === true,
  };
  saveContextToDisk();
  applyShareVisibility();
  return {
    ok: true,
    cvLen: context.cv.length,
    jdLen: context.jd.length,
    responseChars: context.responseChars,
    responseFormat: context.responseFormat,
    shareInterfaceVisible: context.shareInterfaceVisible,
  };
});

ipcMain.on('set-click-through', (_e, on) => {
  clickThrough = !!on;
  if (win) win.setIgnoreMouseEvents(clickThrough, { forward: true });
});

ipcMain.on('quit', () => app.quit());
