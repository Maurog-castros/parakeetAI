'use strict';
// Long-term memory for meeting mode: previous meetings (summary, ideas,
// decisions, next steps) and the action items ("pendientes") that carry over
// from one conversation to the next. Pure functions; main.js persists the
// store as JSON in userData.

const MAX_MEETINGS = 60;
const MAX_LIST = 12;
const MAX_TEXT = 600;

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || MAX_TEXT);
const list = (v, max) => (Array.isArray(v) ? v : [])
  .map((x) => str(typeof x === 'object' && x ? (x.text || x.title || '') : x))
  .filter(Boolean)
  .slice(0, max || MAX_LIST);
const iso = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function emptyMemory() {
  return { version: 1, meetings: [], items: [] };
}

function normalizeItem(it) {
  const text = str(it && it.text);
  if (!text) return null;
  return {
    id: str(it.id, 40),
    text,
    owner: str(it.owner, 80),
    createdAt: iso(it.createdAt) || new Date().toISOString(),
    meetingId: str(it.meetingId, 60),
    done: it.done === true,
    doneAt: it.done === true ? iso(it.doneAt) : null,
    doneMeetingId: it.done === true ? str(it.doneMeetingId, 60) : '',
  };
}

function normalizeMeeting(m) {
  const id = str(m && m.id, 60);
  if (!id) return null;
  return {
    id,
    startedAt: iso(m.startedAt),
    endedAt: iso(m.endedAt),
    title: str(m.title, 120) || 'Conversación',
    summary: str(m.summary, 2000),
    topics: list(m.topics),
    ideas: list(m.ideas),
    decisions: list(m.decisions),
    nextSteps: list(m.nextSteps),
    initiatives: list(m.initiatives),
    folder: str(m.folder, 400), // session folder under transcripciones/
  };
}

function normalizeMemory(raw) {
  const mem = emptyMemory();
  if (!raw || typeof raw !== 'object') return mem;
  mem.meetings = (Array.isArray(raw.meetings) ? raw.meetings : []).map(normalizeMeeting).filter(Boolean).slice(-MAX_MEETINGS);
  mem.items = (Array.isArray(raw.items) ? raw.items : []).map(normalizeItem).filter((it) => it && it.id);
  return mem;
}

