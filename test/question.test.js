'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { needsAnswer, isClearQuestionEnd } = require('../src/renderer/question');

test('detecta interrogativos con tilde (antes fallaban por \\b)', () => {
  assert.ok(needsAnswer('Y cómo manejaste ese conflicto con el equipo'));
  assert.ok(needsAnswer('Por qué quieres trabajar con nosotros'));
  assert.ok(needsAnswer('Cuál fue tu mayor logro'));
  assert.ok(needsAnswer('En qué proyecto aplicaste eso'));
});

test('detecta peticiones sin signo de interrogación', () => {
  assert.ok(needsAnswer('Cuéntame un poco sobre tu experiencia en datos'));
  assert.ok(needsAnswer('Me gustaría saber tu experiencia con AWS'));
  assert.ok(needsAnswer('Dame un ejemplo de una situación difícil'));
  assert.ok(needsAnswer('Has trabajado con equipos remotos'));
});

test('detecta signos de pregunta', () => {
  assert.ok(needsAnswer('¿Tienes disponibilidad inmediata?'));
  assert.ok(isClearQuestionEnd('Tienes disponibilidad inmediata?'));
  assert.ok(!isClearQuestionEnd('Gracias por venir.'));
});

test('no dispara con "que"/"como" en frases afirmativas', () => {
  assert.ok(!needsAnswer('Bueno, te comento que la empresa tiene tres áreas'));
  assert.ok(!needsAnswer('Perfecto, como te decía el equipo es pequeño'));
  assert.ok(!needsAnswer('Muchas gracias por tu tiempo'));
});

test('acepta interrogativo sin tilde al inicio', () => {
  assert.ok(needsAnswer('como manejarías un cliente molesto'));
  assert.ok(needsAnswer('y cuando podrías empezar'));
});

const { isBackchannel, isEcho } = require('../src/renderer/question');

test('isBackchannel: muletillas de la entrevista no piden respuesta', () => {
  for (const t of ['Mm-hmm.', 'Mm.', 'Claro.', 'Super.', 'Súper, super.', 'Okay.', 'Hmm.', 'Ah yeah, perfecto.', 'Muy bien, gracias.', 'De acuerdo.', 'Ya, vale, perfecto.', 'Super, sí, no hay problema.']) {
    assert.ok(isBackchannel(t), t);
  }
});

test('isBackchannel: frases con contenido sí se responden', () => {
  for (const t of [
    'Super. Y coméntame una situación en la que hayas tenido que priorizar.',
    'Exacto. Plataforma.',
    'Aquí está, tres millones cien.',
    '¿Cuál sería tu disponibilidad?',
    'No, en el Alto Las Condes.',
  ]) {
    assert.ok(!isBackchannel(t), t);
  }
});

test('isEcho: el micrófono repitiendo al entrevistador es eco', () => {
  const them = 'Super, mira, parto presentándome. Mi nombre es Karina Lecaro, soy asistente y reclutadora TI acá en Witi y voy a estar a cargo del proceso inicial para este cargo.';
  assert.ok(isEcho('Super, mira, parto presentándome. Mi nombre es Karina Lecaro, soy asistente y reclutadora TI acá en Witi y voy a estar a cargo del proceso inicial para este cargo. Vale, perfecto.', them));
  assert.ok(isEcho('ya específicamente para el área de retail de cinco sud está destinado el cargo',
    'Bueno, la contratación es directamente con Witi. Ya específicamente para el área de retail de Sencosud está destinado el cargo.'));
});

test('isEcho: tus propias preguntas no son eco', () => {
  const them = 'Super. No sé si tu tienes alguna duda, alguna consulta adicional.';
  assert.ok(!isEcho('¿Este perfil debería estar trabajando a principios de enero o todavía no lo tienen considerado?', them));
  assert.ok(!isEcho('¿Qué stack usan en el equipo?', ''));
  assert.ok(!isEcho('Sí.', them));
});

const { extractQuestions } = require('../src/renderer/question');

test('extractQuestions: preguntas del entrevistador con fecha y hora', () => {
  const md = [
    '# Entrevista 2026-11-25 23:59:00', '', '- Inicio: 2026-11-25 23:59:00', '', '## Transcripción', '',
    '**[23:59:10] Entrevistador:** Mm-hmm.', '',
    '**[23:59:20] Yo:** ¿Cómo fue la situación?', '',
    '**[23:59:30] Entrevistador:** Súper. Y coméntame cómo priorizas tareas.', '',
    '**[00:00:05] Entrevistador:** ¿Cuál sería tu disponibilidad?', '',
    '**[00:00:09] Entrevistador:** Bueno, te comento que la empresa tiene tres áreas.', '',
    '## Respuestas sugeridas', '', '### 1. [23:59:30] (auto)', '', '**[01:00:00] Entrevistador:** ¿No cuenta?',
  ].join('\n');
  assert.deepEqual(extractQuestions(md), [
    { date: '2026-11-25', time: '23:59:30', who: 'Entrevistador', text: 'Súper. Y coméntame cómo priorizas tareas.' },
    { date: '2026-11-26', time: '00:00:05', who: 'Entrevistador', text: '¿Cuál sería tu disponibilidad?' },
  ]);
});

test('extractQuestions: sin transcripción no hay preguntas', () => {
  assert.deepEqual(extractQuestions(''), []);
});

test('isAskedQuestion: ignora "cómo"/"puedes" dentro de afirmaciones', () => {
  const { isAskedQuestion } = require('../src/renderer/question');
  assert.ok(!isAskedQuestion('Yo comentarte cómo vamos a avanzar para que tú tengas claridad.'));
  assert.ok(!isAskedQuestion('Cualquier duda me la puedes hacer por WhatsApp, no hay ningún problema.'));
  assert.ok(isAskedQuestion('O, o cuánto es el mínimo, prefiero aclararlo desde ya.'));
  assert.ok(isAskedQuestion('No sé si tienes algún viaje programado.'));
});
