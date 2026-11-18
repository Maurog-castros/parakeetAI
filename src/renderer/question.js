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

  // A finished chunk that clearly ends a question: answer right away instead
  // of waiting for Deepgram's end-of-utterance silence.
  function isClearQuestionEnd(text) {
    return /\?\s*$/.test(String(text || ''));
  }

  return { needsAnswer, isClearQuestionEnd };
});