function nextItemId(mem) {
  const max = mem.items.reduce((n, it) => {
    const m = /^p(\d+)$/.exec(it.id);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);
  return 'p' + (max + 1);
}

// Stable id per live session, so summarising the same conversation twice
// replaces the earlier result instead of duplicating it.
function meetingIdFor(startedAt) {
  const d = new Date(startedAt);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  return 'm' + t.toISOString().replace(/\D/g, '').slice(0, 14);
}

// Open action items, excluding those created by `exceptMeetingId` (the
// meeting being re-summarised: its own items get regenerated).
function openItems(mem, exceptMeetingId) {
  return mem.items.filter((it) => !it.done && it.meetingId !== exceptMeetingId);
}

// Text block with what the assistant should remember: open action items (with
// ids, so the model can mark them resolved) and the last few meetings.
function buildMemoryContext(mem, options) {
  const opts = options || {};
  const except = opts.exceptMeetingId || '';
  const maxMeetings = opts.maxMeetings == null ? 4 : opts.maxMeetings;
  const pending = openItems(mem, except);
  const past = mem.meetings.filter((m) => m.id !== except).slice(-maxMeetings);
  const lines = ['=== PENDIENTES ABIERTOS DE CONVERSACIONES ANTERIORES ==='];
  if (!pending.length) lines.push('(ninguno)');
  for (const it of pending) {
    const day = it.createdAt ? it.createdAt.slice(0, 10) : '';
    lines.push(`- [${it.id}] ${it.text}${it.owner ? ` (responsable: ${it.owner})` : ''}${day ? ` — desde ${day}` : ''}`);
  }
  lines.push('', '=== CONVERSACIONES ANTERIORES (más reciente al final) ===');
  if (!past.length) lines.push('(ninguna)');
  for (const m of past) {
    lines.push(`## ${m.startedAt ? m.startedAt.slice(0, 10) : ''} · ${m.title}`);
    if (m.summary) lines.push(m.summary);
    if (m.decisions.length) lines.push('Decisiones: ' + m.decisions.join('; '));
    if (m.ideas.length) lines.push('Ideas: ' + m.ideas.join('; '));
    if (m.nextSteps.length) lines.push('Próximos pasos: ' + m.nextSteps.join('; '));
    lines.push('');
  }
  return lines.join('\n').trim();
}

// Pulls the first JSON object out of a model reply (tolerates ```json fences,
// <think> blocks and surrounding prose). Returns null if nothing parses.
function parseSummaryJson(text) {
  const clean = String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : clean;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch (_) { return null; }
}

function normalizeSummary(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const actionItems = (Array.isArray(s.actionItems) ? s.actionItems : [])
    .map((a) => (typeof a === 'string' ? { text: a } : a))
    .map((a) => ({ text: str(a && a.text), owner: str(a && a.owner, 80) }))
    .filter((a) => a.text)
    .slice(0, 20);
  const resolvedItemIds = (Array.isArray(s.resolvedItemIds) ? s.resolvedItemIds : [])
    .map((x) => str(x, 40)).filter(Boolean);
  return {
    title: str(s.title, 120) || 'Conversación',
    summary: str(s.summary, 2000),
    topics: list(s.topics),
    ideas: list(s.ideas),
    decisions: list(s.decisions),
    actionItems,
    resolvedItemIds,
    nextSteps: list(s.nextSteps),
    initiatives: list(s.initiatives),
  };
}

// Stores a summary as meeting `meetingId`. Re-summarising the same meeting
// first undoes what its previous version did (its items, its resolutions).
// Returns { memory, meeting, newItems, resolvedItems }.
function applySummary(memory, summary, info) {
  const mem = normalizeMemory(memory);
  const s = normalizeSummary(summary);
  const meetingId = str(info && info.meetingId, 60) || meetingIdFor(info && info.startedAt);
  const now = iso(info && info.endedAt) || iso(info && info.startedAt) || new Date().toISOString();

  mem.meetings = mem.meetings.filter((m) => m.id !== meetingId);
  mem.items = mem.items.filter((it) => !(it.meetingId === meetingId && !it.done));
  for (const it of mem.items) {
    if (it.done && it.doneMeetingId === meetingId) { it.done = false; it.doneAt = null; it.doneMeetingId = ''; }
  }

  const resolvedItems = [];
  for (const id of s.resolvedItemIds) {
    const it = mem.items.find((x) => x.id === id && !x.done);
    if (!it) continue;
    it.done = true; it.doneAt = now; it.doneMeetingId = meetingId;
    resolvedItems.push(it);
  }
  const newItems = [];
  for (const a of s.actionItems) {
    const it = { id: nextItemId(mem), text: a.text, owner: a.owner, createdAt: now, meetingId, done: false, doneAt: null, doneMeetingId: '' };
    mem.items.push(it);
    newItems.push(it);
  }
  const meeting = normalizeMeeting({
    id: meetingId,
    startedAt: info && info.startedAt,
    endedAt: now,
    title: s.title,
    summary: s.summary,
    topics: s.topics,
    ideas: s.ideas,
    decisions: s.decisions,
    nextSteps: s.nextSteps,
    initiatives: s.initiatives,
    folder: info && info.folder,
  });
  mem.meetings.push(meeting);
  mem.meetings.sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  mem.meetings = mem.meetings.slice(-MAX_MEETINGS);
  return { memory: mem, meeting, newItems, resolvedItems };
}

function setItemDone(memory, itemId, done) {
  const mem = normalizeMemory(memory);
  const it = mem.items.find((x) => x.id === itemId);
  if (it) {
    it.done = !!done;
    it.doneAt = it.done ? new Date().toISOString() : null;
    it.doneMeetingId = '';
  }
  return mem;
}

function removeItem(memory, itemId) {
  const mem = normalizeMemory(memory);
  mem.items = mem.items.filter((x) => x.id !== itemId);
  return mem;
}

function removeMeeting(memory, meetingId) {
  const mem = normalizeMemory(memory);
  mem.meetings = mem.meetings.filter((m) => m.id !== meetingId);
  mem.items = mem.items.filter((it) => it.meetingId !== meetingId);
  return mem;
}

// Markdown block appended to the session log.
function summaryMarkdown(meeting, newItems, resolvedItems) {
  const m = meeting || {};
  const out = ['## Resumen de la conversación', ''];
  if (m.title) out.push(`**${m.title}**`, '');
  if (m.summary) out.push(m.summary, '');
  const section = (title, arr, fmt) => {
    if (!arr || !arr.length) return;
    out.push(`### ${title}`, '');
    for (const x of arr) out.push('- ' + (fmt ? fmt(x) : x));
    out.push('');
  };
  section('Temas', m.topics);
  section('Ideas', m.ideas);
  section('Decisiones', m.decisions);
  section('Pendientes nuevos', newItems, (it) => `[ ] ${it.text}${it.owner ? ` — ${it.owner}` : ''}`);
  section('Pendientes anteriores resueltos', resolvedItems, (it) => `[x] ${it.text}`);
  section('Próximos pasos', m.nextSteps);
  section('Próximas iniciativas', m.initiatives);
  return out.join('\n').trim();
}

module.exports = {
  emptyMemory,
  normalizeMemory,
  meetingIdFor,
  openItems,
  buildMemoryContext,
  parseSummaryJson,
  normalizeSummary,
  applySummary,
  setItemDone,
  removeItem,
  removeMeeting,
  summaryMarkdown,
};
