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
let lastFinal = '';     // most recent final chunk (for question detection)
let suggestTimer = null;

let practiceHistory = [];
let practiceQuestion = '';
let practiceTotal = 5;
let practiceRecording = false;
let practiceCommitted = '';
let practiceInterim = '';
let practiceCtx = null, practiceNode = null, practiceSource = null, practiceStream = null;
let practiceAudio = null;

// Heuristic: does the interviewer's last line warrant an answer?
function needsAnswer(text) {
  if (!text) return false;
  if (text.includes('?') || text.includes('¿')) return true;
  const t = text.toLowerCase();
  return /\b(qué|que|cómo|como|cuál|cual|cuándo|cuando|dónde|donde|quién|quien|por qué|porqué|cuéntame|cuentame|háblame|hablame|explica|explícame|explicame|describe|dime|platícame|coméntame|comentame|podrías|podrias|puedes|me puedes|hábleme|cuénteme|descríbeme|por que)\b/.test(t);
}

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

function scheduleSuggest() {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(async () => {
    const ctxText = committed.slice(-800);
    if (!ctxText.trim()) return;
    setStatus('Generando sugerencia…');
    const res = await window.api.suggest(ctxText);
    if (!res.ok) { setStatus('LLM: ' + res.error, true); return; }
    const t = (res.text || '').trim();
    if (t && !/^[-—–\s.]+$/.test(t)) setContent(ansEl, t);   // keep previous if "no answer"
    setStatus('Escuchando…');
  }, 250);
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
    window.DG.onFinal = (t) => { committed += (committed ? ' ' : '') + t; lastFinal = t; interimText = ''; render(); };
    window.DG.onInterim = (t) => { interimText = t; render(); };
    window.DG.onUtterance = () => { if (needsAnswer(lastFinal)) scheduleSuggest(); };
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
  setPracticeStatus(answer ? 'Respuesta lista para enviar.' : 'No se detectó una respuesta.', !answer);
}

async function speakPracticeQuestion() {
  if (!practiceQuestion) return;
  if (practiceAudio) { practiceAudio.pause(); practiceAudio = null; }
  setPracticeStatus('Preparando voz del entrevistador…');
  const response = await window.api.speak(practiceQuestion);
  if (!response.ok) { setPracticeStatus('Voz: ' + response.error, true); return; }
  const url = URL.createObjectURL(new Blob([new Uint8Array(response.audio)], { type: 'audio/mpeg' }));
  practiceAudio = new Audio(url);
  practiceAudio.onended = () => { URL.revokeObjectURL(url); setPracticeStatus('Pulsa “Responder” cuando estés listo.'); };
  practiceAudio.onerror = () => { URL.revokeObjectURL(url); setPracticeStatus('No se pudo reproducir la voz.', true); };
  await practiceAudio.play();
}

async function loadPracticeQuestion() {
  setPracticeStatus('Preparando pregunta…');
  el('practiceRecord').disabled = true;
  el('practiceRecord').textContent = '🎙 Comenzar a responder';
  el('practiceRecord').classList.remove('recording');
  el('practiceSend').hidden = true;
  el('practiceOptimal').textContent = 'Preparando una respuesta óptima para esta pregunta…';
  const response = await window.api.practiceQuestion(practiceHistory);
  if (!response.ok) {
    setPracticeStatus('Pregunta: ' + response.error, true);
    el('practiceRecord').disabled = false;
    return;
  }
  practiceQuestion = response.text.trim();
  el('practiceQuestion').textContent = practiceQuestion;
  el('practiceAnswer').textContent = 'Pulsa “Responder” y habla.';
  el('practiceProgress').value = practiceHistory.length;
  el('practiceProgress').max = practiceTotal;
  el('practiceCounter').textContent = `Pregunta ${practiceHistory.length + 1} de ${practiceTotal}`;
  el('practiceRecord').disabled = false;
  const optimalPromise = window.api.suggest(practiceQuestion).then((optimal) => {
    el('practiceOptimal').textContent = optimal.ok && optimal.text
      ? optimal.text
      : 'No se pudo generar la respuesta sugerida: ' + (optimal.error || 'respuesta vacía');
  });
  await Promise.allSettled([speakPracticeQuestion(), optimalPromise]);
}

async function finishPractice() {
  showPracticeView('practiceResultView');
  el('practiceResult').textContent = 'Evaluando tus respuestas…';
  setPracticeStatus('Generando evaluación final…');
  const response = await window.api.evaluatePractice(practiceHistory);
  if (!response.ok) {
    el('practiceResult').textContent = 'No se pudo generar la evaluación.';
    setPracticeStatus('Evaluación: ' + response.error, true);
    return;
  }
  el('practiceResult').textContent = response.text;
  setPracticeStatus('Evaluación completada.');
}

el('practiceOpen').onclick = async () => {
  if (running) await stop();
  practiceHistory = [];
  practiceQuestion = '';
  showPracticeView('practiceSetup');
  setPracticeStatus('');
  window.api.setPracticeMode(true);
  el('practiceDialog').showModal();
};
el('practiceClose').onclick = () => el('practiceDialog').close();
el('practiceDialog').addEventListener('close', async () => {
  await stopPracticeMic();
  if (practiceAudio) { practiceAudio.pause(); practiceAudio = null; }
  window.api.setPracticeMode(false);
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
  if (missing.length) setStatus('Falta configurar ' + missing.join(' y ') + ' en el archivo .env', true);
  else if (!(ctx.cv || ctx.jd)) setStatus('Añade tu CV y el cargo en ⚙ Configuración, luego pulsa «Iniciar escucha»');
  else setStatus('Listo — pulsa «Iniciar escucha»');
  console.log('[app] ready | deepgram', !!dgKey, dgModel, '| chat', c.chatModel, '| lang', sttLang, '| cv', (ctx.cv || '').length, 'jd', (ctx.jd || '').length);
})();
