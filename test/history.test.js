'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const history = require('../src/history');
const { buildTranscriptLog, parseTranscriptLog } = require('../src/transcriptLog');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pk-hist-'));
}
const meetingLog = buildTranscriptLog({
  mode: 'meeting',
  transcript: [
    { who: 'them', text: 'Subamos el volcán Villarrica.', time: '2026-11-19T20:00:05' },
    { who: 'me', text: 'Yo veo los pasajes.', time: '2026-11-19T20:01:10' },
  ],
  answers: [{ who: 'them', question: 'x', text: '💡 Idea: volcán', time: '2026-11-19T20:00:08' }],
});

test('parseTranscriptLog recovers the transcript from a saved log', () => {
  const r = parseTranscriptLog(meetingLog, new Date(2026, 10, 19, 20, 0, 5));
  assert.equal(r.mode, 'meeting');
  assert.equal(r.transcript.length, 2, 'live notes are not part of the transcript');
  assert.deepEqual(r.transcript.map((t) => t.who), ['them', 'me']);
  assert.equal(r.transcript[1].text, 'Yo veo los pasajes.');
  assert.equal(new Date(r.transcript[1].time).getMinutes(), 1);
  const zh = parseTranscriptLog('# Entrevista x\n\n## Transcripción\n\n**[10:00:00] Entrevistador:** 你好\n\n> **Traducción:** Hola\n', new Date(2026, 0, 1, 10));
  assert.equal(zh.mode, 'interview');
  assert.equal(zh.transcript[0].translation, 'Hola');
});

test('lists folders and old flat logs, newest first, with summary info', () => {
  const root = tmpRoot();
  const a = path.join(root, '2026-11-19_20-00-05_viaje-a-pucon');
  fs.mkdirSync(a);
  fs.writeFileSync(path.join(a, 'transcripcion.md'), meetingLog);
  fs.writeFileSync(path.join(a, 'resumen.md'), '# Resumen');
  fs.writeFileSync(path.join(a, 'reunion.json'), JSON.stringify({ meeting: { title: 'Viaje a Pucón', summary: 'Planes de febrero' } }));
  const b = path.join(root, '2026-11-20_09-00-00');
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(b, 'transcripcion.md'), '# Entrevista 2026-11-20\n\n## Transcripción\n');
  fs.writeFileSync(path.join(root, '2026-11-01_08-00-00.md'), '# Entrevista vieja\n\n## Transcripción\n\n**[08:00:01] Entrevistador:** Hola\n');
  fs.writeFileSync(path.join(root, 'notas.txt'), 'ignorar');
  fs.mkdirSync(path.join(root, 'otra-carpeta'));

  const list = history.listSessions(root);
  assert.deepEqual(list.map((s) => s.id), ['2026-11-20_09-00-00', '2026-11-19_20-00-05_viaje-a-pucon', '2026-11-01_08-00-00.md']);
  const viaje = list[1];
  assert.equal(viaje.title, 'Viaje a Pucón');
  assert.equal(viaje.mode, 'meeting');
  assert.equal(viaje.hasSummary, true);
  assert.deepEqual(viaje.files, ['resumen.md', 'transcripcion.md']);
  assert.equal(list[0].mode, 'interview');
  assert.equal(list[2].kind, 'file');

  assert.deepEqual(history.listSessions(root, 'VOLCAN').map((s) => s.id), ['2026-11-19_20-00-05_viaje-a-pucon'], 'search ignores case and accents');
  assert.deepEqual(history.listSessions(root, 'febrero').map((s) => s.id), ['2026-11-19_20-00-05_viaje-a-pucon']);
});

test('readSession returns file contents; unsafe ids are rejected', () => {
  const root = tmpRoot();
  const a = path.join(root, '2026-11-19_20-00-05');
  fs.mkdirSync(a);
  fs.writeFileSync(path.join(a, 'transcripcion.md'), meetingLog);
  const r = history.readSession(root, '2026-11-19_20-00-05');
  assert.match(r.files['transcripcion.md'], /volcán/);
  assert.equal(r.info.title, 'Conversación');
  for (const bad of ['..', '../2026-11-19_20-00-05', '2026-11-19_20-00-05/../x', 'C:\\Windows', '']) {
    assert.equal(history.readSession(root, bad), null, bad);
  }
});

test('migrateFlatLog moves an old log into its own folder', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, '2026-11-01_08-00-00.md'), meetingLog);
  const dir = history.migrateFlatLog(root, '2026-11-01_08-00-00.md');
  assert.equal(path.basename(dir), '2026-11-01_08-00-00');
  assert.ok(fs.existsSync(path.join(dir, 'transcripcion.md')));
  assert.ok(!fs.existsSync(path.join(root, '2026-11-01_08-00-00.md')));
  assert.equal(history.listSessions(root)[0].kind, 'folder');
});
