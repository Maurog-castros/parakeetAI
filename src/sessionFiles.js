'use strict';
// One folder per session under transcripciones/:
//   2026-11-19_15-00-05_planificacion-del-viaje/
//     transcripcion.md   transcript + live notes / suggested answers
//     resumen.md         title, summary, topics, decisions
//     pendientes.md      new, resolved and still-open action items
//     ideas.md           ideas + proposed initiatives
//     proximos-pasos.md  next steps
//     reunion.json       everything above, structured
// The folder starts with the timestamp only and gets the title appended once
// the meeting is summarised. Pure functions; main.js does the I/O.

const TRANSCRIPT_FILE = 'transcripcion.md';

const pad = (n) => String(n).padStart(2, '0');
function stamp(date) {
  const d0 = new Date(date);
  const d = Number.isNaN(d0.getTime()) ? new Date() : d0;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function slugify(text, max) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max || 40)
    .replace(/-+$/, '');
}

function sessionFolderName(startedAt, title) {
  const slug = slugify(title);
  return stamp(startedAt) + (slug ? '_' + slug : '');
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const bullets = (arr, empty) => (arr && arr.length ? arr.map((x) => '- ' + x) : [empty || '_Nada registrado._']);
const itemLine = (it, done) => `- [${done ? 'x' : ' '}] ${it.text}${it.owner ? ` — ${it.owner}` : ''}`;

// files: { name: content } for a summarised meeting.
// stillOpen: open items from previous meetings (not created by this one).
function meetingFiles(meeting, newItems, resolvedItems, stillOpen) {
  const m = meeting || {};
  const head = (title) => [`# ${title} · ${m.title || 'Conversación'}`, '', `_${fmtDate(m.startedAt)}_`, ''];
  const files = {};

  files['resumen.md'] = [
    ...head('Resumen'),
    m.summary || '_Sin resumen._',
    '',
    '## Temas', '', ...bullets(m.topics), '',
    '## Decisiones', '', ...bullets(m.decisions), '',
  ].join('\n');

  files['pendientes.md'] = [
    ...head('Pendientes'),
    '## Nuevos en esta conversación', '',
    ...(newItems && newItems.length ? newItems.map((it) => itemLine(it, false)) : ['_Ninguno._']), '',
    '## Cerrados en esta conversación', '',
    ...(resolvedItems && resolvedItems.length ? resolvedItems.map((it) => itemLine(it, true)) : ['_Ninguno._']), '',
    '## Siguen abiertos de conversaciones anteriores', '',
    ...(stillOpen && stillOpen.length
      ? stillOpen.map((it) => itemLine(it, false) + (it.createdAt ? ` _(desde ${it.createdAt.slice(0, 10)})_` : ''))
      : ['_Ninguno._']), '',
  ].join('\n');

  files['ideas.md'] = [
    ...head('Ideas'),
    '## Ideas que surgieron', '', ...bullets(m.ideas), '',
    '## Próximas iniciativas propuestas', '', ...bullets(m.initiatives), '',
  ].join('\n');

  files['proximos-pasos.md'] = [
    ...head('Próximos pasos'),
    ...bullets(m.nextSteps), '',
  ].join('\n');

  files['reunion.json'] = JSON.stringify({
    meeting: m,
    newItems: newItems || [],
    resolvedItems: resolvedItems || [],
    stillOpen: stillOpen || [],
  }, null, 2) + '\n';

  return files;
}

module.exports = { TRANSCRIPT_FILE, slugify, sessionFolderName, meetingFiles };
