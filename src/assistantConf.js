'use strict';
// asistente.conf: the app's settings as a plain-text file people can read,
// edit and hand out (one per user). Short values are "clave = valor" lines at
// the top; long texts (CV, instructions, documents) are "[seccion]" blocks
// whose body is taken verbatim until the next known section header.
//
//   modo = reunion
//   nombre = Ana Pérez
//   [instrucciones_reunion]
//   Eres mi asistente…
//
// parse() returns only the settings found, with their internal names; values
// are normalized later by main.js like any other saved context.

const MODE_IN = { entrevista: 'interview', reunion: 'meeting', 'reunión': 'meeting', clase: 'class', interview: 'interview', meeting: 'meeting', class: 'class' };
const MODE_OUT = { interview: 'entrevista', meeting: 'reunion', class: 'clase' };

// [section] -> context key (text values).
const SECTIONS = {
  contexto_reunion: 'meetingContext',
  descripcion_cargo: 'jd',
  cv: 'cv',
  instrucciones_entrevista: 'responseInstructions',
  instrucciones_reunion: 'meetingInstructions',
  instrucciones_clase: 'classInstructions',
};
const DOC_SECTION = 'documento';

const YES = /^(si|sí|true|1|yes|on)$/i;
const NO = /^(no|false|0|off)$/i;

function strip(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

// "[cv]" / "[documento: plan.pdf]" -> { name, arg } for known sections only.
function sectionOf(line) {
  const m = /^\[\s*([^\]:]+?)\s*(?::\s*([^\]]*?)\s*)?\]\s*$/.exec(line);
  if (!m) return null;
  const name = strip(m[1]).replace(/\s+/g, '_');
  if (name === DOC_SECTION) return { name, arg: m[2] || 'Documento' };
  return SECTIONS[name] && m[2] === undefined ? { name, arg: '' } : null;
}

// Body lines that look like a header get a leading "\" when written.
const HEADERISH = /^\\*\[.*\]\s*$/;
const escapeLine = (l) => (HEADERISH.test(l) ? '\\' + l : l);
const unescapeLine = (l) => (/^\\+\[.*\]\s*$/.test(l) ? l.slice(1) : l);

function trimBlank(lines) {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b).join('\n');
}

function parseKey(out, warnings, key, value, lineNo) {
  const k = strip(key.trim()).replace(/\s+/g, '_');
  const v = value.trim();
  switch (k) {
    case 'modo': {
      const mode = MODE_IN[strip(v)];
      if (mode) out.mode = mode; else warnings.push(`línea ${lineNo}: modo desconocido "${v}"`);
      break;
    }
    case 'nombre': out.userName = v; break;
    case 'caracteres': out.responseChars = v; break;
    case 'formato': out.responseFormat = /^p/i.test(strip(v)) ? 'paragraph' : 'bullets'; break;
    case 'mostrar_en_pantalla_compartida':
      if (YES.test(v)) out.shareInterfaceVisible = true;
      else if (NO.test(v)) out.shareInterfaceVisible = false;
      else warnings.push(`línea ${lineNo}: usa "si" o "no" en ${k}`);
      break;
    case 'transparencia': out.transparency = v; break;
    case 'carpeta_transcripciones': out.logDir = v; break;
    default: warnings.push(`línea ${lineNo}: clave desconocida "${key.trim()}"`);
  }
}

function parse(text) {
  const out = {};
  const warnings = [];
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  let section = null; // { name, arg, lines }
  const docs = [];
  const flush = () => {
    if (!section) return;
    const body = trimBlank(section.lines);
    if (section.name === DOC_SECTION) { if (body) docs.push({ name: section.arg, text: body }); }
    else out[SECTIONS[section.name]] = body;
  };
  lines.forEach((line, i) => {
    const head = sectionOf(line.trim());
    if (head) { flush(); section = Object.assign(head, { lines: [] }); return; }
    if (section) { section.lines.push(unescapeLine(line)); return; }
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith(';')) return;
    const eq = t.indexOf('=');
    if (eq <= 0) { warnings.push(`línea ${i + 1}: se esperaba "clave = valor"`); return; }
    parseKey(out, warnings, t.slice(0, eq), t.slice(eq + 1), i + 1);
  });
  flush();
  if (docs.length) out.meetingDocuments = docs;
  return { values: out, warnings };
}

function block(name, text) {
  const body = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(escapeLine).join('\n').trim();
  return [`[${name}]`, body, ''];
}

function serialize(ctx) {
  const c = ctx || {};
  const one = (v) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
  const lines = [
    '# asistente.conf · configuración de ParakeetAI',
    '# La app lo lee al abrirse y lo reescribe cuando guardas en ⚙ Configuración.',
    '# Puedes editarlo a mano con la app cerrada (o reabre ⚙ Configuración para recargarlo).',
    '# Valores: modo = entrevista | reunion | clase · formato = viñetas | parrafo · si/no.',
    '# Los textos largos van bajo su [seccion], tal cual, hasta la siguiente [seccion].',
    '',
    `modo = ${MODE_OUT[c.mode] || 'entrevista'}`,
    `nombre = ${one(c.userName)}`,
    `caracteres = ${one(c.responseChars)}`,
    `formato = ${c.responseFormat === 'paragraph' ? 'parrafo' : 'viñetas'}`,
    `mostrar_en_pantalla_compartida = ${c.shareInterfaceVisible === true ? 'si' : 'no'}`,
    `transparencia = ${one(c.transparency || 0)}`,
    `carpeta_transcripciones = ${one(c.logDir)}`,
    '',
  ];
  for (const [name, key] of Object.entries(SECTIONS)) lines.push(...block(name, c[key]));
  for (const d of Array.isArray(c.meetingDocuments) ? c.meetingDocuments : []) {
    const name = one(d && d.name).replace(/[\]:]/g, ' ').trim() || 'Documento';
    lines.push(...block(`${DOC_SECTION}: ${name}`, d && d.text));
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

module.exports = { parse, serialize, SECTIONS };
