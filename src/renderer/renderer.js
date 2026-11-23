'use strict';
const SR = 16000;
const SEND_SAMPLES = 3200; // ~200ms per WS frame

const el = (id) => document.getElementById(id);
const appEl = el('app'), statusEl = el('status');
const txList = el('txList'), chipsEl = el('chips'), ansEl = el('ans');
const IS_MAC = window.api && window.api.platform === 'darwin';

// macOS: global shortcuts are registered as CommandOrControl -> show Cmd (⌘).
// Ctrl+←/→ (answer navigation) really is Ctrl on every platform, so skip those.
if (IS_MAC) {
  for (const id of ['answerBtn', 'shotBtn', 'clickthru', 'minimize', 'close', 'ctBanner', 'clear']) {
    const n = el(id);
    if (!n) continue;
    if (n.title) n.title = n.title.replace(/Ctrl\+Shift/g, 'Cmd+Shift');
    n.querySelectorAll('kbd').forEach((k) => { if (k.textContent === 'Ctrl') k.textContent = '⌘'; });
  }
}

let clickThrough = false;
let sttLang = 'es', sttUrl = '', sttKey = '', sttModel = 'nova-2';
// Interviewer language. 'auto': voice gateway (parakeet-tdt: es/en/European
// languages, auto-detected, mixing allowed). 'zh': Deepgram nova-2 zh-CN
// (the gateway has no Chinese), each phrase translated to Spanish in a second
// column and answers generated locally from the translation.
const DG_LISTEN_URL = 'wss://api.deepgram.com/v1/listen';
let dgKey = '';
let themLang = 'auto';
try { themLang = localStorage.getItem('themLang') === 'zh' ? 'zh' : 'auto'; } catch (_) {}
const isZh = () => themLang === 'zh';
let responseChars = 500; // answer length limit (from settings)
// 'interview': job-interview copilot. 'meeting': any conversation (work,
// friends): live notes, summary on demand and a memory of open action items
// and previous conversations.
let appMode = 'interview';
const isMeeting = () => appMode === 'meeting';
let meetingDocuments = [];
let running = false;     // any live source (system audio or mic) active

let practiceHistory = [];
let practiceQuestion = '';
let practiceTotal = 5;
let practiceRecording = false;
let practiceCommitted = '';
let practiceInterim = '';
let practiceCtx = null, practiceNode = null, practiceSource = null, practiceStream = null;
let practiceAudio = null;

// Two gateway connections: the interviewer (system audio, with suggestions)
// and you (microphone, text only). The gateway allows exactly 2 at once.
const conns = { them: window.createSTT('them'), me: window.createSTT('me') };
const sources = { them: null, me: null }; // active audio pipelines

function toInt16(f32) {
  const i = new Int16Array(f32.length);
  for (let k = 0; k < f32.length; k++) { let v = Math.max(-1, Math.min(1, f32[k])); i[k] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return i;
}

// --- status pill ---
// kind: true/'err' for errors, 'busy' while generating, falsy otherwise.
function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.title = msg;
  statusEl.classList.toggle('err', kind === true || kind === 'err');
  statusEl.classList.toggle('busy', kind === 'busy');
}
const idleStatus = () => (isMeeting()
  ? (autoAnswer ? 'Notas en vivo activas' : 'Notas en vivo desactivadas')
  : (autoAnswer ? 'Auto respuesta activa' : 'Auto respuesta desactivada'));

// --- layout: compact bar <-> expanded panes ---
function compactHeight() {
  return el('toolbar').offsetHeight + el('strip').offsetHeight + (clickThrough ? el('ctBanner').offsetHeight : 0) + 2;
}
function setLayout(mode) {
  const compact = mode === 'compact';
  appEl.classList.toggle('compact', compact);
  el('layoutBtn').textContent = compact ? '⤢' : '⤡';
  el('layoutBtn').title = compact ? 'Expandir' : 'Contraer';
  el('layoutBtn').setAttribute('aria-label', compact ? 'Expandir' : 'Contraer');
  window.api.setLayout(compact ? 'compact' : 'expanded', compactHeight());
}
const isCompact = () => appEl.classList.contains('compact');
el('layoutBtn').onclick = () => setLayout(isCompact() ? 'expanded' : 'compact');

// --- session timer ---
let timerStart = 0, timerHandle = null;
function tickTimer() {
  const s = Math.floor((Date.now() - timerStart) / 1000);
  el('timer').textContent = '⏱ ' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function updateRunning() {
  running = !!(sources.them || sources.me);
  el('timer').classList.toggle('live', running);
  el('meter').classList.toggle('on', running);
  if (running && !timerHandle) { timerStart = Date.now(); tickTimer(); timerHandle = setInterval(tickTimer, 1000); }
  if (!running && timerHandle) { clearInterval(timerHandle); timerHandle = null; setMeter(0); }
  window.api.setLiveShortcuts(!!sources.them);
  window.api.setLiveState({ them: !!sources.them, me: !!sources.me });
}

// --- level meter ---
const meterBars = Array.from(el('meter').children);
const BAR_SHAPE = [0.55, 1, 0.75, 0.45];
let meterLevel = 0, meterQueued = false;
function setMeter(level) {
  meterBars.forEach((b, i) => b.style.setProperty('--lv', Math.min(1, level * BAR_SHAPE[i]).toFixed(2)));
}
function feedMeter(block) {
  let sum = 0;
  for (let i = 0; i < block.length; i += 4) sum += block[i] * block[i];
  const rms = Math.sqrt(sum / (block.length / 4));
  meterLevel = Math.max(meterLevel * 0.8, Math.min(1, rms * 6));
  if (!meterQueued) { meterQueued = true; requestAnimationFrame(() => { meterQueued = false; setMeter(meterLevel); }); }
}

// --- transcript: chat bubbles (expanded) + chips (compact) ---
const WHO_LABEL = { them: 'Entrevistador', me: 'Tú' };
const MEETING_WHO_LABEL = { them: 'Otros', me: 'Tú' };
const whoLabel = (who) => (isMeeting() ? MEETING_WHO_LABEL : WHO_LABEL)[who];
let bubbles = [];                          // [{who, el, txt, whoEl}]
const openBubble = { them: null, me: null }; // bubble still receiving finals
const interimEl = { them: null, me: null };
const hhmm = (d) => d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

function txEmpty(on) {
  const e = txList.querySelector('.tx-empty');
  if (e) e.hidden = !on;
}
function scrollTx() { txList.scrollTop = txList.scrollHeight; }

function addChip(who, text, interim) {
  let chip = interim ? chipsEl.querySelector('.chip.interim.' + who) : null;
  if (!chip) {
    chip = document.createElement('span');
    chip.className = 'chip ' + who + (interim ? ' interim' : '');
    chipsEl.appendChild(chip);
  }
  chip.textContent = text;
  if (interim) chipsEl.appendChild(chip); // keep the live partial last
  while (chipsEl.children.length > 8) chipsEl.firstChild.remove();
}
function dropInterim(who) {
  if (interimEl[who]) { interimEl[who].remove(); interimEl[who] = null; }
  const chip = chipsEl.querySelector('.chip.interim.' + who);
  if (chip) chip.remove();
}
function makeMsg(who, extraClass) {
  const m = document.createElement('div');
  m.className = 'msg ' + who + (extraClass ? ' ' + extraClass : '');
  const txt = document.createElement('div'); txt.className = 'txt';
  const whoEl = document.createElement('div'); whoEl.className = 'who';
  whoEl.textContent = whoLabel(who) + ' · ' + hhmm(new Date());
  m.append(txt, whoEl);
  return { el: m, txt, whoEl };
}
// Bilingual bubble (Chinese mode): original | translation, side by side.
function addTrColumn(msg) {
  msg.el.classList.add('bi');
  const tr = document.createElement('div');
  tr.className = 'tr pending';
  tr.textContent = '…';
  msg.txt.after(tr);
  msg.tr = tr;
  return msg;
}
function addFinal(who, text) {
  dropInterim(who);
  txEmpty(false);
  let b = openBubble[who];
  if (!b) {
    b = Object.assign({ who, text: '', time: new Date() }, makeMsg(who));
    if (who === 'them' && isZh()) { addTrColumn(b); b.trSeq = 0; }
    bubbles.push(b);
    openBubble[who] = b;
    txList.appendChild(b.el);
  }
  b.text += (b.text ? ' ' : '') + text;
  b.txt.textContent = b.text;
  if (b.tr) scheduleTranslate(b); // its chip shows the translation instead
  else addChip(who, text, false);
  scheduleSessionLog();
  scrollTx();
}
function setInterim(who, text) {
  if (!text) { dropInterim(who); return; }
  txEmpty(false);
  if (!interimEl[who]) {
    const m = makeMsg(who, 'interim');
    if (who === 'them' && isZh()) addTrColumn(m);
    interimEl[who] = m.el;
  }
  interimEl[who].querySelector('.txt').textContent = text;
  txList.appendChild(interimEl[who]); // stays at the bottom
  if (!(who === 'them' && isZh())) addChip(who, text, true);
  scrollTx();
}
function closeBubble(who) {
  const b = openBubble[who];
  openBubble[who] = null;
  if (b && b.tr && autoAnswer && sources.them) localAnswer(b, false);
}

// --- translation (Chinese mode) ---
// Each new final re-translates the whole bubble (debounced) so the Spanish
// stays coherent; only the newest request may write the result.
function scheduleTranslate(b) {
  clearTimeout(b.trTimer);
  b.trTimer = setTimeout(() => translateBubble(b), 250);
}
function translateBubble(b) {
  clearTimeout(b.trTimer); b.trTimer = null;
  if (b.trPromise && b.trSrc === b.text) return b.trPromise;
  const src = b.text, seq = ++b.trSeq;
  b.trSrc = src;
  b.tr.classList.add('pending');
  b.trPromise = window.api.translate(src, 'zh').then((r) => {
    if (seq !== b.trSeq) return b.translation || '';
    b.tr.classList.remove('pending');
    if (r && r.ok && r.text) {
      b.translation = r.text;
      b.tr.textContent = r.text;
      if (!b.chip || !b.chip.isConnected) { b.chip = document.createElement('span'); b.chip.className = 'chip them'; chipsEl.appendChild(b.chip); }
      b.chip.textContent = r.text;
      while (chipsEl.children.length > 8) chipsEl.firstChild.remove();
      scheduleSessionLog();
    } else {
      b.tr.textContent = b.translation || '(sin traducción)';
      setStatus('Traducción: ' + (r && r.error || 'error'), true);
    }
    return b.translation || '';
  });
  return b.trPromise;
}
// bubble: the phrase that was answered (local answers); else the latest one.
function markQuestion(who, bubble) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (b.who !== who || (bubble && b !== bubble)) continue;
    if (!b.whoEl.querySelector('.q')) {
      const q = document.createElement('span'); q.className = 'q'; q.textContent = isMeeting() ? ' · Nota' : ' · Pregunta detectada';
      b.whoEl.appendChild(q);
    }
    return;
  }
}

