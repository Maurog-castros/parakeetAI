// Live notes (meeting / class mode): keep one line per note and drop notes
// that repeat one already on screen or an open item from the memory.
// Loaded as a plain <script> in the renderer (window.Notes) and via
// require() in tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Notes = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // "✅ Pendiente: Miko debe…" -> label "pendiente", body "Miko debe…".
  const LABEL_RE = /^[^\p{L}\p{N}]*(idea principal|idea|pendiente|decisi[oó]n|retoma|pregunta|ejemplo|tarea|importante)\s*:\s*/iu;

  function labelOf(note) {
    const m = LABEL_RE.exec(String(note || ''));
    return m ? m[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() : '';
  }

  // The prompt asks for ONE note; models sometimes send a list of them.
  function firstNote(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    return lines[0].replace(/^(?:[-•●▪*]\s+)/, '');
  }

  const STOP = new Set([
    'debe', 'deben', 'para', 'como', 'esta', 'este', 'esto', 'estos', 'estas', 'sobre', 'entre', 'desde', 'hasta',
    'incluyendo', 'incluye', 'donde', 'cuando', 'porque', 'pero', 'tambien', 'segun', 'cada', 'otro', 'otra',
    'tiene', 'tienen', 'hacer', 'sera', 'debera', 'ser', 'estar', 'muy', 'mas', 'menos', 'todo', 'toda', 'todos',
    'todas', 'algo', 'cual', 'cuales', 'que', 'sus', 'los', 'las', 'del', 'con', 'una', 'uno', 'unos', 'unas',
  ]);
  function contentWords(note) {
    const body = String(note || '').replace(LABEL_RE, '');
    return new Set(body
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && !STOP.has(w)));
  }

  // Share of the smaller note's words that also appear in the other one.
  function overlap(a, b) {
    const A = contentWords(a), B = contentWords(b);
    if (!A.size || !B.size) return { hits: 0, ratio: 0 };
    let hits = 0;
    for (const w of A) if (B.has(w)) hits++;
    return { hits, ratio: hits / Math.min(A.size, B.size) };
  }

  // previous: notes already taken this session.
  // openItems: texts of open pending items from the memory; a note that only
  // restates one of them is noise, except a "Retoma" (it reports progress).
  function isRepeatedNote(note, previous, openItems) {
    const label = labelOf(note);
    for (const p of previous || []) {
      const o = overlap(note, p);
      if (o.ratio >= 0.75 && o.hits >= 2) return true;
      if (label && label === labelOf(p) && o.hits >= 3 && o.ratio >= 0.5) return true;
    }
    if (label !== 'retoma') {
      for (const it of openItems || []) {
        const o = overlap(note, it);
        if (o.hits >= 3 && o.ratio >= 0.6) return true;
      }
    }
    return false;
  }

  // A question addressed to the user gets a suggested answer instead of a
  // note: "💬 Respuesta:" on its own line, then bullets (see llm.js).
  const REPLY_RE = /^\s*💬?\s*Respuesta(?: sugerida)?\s*:\s*/iu;
  function isReply(text) {
    return REPLY_RE.test(String(text || ''));
  }
  function replyBody(text) {
    return String(text || '').replace(REPLY_RE, '').trim();
  }

  return { firstNote, labelOf, isRepeatedNote, isReply, replyBody };
});
