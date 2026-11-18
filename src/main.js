'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, session, Tray, Menu, nativeImage, screen } = require('electron');
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

// Single instance: a second launch (e.g. the .cmd run twice, or while the
// window is hidden) would fail to register shortcuts and lock the cache.
// Instead, quit it and bring the existing window back.
if (!app.requestSingleInstanceLock()) {
  console.log('ParakeetAI ya está abierto: se muestra la ventana existente.');
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => showWindow());

let win = null;
let tray = null;
let clickThrough = false;
let interviewBounds = null;

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

// --- window visibility / click-through helpers ---
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function toggleVisible() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) win.hide(); else showWindow();
  updateTrayMenu();
}
function setClickThrough(on) {
  clickThrough = !!on;
  if (!win) return;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
  win.webContents.send('click-through-changed', clickThrough);
  updateTrayMenu();
}
function registerShortcut(accel, fn) {
  try {
    if (!globalShortcut.register(accel, fn)) console.log('[shortcut] no se pudo registrar', accel);
  } catch (e) { console.log('[shortcut] error', accel, e.message); }
}

// Tray: always-available way to show, release the mouse or quit
// (the window has no taskbar entry and may be click-through).
function trayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const i = (y * size + x) * 4;
      const a = d <= 6.5 ? 255 : d <= 7.5 ? Math.round(255 * (7.5 - d)) : 0;
      buf[i] = 0xfe; buf[i + 1] = 0xa8; buf[i + 2] = 0x6e; buf[i + 3] = a; // BGRA (#6ea8fe)
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
function updateTrayMenu() {
  if (!tray) return;
  const visible = !!(win && win.isVisible() && !win.isMinimized());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Ocultar asistente' : 'Mostrar asistente', accelerator: 'CommandOrControl+Shift+Space', click: toggleVisible },
    { label: 'Paso del ratón (click-through)', type: 'checkbox', checked: clickThrough,
      accelerator: 'CommandOrControl+Shift+M', click: (item) => setClickThrough(item.checked) },
    { type: 'separator' },
    { label: 'Salir', accelerator: 'CommandOrControl+Shift+Q', click: () => app.quit() },
  ]));
}
function createTray() {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip('ParakeetAI — asistente');
    tray.on('click', toggleVisible);
    updateTrayMenu();
  } catch (e) { console.log('[tray] error', e.message); }
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

  registerShortcut('CommandOrControl+Shift+Space', toggleVisible);
  registerShortcut('CommandOrControl+Shift+M', () => setClickThrough(!clickThrough));
  registerShortcut('CommandOrControl+Shift+Q', () => app.quit());
  createTray();

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

ipcMain.handle('practice-question', async (_e, history) => {
  try { return { ok: true, text: await llm.practiceQuestion(history, context) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('practice-evaluate', async (_e, history) => {
  try { return { ok: true, text: await llm.evaluatePractice(history, context) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('tts', async (_e, text) => {
  const key = process.env.DEEPGRAM_API_KEY || '';
  if (!key) return { ok: false, error: 'falta DEEPGRAM_API_KEY' };
  const model = process.env.DEEPGRAM_TTS_MODEL || 'aura-2-olivia-es';
  try {
    const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=mp3`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text || '').slice(0, 1800) }),
    });
    if (!r.ok) throw new Error(`Deepgram TTS -> ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return { ok: true, audio: Array.from(new Uint8Array(await r.arrayBuffer())), model };
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

ipcMain.on('set-click-through', (_e, on) => setClickThrough(on));

ipcMain.on('set-practice-mode', (_e, on) => {
  if (!win) return;
  if (on) {
    if (!interviewBounds) interviewBounds = win.getBounds();
    // Fit inside the visible work area (taskbar excluded, DPI-scaled), or the bottom gets cut off.
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const w = Math.min(760, wa.width - 16);
    const h = Math.min(760, wa.height - 16);
    win.setBounds({
      x: Math.round(wa.x + (wa.width - w) / 2),
      y: Math.round(wa.y + (wa.height - h) / 2),
      width: w,
      height: h,
    }, true);
    return;
  }
  if (interviewBounds) {
    win.setBounds(interviewBounds, true);
    interviewBounds = null;
  }
});

// No taskbar entry (skipTaskbar), so "minimize" hides; bring back with
// Ctrl+Shift+Space or the tray icon.
ipcMain.on('minimize', () => { if (win) { win.hide(); updateTrayMenu(); } });

ipcMain.on('quit', () => app.quit());

// Quick toggle: make the overlay visible to screenshots / screen sharing
// (same setting as "Mostrar el asistente al compartir pantalla").
ipcMain.handle('set-capture-visible', (_e, on) => {
  context.shareInterfaceVisible = on === true;
  saveContextToDisk();
  applyShareVisibility();
  return context.shareInterfaceVisible;
});

