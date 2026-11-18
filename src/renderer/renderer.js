'use strict';
const SR = 16000;
const SEND_SAMPLES = 3200; // ~200ms per WS frame

const el = (id) => document.getElementById(id);
const txEl = el('tx'), ansEl = el('ans'), statusEl = el('status');

let running = false;
let ctx = null, node = null, srcNode = null, stream = null;
let clickThrough = false;
let sttLang = 'es', dgKey = '', dgModel = 'nova-2';

let committed = '';     // finalized transcript
let interimText = '';   // live partial
let utteranceText = ''; // finals of the current interviewer turn (question detection)
let triggeredText = ''; // utterance text already sent to the LLM (avoid duplicates)
let suggestTimer = null;
let suggestSeq = 0;     // id of the newest live suggestion request

let practiceHistory = [];
let practiceQuestion = '';
let practiceTotal = 5;
let practiceRecording = false;
let practiceCommitted = '';
let practiceInterim = '';
let practiceCtx = null, practiceNode = null, practiceSource = null, practiceStream = null;
let practiceAudio = null;

// Question detection lives in question.js (window.Question).
const { needsAnswer, isClearQuestionEnd } = window.Question;

// pcm send buffer
let pcm = new Float32Array(0);

function setStatus(msg, err) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', !!err);
  el('liveDot').classList.toggle('err', !!err);
}

function setPlaceholder(target, text) {
  target.textContent = text;
  target.classList.add('empty');
}
function setContent(target, text) {
  target.textContent = text;
  target.classList.remove('empty');
}
const ANS_EMPTY = 'Las sugerencias aparecerán aquí cuando el entrevistador haga una pregunta.';
const TX_EMPTY_IDLE = 'Pulsa «Iniciar escucha» para comenzar.';
const TX_EMPTY_LIVE = 'Escuchando el audio del sistema…';

function render() {
  const live = interimText ? (committed ? committed + ' ' : '') + interimText : committed;
  if (!live) setPlaceholder(txEl, running ? TX_EMPTY_LIVE : TX_EMPTY_IDLE);
  else setContent(txEl, live.slice(-1400));
  txEl.parentElement.scrollTop = txEl.parentElement.scrollHeight;
}

function toInt16(f32) {
  const i = new Int16Array(f32.length);
  for (let k = 0; k < f32.length; k++) { let v = Math.max(-1, Math.min(1, f32[k])); i[k] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return i;
}

function onBlock(block) {
  if (!running) return;
  const merged = new Float32Array(pcm.length + block.length);
  merged.set(pcm, 0); merged.set(block, pcm.length); pcm = merged;
  while (pcm.length >= SEND_SAMPLES) {
    const frame = pcm.slice(0, SEND_SAMPLES);
    pcm = pcm.slice(SEND_SAMPLES);
    window.DG.send(toInt16(frame).buffer);
  }
}

const isNoAnswer = (t) => !t || /^[-—–\s.]+$/.test(t);

// delayMs: 0 when the question is unambiguous, small debounce otherwise.
function scheduleSuggest(delayMs) {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(async () => {
    const ctxText = committed.slice(-800);
    if (!ctxText.trim()) return;
    const id = ++suggestSeq;
    setStatus('Generando sugerencia…');
    ansEl.parentElement.classList.add('generating');
    const res = await window.api.suggestStream(ctxText, id);
    if (id !== suggestSeq || res.aborted) return; // a newer question took over
    ansEl.parentElement.classList.remove('generating');
    if (!res.ok) { setStatus('LLM: ' + res.error, true); return; }
    const t = (res.text || '').trim();
    if (!isNoAnswer(t)) setContent(ansEl, t);   // keep previous if "no answer"
    setStatus('Escuchando…');
  }, delayMs);
}

// Streamed tokens: show the answer while it is being written.
window.api.onSuggestDelta(({ id, text }) => {
  if (id !== suggestSeq) return;
  const t = (text || '').trim();
  if (t.length < 3 || isNoAnswer(t)) return; // wait for real content ("—" means no answer)
  setContent(ansEl, t);
});

function onInterviewerFinal(t) {
  committed += (committed ? ' ' : '') + t;
  utteranceText += (utteranceText ? ' ' : '') + t;
  interimText = '';
  render();
  // Chunk ends with "?": answer now, don't wait for the end-of-turn silence.
  if (isClearQuestionEnd(t) && needsAnswer(utteranceText)) {
    triggeredText = utteranceText;
    scheduleSuggest(0);
  }
}

function onInterviewerTurnEnd() {
  const turn = utteranceText;
  utteranceText = '';
  if (!turn || turn === triggeredText) { triggeredText = ''; return; }
  // Judge the whole turn, not just the last chunk (questions often span several).
  if (needsAnswer(turn)) scheduleSuggest(triggeredText ? 0 : 120);
  triggeredText = '';
}

async function start() {
  if (!dgKey) { setStatus('Falta DEEPGRAM_API_KEY en el archivo .env', true); return; }
  try {
    setStatus('Conectando con el audio del sistema…');
    const noDsp = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: noDsp });
    stream.getVideoTracks().forEach((t) => t.stop());
    const audioStream = new MediaStream(stream.getAudioTracks());
    const at = audioStream.getAudioTracks()[0];
    if (!at) throw new Error('sin pista de audio (loopback)');
    try { await at.applyConstraints(noDsp); } catch (_) {}
    console.log('[cap] track', at.label, JSON.stringify(at.getSettings()));

    // open Deepgram
    utteranceText = triggeredText = '';
    window.DG.onFinal = onInterviewerFinal;
    window.DG.onInterim = (t) => { interimText = t; render(); };
    window.DG.onUtterance = onInterviewerTurnEnd;
    window.DG.onStatus = (m, e) => setStatus(m, e);
    window.DG.open(dgKey, dgModel, sttLang);

    ctx = new AudioContext({ sampleRate: SR });
    await ctx.audioWorklet.addModule('recorder-worklet.js');
    srcNode = ctx.createMediaStreamSource(audioStream);
    node = new AudioWorkletNode(ctx, 'recorder-worklet');
    node.port.onmessage = (ev) => onBlock(ev.data);
    srcNode.connect(node);
    node.connect(ctx.destination);

    running = true;
    el('toggle').textContent = '■ Detener escucha';
    el('toggle').classList.remove('primary');
    el('toggle').classList.add('danger');
    el('liveDot').classList.add('live');
    render();
  } catch (err) {
    console.error('[cap] start error', err.message || err);
    setStatus('Error: ' + (err.message || err), true);
    await stop();
  }
}

