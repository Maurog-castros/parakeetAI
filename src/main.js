'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, session, Tray, Menu, nativeImage, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const llm = require('./llm');
const IS_MAC = process.platform === 'darwin';
const MOD = IS_MAC ? 'Cmd' : 'Ctrl';
const transcriptLog = require('./transcriptLog');
const meetingMemory = require('./meetingMemory');
const sessionFiles = require('./sessionFiles');
const history = require('./history');

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
const COMPACT_HEIGHT = 96;
let layout = 'compact';
let expandedHeight = 560;

// --- interview context (CV + job description), persisted in userData ---
let context = {
  mode: 'interview',      // 'interview' | 'meeting'
  meetingContext: '',     // meeting mode: who/what the conversation is about
  meetingDocuments: [],   // extracted reference documents for meeting mode
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
  context.mode = llm.normalizeMode(context.mode);
  context.meetingContext = llm.normalizeMeetingContext(context.meetingContext);
  context.meetingDocuments = llm.normalizeMeetingDocuments(context.meetingDocuments);
}
function saveContextToDisk() {
  try { fs.writeFileSync(contextFile(), JSON.stringify(context), 'utf8'); } catch (e) { console.log('[ctx] save err', e.message); }
}

// --- meeting memory (previous meetings + open action items), in userData ---
let memory = meetingMemory.emptyMemory();
function memoryFile() { return path.join(app.getPath('userData'), 'parakeet-memory.json'); }
function loadMemory() {
  try { memory = meetingMemory.normalizeMemory(JSON.parse(fs.readFileSync(memoryFile(), 'utf8'))); } catch (_) {}
}
function saveMemoryToDisk() {
  try { fs.writeFileSync(memoryFile(), JSON.stringify(memory, null, 2), 'utf8'); } catch (e) { console.log('[mem] save err', e.message); }
}
// Context for LLM calls; meeting mode adds the memory (open items + last meetings).
function llmContext(exceptMeetingId) {
  if (context.mode !== 'meeting') return context;
  return Object.assign({}, context, {
    memoryContext: meetingMemory.buildMemoryContext(memory, { exceptMeetingId }),
  });
}

function applyShareVisibility() {
  if (!win) return;
  try { win.setContentProtection(!context.shareInterfaceVisible); } catch (_) {}
}