// --- answers: history with navigation ---
const isNoAnswer = (t) => !t || /^[-—–\s.]+$/.test(t);
let answers = [];   // [{id, who, question, text, mode, time, done}]
let view = -1;      // index of the answer on screen
let autoAnswer = true;   // interviewer: answer each phrase automatically
let mineAnswers = true;  // also answer the questions *you* ask (microphone)
let manualPending = false;
try {
  autoAnswer = localStorage.getItem('autoAnswer') !== 'off';
  mineAnswers = localStorage.getItem('mineAnswers') !== 'off';
} catch (_) {}

// Gateway output is capped by tokens; keep the configured character limit too.
function limitChars(text) {
  const clean = String(text || '').trim();
  if (clean.length <= responseChars) return clean;
  const room = responseChars - 1;
  const cut = clean.slice(0, room);
  const sp = cut.lastIndexOf(' ');
  return (sp >= room * 0.65 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}
// Screenshot answers may carry code: they are not cut to the spoken-answer limit.
const answerText = (a) => (a.mode === 'screenshot' ? String(a.text || '').trim() : limitChars(a.text));
// Paragraph lines -> <p>, "• "/"- " lines -> one <ul> per run of bullets,
// ``` fenced blocks -> <pre> (code from screenshot answers).
function formatAnswer(target, text) {
  target.replaceChildren();
  let ul = null, pre = null, code = [];
  for (const raw of String(text).split('\n')) {
    if (/^\s*```/.test(raw)) {
      if (pre) { pre = null; code = []; }
      else { pre = document.createElement('pre'); target.appendChild(pre); ul = null; }
      continue;
    }
    if (pre) { code.push(raw.replace(/\s+$/, '')); pre.textContent = code.join('\n'); continue; }
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[•●▪*]|-(?=\s))\s*(.*)$/);
    if (bullet) {
      if (!ul) { ul = document.createElement('ul'); target.appendChild(ul); }
      const li = document.createElement('li'); li.textContent = bullet[1]; ul.appendChild(li);
    } else {
      ul = null;
      const p = document.createElement('p'); p.textContent = line; target.appendChild(p);
    }
  }
}
const ansEmpty = () => (isMeeting()
  ? 'Las notas (ideas, pendientes, decisiones) aparecerán aquí mientras conversan. Pulsa 📝 Resumir al terminar.'
  : 'Las sugerencias aparecerán aquí cuando el entrevistador haga una pregunta.');
function renderAnswer() {
  const a = answers[view];
  el('prevAns').disabled = view <= 0;
  el('nextAns').disabled = view < 0 || view >= answers.length - 1;
  el('ansPos').textContent = answers.length ? (view + 1) + ' / ' + answers.length : '';
  el('ansPane').classList.toggle('generating', !!(a && !a.done));
  el('ansPane').classList.toggle('mine', !!(a && a.who === 'me'));
  if (!a) {
    el('ansTitle').textContent = '';
    ansEl.textContent = ansEmpty();
    ansEl.classList.add('empty');
    el('ansMeta').textContent = '';
    el('copyAns').disabled = true;
    return;
  }
  const q = String(a.question || '').trim();
  el('ansTitle').textContent = q.length > 160 ? q.slice(0, 159) + '…' : q;
  const t = a.text.trim();
  if (t.length < 3 || isNoAnswer(t)) { ansEl.textContent = 'Pensando…'; ansEl.classList.add('empty'); }
  else { formatAnswer(ansEl, answerText(a)); ansEl.classList.remove('empty'); }
  const label = a.mode === 'screenshot' ? 'Sugerencia (captura)' : isMeeting()
    ? (a.who === 'me' ? 'Nota (tú)' : 'Nota')
    : a.who === 'me' ? 'Tu pregunta' : a.mode === 'manual' ? 'Respuesta (manual)' : 'Respuesta (auto)';
  el('ansMeta').textContent = label + ' · ' + hhmm(a.time);
  el('copyAns').disabled = !a.done;
}
function showAnswer(i) {
  if (!answers.length) return;
  view = Math.max(0, Math.min(answers.length - 1, i));
  renderAnswer();
}
function removeAnswer(a) {
  const i = answers.indexOf(a);
  if (i < 0) return;
  answers.splice(i, 1);
  if (view > i) view--;
  else if (view === i) view = Math.min(i, answers.length - 1);
  renderAnswer();
}
el('prevAns').onclick = () => showAnswer(view - 1);
el('nextAns').onclick = () => showAnswer(view + 1);
el('copyAns').onclick = async () => {
  const a = answers[view];
  if (!a) return;
  try { await navigator.clipboard.writeText(answerText(a)); setStatus('Respuesta copiada'); }
  catch (_) { setStatus('No se pudo copiar', true); }
};

// Live answers are generated by the voice gateway after each phrase
// (suggest=auto) or on request (Suggest), and arrive on that source's socket:
// start → delta* → end. A newer phrase cancels the one in flight; "—" means
// "no answer needed". who: 'them' (interviewer) or 'me' (your own questions).
function onGatewaySuggestion(who, m) {
  if (m.status === 'start') {
    const followLatest = view === answers.length - 1;
    const mode = who === 'me' ? 'mine' : manualPending ? 'manual' : 'auto';
    answers.push({ id: m.id, who, question: m.transcript || '', text: '', mode, time: new Date(), done: false, bubble: m.bubble || null });
    if (who === 'them') manualPending = false;
    if (followLatest || view < 0) view = answers.length - 1;
    setStatus('Generando respuesta…', 'busy');
    renderAnswer();
    return;
  }
  const a = answers.find((x) => x.id === m.id);
  if (m.status === 'error' && /no hay texto nuevo/i.test(m.message || '')) {
    if (who === 'them' && !answers.some((x) => !x.done)) setStatus('Sin texto nuevo para responder');
    if (a) removeAnswer(a);
    return;
  }
  if (!a) return;
  if (m.status === 'delta') {
    a.text += m.delta || '';
    const t = a.text.trim();
    if (t.length >= 3 && !isNoAnswer(t) && isCompact()) setLayout('expanded');
    if (answers[view] === a) renderAnswer();
    return;
  }
  a.done = true;
  if (m.status === 'end') {
    a.text = String(m.suggestion || a.text);
    if (isNoAnswer(a.text.trim())) { removeAnswer(a); if (who === 'them') setStatus('Sin pregunta'); return; }
    markQuestion(who, a.bubble);
    scheduleSessionLog();
    setStatus(idleStatus());
    renderAnswer();
  } else if (m.status === 'cancelled') {
    removeAnswer(a); // a newer phrase took over; its 'start' follows
  } else if (m.status === 'error') {
    removeAnswer(a);
    setStatus('Respuesta: ' + (m.message || 'error'), true);
  }
}

// Chinese mode: Deepgram sends no suggestions, so answers come from the local
// LLM call using the Spanish translation (last few phrases as context). Same
// start → end/error/cancelled flow as the gateway; a newer phrase cancels.
let localSeq = 0;
async function localAnswer(b, manual) {
  const tr = await translateBubble(b);
  if (!tr) return;
  const id = 'local-' + (++localSeq);
  answers.filter((a) => a.who === 'them' && !a.done && String(a.id).startsWith('local-'))
    .forEach((a) => onGatewaySuggestion('them', { status: 'cancelled', id: a.id }));
  if (manual) manualPending = true;
  onGatewaySuggestion('them', { status: 'start', id, transcript: tr, bubble: b });
  const recent = bubbles.filter((x) => x.who === 'them' && x.translation).slice(-3).map((x) => x.translation).join('\n');
  let r;
  try { r = await window.api.suggest(recent || tr); } catch (err) { r = { ok: false, error: err.message || String(err) }; }
  if (!answers.some((a) => a.id === id && !a.done)) return; // cancelled meanwhile
  onGatewaySuggestion('them', r && r.ok
    ? { status: 'end', id, suggestion: r.text }
    : { status: 'error', id, message: (r && r.error) || 'error' });
}

const suggestMode = (who) => (who === 'them' ? (autoAnswer ? 'auto' : 'manual') : (mineAnswers ? 'auto' : 'off'));

// Opens the interviewer connection for the current language.
function openThem() {
  if (isZh()) conns.them.open(DG_LISTEN_URL, dgKey, 'nova-2', 'zh-CN', 'off');
  else conns.them.open(sttUrl, sttKey, sttModel, sttLang, suggestMode('them'));
}

// Sends rules + CV/JD to one connection (or both when who is omitted).
// Not to Deepgram (Chinese mode): it only understands its own messages.
async function configureGateway(resetHistory, who) {
  const list = (who ? [who] : ['them', 'me']).filter((w) => !(w === 'them' && isZh()));
  await Promise.all(list.map(async (w) => {
    const g = await window.api.gatewayConfig(resetHistory, w === 'me' ? 'candidate' : 'interviewer');
    responseChars = g.responseChars || responseChars;
    if (sources[w]) conns[w].configure(Object.assign({}, g.configure, { suggest: suggestMode(w) }));
  }));
}

function applyAutoUi() {
  const b = el('autoBtn');
  b.classList.toggle('on', autoAnswer);
  b.setAttribute('aria-pressed', String(autoAnswer));
  const name = isMeeting() ? 'Notas en vivo' : 'Auto respuesta';
  b.textContent = (autoAnswer ? '● ' : '○ ') + name;
  b.title = isMeeting()
    ? 'Anotar automáticamente ideas, pendientes y decisiones de lo que dicen los demás'
    : 'Responder automáticamente al terminar cada pregunta del entrevistador';
}
el('autoBtn').onclick = () => {
  autoAnswer = !autoAnswer;
  try { localStorage.setItem('autoAnswer', autoAnswer ? 'on' : 'off'); } catch (_) {}
  applyAutoUi();
  if (sources.them) configureGateway(false, 'them');
  setStatus(idleStatus());
};
applyAutoUi();

function applyMineUi() {
  const b = el('mineBtn');
  b.classList.toggle('on', mineAnswers);
  b.setAttribute('aria-pressed', String(mineAnswers));
  const name = isMeeting() ? 'Mis frases' : 'Mis preguntas';
  b.textContent = (mineAnswers ? '● ' : '○ ') + name;
  b.title = isMeeting()
    ? 'Anotar también lo que dices tú (micrófono)'
    : 'Sugerir también respuestas a las preguntas que haces tú (micrófono)';
}
el('mineBtn').onclick = () => {
  mineAnswers = !mineAnswers;
  try { localStorage.setItem('mineAnswers', mineAnswers ? 'on' : 'off'); } catch (_) {}
  applyMineUi();
  if (sources.me) configureGateway(false, 'me');
  setStatus(isMeeting()
    ? (mineAnswers ? 'También anoto lo que dices tú' : 'Solo anoto lo que dicen los demás')
    : (mineAnswers ? 'También respondo tus preguntas' : 'Solo respuestas al entrevistador'));
};
applyMineUi();

// Ask for an answer now: close the phrase in progress, then request it.
function answerNow() {
  if (!sources.them) { setStatus(isMeeting() ? 'Activa 🖥 para escuchar la reunión' : 'Activa 🖥 para escuchar al entrevistador', true); return; }
  conns.them.control('Finalize');
  setStatus('Pidiendo respuesta…', 'busy');
  if (isZh()) {
    // Answer the latest interviewer phrase once Finalize has flushed it.
    setTimeout(() => {
      const b = [...bubbles].reverse().find((x) => x.who === 'them' && x.tr);
      if (!b) { setStatus('Sin texto nuevo para responder'); return; }
      if (openBubble.them === b) openBubble.them = null; // don't auto-answer it again
      localAnswer(b, true);
    }, 400);
    return;
  }
  manualPending = true;
  setTimeout(() => conns.them.control('Suggest'), 200);
}
el('answerBtn').onclick = answerNow;

// --- screenshots: capture the screen, attach it to the conversation and,
// on request, suggest an answer based on it (plus the recent transcript) ---
let shots = []; // [{id, file, time, prompt, el}]
let shotBusy = false;
async function captureScreenshot() {
  if (shotBusy) return;
  shotBusy = true;
  el('shotBtn').disabled = true;
  setStatus('Capturando pantalla…', 'busy');
  let r;
  try { r = await window.api.captureScreen(); } catch (err) { r = { ok: false, error: err.message || String(err) }; }
  shotBusy = false;
  el('shotBtn').disabled = false;
  if (!r || !r.ok) { setStatus('Captura: ' + (r && r.error || 'error'), true); return; }
  const shot = { id: r.id, file: r.file || '', time: new Date(r.time || Date.now()), prompt: '' };
  shots.push(shot);
  addShotBubble(shot, r.dataUrl);
  scheduleSessionLog();
  if (isCompact()) setLayout('expanded');
  setStatus('Captura adjunta — pulsa 💡 Sugerir para pedir una respuesta');
}
el('shotBtn').onclick = captureScreenshot;

function addShotBubble(shot, dataUrl) {
  txEmpty(false);
  const m = document.createElement('div');
  m.className = 'msg shot';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Captura de pantalla';
  img.title = 'Clic para ampliar';
  img.onclick = () => m.classList.toggle('big');
  const row = document.createElement('div');
  row.className = 'shot-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 1000;
  input.placeholder = '¿Qué necesitas? (opcional)';
  input.setAttribute('aria-label', 'Pregunta sobre la captura');
  const btn = document.createElement('button');
  btn.className = 'small primary';
  btn.type = 'button';
  btn.textContent = '💡 Sugerir';
  btn.title = 'Sugerir una respuesta en base a esta captura y a la conversación reciente';
  const go = () => { if (!btn.disabled) suggestFromShot(shot, input.value, btn); };
  btn.onclick = go;
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
  row.append(input, btn);
  const whoEl = document.createElement('div');
  whoEl.className = 'who';
  whoEl.textContent = '📸 Captura · ' + hhmm(shot.time) + (shot.file ? ' · ' + shot.file.split(/[\\/]/).pop() : '');
  m.append(img, row, whoEl);
  shot.el = m;
  // Stay above the live (interim) bubbles, which keep themselves last.
  const firstInterim = txList.querySelector('.msg.interim');
  if (firstInterim) txList.insertBefore(m, firstInterim); else txList.appendChild(m);
  scrollTx();
}

// Recent transcript as plain lines, for context next to the image.
function recentTranscript(n) {
  return bubbles.filter((b) => b.text).slice(-(n || 8))
    .map((b) => whoLabel(b.who) + ': ' + (b.translation || b.text)).join('\n');
}

let shotReqSeq = 0;
async function suggestFromShot(shot, prompt, btn) {
  if (btn) btn.disabled = true;
  shot.prompt = String(prompt || '').trim();
  const id = 'shotreq-' + (++shotReqSeq);
  const question = '📸 ' + (shot.prompt || 'Captura de pantalla · ' + hhmm(shot.time));
  const a = { id, who: 'them', question, text: '', mode: 'screenshot', time: new Date(), done: false };
  answers.push(a);
  view = answers.length - 1;
  if (isCompact()) setLayout('expanded');
  setStatus('Analizando la captura…', 'busy');
  renderAnswer();
  let r;
  try {
    r = await window.api.suggestScreenshot(shot.id, { prompt: shot.prompt, transcript: recentTranscript(8) }, id);
  } catch (err) { r = { ok: false, error: err.message || String(err) }; }
  if (btn) btn.disabled = false;
  if (!answers.includes(a)) return; // cleared meanwhile
  if (!r || !r.ok || !String(r.text || '').trim()) {
    removeAnswer(a);
    setStatus('Captura: ' + (r && r.error || 'sin respuesta'), true);
    return;
  }
  a.text = r.text;
  a.done = true;
  scheduleSessionLog();
  setStatus('Sugerencia lista');
  renderAnswer();
}
window.api.onScreenshotDelta((reqId, text) => {
  const a = answers.find((x) => x.id === reqId && !x.done);
  if (!a) return;
  a.text = text;
  if (answers[view] === a) renderAnswer();
});

// --- audio sources ---
// Worklet → 200 ms Int16 frames → its gateway connection (+ level meter).
async function startPipeline(stream, conn) {
  const ctx = new AudioContext({ sampleRate: SR });
  await ctx.audioWorklet.addModule('recorder-worklet.js');
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'recorder-worklet');
  const silent = ctx.createGain();
  silent.gain.value = 0;
  let pcm = new Float32Array(0);
  node.port.onmessage = (ev) => {
    const block = ev.data;
    feedMeter(block);
    const merged = new Float32Array(pcm.length + block.length);
    merged.set(pcm, 0); merged.set(block, pcm.length); pcm = merged;
    while (pcm.length >= SEND_SAMPLES) {
      conn.send(toInt16(pcm.slice(0, SEND_SAMPLES)).buffer);
      pcm = pcm.slice(SEND_SAMPLES);
    }
  };
  src.connect(node);
  node.connect(silent).connect(ctx.destination);
  return { stream, ctx, src, node };
}
async function stopPipeline(p) {
  if (!p) return;
  try { p.node.disconnect(); } catch (_) {}
  try { p.src.disconnect(); } catch (_) {}
  try { await p.ctx.close(); } catch (_) {}
  try { p.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
}
function wireConn(who) {
  const c = conns[who];
  c.onFinal = (t) => addFinal(who, t);
  c.onInterim = (t) => setInterim(who, t);
  c.onUtterance = () => closeBubble(who);
  c.onSuggestion = (m) => onGatewaySuggestion(who, m);
  c.onStatus = (m, e) => { if (e) setStatus((who === 'me' ? 'Micrófono · ' : '') + m, true); };
  // Dropped socket (e.g. gateway restart 1012): the connection retries by
  // itself; answers in flight on it are lost, the rest of the session stays.
  c.onReconnect = (state, code, delay) => {
    const name = who === 'me' ? 'micrófono' : 'entrevistador';
    if (state === 'reconnecting') {
      dropInterim(who);
      closeBubble(who);
      answers.filter((a) => a.who === who && !a.done).forEach(removeAnswer);
      setStatus('Reconectando ' + name + '… (' + code + ', ' + Math.round(delay / 1000) + ' s)', 'busy');
    } else {
      setStatus(who === 'them' ? idleStatus() : 'Micrófono reconectado');
    }
  };
}
function setSourceUi(who, on) {
  const b = el(who === 'them' ? 'sysBtn' : 'micBtn');
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
}

async function startSource(who) {
  if (who === 'them' && isZh()) {
    if (!dgKey) { setStatus('Modo chino: falta DEEPGRAM_API_KEY en el archivo .env', true); return; }
  } else if (!sttKey) { setStatus('Falta STT_TOKEN en el archivo .env', true); return; }
  let stream = null;
  try {
    if (who === 'them') {
      setStatus('Conectando con el audio del sistema…');
      const noDsp = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: noDsp });
      display.getVideoTracks().forEach((t) => t.stop());
      stream = new MediaStream(display.getAudioTracks());
      const at = stream.getAudioTracks()[0];
      if (!at) throw new Error('sin pista de audio (loopback)');
      // macOS: if "System Audio Recording" isn't granted, Chromium hands back a
      // track that is already 'ended' and never delivers samples (no error).
      if (at.readyState === 'ended') {
        throw new Error(IS_MAC
          ? 'macOS bloqueó el audio del sistema. Activa ParakeetAI en Ajustes > Privacidad y seguridad > Grabación de pantalla y audio del sistema, y reabre la app.'
          : 'la pista de audio del sistema terminó al iniciar');
      }
      try { await at.applyConstraints(noDsp); } catch (_) {}
      console.log('[cap] track', at.label, JSON.stringify(at.getSettings()));
    } else {
      setStatus('Conectando con el micrófono…');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    }
    wireConn(who);
    if (who === 'them') openThem();
    else conns.me.open(sttUrl, sttKey, sttModel, sttLang, suggestMode('me'));
    sources[who] = await startPipeline(stream, conns[who]);
    await configureGateway(true, who);
    setSourceUi(who, true);
    updateRunning();
    setStatus(who === 'them' ? idleStatus() : 'Micrófono activo');
  } catch (err) {
    console.error('[cap] start error', who, err.message || err);
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    await stopSource(who);
    setStatus((who === 'me' ? 'Micrófono: ' : 'Error: ') + (err.message || err), true);
  }
}
async function stopSource(who) {
  const p = sources[who];
  sources[who] = null;
  try { conns[who].close(); } catch (_) {}
  await stopPipeline(p);
  dropInterim(who);
  closeBubble(who);
  if (who === 'them') manualPending = false;
  answers.filter((a) => a.who === who && !a.done).forEach(removeAnswer);
  setSourceUi(who, false);
  updateRunning();
}
// Stops everything (used before practice mode, which needs a connection).
async function stop() {
  await Promise.all([stopSource('them'), stopSource('me')]);
  if (!statusEl.classList.contains('err')) setStatus('Detenido');
}

// Interviewer language selector. While listening, only the socket is swapped:
// the audio pipeline keeps feeding conns.them.
function applyLangUi() {
  el('themLang').value = themLang;
  el('panes').classList.toggle('bilingual', isZh());
}
el('themLang').onchange = async () => {
  themLang = el('themLang').value === 'zh' ? 'zh' : 'auto';
  try { localStorage.setItem('themLang', themLang); } catch (_) {}
  applyLangUi();
  if (!sources.them) { setStatus(isZh() ? 'Entrevistador en chino: transcripción + traducción al español' : 'Entrevistador: idioma automático'); return; }
  if (isZh() && !dgKey) { setStatus('Modo chino: falta DEEPGRAM_API_KEY en el archivo .env', true); return; }
  dropInterim('them');
  openBubble.them = null;
  manualPending = false;
  answers.filter((a) => a.who === 'them' && !a.done).forEach(removeAnswer);
  openThem();
  await configureGateway(true, 'them');
  setStatus(isZh() ? 'Escuchando en chino → español' : idleStatus());
};
applyLangUi();

el('sysBtn').onclick =() => (sources.them ? stopSource('them').then(() => setStatus('Entrevistador en pausa')) : startSource('them'));
el('micBtn').onclick = () => (sources.me ? stopSource('me').then(() => setStatus('Micrófono apagado')) : startSource('me'));

// --- mode: interview <-> meeting ---
function applyModeUi() {
  appEl.classList.toggle('meeting', isMeeting());
  el('modeSel').value = appMode;
  el('sysBtn').title = isMeeting() ? 'Escuchar a los demás (audio del sistema: Teams, Meet, Zoom…)' : 'Escuchar al entrevistador (audio del sistema)';
  el('themLang').title = isMeeting() ? 'Idioma de los demás' : 'Idioma del entrevistador';
  const empty = txList.querySelector('.tx-empty');
  if (empty) empty.textContent = isMeeting()
    ? 'Pulsa 🖥 para escuchar la reunión (audio del sistema) y 🎙 para tu voz o una conversación en persona.'
    : 'Pulsa 🖥 para escuchar al entrevistador y 🎙 para tu voz.';
  el('ansPane').setAttribute('aria-label', isMeeting() ? 'Notas en vivo' : 'Respuesta sugerida');
  el('endMeetingBtn').title = isMeeting()
    ? 'Terminar la reunión: recoge las últimas frases, deja de escuchar, resume y guarda en la memoria'
    : 'Terminar la entrevista: recoge las últimas frases, deja de escuchar y guarda el log en el historial';
  applyAutoUi();
  applyMineUi();
  renderAnswer();
}
el('modeSel').onchange = async () => {
  const next = el('modeSel').value === 'meeting' ? 'meeting' : 'interview';
  if (next === appMode) return;
  appMode = await window.api.setMode(next);
  applyModeUi();
  el('memPanel').hidden = true;
  // New rules + context for the live connections; forget previous turns.
  configureGateway(true);
  setStatus(isMeeting() ? 'Modo reunión: notas en vivo, resumen y memoria' : 'Modo entrevista');
};

// --- memory panel (meeting mode) ---
let memory = { meetings: [], items: [] };
const dayLabel = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};
function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function addList(target, title, arr, fmt) {
  if (!arr || !arr.length) return;
  target.appendChild(mk('h4', null, title));
  const ul = mk('ul');
  for (const x of arr) ul.appendChild(mk('li', null, fmt ? fmt(x) : x));
  target.appendChild(ul);
}
// Session folder (transcripción, resumen, pendientes, ideas…) in the explorer.
async function openFolder(folder) {
  const r = await window.api.openFolder(folder || '');
  if (!r || !r.ok) setStatus('No se pudo abrir la carpeta: ' + (r && r.error || 'error'), true);
}
function folderButton(folder) {
  const b = mk('button', 'small mem-folder', '📂 Abrir carpeta');
  b.type = 'button';
  b.title = folder;
  b.onclick = () => openFolder(folder);
  return b;
}
const itemLabel = (it) => it.text + (it.owner ? ' — ' + it.owner : '');
// Meeting summary (fresh result or a stored meeting) into target.
function renderMeetingBody(target, m, newItems, resolvedItems) {
  if (m.summary) { target.appendChild(mk('h4', null, 'Resumen')); target.appendChild(mk('p', null, m.summary)); }
  addList(target, 'Ideas', m.ideas);
  addList(target, 'Decisiones', m.decisions);
  addList(target, 'Pendientes nuevos', newItems, itemLabel);
  addList(target, 'Pendientes anteriores resueltos', resolvedItems, itemLabel);
  addList(target, 'Próximos pasos', m.nextSteps);
  addList(target, 'Próximas iniciativas', m.initiatives);
  addList(target, 'Temas', m.topics);
}
function showMemResult(build, isError) {
  const box = el('memResult');
  box.replaceChildren();
  box.classList.toggle('err', !!isError);
  if (typeof build === 'string') box.textContent = build;
  else build(box);
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}
// Plain-text answer with "TITLE" lines and "• " bullets -> headings + lists.
function formatPlan(target, text) {
  let ul = null;
  for (const raw of String(text).split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[•●▪*]|-(?=\s)|\d+[.)])\s*(.*)$/);
    if (bullet) {
      if (!ul) { ul = mk('ul'); target.appendChild(ul); }
      ul.appendChild(mk('li', null, bullet[1]));
    } else {
      ul = null;
      const heading = line.length < 60 && line === line.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(line);
      target.appendChild(mk(heading ? 'h4' : 'p', null, line.replace(/^#+\s*/, '')));
    }
  }
}
function renderMemory() {
  const items = memory.items || [];
  const open = items.filter((it) => !it.done);
  const done = items.filter((it) => it.done).slice(-30).reverse();
  const row = (it) => {
    const li = mk('li', it.done ? 'done' : '');
    const cb = mk('input');
    cb.type = 'checkbox';
    cb.checked = it.done;
    cb.title = it.done ? 'Marcar como pendiente' : 'Marcar como hecho';
    cb.onchange = async () => { memory = await window.api.setMemoryItem(it.id, cb.checked); renderMemory(); configureGateway(false); };
    const txt = mk('span', 'mem-text', it.text);
    const sub = [it.owner, it.createdAt && 'desde ' + dayLabel(it.createdAt)].filter(Boolean).join(' · ');
    if (sub) txt.appendChild(mk('span', 'mem-sub', sub));
    const del = mk('button', null, '✕');
    del.type = 'button';
    del.title = 'Eliminar pendiente';
    del.setAttribute('aria-label', 'Eliminar pendiente');
    del.onclick = async () => { memory = await window.api.removeMemoryItem(it.id); renderMemory(); configureGateway(false); };
    li.append(cb, txt, del);
    return li;
  };
  el('memOpen').replaceChildren(...(open.length ? open.map(row) : [mk('li', 'mem-empty', 'Sin pendientes abiertos.')]));
  el('memDone').replaceChildren(...done.map(row));
  el('memDoneLabel').textContent = 'Completados (' + items.filter((it) => it.done).length + ')';

  const meetings = (memory.meetings || []).slice().reverse();
  const wrap = el('memMeetings');
  wrap.replaceChildren();
  if (!meetings.length) wrap.appendChild(mk('div', 'mem-empty', 'Aún no hay conversaciones resumidas. Escucha una conversación y pulsa 📝 Resumir.'));
  for (const m of meetings) {
    const d = mk('details', 'mem-meeting');
    const sum = mk('summary', null, m.title || 'Conversación');
    sum.appendChild(mk('span', 'muted', dayLabel(m.startedAt)));
    const body = mk('div', 'mem-result');
    renderMeetingBody(body, m, (memory.items || []).filter((it) => it.meetingId === m.id), null);
    const del = mk('button', 'small mem-del', 'Eliminar de la memoria');
    del.type = 'button';
    del.onclick = async () => {
      if (!confirm('¿Eliminar «' + (m.title || 'Conversación') + '» y sus pendientes de la memoria? No se puede deshacer.')) return;
      memory = await window.api.removeMemoryMeeting(m.id);
      renderMemory();
      configureGateway(false);
    };
    d.append(sum, body);
    if (m.folder) {
      const h = mk('button', 'small mem-folder', '📚 Ver en historial');
      h.type = 'button';
      h.onclick = () => openHistory(m.folder.split(/[\\/]/).pop());
      d.appendChild(h);
      d.appendChild(folderButton(m.folder));
    }
    d.appendChild(del);
    wrap.appendChild(d);
  }
  el('memInfo').textContent = open.length + ' pendiente' + (open.length === 1 ? '' : 's') + ' · ' + meetings.length + ' conversaci' + (meetings.length === 1 ? 'ón' : 'ones');
}
async function openMemPanel() {
  if (isCompact()) setLayout('expanded');
  el('ctxPanel').hidden = true;
  el('histPanel').hidden = true;
  memory = await window.api.getMemory();
  renderMemory();
  el('memPanel').hidden = false;
  el('memClose').focus();
}
function closeMemPanel() { el('memPanel').hidden = true; el('memBtn').focus(); }

let summarizing = false;
async function summarizeConversation() {
  if (summarizing) return;
  const snap = sessionSnapshot();
  if (!snap || !snap.transcript.length) { setStatus('No hay conversación para resumir todavía', true); return false; }
  summarizing = true;
  el('summarizeBtn').disabled = el('memSummarize').disabled = true;
  if (el('memPanel').hidden) await openMemPanel();
  showMemResult('Resumiendo la conversación y actualizando pendientes…');
  setStatus('Resumiendo conversación…', 'busy');
  let r;
  try { r = await window.api.summarizeMeeting(snap); } catch (err) { r = { ok: false, error: err.message || String(err) }; }
  summarizing = false;
  el('summarizeBtn').disabled = el('memSummarize').disabled = false;
  if (!r || !r.ok) {
    showMemResult('No se pudo resumir: ' + (r && r.error || 'error'), true);
    setStatus('Resumen: ' + (r && r.error || 'error'), true);
    return false;
  }
  memory = r.memory;
  renderMemory();
  showMemResult((box) => {
    box.appendChild(mk('div', 'mem-title', '📝 ' + r.meeting.title));
    renderMeetingBody(box, r.meeting, r.newItems, r.resolvedItems);
    if (r.meeting.folder) box.appendChild(folderButton(r.meeting.folder));
  });
  configureGateway(false); // live notes now know the updated pending items
  setStatus('Resumen guardado en la memoria');
  return true;
}

// A phrase still being recognised (interim) would be lost on stop: keep it.
function flushInterim(who) {
  const node = interimEl[who];
  const text = node && node.querySelector('.txt').textContent.trim();
  if (text) addFinal(who, text);
  else dropInterim(who);
}

// "Terminar reunión": the last ideas usually come at the very end, so first
// flush what is still in the pipeline (Finalize + pending interim), then stop
// listening, summarise into the memory and start a fresh session. If the
// summary fails the transcript stays on screen to retry with 📝 Resumir.
// Interview mode does the same minus the summary: stop, save the log, clear.
let endingMeeting = false;
async function endMeeting() {
  if (endingMeeting || summarizing) return;
  const meeting = isMeeting();
  if (!running && !bubbles.some((b) => b.text)) { setStatus(meeting ? 'No hay reunión en curso' : 'No hay entrevista en curso', true); return; }
  endingMeeting = true;
  const btn = el('endMeetingBtn');
  btn.disabled = true;
  try {
    const live = ['them', 'me'].filter((w) => sources[w]);
    if (live.length) {
      setStatus('Recogiendo las últimas frases…', 'busy');
      live.forEach((w) => { try { conns[w].control('Finalize'); } catch (_) {} });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      live.forEach(flushInterim);
      await Promise.all(live.map(stopSource));
    }
    // Chinese mode: wait for translations still in flight.
    await Promise.all(bubbles.filter((b) => b.tr && (b.trTimer || b.trPromise)).map((b) => translateBubble(b).catch(() => '')));
    if (!meeting) {
      await clearAll(); // saves the session log (transcripciones/)
      if (!statusEl.classList.contains('err')) setStatus('Entrevista terminada · log guardado en el 📚 Historial');
      return;
    }
    if (!(await summarizeConversation())) {
      setStatus('No se pudo resumir: la conversación sigue en pantalla, reintenta con 📝 Resumir', true);
      return;
    }
    await clearAll();
    setStatus('Reunión terminada · resumen guardado en 🧠 Memoria');
  } finally {
    endingMeeting = false;
    btn.disabled = false;
  }
}

async function proposeNextSteps() {
  const btn = el('memPlan');
  btn.disabled = true;
  showMemResult('Pensando próximos pasos e iniciativas…');
  let r;
  try { r = await window.api.proposeInitiatives(); } catch (err) { r = { ok: false, error: err.message || String(err) }; }
  btn.disabled = false;
  if (!r || !r.ok) { showMemResult('No se pudo generar la propuesta: ' + (r && r.error || 'error'), true); return; }
  showMemResult((box) => { box.appendChild(mk('div', 'mem-title', '💡 Cómo seguir')); formatPlan(box, r.text); });
}

el('memBtn').onclick = openMemPanel;
el('memClose').onclick = closeMemPanel;
el('summarizeBtn').onclick = summarizeConversation;
el('endMeetingBtn').onclick = endMeeting;
el('memSummarize').onclick = summarizeConversation;
el('memPlan').onclick = proposeNextSteps;
el('memFolders').onclick = () => openFolder('');

// --- history panel: browse saved sessions (one folder per conversation) ---
const HIST_TABS = { 'resumen.md': 'Resumen', 'pendientes.md': 'Pendientes', 'ideas.md': 'Ideas', 'proximos-pasos.md': 'Próximos pasos', 'transcripcion.md': 'Transcripción' };
let histSessions = [], histSelected = '', histCurrent = '', histDoc = null, histTab = '', histSearchTimer = null;

// Inline **bold** and _italic_ as DOM nodes (never innerHTML).
function mdInline(target, text) {
  for (const part of String(text).split(/(\*\*[^*]+\*\*|(?:^|(?<=\s))_[^_]+_(?=\s|$))/)) {
    if (!part) continue;
    if (/^\*\*[^*]+\*\*$/.test(part)) target.appendChild(mk('strong', null, part.slice(2, -2)));
    else if (/^_[^_]+_$/.test(part)) target.appendChild(mk('em', null, part.slice(1, -1)));
    else target.appendChild(document.createTextNode(part));
  }
}
// Minimal Markdown for the session files: headings, lists, checkboxes, quotes.
function mdRender(target, md) {
  target.replaceChildren();
  let ul = null;
  for (const raw of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { ul = null; continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/);
    if (h) {
      ul = null;
      const n = mk(['h3', 'h4', 'h5'][h[1].length - 1]);
      mdInline(n, h[2]);
      target.appendChild(n);
    } else if (li) {
      if (!ul) { ul = mk('ul'); target.appendChild(ul); }
      const item = mk('li', li[1] == null ? '' : li[1] === ' ' ? 'todo' : 'done');
      if (li[1] != null) item.appendChild(document.createTextNode(li[1] === ' ' ? '☐ ' : '☑ '));
      mdInline(item, li[2]);
      ul.appendChild(item);
    } else if (/^>\s?/.test(line)) {
      ul = null;
      const q = mk('blockquote');
      mdInline(q, line.replace(/^>\s?/, ''));
      target.appendChild(q);
    } else {
      ul = null;
      const p = mk('p', /^_[^_]+_$/.test(line) ? 'muted' : '');
      mdInline(p, line);
      target.appendChild(p);
    }
  }
  if (!target.childNodes.length) target.appendChild(mk('p', 'muted', 'Archivo vacío.'));
}
const dateTimeLabel = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-CL', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
function setHistStatus(msg, isErr) {
  el('histStatus').textContent = msg || '';
  el('histStatus').style.color = isErr ? 'var(--err)' : '';
}
function renderHistList() {
  const list = el('histList');
  list.replaceChildren();
  if (!histSessions.length) {
    list.appendChild(mk('div', 'mem-empty', el('histSearch').value.trim() ? 'Sin resultados.' : 'Aún no hay conversaciones guardadas.'));
    return;
  }
  for (const s of histSessions) {
    const b = mk('button', 'hist-item' + (s.id === histSelected ? ' sel' : ''));
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(s.id === histSelected));
    b.appendChild(mk('span', 't', s.title));
    const d = mk('span', 'd', dateTimeLabel(s.startedAt));
    if (s.mode) d.appendChild(mk('span', 'badge' + (s.mode === 'meeting' ? ' meeting' : ''), s.mode === 'meeting' ? 'Reunión' : 'Entrevista'));
    if (s.mode !== 'interview' && !s.hasSummary) d.appendChild(mk('span', 'badge pending', 'sin resumen'));
    if (s.id === histCurrent) d.appendChild(mk('span', 'badge live', 'en curso'));
    b.appendChild(d);
    if (s.summary) b.appendChild(mk('span', 's', s.summary));
    b.onclick = () => selectHistory(s.id);
    list.appendChild(b);
  }
}
async function loadHistory(query) {
  const r = await window.api.historyList(query || '');
  if (!r || !r.ok) { setHistStatus('No se pudo leer el historial: ' + (r && r.error || 'error'), true); return; }
  histSessions = r.sessions;
  histCurrent = r.current || '';
  renderHistList();
}
function renderHistTab() {
  const tabs = el('histTabs');
  tabs.replaceChildren();
  for (const f of histDoc.info.files) {
    const t = mk('button', null, HIST_TABS[f] || f);
    t.type = 'button';
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-selected', String(f === histTab));
    t.onclick = () => { histTab = f; renderHistTab(); };
    tabs.appendChild(t);
  }
  mdRender(el('histContent'), histDoc.files[histTab] || '');
  el('histContent').scrollTop = 0;
}
async function selectHistory(id) {
  histSelected = id;
  renderHistList();
  setHistStatus('');
  const r = await window.api.historyRead(id);
  if (histSelected !== id) return;
  if (!r || !r.ok) { setHistStatus(r && r.error || 'No se pudo abrir', true); return; }
  histDoc = r;
  const info = r.info;
  el('histEmpty').hidden = true;
  el('histView').hidden = false;
  el('histTitle').textContent = info.title;
  el('histDate').textContent = dateTimeLabel(info.startedAt) + (info.kind === 'file' ? ' · log antiguo' : '');
  const canSummarize = info.mode !== 'interview';
  el('histSummarize').hidden = !canSummarize;
  el('histSummarize').textContent = info.hasSummary ? '↻ Volver a resumir' : '📝 Resumir';
  el('histSummarize').title = info.kind === 'file'
    ? 'Resume esta conversación (el log se mueve a su propia carpeta)'
    : 'Genera resumen, pendientes, ideas y próximos pasos, y lo guarda en la memoria';
  if (!info.files.includes(histTab)) histTab = info.files.includes('resumen.md') ? 'resumen.md' : info.files[0];
  renderHistTab();
}
async function openHistory(id) {
  if (isCompact()) setLayout('expanded');
  el('ctxPanel').hidden = true;
  el('memPanel').hidden = true;
  el('histPanel').hidden = false;
  el('histSearch').value = '';
  await loadHistory('');
  const pick = id && histSessions.some((s) => s.id === id) ? id : (histSelected && histSessions.some((s) => s.id === histSelected) ? histSelected : '');
  if (pick) await selectHistory(pick);
  else { histDoc = null; el('histView').hidden = true; el('histEmpty').hidden = false; }
  el('histSearch').focus();
}
function closeHistory() { el('histPanel').hidden = true; el('historyBtn').focus(); }

el('historyBtn').onclick = () => openHistory('');
el('memHistory').onclick = () => openHistory('');
el('histClose').onclick = closeHistory;
el('histFolders').onclick = () => openFolder('');
el('histOpen').onclick = () => { if (histDoc) openFolder(histDoc.info.path); };
el('histSearch').oninput = () => {
  clearTimeout(histSearchTimer);
  histSearchTimer = setTimeout(() => loadHistory(el('histSearch').value), 250);
};
el('histSummarize').onclick = async () => {
  if (!histDoc) return;
  const btn = el('histSummarize');
  btn.disabled = true;
  setHistStatus('Resumiendo la conversación y actualizando pendientes…');
  let r;
  try { r = await window.api.historySummarize(histDoc.info.id); } catch (err) { r = { ok: false, error: err.message || String(err) }; }
  btn.disabled = false;
  if (!r || !r.ok) { setHistStatus('No se pudo resumir: ' + (r && r.error || 'error'), true); return; }
  memory = r.memory;
  configureGateway(false); // live notes know the updated pending items
  histTab = 'resumen.md';
  await loadHistory(el('histSearch').value);
  await selectHistory(r.id);
  setHistStatus('✓ Resumen guardado en la carpeta y en 🧠 Memoria');
};
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !el('histPanel').hidden) { ev.preventDefault(); closeHistory(); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !el('memPanel').hidden) { ev.preventDefault(); closeMemPanel(); }
});

// --- session log (transcripciones/) ---
// Snapshot of the session: transcript + finished answers.
function sessionSnapshot() {
  const transcript = bubbles.filter((b) => b.text).map((b) => ({ who: b.who, text: b.text, translation: b.translation || '', time: b.time && b.time.toISOString() }));
  const done = answers.filter((a) => a.done && !isNoAnswer(a.text.trim()))
    .map((a) => ({ who: a.who, question: a.question, text: answerText(a), mode: a.mode, time: a.time.toISOString() }));
  const screenshots = shots.filter((x) => x.file).map((x) => ({ file: x.file, prompt: x.prompt || '', time: x.time.toISOString() }));
  if (!transcript.length && !done.length && !screenshots.length) return null;
  const times = [...transcript, ...done, ...screenshots].map((x) => x.time).filter(Boolean).sort();
  return { mode: appMode, startedAt: times[0], transcript, answers: done, screenshots };
}
// Main keeps the latest snapshot and autosaves it (periodically and on quit).
let logTimer = null;
function pushSessionLog() {
  clearTimeout(logTimer); logTimer = null;
  const snap = sessionSnapshot();
  if (snap) window.api.updateTranscriptLog(snap);
}
function scheduleSessionLog() {
  if (!logTimer) logTimer = setTimeout(pushSessionLog, 1000);
}
window.addEventListener('beforeunload', pushSessionLog);

// Saves the final version before clearing; main then starts a new file.
async function saveSessionLog() {
  clearTimeout(logTimer); logTimer = null;
  const snap = sessionSnapshot();
  if (!snap) return null;
  try {
    const r = await window.api.saveTranscriptLog(snap);
    if (!r || !r.ok) { setStatus('No se pudo guardar el log: ' + (r && r.error || 'error'), true); return null; }
    return r.file || null;
  } catch (err) {
    setStatus('No se pudo guardar el log: ' + (err.message || err), true);
    return null;
  }
}

async function clearAll() {
  const saved = await saveSessionLog();
  bubbles = []; openBubble.them = openBubble.me = null; interimEl.them = interimEl.me = null;
  txList.querySelectorAll('.msg').forEach((m) => m.remove());
  txEmpty(true);
  chipsEl.replaceChildren();
  answers = []; view = -1; renderAnswer();
  shots = [];
  configureGateway(true); // forget previous turns on the gateway too
  if (saved) setStatus('Log guardado: ' + saved.split(/[\\/]/).pop());
  else if (!statusEl.classList.contains('err')) setStatus(running ? idleStatus() : 'Limpio');
}
el('clear').onclick = clearAll;

// Global shortcuts (only registered while listening) arrive from main.
window.api.onShortcut((name) => {
  if (name === 'answer') answerNow();
  else if (name === 'clear') clearAll();
  else if (name === 'screenshot') captureScreenshot();
});
document.addEventListener('keydown', (ev) => {
  if (!ev.ctrlKey || ev.altKey || ev.metaKey) return;
  if (ev.target && /^(TEXTAREA|INPUT)$/.test(ev.target.tagName)) return;
  if (ev.key === 'ArrowLeft') { ev.preventDefault(); showAnswer(view - 1); }
  else if (ev.key === 'ArrowRight') { ev.preventDefault(); showAnswer(view + 1); }
  else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); answerNow(); }
});

// --- wiring ---
el('close').onclick = async () => { try { if (running) await stop(); } finally { window.api.quit(); } };
el('minimize').onclick = () => window.api.minimize();

function applyClickThroughUi(on) {
  clickThrough = on;
  el('clickthru').classList.toggle('active', on);
  el('clickthru').setAttribute('aria-pressed', String(on));
  document.getElementById('app').classList.toggle('click-through', on);
  if (isCompact()) setLayout('compact'); // banner changes the bar height
}
el('clickthru').onclick = () => {
  applyClickThroughUi(!clickThrough);
  window.api.setClickThrough(clickThrough);
};
// main process may toggle it from the global shortcut or the tray
window.api.onClickThroughChanged(applyClickThroughUi);

// --- window drag (replaces -webkit-app-region: drag, see main.js drag-start) ---
// Toolbar and practice header move the window; their controls keep working.
const DRAG_HANDLES = '#toolbar, .practice-head';
const DRAG_SKIP = 'button, select, input, textarea, summary, a, label, [contenteditable]';
let dragPointer = null;
document.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || clickThrough) return;
  const handle = ev.target.closest(DRAG_HANDLES);
  if (!handle || ev.target.closest(DRAG_SKIP)) return;
  ev.preventDefault();
  dragPointer = { id: ev.pointerId, handle };
  handle.setPointerCapture(ev.pointerId);
  window.api.dragStart();
});
document.addEventListener('pointermove', (ev) => {
  if (dragPointer && ev.pointerId === dragPointer.id) window.api.dragMove();
});
function endDrag(ev) {
  if (!dragPointer || (ev && ev.pointerId !== undefined && ev.pointerId !== dragPointer.id)) return;
  try { dragPointer.handle.releasePointerCapture(dragPointer.id); } catch (_) {}
  dragPointer = null;
  window.api.dragEnd();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
document.addEventListener('lostpointercapture', endDrag, true);
window.addEventListener('blur', () => endDrag());

// --- visible / hidden in screenshots (content protection) ---
let captureVisible = false;
document.documentElement.classList.add('stealth'); // hidden by default until config says otherwise
function applyCaptureUi(on) {
  captureVisible = on;
  document.documentElement.classList.toggle('stealth', !on);
  const header = el('captureToggle');
  header.classList.toggle('active', on);
  header.setAttribute('aria-pressed', String(on));
  header.title = on
    ? 'Visible en capturas de pantalla. Clic para ocultarlo'
    : 'Oculto en capturas de pantalla. Clic para mostrarlo';
  header.setAttribute('aria-label', on ? 'Ocultar en capturas de pantalla' : 'Mostrar en capturas de pantalla');
  const practice = el('practiceCapture');
  practice.classList.toggle('active', on);
  practice.setAttribute('aria-pressed', String(on));
  practice.textContent = on ? '📷 Visible en capturas' : '📷 Oculto en capturas';
  el('shareInterfaceVisible').checked = on;
}
async function toggleCapture() {
  const on = await window.api.setCaptureVisible(!captureVisible);
  applyCaptureUi(on);
  const msg = on
    ? 'Visible en capturas: ya puedes tomar un pantallazo (Win+Shift+S)'
    : 'Oculto en capturas y al compartir pantalla';
  if (el('practiceDialog').open) setPracticeStatus(msg);
  else setStatus(msg);
}
el('captureToggle').onclick = toggleCapture;
el('practiceCapture').onclick = toggleCapture;

// --- interview context panel ---
function ctxInfoText() {
  el('ctxInfo').className = '';
  el('ctxInfo').textContent = 'CV: ' + el('cv').value.length + ' caracteres · Cargo: ' + el('jd').value.length + ' caracteres';
}
function renderMeetingDocuments() {
  const list = el('meetingDocumentsList');
  list.replaceChildren();
  meetingDocuments.forEach((doc, index) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'doc-name';
    name.textContent = doc.name;
    const size = document.createElement('span');
    size.className = 'doc-size';
    size.textContent = doc.text.length.toLocaleString('es-CL') + ' caracteres';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'doc-remove';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', 'Quitar ' + doc.name);
    remove.onclick = () => { meetingDocuments.splice(index, 1); renderMeetingDocuments(); };
    li.append(name, size, remove);
    list.append(li);
  });
  const total = meetingDocuments.reduce((sum, doc) => sum + doc.text.length, 0);
  el('meetingDocumentsStatus').textContent = meetingDocuments.length
    ? `${meetingDocuments.length}/5 documentos · ${total.toLocaleString('es-CL')}/12.000 caracteres`
    : 'Sin documentos agregados.';
}
function closeCtxPanel() { el('ctxPanel').hidden = true; el('settings').focus(); }
el('settings').onclick = async () => {
  if (isCompact()) setLayout('expanded'); // the panel needs the full window
  const c = await window.api.getContext();
  el('meetingContext').value = c.meetingContext || '';
  meetingDocuments = Array.isArray(c.meetingDocuments) ? c.meetingDocuments.map((doc) => ({ name: doc.name, text: doc.text })) : [];
  renderMeetingDocuments();
  el('memPanel').hidden = true;
  el('histPanel').hidden = true;
  el('cv').value = c.cv || '';
  el('jd').value = c.jd || '';
  el('responseChars').value = c.responseChars || 500;
  const responseFormat = c.responseFormat === 'paragraph' ? 'paragraph' : 'bullets';
  document.querySelector(`input[name="responseFormat"][value="${responseFormat}"]`).checked = true;
  el('responseInstructions').value = c.responseInstructions || '';
  el('shareInterfaceVisible').checked = c.shareInterfaceVisible === true;
  ctxInfoText();
  el('ctxPanel').hidden = false;
  (isMeeting() ? el('meetingContext') : el('jd')).focus();
};
el('ctxClose').onclick = closeCtxPanel;
el('ctxCancel').onclick = closeCtxPanel;
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !el('ctxPanel').hidden) { ev.preventDefault(); closeCtxPanel(); }
});
el('ctxSave').onclick = async () => {
  const charsInput = el('responseChars');
  if (!charsInput.checkValidity()) { charsInput.reportValidity(); return; }
  const r = await window.api.saveContext({
    meetingContext: el('meetingContext').value,
    meetingDocuments,
    cv: el('cv').value,
    jd: el('jd').value,
    responseChars: charsInput.value,
    responseFormat: document.querySelector('input[name="responseFormat"]:checked').value,
    responseInstructions: el('responseInstructions').value,
    shareInterfaceVisible: el('shareInterfaceVisible').checked,
  });
  if (r && r.ok) applyCaptureUi(r.shareInterfaceVisible === true);
  // New CV/JD/rules apply now; reset the gateway's turn history (last 6 Q&A),
  // otherwise old answers keep leaking the previous context.
  if (r && r.ok) configureGateway(true);
  if (!r || !r.ok) {
    el('ctxInfo').className = 'err';
    el('ctxInfo').textContent = 'No se pudo guardar.';
    return;
  }
  const formatLabel = r.responseFormat === 'paragraph' ? 'texto continuo' : 'lista de puntos';
  el('ctxInfo').className = 'ok';
  el('ctxInfo').textContent = isMeeting() ? '✓ Guardado' : '✓ Guardado · ' + r.responseChars + ' caracteres · ' + formatLabel;
  if (!running && !statusEl.classList.contains('err')) setStatus('Listo — pulsa 🖥 para escuchar');
  setTimeout(closeCtxPanel, 700);
};
el('cv').oninput = ctxInfoText;
el('jd').oninput = ctxInfoText;

el('meetingDocumentsBtn').onclick = () => el('meetingDocuments').click();
el('meetingDocuments').onchange = async (ev) => {
  const files = Array.from(ev.target.files || []);
  const status = el('meetingDocumentsStatus');
  for (const file of files) {
    if (meetingDocuments.length >= 5) { status.textContent = 'Máximo 5 documentos.'; break; }
    if (file.size > 10 * 1024 * 1024) { status.textContent = `${file.name}: supera 10 MB.`; continue; }
    if (!/\.(pdf|txt|md)$/i.test(file.name)) { status.textContent = `${file.name}: formato no compatible.`; continue; }
    status.textContent = 'Leyendo ' + file.name + '…';
    try {
      const raw = /\.pdf$/i.test(file.name) ? await pdfToText(await file.arrayBuffer()) : await file.text();
      const used = meetingDocuments.reduce((sum, doc) => sum + doc.text.length, 0);
      const text = raw.replace(/\0/g, '').trim().slice(0, Math.max(0, 12000 - used));
      if (!text) throw new Error(used >= 12000 ? 'límite total alcanzado' : 'no contiene texto extraíble');
      meetingDocuments.push({ name: file.name, text });
      renderMeetingDocuments();
    } catch (err) {
      status.textContent = `${file.name}: ${err.message || err}`;
    }
  }
  ev.target.value = '';
};

el('cvFileBtn').onclick = () => el('cvFile').click();
el('cvFile').onchange = async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  el('ctxInfo').className = '';
  el('ctxInfo').textContent = 'Leyendo ' + f.name + '…';
  try {
    let text = '';
    if (/\.pdf$/i.test(f.name)) text = await pdfToText(await f.arrayBuffer());
    else text = await f.text();
    el('cv').value = text.trim();
    ctxInfoText();
  } catch (err) {
    el('ctxInfo').className = 'err';
    el('ctxInfo').textContent = 'Error al leer el archivo: ' + (err.message || err);
  }
  ev.target.value = '';
};

async function pdfToText(arrayBuffer) {
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => it.str).join(' ') + '\n';
  }
  return out;
}

// --- AI interview practice ---
function setPracticeStatus(message, isError) {
  const target = el('practiceStatus');
  target.textContent = message || '';
  target.classList.toggle('err', !!isError);
}

function showPracticeView(viewId) {
  ['practiceSetup', 'practiceSession', 'practiceResultView'].forEach((id) => {
    el(id).hidden = id !== viewId;
  });
}

function renderPracticeAnswer() {
  const text = practiceInterim
    ? (practiceCommitted ? practiceCommitted + ' ' : '') + practiceInterim
    : practiceCommitted;
  el('practiceAnswer').textContent = text || 'Escuchando…';
}

function practiceOnBlock(block) {
  if (!practiceRecording) return;
  window.DG.send(toInt16(block).buffer);
}

async function startPracticeMic() {
  if (!sttKey) { setPracticeStatus('Falta STT_TOKEN.', true); return; }
  try {
    practiceCommitted = '';
    practiceInterim = '';
    renderPracticeAnswer();
    practiceStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    window.DG.onFinal = (text) => {
      practiceCommitted += (practiceCommitted ? ' ' : '') + text;
      practiceInterim = '';
      renderPracticeAnswer();
    };
    window.DG.onInterim = (text) => { practiceInterim = text; renderPracticeAnswer(); };
    window.DG.onUtterance = null;
    window.DG.onSuggestion = null;
    window.DG.onStatus = (message, error) => setPracticeStatus(message, error);
    window.DG.open(sttUrl, sttKey, sttModel, sttLang, 'off');

    practiceCtx = new AudioContext({ sampleRate: SR });
    await practiceCtx.audioWorklet.addModule('recorder-worklet.js');
    practiceSource = practiceCtx.createMediaStreamSource(practiceStream);
    practiceNode = new AudioWorkletNode(practiceCtx, 'recorder-worklet');
    const silent = practiceCtx.createGain();
    silent.gain.value = 0;
    practiceNode.port.onmessage = (event) => practiceOnBlock(event.data);
    practiceSource.connect(practiceNode);
    practiceNode.connect(silent).connect(practiceCtx.destination);
    practiceRecording = true;
    stopPracticeAudio();
    updateFinishButton();
    el('practiceRecord').textContent = '■ Terminar respuesta';
    el('practiceRecord').classList.add('recording');
    el('practiceSend').hidden = true;
    setPracticeStatus('Escuchando tu respuesta…');
  } catch (err) {
    await stopPracticeMic();
    setPracticeStatus('Micrófono: ' + (err.message || err), true);
  }
}

async function stopPracticeMic() {
  practiceRecording = false;
  try { window.DG.close(); } catch (_) {}
  try { if (practiceNode) practiceNode.disconnect(); } catch (_) {}
  try { if (practiceSource) practiceSource.disconnect(); } catch (_) {}
  try { if (practiceCtx) await practiceCtx.close(); } catch (_) {}
  try { if (practiceStream) practiceStream.getTracks().forEach((track) => track.stop()); } catch (_) {}
  practiceNode = practiceSource = practiceCtx = practiceStream = null;
  el('practiceRecord').textContent = '↻ Grabar de nuevo';
  el('practiceRecord').classList.remove('recording');
  const answer = practiceCommitted.trim();
  el('practiceSend').hidden = !answer;
  setPracticeStatus(answer ? 'Respuesta lista: pulsa «Continuar» o «Terminar y evaluar».' : 'No se detectó una respuesta.', !answer);
  if (el('practiceFinish')) updateFinishButton();
}

const READY_HINT = 'Pulsa «Comenzar a responder» cuando estés listo. Usa 🔊 Escuchar si quieres oír la pregunta.';
let practiceQuestionToken = 0;

function stopPracticeAudio() {
  if (practiceAudio) { practiceAudio.pause(); practiceAudio = null; }
  el('practiceReplay').textContent = '🔊 Escuchar';
}

// Voice is opt-in (button only): Deepgram TTS is slow and sometimes unavailable.
async function speakPracticeQuestion() {
  if (!practiceQuestion) return;
  if (practiceAudio) { stopPracticeAudio(); setPracticeStatus(READY_HINT); return; }
  const btn = el('practiceReplay');
  btn.disabled = true;
  btn.textContent = '⏳ Cargando voz…';
  setPracticeStatus('Preparando voz del entrevistador…');
  const question = practiceQuestion;
  let response;
  try { response = await window.api.speak(question); }
  catch (err) { response = { ok: false, error: String(err && err.message || err) }; }
  btn.disabled = false;
  btn.textContent = '🔊 Escuchar';
  if (question !== practiceQuestion) return; // moved on meanwhile
  if (!response.ok) {
    const unavailable = /\b(5\d\d|429)\b/.test(response.error || '');
    setPracticeStatus(unavailable
      ? 'La voz no está disponible en este momento. Puedes leer la pregunta y responder igual.'
      : 'No se pudo generar la voz: ' + response.error, true);
    return;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(response.audio)], { type: 'audio/mpeg' }));
  practiceAudio = new Audio(url);
  btn.textContent = '■ Detener voz';
  const done = (msg, isErr) => { URL.revokeObjectURL(url); practiceAudio = null; btn.textContent = '🔊 Escuchar'; setPracticeStatus(msg, isErr); };
  practiceAudio.onended = () => done(READY_HINT);
  practiceAudio.onerror = () => done('No se pudo reproducir la voz.', true);
  setPracticeStatus('Reproduciendo pregunta…');
  try { await practiceAudio.play(); } catch (_) { done('No se pudo reproducir la voz.', true); }
}

function updateFinishButton() {
  const answered = practiceHistory.length + (practiceCommitted.trim() ? 1 : 0);
  el('practiceFinish').disabled = answered === 0 && !practiceRecording;
}

async function loadPracticeQuestion() {
  const token = ++practiceQuestionToken;
  stopPracticeAudio();
  setPracticeStatus('Preparando pregunta…');
  el('practiceRecord').disabled = true;
  el('practiceReplay').disabled = true;
  el('practiceRecord').textContent = '🎙 Comenzar a responder';
  el('practiceRecord').classList.remove('recording');
  el('practiceSend').hidden = true;
  el('practiceQuestion').textContent = 'Generando pregunta…';
  el('practiceOptimal').textContent = 'Preparando una respuesta óptima para esta pregunta…';
  el('practiceProgress').value = practiceHistory.length;
  el('practiceProgress').max = practiceTotal;
  el('practiceCounter').textContent = `Pregunta ${practiceHistory.length + 1} de ${practiceTotal}`;
  updateFinishButton();
  const response = await window.api.practiceQuestion(practiceHistory);
  if (token !== practiceQuestionToken) return;
  el('practiceRecord').disabled = false;
  if (!response.ok) {
    el('practiceQuestion').textContent = 'No se pudo generar la pregunta.';
    setPracticeStatus('Pregunta: ' + response.error, true);
    return;
  }
  practiceQuestion = response.text.trim();
  el('practiceQuestion').textContent = practiceQuestion;
  el('practiceReplay').disabled = false;
  el('practiceAnswer').textContent = 'Pulsa «Comenzar a responder» y habla con naturalidad.';
  setPracticeStatus(READY_HINT);
  // Suggested answer loads in the background; ignore it if the user already moved on.
  window.api.suggest(practiceQuestion).then((optimal) => {
    if (token !== practiceQuestionToken) return;
    el('practiceOptimal').textContent = optimal.ok && optimal.text
      ? optimal.text
      : 'No se pudo generar la respuesta sugerida: ' + (optimal.error || 'respuesta vacía');
  });
}

async function finishPractice() {
  practiceQuestionToken++;
  stopPracticeAudio();
  showPracticeView('practiceResultView');
  const partial = practiceHistory.length < practiceTotal;
  const scope = partial
    ? `Evaluación anticipada: ${practiceHistory.length} de ${practiceTotal} preguntas respondidas.\n\n`
    : '';
  el('practiceResult').textContent = scope + 'Evaluando tus respuestas…';
  setPracticeStatus('Generando evaluación…');
  const response = await window.api.evaluatePractice(practiceHistory);
  if (!response.ok) {
    el('practiceResult').textContent = scope + 'No se pudo generar la evaluación.';
    setPracticeStatus('Evaluación: ' + response.error, true);
    return;
  }
  el('practiceResult').textContent = scope + response.text;
  setPracticeStatus('Evaluación completada.');
}

el('practiceOpen').onclick = async () => {
  if (running) await stop();
  practiceHistory = [];
  practiceQuestion = '';
  showPracticeView('practiceSetup');
  setPracticeStatus('');
  el('ctxPanel').hidden = true;
  // Practice replaces the assistant view (no overlap); restored on close.
  document.getElementById('app').classList.add('practice-mode');
  window.api.setPracticeMode(true);
  el('practiceDialog').showModal();
};
el('practiceClose').onclick = () => el('practiceDialog').close();
el('practiceDialog').addEventListener('close', async () => {
  practiceQuestionToken++;
  await stopPracticeMic();
  stopPracticeAudio();
  document.getElementById('app').classList.remove('practice-mode');
  window.api.setPracticeMode(false);
  setStatus('Listo — pulsa 🖥 para escuchar');
});
el('practiceStart').onclick = async () => {
  const count = el('practiceCount');
  if (!count.checkValidity()) { count.reportValidity(); return; }
  practiceTotal = Number.parseInt(count.value, 10);
  practiceHistory = [];
  showPracticeView('practiceSession');
  await loadPracticeQuestion();
};
el('practiceReplay').onclick = speakPracticeQuestion;
el('practiceRecord').onclick = () => practiceRecording ? stopPracticeMic() : startPracticeMic();
el('practiceSend').onclick = async () => {
  const answer = practiceCommitted.trim();
  if (!answer) return;
  practiceHistory.push({ question: practiceQuestion, answer });
  practiceCommitted = practiceInterim = '';
  if (practiceHistory.length >= practiceTotal) await finishPractice();
  else await loadPracticeQuestion();
};
// Finish early: evaluate what has been answered so far (including an unsent answer).
el('practiceFinish').onclick = async () => {
  if (practiceRecording) await stopPracticeMic();
  const pending = practiceCommitted.trim();
  if (pending && practiceQuestion) practiceHistory.push({ question: practiceQuestion, answer: pending });
  practiceCommitted = practiceInterim = '';
  if (!practiceHistory.length) {
    setPracticeStatus('Responde al menos una pregunta para poder evaluar.', true);
    return;
  }
  await finishPractice();
};
el('practiceAgain').onclick = () => {
  practiceHistory = [];
  practiceQuestion = '';
  showPracticeView('practiceSetup');
  setPracticeStatus('');
};

(async function init() {
  const c = await window.api.config();
  sttLang = c.sttLang || 'es';
  sttUrl = c.sttUrl || '';
  sttKey = c.sttKey || '';
  sttModel = c.sttModel || 'nova-2';
  dgKey = c.dgKey || '';
  responseChars = (await window.api.gatewayConfig(false)).responseChars || responseChars;
  const missing = [];
  if (!c.hasKey) missing.push('IAMIKO_TOKEN');
  if (!sttKey) missing.push('STT_TOKEN');
  const ctx = await window.api.getContext();
  appMode = ctx.mode === 'meeting' ? 'meeting' : 'interview';
  applyModeUi();
  applyCaptureUi(ctx.shareInterfaceVisible === true);
  if (missing.length) setStatus('Falta configurar ' + missing.join(' y ') + ' en el archivo .env', true);
  else if (isMeeting()) setStatus('Modo reunión — pulsa 🖥 o 🎙 para escuchar');
  else if (!(ctx.cv || ctx.jd)) setStatus('Añade tu CV y el cargo en ⚙ Configuración, luego pulsa 🖥');
  else setStatus('Listo — pulsa 🖥 para escuchar');
  console.log('[app] ready | stt', sttUrl, !!sttKey, sttModel, '| chat', c.chatModel, '| lang', sttLang, '| cv', (ctx.cv || '').length, 'jd', (ctx.jd || '').length);
})();
