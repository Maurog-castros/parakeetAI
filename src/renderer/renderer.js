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

// Heuristic: does the interviewer's last line warrant an answer?
function needsAnswer(text) {
  if (!text) return false;
  if (text.includes('?') || text.includes('¿')) return true;
  const t = text.toLowerCase();
  return /\b(qué|que|cómo|como|cuál|cual|cuándo|cuando|dónde|donde|quién|quien|por qué|porqué|cuéntame|cuentame|háblame|hablame|explica|explícame|explicame|describe|dime|platícame|coméntame|comentame|podrías|podrias|puedes|me puedes|hábleme|cuénteme|descríbeme|por que)\b/.test(t);
}

// pcm send buffer
let pcm = new Float32Array(0);

function setStatus(msg, err) { statusEl.textContent = msg; statusEl.classList.toggle('err', !!err); }

function render() {
  const live = interimText ? (committed ? committed + ' ' : '') + interimText : committed;
  txEl.textContent = live.slice(-1400);
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
    setStatus('pensando…');
    const res = await window.api.suggest(ctxText);
    if (!res.ok) { setStatus('LLM: ' + res.error, true); return; }
    const t = (res.text || '').trim();
    if (t && !/^[-—–\s.]+$/.test(t)) ansEl.textContent = t;   // keep previous if "no answer"
    setStatus('escuchando (deepgram)');
  }, 250);
}

async function start() {
  if (!dgKey) { setStatus('falta DEEPGRAM_API_KEY', true); return; }
  try {
    setStatus('capturando audio de sistema…');
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
    el('toggle').textContent = '■ Stop';
    el('toggle').classList.remove('primary');
  } catch (err) {
    console.error('[cap] start error', err.message || err);
    setStatus('error: ' + (err.message || err), true);
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
  el('toggle').textContent = '▶ Start';
  el('toggle').classList.add('primary');
  setStatus('detenido');
}

// --- wiring ---
el('toggle').onclick = () => (running ? stop() : start());
el('clear').onclick = () => { committed = ''; interimText = ''; render(); ansEl.textContent = '—'; };
el('close').onclick = () => window.api.quit();
el('clickthru').onclick = () => {
  clickThrough = !clickThrough;
  window.api.setClickThrough(clickThrough);
  el('clickthru').textContent = 'Click-through: ' + (clickThrough ? 'on' : 'off');
  if (clickThrough) setStatus('click-through ON — usa Ctrl+Shift+Space para ocultar');
};

// --- interview context panel ---
function ctxInfoText() {
  el('ctxInfo').textContent = 'CV: ' + el('cv').value.length + ' car · Cargo: ' + el('jd').value.length + ' car';
}
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
};
el('ctxClose').onclick = () => { el('ctxPanel').hidden = true; };
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
  const formatLabel = r.responseFormat === 'paragraph' ? 'texto continuo' : 'bullets';
  el('ctxInfo').textContent = r.ok ? ('Guardado ✓  ' + r.responseChars + ' car · ' + formatLabel) : 'error';
  setTimeout(() => { el('ctxPanel').hidden = true; }, 600);
};
el('cv').oninput = ctxInfoText;
el('jd').oninput = ctxInfoText;

el('cvFileBtn').onclick = () => el('cvFile').click();
el('cvFile').onchange = async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  el('ctxInfo').textContent = 'leyendo ' + f.name + '…';
  try {
    let text = '';
    if (/\.pdf$/i.test(f.name)) text = await pdfToText(await f.arrayBuffer());
    else text = await f.text();
    el('cv').value = text.trim();
    ctxInfoText();
  } catch (err) {
    el('ctxInfo').textContent = 'error al leer: ' + (err.message || err);
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

(async function init() {
  const c = await window.api.config();
  sttLang = c.sttLang || 'es';
  dgKey = c.deepgramKey || '';
  dgModel = c.deepgramModel || 'nova-2';
  const missing = [];
  if (!c.hasKey) missing.push('IAMIKO_TOKEN');
  if (!dgKey) missing.push('DEEPGRAM_API_KEY');
  const ctx = await window.api.getContext();
  if (missing.length) setStatus('falta ' + missing.join(', '), true);
  else if (!(ctx.cv || ctx.jd)) setStatus('añade CV y cargo en ⚙ Contexto, luego Start');
  else setStatus('listo — pulsa Start');
  console.log('[app] ready | deepgram', !!dgKey, dgModel, '| chat', c.chatModel, '| lang', sttLang, '| cv', (ctx.cv || '').length, 'jd', (ctx.jd || '').length);
})();