function createWindow() {
  // Starts as a compact bar at the top centre of the screen; the renderer
  // expands it (set-layout) to show transcript + answer panes.
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(880, wa.width - 32);
  win = new BrowserWindow({
    width,
    height: COMPACT_HEIGHT,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: wa.y + 16,
    minWidth: 600,
    minHeight: 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    resizable: true,
    hasShadow: false,
    backgroundColor: '#00000000', // never paint an opaque (white) background behind the page
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  // macOS: keep the overlay over full-screen meetings and on every Space.
  if (IS_MAC) { try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {} }
  applyShareVisibility();

  // Electron 35+ passes a single event object; older versions pass positional args.
  // Declared with one parameter so Electron 35+ doesn't warn about positional args.
  win.webContents.on('console-message', function (e) {
    console.log('[renderer]', e.message !== undefined ? e.message : arguments[2]);
  });

  // No taskbar entry: if Windows minimizes it anyway, bring it straight back.
  win.on('minimize', () => { console.log('[win] minimized by system, restoring'); setTimeout(showWindow, 50); });
  win.on('show', updateTray);
  win.on('hide', updateTray);

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
  if (win.isVisible() && !win.isMinimized()) hideWindow(); else showWindow();
  updateTray();
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
// (the window has no taskbar entry and may be click-through). The icon also
// tells the state at a glance: grey = idle, green = listening; a white ring
// means the window is hidden.
let liveState = { them: false, me: false };
const trayIcons = {};
function trayIcon(color, hiddenRing) {
  const key = color + (hiddenRing ? '-h' : '');
  if (trayIcons[key]) return trayIcons[key];
  const size = 32; // 2x for HiDPI trays
  const [r, g, b] = color === 'live' ? [0x5f, 0xd3, 0x9a] : [0x9a, 0xa3, 0xb8];
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const i = (y * size + x) * 4;
      let cr = r, cg = g, cb = b, a = 0;
      if (d <= 10) a = 255;                                   // filled dot
      else if (d <= 11) a = Math.round(255 * (11 - d));
      if (hiddenRing && d > 12.5 && d <= 15.5) { cr = cg = cb = 0xff; a = d <= 14.5 ? 255 : Math.round(255 * (15.5 - d)); }
      buf[i] = cb; buf[i + 1] = cg; buf[i + 2] = cr; buf[i + 3] = a; // BGRA
    }
  }
  trayIcons[key] = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
  return trayIcons[key];
}
function stateText() {
  const parts = [];
  if (liveState.them) parts.push('entrevistador');
  if (liveState.me) parts.push('micrófono');
  return parts.length ? 'Escuchando: ' + parts.join(' + ') : 'En pausa (no escucha)';
}
function updateTray() {
  if (!tray) return;
  const visible = !!(win && win.isVisible() && !win.isMinimized());
  const live = liveState.them || liveState.me;
  tray.setImage(trayIcon(live ? 'live' : 'idle', !visible));
  tray.setToolTip('ParakeetAI · ' + stateText() + (visible ? '' : '\nVentana oculta — ' + MOD + '+Shift+Space o clic aquí'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'ParakeetAI · ' + stateText(), enabled: false },
    { type: 'separator' },
    { label: visible ? 'Ocultar asistente' : 'Mostrar asistente', accelerator: 'CommandOrControl+Shift+Space', click: toggleVisible },
    { label: 'Paso del ratón (click-through)', type: 'checkbox', checked: clickThrough,
      accelerator: 'CommandOrControl+Shift+M', click: (item) => setClickThrough(item.checked) },
    { type: 'separator' },
    { label: 'Salir', accelerator: 'CommandOrControl+Shift+Q', click: () => app.quit() },
  ]));
}
const updateTrayMenu = updateTray;
function createTray() {
  try {
    tray = new Tray(trayIcon('idle', false));
    tray.on('click', toggleVisible);
    updateTray();
  } catch (e) { console.log('[tray] error', e.message); }
}
// Hide on purpose and say where it went (once per session; Windows 11 tucks
// new tray icons behind the ^ overflow arrow).
let hideTipShown = false;
function hideWindow() {
  if (!win) return;
  win.hide();
  updateTray();
  if (!hideTipShown && tray && process.platform === 'win32') {
    hideTipShown = true;
    try {
      tray.displayBalloon({
        title: 'ParakeetAI sigue activo',
        content: stateText() + '. Vuelve con Ctrl+Shift+Space o con el punto de la bandeja (flecha ^ junto al reloj).',
        noSound: true,
      });
    } catch (_) {}
  }
}

// System-audio loopback: when the renderer calls getDisplayMedia, grant a screen
// source for video (required by the API) plus 'loopback' audio. Windows: WASAPI
// loopback. macOS 14.2+: CoreAudio tap (Electron 39+), which needs the
// NSAudioCaptureUsageDescription Info.plist key and the "System Audio Recording"
// permission; without it the track arrives already 'ended' (no JS error).
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
  if (IS_MAC) {
    try {
      const { systemPreferences } = require('electron');
      console.log('[mac] screen:', systemPreferences.getMediaAccessStatus('screen'),
        '| mic:', systemPreferences.getMediaAccessStatus('microphone'));
    } catch (_) {}
  }
  loadContext();
  loadMemory();
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
  registerShortcut('CommandOrControl+Shift+X', () => { if (win) win.webContents.send('shortcut', 'screenshot'); });
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
    sttUrl: c.sttUrl,
    sttKey: c.sttKey,
    sttModel: c.sttModel,
    // Chinese interviewer: the voice gateway (parakeet-tdt) has no Chinese, so
    // that source goes straight to Deepgram (nova-2, zh-CN).
    dgKey: process.env.DEEPGRAM_API_KEY || '',
  };
});

