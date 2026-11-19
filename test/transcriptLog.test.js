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

test('log includes the translation of interviewer phrases (Chinese mode)', () => {
  const md = buildTranscriptLog({
    transcript: [
      { who: 'them', text: '请介绍一下你自己', translation: 'Preséntate, por favor.', time: '2026-11-19T15:00:05' },
      { who: 'me', text: 'Claro.', translation: '', time: '2026-11-19T15:00:09' },
    ],
  });
  assert.match(md, /\*\*\[15:00:05\] Entrevistador:\*\* 请介绍一下你自己\n\n> \*\*Traducción:\*\* Preséntate, por favor\./);
  assert.equal((md.match(/Traducción:/g) || []).length, 1);
});

test('file name is sortable timestamp', () => {
  assert.equal(logFileName('2026-11-19T09:05:03'), '2026-11-19_09-05-03.md');
});

test('meeting log uses neutral labels and includes the summary', () => {
  const md = buildTranscriptLog({
    mode: 'meeting',
    summary: '## Resumen de la conversación\n\nTodo bien.',
    transcript: [{ who: 'them', text: 'Hagamos el viaje.', time: '2026-11-19T15:00:05' }],
    answers: [{ who: 'them', question: 'Hagamos el viaje.', text: '💡 Idea: viaje', time: '2026-11-19T15:00:08' }],
  });
  assert.match(md, /^# Reunión /);
  assert.match(md, /\*\*\[15:00:05\] Otros:\*\* Hagamos el viaje\./);
  assert.match(md, /## Resumen de la conversación[\s\S]*## Transcripción[\s\S]*## Notas en vivo/);
});
