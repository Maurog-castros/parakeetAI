// Question detection for the interviewer's speech (Spanish).
// Loaded as a plain <script> in the renderer (window.Question) and via
// require() in tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Question = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Unicode-aware word boundaries: plain \b treats á/é/í/ó/ú/ñ as non-letters,
  // so /\bqué\b/ never matched.
  const L = '\\p{L}';
  const word = (alts) => new RegExp(`(?<![${L}])(?:${alts})(?![${L}])`, 'iu');

  // Interrogatives with an accent are unambiguous questions anywhere.
  const INTERROGATIVE = word('qué|cómo|cuál|cuáles|cuándo|dónde|quién|quiénes|cuánto|cuánta|cuántos|cuántas|por qué|para qué');

  // Requests that expect an answer even without a question mark.
  const REQUEST = word([
    'cuéntame', 'cuentame', 'cuénteme', 'cuenteme', 'cuéntanos', 'cuentanos',
    'háblame', 'hablame', 'hábleme', 'hableme', 'háblanos', 'hablanos',
    'explícame', 'explicame', 'explíqueme', 'expliqueme', 'explica', 'explique',
    'descríbeme', 'describeme', 'describe', 'describa', 'descríbenos',
    'coméntame', 'comentame', 'coménteme', 'comenta', 'comente',
    'platícame', 'platicame', 'dime', 'díganos', 'digame', 'dígame',
    'detállame', 'detallame', 'profundiza', 'profundice', 'amplía', 'amplia',
    'menciona', 'mencione', 'nombra', 'da un ejemplo', 'dame un ejemplo', 'deme un ejemplo',
    'podrías', 'podrias', 'podría', 'podria', 'puedes', 'puede usted',
    'me gustaría saber', 'me gustaria saber', 'quisiera saber', 'quiero saber', 'nos gustaría saber',
    'tienes experiencia', 'tiene experiencia', 'has trabajado', 'ha trabajado', 'has tenido', 'ha tenido',
    'estarías dispuesto', 'estarías dispuesta', 'te consideras', 'se considera',
  ].join('|'));

  // Unaccented interrogatives are very common words ("que", "como"), so only
  // count them when they open the utterance ("como manejarías...").
  const LEADING_UNACCENTED = /^\s*(?:y\s+|entonces\s+|bueno\s*,?\s+|ok\s*,?\s+)?(?:que|como|cual|cuales|cuando|donde|quien|cuanto|cuantos|por que|porque)(?![\p{L}])/iu;

  // Polite closers that signal the floor is handed over.
  const CLOSER = word('verdad|cierto|no crees|no cree|me explico|qué opinas|que opinas');

  function needsAnswer(text) {
    const t = String(text || '').trim();
    if (t.length < 4) return false;
    if (/[?¿]/.test(t)) return true;
    return INTERROGATIVE.test(t) || REQUEST.test(t) || LEADING_UNACCENTED.test(t) || CLOSER.test(t);
  }

  // Stricter test for listing questions afterwards: needsAnswer() fires on any
  // "cómo"/"puedes" ("te comento cómo vamos a avanzar"), which is fine for a
  // live suggestion but clutters a list. Here an accented interrogative only
  // counts when it opens a sentence, and "puedes/podrías" need a "?".
  const LIST_REQUEST = word([
    'cuéntame', 'cuentame', 'cuénteme', 'cuenteme', 'cuéntanos', 'cuentanos',
    'háblame', 'hablame', 'hábleme', 'hableme', 'háblanos', 'hablanos',
    'explícame', 'explicame', 'explíqueme', 'expliqueme', 'descríbeme', 'describeme', 'descríbenos',
    'coméntame', 'comentame', 'coménteme', 'platícame', 'platicame', 'dime', 'díganos', 'digame', 'dígame',
    'detállame', 'detallame', 'da un ejemplo', 'dame un ejemplo', 'deme un ejemplo',
    'me gustaría saber', 'me gustaria saber', 'me gustaría que', 'me gustaria que', 'quisiera saber', 'quiero saber',
    'nos gustaría saber', 'no sé si', 'no se si', 'te consulto', 'le consulto',
  ].join('|'));
  const SENTENCE_INTERROGATIVE = /^(?:(?:y|o|e|entonces|bueno|super|súper|ya|ok|okay|vale)[\s,]+)*(?:qué|cómo|cuál|cuáles|cuándo|dónde|quién|quiénes|cuánto|cuánta|cuántos|cuántas|por qué|para qué)(?![\p{L}])/iu;
  function isAskedQuestion(text) {
    const t = String(text || '').trim();
    if (t.length < 4) return false;
    if (/[?¿]/.test(t) || LIST_REQUEST.test(t) || LEADING_UNACCENTED.test(t)) return true;
    return t.split(/[.!;:]\s*/).some((s) => SENTENCE_INTERROGATIVE.test(s.trim()));
  }

  // A finished chunk that clearly ends a question: answer right away instead
  // of waiting for Deepgram's end-of-utterance silence.
  function isClearQuestionEnd(text) {
    return /\?\s*$/.test(String(text || ''));
  }

  // Lowercase, no accents, words only ("Mm-hmm." -> ["mm", "hmm"]).
  function words(text) {
    return String(text || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  }

  // Acknowledgements the other side says while you talk ("Mm-hmm", "Claro",
  // "Súper", "Okay"). They need no answer and must not replace the one on
  // screen. Accents are already stripped by words().
  const FILLER = new Set([
    'mm', 'mmm', 'mmmm', 'hmm', 'hm', 'mhm', 'mmhmm', 'uhm', 'um', 'uh', 'ah', 'eh', 'em', 'oh', 'aha', 'aja', 'ajam',
    'ok', 'okay', 'okey', 'vale', 'ya', 'si', 'claro', 'super', 'perfecto', 'exacto', 'exactamente', 'bien', 'muy',
    'bueno', 'genial', 'entiendo', 'entendido', 'correcto', 'buenisimo', 'buenisima', 'listo', 'dale', 'gracias',
    'muchas', 'excelente', 'interesante', 'de', 'acuerdo', 'yes', 'yeah', 'right', 'sure', 'cierto', 'obvio',
    'efectivamente', 'maravilloso', 'pues', 'okis', 'sale', 'y', 'eso', 'no', 'hay', 'problema',
  ]);
  function isBackchannel(text) {
    const w = words(text);
    if (!w.length) return true;
    return w.length <= 6 && w.every((x) => FILLER.has(x));
  }

  // The microphone picks up the interviewer through the speakers: a "me"
  // phrase whose words mostly appear in what the interviewer just said is that
  // echo, not a question of yours.
  function isEcho(mine, theirs) {
    const own = words(mine).filter((x) => x.length >= 3);
    if (own.length < 3) return false;
    const heard = new Set(words(theirs));
    if (!heard.size) return false;
    const hits = own.filter((x) => heard.has(x)).length;
    return hits / own.length >= 0.7;
  }

  // Questions asked by the other side in a saved transcripcion.md, with the
  // date and time of each one. Lines look like "**[15:32:27] Entrevistador:** …";
  // the date comes from "- Inicio: 2026-11-25 15:16:02" and rolls over at
  // midnight. Your own lines ("Yo") are left out: the microphone also picks up
  // the interviewer's voice, so they'd repeat the same questions.
  function extractQuestions(md) {
    const text = String(md || '').replace(/\r\n/g, '\n');
    const start = /^- Inicio:\s*(\d{4})-(\d\d)-(\d\d)/m.exec(text);
    let day = start ? new Date(Date.UTC(+start[1], +start[2] - 1, +start[3])) : null;
    const body = text.split(/^## (?:Respuestas sugeridas|Notas en vivo)\s*$/m)[0];
    const out = [];
    let prev = '';
    for (const line of body.split('\n')) {
      const m = /^\*\*\[(\d\d):(\d\d):(\d\d)\] ([^:*]+):\*\*\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      const time = `${m[1]}:${m[2]}:${m[3]}`;
      if (day && prev && time < prev) day = new Date(day.getTime() + 86400000);
      prev = time;
      const who = m[4].trim();
      const said = m[5].trim();
      if (who === 'Yo' || !isAskedQuestion(said) || isBackchannel(said)) continue;
      out.push({ date: day ? day.toISOString().slice(0, 10) : '', time, who, text: said });
    }
    return out;
  }

  return { needsAnswer, isAskedQuestion, isClearQuestionEnd, isBackchannel, isEcho, extractQuestions };
});
