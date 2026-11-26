'use strict';
// Browsing saved sessions under transcripciones/: session folders
// (YYYY-MM-DD_HH-MM-SS[_slug]/) and old flat logs (YYYY-MM-DD_HH-MM-SS.md).
// All ids are plain names inside the root; anything else is rejected.

const fs = require('fs');
const path = require('path');
const { TRANSCRIPT_FILE } = require('./sessionFiles');

const STAMP_RE = /^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)/;
// Files shown in the viewer, in tab order.
const VIEW_FILES = ['resumen.md', 'pendientes.md', 'tareas.md', 'ideas.md', 'ejemplos.md', 'proximos-pasos.md', TRANSCRIPT_FILE];

function stampDate(name) {
  const m = STAMP_RE.exec(name);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? null : d;
}

function readText(file, max) {
  try {
    const s = fs.readFileSync(file, 'utf8');
    return max ? s.slice(0, max) : s;
  } catch (_) { return ''; }
}

function deslug(name) {
  const slug = name.replace(STAMP_RE, '').replace(/^_/, '').replace(/_\d+$/, '');
  if (!slug) return '';
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Safe absolute path of a session id, or null.
function resolveSession(root, id) {
  const name = String(id || '');
  if (!name || name !== path.basename(name) || name.startsWith('.') || !STAMP_RE.test(name)) return null;
  const p = path.join(root, name);
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) return { kind: 'folder', path: p };
    if (st.isFile() && /\.md$/i.test(name)) return { kind: 'file', path: p };
  } catch (_) {}
  return null;
}

function sessionInfo(root, name) {
  const loc = resolveSession(root, name);
  if (!loc) return null;
  const started = stampDate(name);
  const transcriptPath = loc.kind === 'folder' ? path.join(loc.path, TRANSCRIPT_FILE) : loc.path;
  const head = readText(transcriptPath, 400);
  const mode = /^#\s*Clase/m.test(head) ? 'class' : /^#\s*Reuni[oó]n/m.test(head) ? 'meeting' : /^#\s*Entrevista/m.test(head) ? 'interview' : '';
  let meeting = null;
  let files = [];
  if (loc.kind === 'folder') {
    try { files = fs.readdirSync(loc.path).filter((f) => VIEW_FILES.includes(f) || f === 'reunion.json'); } catch (_) {}
    try { meeting = JSON.parse(readText(path.join(loc.path, 'reunion.json'))).meeting || null; } catch (_) {}
  } else {
    files = [TRANSCRIPT_FILE];
  }
  const title = (meeting && meeting.title) || deslug(name) || (mode === 'interview' ? 'Entrevista' : mode === 'class' ? 'Clase' : 'Conversación');
  return {
    id: name,
    kind: loc.kind,
    path: loc.path,
    startedAt: started ? started.toISOString() : null,
    title,
    mode: mode || (meeting ? (meeting.kind === 'class' ? 'class' : 'meeting') : ''),
    hasSummary: !!meeting,
    summary: meeting && meeting.summary ? String(meeting.summary).slice(0, 300) : '',
    files: VIEW_FILES.filter((f) => files.includes(f)),
  };
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Newest first. query: case/accent-insensitive search over title and all
// text files of the session.
function listSessions(root, query) {
  let names = [];
  try { names = fs.readdirSync(root); } catch (_) { return []; }
  const q = norm(query).trim();
  const out = [];
  for (const name of names) {
    if (!STAMP_RE.test(name)) continue;
    const info = sessionInfo(root, name);
    if (!info) continue;
    if (q) {
      const texts = [info.title, info.summary];
      if (info.kind === 'file') texts.push(readText(info.path));
      else for (const f of info.files) texts.push(readText(path.join(info.path, f)));
      if (!norm(texts.join('\n')).includes(q)) continue;
    }
    out.push(info);
  }
  return out.sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

function readSession(root, id) {
  const info = sessionInfo(root, id);
  if (!info) return null;
  const files = {};
  if (info.kind === 'file') files[TRANSCRIPT_FILE] = readText(info.path);
  else for (const f of info.files) files[f] = readText(path.join(info.path, f));
  return { info, files };
}

// Old flat log -> its own folder (file moved in as transcripcion.md), so it
// can be summarised like any other session. Returns the folder path.
function migrateFlatLog(root, id) {
  const loc = resolveSession(root, id);
  if (!loc) return null;
  if (loc.kind === 'folder') return loc.path;
  const base = id.replace(/\.md$/i, '');
  let dir = path.join(root, base);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(root, `${base}_${n}`);
  fs.mkdirSync(dir);
  fs.renameSync(loc.path, path.join(dir, TRANSCRIPT_FILE));
  return dir;
}

module.exports = { VIEW_FILES, stampDate, resolveSession, sessionInfo, listSessions, readSession, migrateFlatLog };