// Live translation of the interviewer's phrase (Chinese mode).
ipcMain.handle('translate', async (_e, text, from) => {
  try { return { ok: true, text: await llm.translate(text, from) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// Live interview answers come from the voice gateway on the STT socket; the
// renderer sends this Configure (rules + CV/JD) when the connection opens.
ipcMain.handle('gateway-config', (_e, resetHistory, role) => ({
  configure: llm.gatewayConfigure(llmContext(), !!resetHistory, role === 'candidate' ? 'candidate' : 'interviewer'),
  mode: context.mode,
  responseChars: llm.normalizeResponseChars(context.responseChars),
}));

// Practice mode: model answer for the current question (local LLM call).
ipcMain.handle('suggest', async (_e, transcript) => {
  try {
    const text = await llm.suggest(transcript, llmContext());
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

// Session log: one folder per session, <inicio>[_<título>]/transcripcion.md
// (+ resumen/pendientes/ideas/próximos pasos once summarised, see
// sessionFiles.js). The renderer pushes a snapshot on every change; the
// transcript is rewritten in place every LOG_AUTOSAVE_MS (if changed), on
// "Limpiar" (then a new session starts) and when the app quits.
// Dev: <project>/transcripciones. Packaged: Documents\ParakeetAI\transcripciones,
// outside the app folder so rebuilding/replacing dist never deletes them.
const LOG_DIR = app.isPackaged
  ? path.join(app.getPath('documents'), 'ParakeetAI', 'transcripciones')
  : path.join(__dirname, '..', 'transcripciones');
const LOG_AUTOSAVE_MS = 20000;
let logSession = null; // latest snapshot from the renderer
let logDir = null;     // folder of the current session (set on first write)
let logDirty = false;

function freeDir(base) {
  let dir = path.join(LOG_DIR, base);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(LOG_DIR, `${base}_${n}`);
  return dir;
}
function ensureLogDir() {
  if (logDir && fs.existsSync(logDir)) return logDir;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logDir = freeDir(sessionFiles.sessionFolderName(logSession && (logSession.startedAt || logSession.endedAt)));
  fs.mkdirSync(logDir, { recursive: true });
  return logDir;
}
function writeSessionLog() {
  if (!logSession || !logDirty) return logDir;
  const md = transcriptLog.buildTranscriptLog(logSession);
  if (!md) return logDir;
  fs.writeFileSync(path.join(ensureLogDir(), sessionFiles.TRANSCRIPT_FILE), md, 'utf8');
  logDirty = false;
  return logDir;
}
// Appends the meeting title to a session folder name (once summarised).
// Keeps the live session's logDir in sync if that is the folder renamed.
function renameSessionDir(dir, startedAt, title) {
  if (!dir) return dir;
  const base = sessionFiles.sessionFolderName(startedAt, title);
  const current = path.basename(dir);
  if (current === base || new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_\\d+$').test(current)) return dir;
  const target = freeDir(base);
  try {
    fs.renameSync(dir, target);
    if (logDir && path.resolve(logDir) === path.resolve(dir)) logDir = target;
    return target;
  } catch (err) {
    console.log('[log] rename failed', err.message);
    return dir;
  }
}
function safeWriteSessionLog() {
  try { return writeSessionLog(); } catch (err) { console.error('[log] write failed', err.message || err); return null; }
}
setInterval(safeWriteSessionLog, LOG_AUTOSAVE_MS).unref();
app.on('before-quit', safeWriteSessionLog);

ipcMain.on('update-transcript-log', (_e, session) => {
  logSession = Object.assign({}, session, { endedAt: new Date().toISOString() });
  logDirty = true;
});
// "Limpiar": write the final version and start a new session file.
ipcMain.handle('save-transcript-log', (_e, session) => {
  try {
    if (session) { logSession = Object.assign({}, session, { endedAt: new Date().toISOString() }); logDirty = true; }
    const dir = writeSessionLog();
    logSession = null; logDir = null; logDirty = false;
    return dir ? { ok: true, file: dir } : { ok: true, skipped: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// --- screenshots: capture the screen and ask for an answer based on it ---
// Captures the display the overlay is on. The overlay itself is left out
// by content protection; when the user made it visible in captures it is
// protected just for the grab. The image is kept here (by id) so the
// renderer only sends the id back when asking for a suggestion, and saved
// as a JPEG in the session folder.
const SHOT_MAX_WIDTH = 1920;
const SHOT_KEEP = 20;
const shots = new Map(); // id -> { dataUrl, file, time }
let shotSeq = 0;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureScreen() {
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const scale = display.scaleFactor || 1;
  let width = Math.round(display.size.width * scale);
  let height = Math.round(display.size.height * scale);
  if (width > SHOT_MAX_WIDTH) { height = Math.round(height * SHOT_MAX_WIDTH / width); width = SHOT_MAX_WIDTH; }
  const unprotect = win && context.shareInterfaceVisible;
  if (unprotect) { try { win.setContentProtection(true); } catch (_) {} await delay(150); }
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) throw new Error('no se pudo capturar la pantalla (¿permiso de grabación de pantalla?)');
    return source.thumbnail;
  } finally {
    if (unprotect) applyShareVisibility();
  }
}

ipcMain.handle('screenshot-capture', async () => {
  try {
    const image = await captureScreen();
    const jpeg = image.toJPEG(82);
    const time = new Date();
    const id = 'shot-' + (++shotSeq);
    let file = '';
    try {
      const pad = (n) => String(n).padStart(2, '0');
      const base = `captura_${pad(time.getHours())}-${pad(time.getMinutes())}-${pad(time.getSeconds())}`;
      const dir = ensureLogDir();
      file = path.join(dir, base + '.jpg');
      for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}_${n}.jpg`);
      fs.writeFileSync(file, jpeg);
    } catch (err) { console.log('[shot] save failed', err.message); file = ''; }
    const dataUrl = 'data:image/jpeg;base64,' + jpeg.toString('base64');
    shots.set(id, { dataUrl, file, time });
    while (shots.size > SHOT_KEEP) shots.delete(shots.keys().next().value);
    const size = image.getSize();
    return { ok: true, id, dataUrl, file, width: size.width, height: size.height, time: time.toISOString() };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Streams the answer back with 'screenshot-delta' events; resolves with the full text.
ipcMain.handle('screenshot-suggest', async (e, id, opts, reqId) => {
  const shot = shots.get(String(id || ''));
  if (!shot) return { ok: false, error: 'la captura ya no está disponible; toma otra' };
  const key = String(reqId || id);
  try {
    const text = await llm.suggestFromScreenshot(shot.dataUrl, opts || {}, llmContext(), (partial) => {
      if (!e.sender.isDestroyed()) e.sender.send('screenshot-delta', key, partial);
    });
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// --- meeting mode: summary + memory ---
ipcMain.handle('set-mode', (_e, mode) => {
  context.mode = llm.normalizeMode(mode);
  saveContextToDisk();
  return context.mode;
});

ipcMain.handle('get-memory', () => memory);

// Summarises a transcript, stores it in the memory (re-summarising the same
// session replaces its previous version) and writes the summary files into
// the session folder, renamed to include the title. getDir() returns the
// folder once the summary is known (null: memory only).
async function summarizeSession(transcript, startedAt, endedAt, getDir) {
  const meetingId = meetingMemory.meetingIdFor(startedAt);
  const raw = await llm.summarizeMeeting(transcript, llmContext(meetingId));
  const parsed = meetingMemory.parseSummaryJson(raw);
  if (!parsed) return { ok: false, error: 'el modelo no devolvió un resumen válido', raw: raw.slice(0, 2000) };
  let dir = getDir();
  if (dir) dir = renameSessionDir(dir, startedAt, meetingMemory.normalizeSummary(parsed).title);
  const result = meetingMemory.applySummary(memory, parsed, { meetingId, startedAt, endedAt, folder: dir || '' });
  memory = result.memory;
  saveMemoryToDisk();
  if (dir) {
    const files = sessionFiles.meetingFiles(result.meeting, result.newItems, result.resolvedItems, meetingMemory.openItems(memory, meetingId));
    try {
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content, 'utf8');
    } catch (err) { console.error('[log] summary files failed', err.message || err); }
  }
  return { ok: true, meeting: result.meeting, newItems: result.newItems, resolvedItems: result.resolvedItems, memory, folder: dir || '' };
}

// The live conversation.
ipcMain.handle('meeting-summarize', async (_e, session) => {
  try {
    const snap = session || logSession;
    if (!snap || !Array.isArray(snap.transcript) || !snap.transcript.length) return { ok: false, error: 'no hay conversación para resumir' };
    const endedAt = new Date().toISOString();
    return await summarizeSession(snap.transcript, snap.startedAt, endedAt, () => {
      logSession = Object.assign({}, snap, { endedAt });
      logDirty = true;
      return safeWriteSessionLog();
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// --- history: browse saved sessions (transcripciones/) ---
ipcMain.handle('history-list', (_e, query) => {
  try { return { ok: true, sessions: history.listSessions(LOG_DIR, query), current: logDir ? path.basename(logDir) : '' }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('history-read', (_e, id) => {
  const s = history.readSession(LOG_DIR, id);
  return s ? { ok: true, info: s.info, files: s.files } : { ok: false, error: 'sesión no encontrada' };
});

// Summarise a saved session (e.g. one closed without summary). Old flat logs
// are first moved into their own folder.
ipcMain.handle('history-summarize', async (_e, id) => {
  try {
    if (!history.resolveSession(LOG_DIR, id)) return { ok: false, error: 'sesión no encontrada' };
    const started = history.stampDate(String(id));
    const dir = history.migrateFlatLog(LOG_DIR, id);
    const md = fs.readFileSync(path.join(dir, sessionFiles.TRANSCRIPT_FILE), 'utf8');
    const { transcript } = transcriptLog.parseTranscriptLog(md, started);
    if (!transcript.length) return { ok: false, error: 'la sesión no tiene transcripción' };
    const startedAt = started.toISOString();
    const endedAt = transcript[transcript.length - 1].time || startedAt;
    const r = await summarizeSession(transcript, startedAt, endedAt, () => dir);
    if (r.ok) r.id = path.basename(r.folder || dir);
    return r;
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Opens a session folder (or the transcripciones root) in the file explorer.
// Only paths inside LOG_DIR are allowed.
ipcMain.handle('open-folder', async (_e, folder) => {
  const rootDir = path.resolve(LOG_DIR);
  let target = path.resolve(String(folder || rootDir));
  if (target !== rootDir && !target.startsWith(rootDir + path.sep)) return { ok: false, error: 'ruta no permitida' };
  if (!fs.existsSync(target)) target = rootDir;
  fs.mkdirSync(target, { recursive: true });
  const err = await shell.openPath(target);
  return err ? { ok: false, error: err } : { ok: true };
});

ipcMain.handle('memory-initiatives', async () => {
  try { return { ok: true, text: await llm.proposeInitiatives(llmContext()) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('memory-set-item', (_e, id, done) => {
  memory = meetingMemory.setItemDone(memory, String(id || ''), !!done);
  saveMemoryToDisk();
  return memory;
});
ipcMain.handle('memory-remove-item', (_e, id) => {
  memory = meetingMemory.removeItem(memory, String(id || ''));
  saveMemoryToDisk();
  return memory;
});
ipcMain.handle('memory-remove-meeting', (_e, id) => {
  memory = meetingMemory.removeMeeting(memory, String(id || ''));
  saveMemoryToDisk();
  return memory;
});

ipcMain.handle('get-context', () => context);
ipcMain.handle('save-context', (_e, data) => {
  context = {
    mode: context.mode,
    meetingContext: llm.normalizeMeetingContext(data && data.meetingContext),
    meetingDocuments: llm.normalizeMeetingDocuments(data && data.meetingDocuments),
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
    documentCount: context.meetingDocuments.length,
    responseChars: context.responseChars,
    responseFormat: context.responseFormat,
    shareInterfaceVisible: context.shareInterfaceVisible,
  };
});

ipcMain.on('set-click-through', (_e, on) => setClickThrough(on));

// Window drag done by hand instead of -webkit-app-region: drag. The OS move
// loop (WM_SYSCOMMAND/SC_MOVE) can draw a drag outline / flash a white frame
// that screen-share captures even with content protection on; moving with
// setBounds never enters that loop, so nothing leaks while hidden.
let dragState = null;
ipcMain.on('drag-start', () => {
  if (!win) return;
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  dragState = { dx: c.x - b.x, dy: c.y - b.y, width: b.width, height: b.height };
});
ipcMain.on('drag-move', () => {
  if (!win || !dragState) return;
  const c = screen.getCursorScreenPoint();
  // setBounds with the fixed size: setPosition alone can grow the window across mixed-DPI monitors.
  win.setBounds({ x: c.x - dragState.dx, y: c.y - dragState.dy, width: dragState.width, height: dragState.height }, false);
});
ipcMain.on('drag-end', () => { dragState = null; });

// Compact bar (toolbar + live strip) <-> expanded (transcript + answer panes).
// Keeps x/y/width; remembers the expanded height the user dragged to.
ipcMain.on('set-layout', (_e, mode, compactHeight) => {
  if (!win || interviewBounds) return; // practice mode owns the bounds
  const b = win.getBounds();
  if (layout === 'expanded') expandedHeight = Math.max(320, b.height);
  layout = mode === 'expanded' ? 'expanded' : 'compact';
  const wa = screen.getDisplayMatching(b).workArea;
  const height = layout === 'compact'
    ? Math.max(60, Math.round(compactHeight || COMPACT_HEIGHT))
    : Math.max(320, Math.min(expandedHeight, wa.y + wa.height - b.y - 8));
  win.setBounds({ x: b.x, y: b.y, width: b.width, height }, false);
});

// Answer / clear shortcuts are global only while the interviewer is being
// heard, so they don't steal Ctrl+Shift+Enter / Backspace from other apps.
const LIVE_SHORTCUTS = { 'CommandOrControl+Shift+Enter': 'answer', 'CommandOrControl+Shift+Backspace': 'clear' };
let liveShortcuts = false;
ipcMain.on('set-live-shortcuts', (_e, on) => {
  if (!!on === liveShortcuts) return;
  liveShortcuts = !!on;
  for (const [accel, name] of Object.entries(LIVE_SHORTCUTS)) {
    if (liveShortcuts) registerShortcut(accel, () => { if (win) win.webContents.send('shortcut', name); });
    else { try { globalShortcut.unregister(accel); } catch (_) {} }
  }
});

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
ipcMain.on('minimize', hideWindow);

// Which sources are live (tray colour + tooltip).
ipcMain.on('set-live-state', (_e, st) => {
  liveState = { them: !!(st && st.them), me: !!(st && st.me) };
  updateTray();
});

ipcMain.on('quit', () => app.quit());

// Quick toggle: make the overlay visible to screenshots / screen sharing
// (same setting as "Mostrar el asistente al compartir pantalla").
ipcMain.handle('set-capture-visible', (_e, on) => {
  context.shareInterfaceVisible = on === true;
  saveContextToDisk();
  applyShareVisibility();
  return context.shareInterfaceVisible;
});