async function stop() {
  running = false;
  pcm = new Float32Array(0);
  clearTimeout(suggestTimer);
  suggestSeq++;
  ansEl.parentElement.classList.remove('generating');
  try { window.DG.close(); } catch (_) {}
  try { if (node) node.disconnect(); } catch (_) {}
  try { if (srcNode) srcNode.disconnect(); } catch (_) {}
  try { if (ctx) await ctx.close(); } catch (_) {}
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  node = srcNode = ctx = stream = null;
  el('toggle').textContent = '▶ Iniciar escucha';
  el('toggle').classList.remove('danger');
  el('toggle').classList.add('primary');
  el('liveDot').classList.remove('live');
  render();
  if (!statusEl.classList.contains('err')) setStatus('Detenido');
}

// --- wiring ---
el('toggle').onclick = () => (running ? stop() : start());
el('clear').onclick = () => { committed = ''; interimText = ''; render(); setPlaceholder(ansEl, ANS_EMPTY); };
el('close').onclick = async () => { try { if (running) await stop(); } finally { window.api.quit(); } };
el('minimize').onclick = () => window.api.minimize();

function applyClickThroughUi(on) {
  clickThrough = on;
  el('clickthru').classList.toggle('active', on);
  el('clickthru').setAttribute('aria-pressed', String(on));
  document.getElementById('app').classList.toggle('click-through', on);
}
el('clickthru').onclick = () => {
  applyClickThroughUi(!clickThrough);
  window.api.setClickThrough(clickThrough);
};
// main process may toggle it from the global shortcut or the tray
window.api.onClickThroughChanged(applyClickThroughUi);

// --- visible / hidden in screenshots (content protection) ---
let captureVisible = false;
function applyCaptureUi(on) {
  captureVisible = on;
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
function closeCtxPanel() { el('ctxPanel').hidden = true; el('settings').focus(); }
el('settings').onclick = async () => {
  const c = await window.api.getContext();
  el('cv').value = c.cv || '';
  el('jd').value = c.jd || '';
  el('responseChars').value = c.responseChars || 500;
  const responseFormat = c.responseFormat === 'paragraph' ? 'paragraph' : 'bullets';
  document.querySelector(`input[name="responseFormat"][value="${responseFormat}"]`).checked = true;
  el('responseInstructions').value = c.responseInstructions || '';
  el('shareInterfaceVisible').checked = c.shareInterfaceVisible === true;
  ctxInfoText();
  el('ctxPanel').hidden = false;
  el('jd').focus();
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
    cv: el('cv').value,
    jd: el('jd').value,
    responseChars: charsInput.value,
    responseFormat: document.querySelector('input[name="responseFormat"]:checked').value,
    responseInstructions: el('responseInstructions').value,
    shareInterfaceVisible: el('shareInterfaceVisible').checked,
  });
  if (r && r.ok) applyCaptureUi(r.shareInterfaceVisible === true);
  if (!r || !r.ok) {
    el('ctxInfo').className = 'err';
    el('ctxInfo').textContent = 'No se pudo guardar.';
    return;
  }
  const formatLabel = r.responseFormat === 'paragraph' ? 'texto continuo' : 'lista de puntos';
  el('ctxInfo').className = 'ok';
  el('ctxInfo').textContent = '✓ Guardado · ' + r.responseChars + ' caracteres · ' + formatLabel;
  if (!running && !statusEl.classList.contains('err')) setStatus('Listo — pulsa «Iniciar escucha»');
  setTimeout(closeCtxPanel, 700);
};
el('cv').oninput = ctxInfoText;
el('jd').oninput = ctxInfoText;

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
  if (!dgKey) { setPracticeStatus('Falta DEEPGRAM_API_KEY.', true); return; }
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
    window.DG.onStatus = (message, error) => setPracticeStatus(message, error);
    window.DG.open(dgKey, dgModel, sttLang);

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
  setStatus('Listo — pulsa «Iniciar escucha»');
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
  dgKey = c.deepgramKey || '';
  dgModel = c.deepgramModel || 'nova-2';
  const missing = [];
  if (!c.hasKey) missing.push('IAMIKO_TOKEN');
  if (!dgKey) missing.push('DEEPGRAM_API_KEY');
  const ctx = await window.api.getContext();
  applyCaptureUi(ctx.shareInterfaceVisible === true);
  if (missing.length) setStatus('Falta configurar ' + missing.join(' y ') + ' en el archivo .env', true);
  else if (!(ctx.cv || ctx.jd)) setStatus('Añade tu CV y el cargo en ⚙ Configuración, luego pulsa «Iniciar escucha»');
  else setStatus('Listo — pulsa «Iniciar escucha»');
  console.log('[app] ready | deepgram', !!dgKey, dgModel, '| chat', c.chatModel, '| lang', sttLang, '| cv', (ctx.cv || '').length, 'jd', (ctx.jd || '').length);
})();
