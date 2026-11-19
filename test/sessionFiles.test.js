'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify, sessionFolderName, meetingFiles, TRANSCRIPT_FILE } = require('../src/sessionFiles');
const mm = require('../src/meetingMemory');

test('folder name: timestamp plus a safe slug of the title', () => {
  assert.equal(slugify('¡Planificación del Viaje a Pucón! 2027'), 'planificacion-del-viaje-a-pucon-2027');
  assert.equal(slugify('  ///  '), '');
  assert.ok(slugify('a'.repeat(30) + ' ' + 'b'.repeat(30)).length <= 40);
  assert.equal(sessionFolderName('2026-11-19T09:05:03', ''), '2026-11-19_09-05-03');
  assert.equal(sessionFolderName('2026-11-19T09:05:03', 'Viaje al sur'), '2026-11-19_09-05-03_viaje-al-sur');
  assert.equal(TRANSCRIPT_FILE, 'transcripcion.md');
});

test('meeting files: one file per aspect plus structured json', () => {
  let mem = mm.applySummary(mm.emptyMemory(), { title: 'Previa', actionItems: [{ text: 'Revisar fechas', owner: 'Luis' }] }, { meetingId: 'm0', startedAt: '2026-11-12T20:00:00' }).memory;
  const r = mm.applySummary(mem, {
    title: 'Viaje',
    summary: 'Se habló del viaje.',
    topics: ['Fechas'],
    decisions: ['Febrero'],
    ideas: ['Subir el volcán'],
    initiatives: ['Fondo común'],
    nextSteps: ['Comprar pasajes'],
    actionItems: [{ text: 'Ver pasajes', owner: 'Yo' }],
  }, { meetingId: 'm1', startedAt: '2026-11-19T20:00:00', folder: 'C:/x/2026-11-19_20-00-00_viaje' });
  mem = r.memory;
  const files = meetingFiles(r.meeting, r.newItems, r.resolvedItems, mm.openItems(mem, 'm1'));
  assert.deepEqual(Object.keys(files).sort(), ['ideas.md', 'pendientes.md', 'proximos-pasos.md', 'resumen.md', 'reunion.json']);
  assert.match(files['resumen.md'], /^# Resumen · Viaje\n\n_2026-11-19 20:00_/);
  assert.match(files['resumen.md'], /## Decisiones\n\n- Febrero/);
  assert.match(files['pendientes.md'], /## Nuevos en esta conversación\n\n- \[ \] Ver pasajes — Yo/);
  assert.match(files['pendientes.md'], /## Siguen abiertos de conversaciones anteriores\n\n- \[ \] Revisar fechas — Luis _\(desde 2026-11-12\)_/);
  assert.match(files['ideas.md'], /- Subir el volcán[\s\S]*- Fondo común/);
  assert.match(files['proximos-pasos.md'], /- Comprar pasajes/);
  const json = JSON.parse(files['reunion.json']);
  assert.equal(json.meeting.folder, 'C:/x/2026-11-19_20-00-00_viaje');
  assert.equal(json.newItems[0].text, 'Ver pasajes');
});
