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
