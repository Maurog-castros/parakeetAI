'use strict';
// Chat client for the ia.iamiko.cl VSCode gateway (OpenAI-compatible chat,
// authenticated with the custom X-Iamiko-Token header). STT is done locally
// in the renderer (Transformers.js), not here.

const DEFAULT_RESPONSE_CHARS = 500;
const MIN_RESPONSE_CHARS = 120;
const MAX_RESPONSE_CHARS = 1500;
const DEFAULT_RESPONSE_FORMAT = 'bullets';
const MAX_RESPONSE_INSTRUCTIONS = 1000;

function normalizeResponseChars(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_RESPONSE_CHARS;
  return Math.min(MAX_RESPONSE_CHARS, Math.max(MIN_RESPONSE_CHARS, parsed));
}

function normalizeResponseFormat(value) {
  return value === 'paragraph' ? 'paragraph' : DEFAULT_RESPONSE_FORMAT;
}

function normalizeResponseInstructions(value) {
  return String(value || '').trim().slice(0, MAX_RESPONSE_INSTRUCTIONS);
}

function limitResponse(text, maxChars) {
  const clean = String(text || '').trim();
  const limit = normalizeResponseChars(maxChars);
  if (clean.length <= limit) return clean;
  const room = limit - 1;
  const fragment = clean.slice(0, room + 1);
  const breakAt = fragment.search(/\s+\S*$/);
  const shortened = (breakAt >= Math.floor(room * 0.65) ? fragment.slice(0, breakAt) : fragment.slice(0, room)).trimEnd();
  return shortened + '…';
}

function cfg() {
  const baseUrl = (process.env.IAMIKO_BASE_URL || 'https://ia.iamiko.cl/vscode/v1').replace(/\/+$/, '');
  const token = process.env.IAMIKO_TOKEN || '';
  return {
    baseUrl,
    token,
    hasKey: !!token,
    chatModel: process.env.CHAT_MODEL || 'auto-vscode',
    sttLang: process.env.STT_LANG || 'es',
    deepgramKey: process.env.DEEPGRAM_API_KEY || '',
    deepgramModel: process.env.DEEPGRAM_MODEL || 'nova-2',
  };
}

function headers(extra) {
  const c = cfg();
  return Object.assign({ 'X-Iamiko-Token': c.token }, extra || {});
}

async function probe() {
  const c = cfg();
  if (!c.hasKey) return { error: 'IAMIKO_TOKEN not set' };
  try {
    const r = await fetch(`${c.baseUrl}/models`, { headers: headers() });
    if (!r.ok) return { error: `GET /models -> ${r.status}` };
    const j = await r.json();
    const models = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
    return { models };
  } catch (err) {
    return { error: String(err && err.message || err) };
  }
}

function buildSystem(context) {
  const cv = (context && context.cv || '').slice(0, 6000);
  const jd = (context && context.jd || '').slice(0, 3000);
  const responseChars = normalizeResponseChars(context && context.responseChars);
  const responseFormat = normalizeResponseFormat(context && context.responseFormat);
  const responseInstructions = normalizeResponseInstructions(context && context.responseInstructions);
  const formatRules = responseFormat === 'paragraph'
    ? [
      '- FORMATO: texto continuo, natural y desarrollado en uno o dos párrafos.',
      '- No uses viñetas, listas, encabezados ni numeración.',
    ]
    : [
      '- FORMATO: lista de 2-4 viñetas breves; cada viñeta comienza con "• ".',
      '- Cada viñeta debe expresar una sola idea fácil de decir en voz alta.',
    ];
  return [
    'Eres el copiloto de entrevista del CANDIDATO durante una entrevista por Teams/Meet.',
    'Recibes la transcripcion de lo que dice el ENTREVISTADOR.',
    '',
    'TAREA: si la ultima intervencion es una pregunta o pide algo que el candidato deba responder,',
    `redacta una respuesta oral natural de hasta ${responseChars} caracteres, incluyendo espacios.`,
    'Reglas de la respuesta:',
    '- Primera persona, como una persona real hablando; no como un manual ni una IA.',
    ...formatRules,
    '- Varía el inicio y evita repetir "Yo" o "En mi experiencia" mecánicamente.',
    '- Alineada a las FUNCIONES DEL CARGO y respaldada por el CV cuando aplique.',
    '- Concreta, cálida y profesional. Sin relleno, preámbulos, jerga corporativa ni datos inventados.',
    `- Límite estricto: ${responseChars} caracteres. Termina la idea antes de alcanzar el límite.`,
    responseInstructions ? '' : null,
    responseInstructions ? '=== INSTRUCCIONES PERSONALES DEL CANDIDATO ===' : null,
    responseInstructions || null,
    responseInstructions ? 'Aplica estas instrucciones sin contradecir las reglas anteriores ni inventar datos.' : null,
    'Si la intervencion NO es una pregunta ni requiere respuesta, responde EXACTAMENTE con "—".',
    '',
    '=== DESCRIPCION DEL CARGO ===',
    jd || '(no proporcionada)',
    '',
    '=== CV DEL CANDIDATO ===',
    cv || '(no proporcionado)',
  ].filter((line) => line !== null).join('\n');
}

async function suggest(transcript, context) {
  const c = cfg();
  if (!c.hasKey) throw new Error('token missing');
  const responseChars = normalizeResponseChars(context && context.responseChars);
  const body = {
    model: c.chatModel,
    messages: [
      { role: 'system', content: buildSystem(context) },
      { role: 'user', content: 'ENTREVISTADOR (reciente):\n' + transcript },
    ],
    temperature: 0.3,
    max_tokens: Math.min(800, Math.max(96, Math.ceil(responseChars / 2))),
    stream: false,
  };
  const r = await fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`chat -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '';
  return limitResponse(text, responseChars);
}

module.exports = {
  cfg,
  probe,
  suggest,
  buildSystem,
  limitResponse,
  normalizeResponseChars,
  normalizeResponseFormat,
  normalizeResponseInstructions,
};
