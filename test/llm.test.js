'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSystem,
  limitResponse,
  normalizeResponseChars,
  normalizeResponseFormat,
  normalizeResponseInstructions,
  buildPracticeQuestionPrompt,
  buildPracticeEvaluationPrompt,
} = require('../src/llm');

test('normaliza el límite al rango permitido', () => {
  assert.equal(normalizeResponseChars('640'), 640);
  assert.equal(normalizeResponseChars(20), 120);
  assert.equal(normalizeResponseChars(9999), 1500);
  assert.equal(normalizeResponseChars('mal'), 500);
});

test('recorta sin superar el máximo', () => {
  const result = limitResponse('Una respuesta humana con palabras completas y una conclusión clara.'.repeat(5), 120);
  assert.ok(result.length <= 120);
  assert.ok(result.endsWith('…'));
});

test('el prompt incorpora tono y límite elegidos', () => {
  const prompt = buildSystem({ responseChars: 700, cv: '', jd: '' });
  assert.match(prompt, /persona real hablando/);
  assert.match(prompt, /Límite estricto: 700 caracteres/);
});

test('normaliza formato e instrucciones del usuario', () => {
  assert.equal(normalizeResponseFormat('paragraph'), 'paragraph');
  assert.equal(normalizeResponseFormat('formato-inventado'), 'bullets');
  assert.equal(normalizeResponseInstructions('  Responde con ejemplos  '), 'Responde con ejemplos');
  assert.equal(normalizeResponseInstructions('x'.repeat(1200)).length, 1000);
});

test('el prompt respeta bullets o texto continuo', () => {
  const bullets = buildSystem({ responseFormat: 'bullets' });
  assert.match(bullets, /lista de 2-4 viñetas/);
  assert.match(bullets, /cada viñeta comienza con "• "/);

  const paragraph = buildSystem({
    responseFormat: 'paragraph',
    responseInstructions: 'Incluye un ejemplo concreto.',
  });
  assert.match(paragraph, /texto continuo/);
  assert.match(paragraph, /No uses viñetas/);
  assert.match(paragraph, /Incluye un ejemplo concreto/);
});

test('la práctica evita repetir preguntas y usa el contexto', () => {
  const prompt = buildPracticeQuestionPrompt(
    [{ question: 'Háblame de ti', answer: 'Soy desarrollador.' }],
    { jd: 'Backend Node.js', cv: 'Experiencia con APIs' }
  );
  assert.match(prompt, /No repitas preguntas/);
  assert.match(prompt, /Backend Node\.js/);
  assert.match(prompt, /Háblame de ti/);
});

test('la evaluación exige evidencia y un plan concreto', () => {
  const prompt = buildPracticeEvaluationPrompt(
    [{ question: '¿Qué resolviste?', answer: 'Automaticé un proceso.' }],
    { jd: 'Automatización' }
  );
  assert.match(prompt, /PUNTAJE GLOBAL: X\/100/);
  assert.match(prompt, /PLAN DE PRÁCTICA/);
  assert.match(prompt, /Automaticé un proceso/);
});
