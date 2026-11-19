'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mm = require('../src/meetingMemory');

const summary = (extra) => Object.assign({
  title: 'Planificación del viaje',
  summary: 'Se habló del viaje al sur.',
  ideas: ['Arrendar una cabaña'],
  decisions: ['Viajar en febrero'],
  actionItems: [{ text: 'Cotizar cabañas', owner: 'Ana' }, 'Revisar pasajes'],
  nextSteps: ['Definir presupuesto'],
  initiatives: ['Armar un fondo común'],
}, extra || {});

test('parses JSON from fenced or noisy replies', () => {
  assert.deepEqual(mm.parseSummaryJson('```json\n{"title":"x"}\n```'), { title: 'x' });
  assert.deepEqual(mm.parseSummaryJson('<think>hmm</think>Aquí va: {"a":1} listo'), { a: 1 });
  assert.equal(mm.parseSummaryJson('sin json'), null);
  assert.equal(mm.parseSummaryJson('{roto'), null);
});

test('applySummary stores meeting and new action items with ids', () => {
  const { memory, meeting, newItems } = mm.applySummary(mm.emptyMemory(), summary(), { startedAt: '2026-11-19T15:00:00Z' });
  assert.equal(memory.meetings.length, 1);
  assert.equal(meeting.title, 'Planificación del viaje');
  assert.deepEqual(newItems.map((it) => it.id), ['p1', 'p2']);
  assert.equal(newItems[0].owner, 'Ana');
  assert.equal(newItems[1].text, 'Revisar pasajes');
  assert.equal(mm.openItems(memory).length, 2);
});

test('a later meeting resolves earlier items and memory context lists open ones', () => {
  let mem = mm.applySummary(mm.emptyMemory(), summary(), { startedAt: '2026-11-19T15:00:00Z' }).memory;
  const ctx = mm.buildMemoryContext(mem);
  assert.match(ctx, /\[p1\] Cotizar cabañas \(responsable: Ana\)/);
  assert.match(ctx, /Planificación del viaje/);

  const r = mm.applySummary(mem, { title: 'Segunda', actionItems: [], resolvedItemIds: ['p1', 'p99'] }, { startedAt: '2026-11-26T15:00:00Z' });
  mem = r.memory;
  assert.deepEqual(r.resolvedItems.map((it) => it.id), ['p1']);
  assert.deepEqual(mm.openItems(mem).map((it) => it.id), ['p2']);
  assert.equal(mem.meetings.length, 2);
});

test('re-summarising the same session replaces it instead of duplicating', () => {
  const info = { startedAt: '2026-11-19T15:00:00Z' };
  let mem = mm.applySummary(mm.emptyMemory(), summary(), { startedAt: '2026-11-12T15:00:00Z' }).memory; // p1, p2
  mem = mm.applySummary(mem, summary({ title: 'v1', actionItems: ['A'], resolvedItemIds: ['p1'] }), info).memory;
  mem = mm.applySummary(mem, summary({ title: 'v2', actionItems: ['B'], resolvedItemIds: [] }), info).memory;
  assert.equal(mem.meetings.length, 2);
  assert.equal(mem.meetings[1].title, 'v2');
  const texts = mem.items.map((it) => it.text);
  assert.ok(texts.includes('B') && !texts.includes('A'));
  assert.equal(mem.items.find((it) => it.id === 'p1').done, false, 'resolution from v1 is undone');
  // the meeting being re-summarised is excluded from its own memory context
  assert.doesNotMatch(mm.buildMemoryContext(mem, { exceptMeetingId: mm.meetingIdFor(info.startedAt) }), /v2|\] B/);
});

test('manual edits: mark done, remove item, remove meeting', () => {
  let mem = mm.applySummary(mm.emptyMemory(), summary(), { meetingId: 'm1' }).memory;
  mem = mm.setItemDone(mem, 'p1', true);
  assert.equal(mm.openItems(mem).length, 1);
  mem = mm.removeItem(mem, 'p2');
  assert.equal(mem.items.length, 1);
  mem = mm.removeMeeting(mem, 'm1');
  assert.equal(mem.meetings.length, 0);
  assert.equal(mem.items.length, 0);
});

test('normalizeMemory tolerates garbage', () => {
  assert.deepEqual(mm.normalizeMemory(null), mm.emptyMemory());
  const mem = mm.normalizeMemory({ meetings: [{}, { id: 'm1' }], items: [{ text: '' }, { id: 'p1', text: 'x' }] });
  assert.equal(mem.meetings.length, 1);
  assert.equal(mem.items.length, 1);
});

test('summary markdown has the main sections', () => {
  const r = mm.applySummary(mm.emptyMemory(), summary(), { meetingId: 'm1' });
  const md = mm.summaryMarkdown(r.meeting, r.newItems, r.resolvedItems);
  assert.match(md, /^## Resumen de la conversación/);
  assert.match(md, /### Ideas\n\n- Arrendar una cabaña/);
  assert.match(md, /- \[ \] Cotizar cabañas — Ana/);
  assert.match(md, /### Próximas iniciativas/);
});
