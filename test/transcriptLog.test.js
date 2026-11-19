'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTranscriptLog, logFileName } = require('../src/transcriptLog');

test('empty session produces no log', () => {
  assert.equal(buildTranscriptLog({ transcript: [], answers: [] }), '');
  assert.equal(buildTranscriptLog({ transcript: [{ who: 'them', text: '  ' }] }), '');
});

test('log includes transcript and suggested answers', () => {
  const md = buildTranscriptLog({
    endedAt: '2026-11-19T15:10:00',
    transcript: [
      { who: 'them', text: '¿Por qué quieres este cargo?', time: '2026-11-19T15:00:05' },
      { who: 'me', text: 'Porque encaja con mi experiencia.', time: '2026-11-19T15:00:20' },
    ],
    answers: [{ who: 'them', question: '¿Por qué quieres este cargo?', text: '• Lideré un equipo', mode: 'auto', time: '2026-11-19T15:00:08' }],
  });
  assert.match(md, /^# Entrevista 2026-11-19 15:00:05/);
  assert.match(md, /\*\*\[15:00:05\] Entrevistador:\*\* ¿Por qué quieres este cargo\?/);
  assert.match(md, /\*\*\[15:00:20\] Yo:\*\* Porque encaja/);
  assert.match(md, /### 1\. \[15:00:08\] \(auto\)/);
  assert.match(md, /• Lideré un equipo/);
});

test('file name is sortable timestamp', () => {
  assert.equal(logFileName('2026-11-19T09:05:03'), '2026-11-19_09-05-03.md');
});
