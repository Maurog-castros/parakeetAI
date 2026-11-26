'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { firstNote, labelOf, isRepeatedNote, isReply, replyBody } = require('../src/renderer/notes');

test('firstNote: se queda con una sola línea', () => {
  assert.equal(firstNote('✅ Pendiente: Mauro actualizó la conexión.\n✅ Pendiente: Miko define Casos.'), '✅ Pendiente: Mauro actualizó la conexión.');
  assert.equal(firstNote('- Confirmo que no visualizo el elemento.\n- Solicito que indiquen dónde.'), 'Confirmo que no visualizo el elemento.');
  assert.equal(firstNote('  \n'), '');
});

test('labelOf: reconoce la etiqueta con o sin emoji', () => {
  assert.equal(labelOf('📌 Decisión: usar Apuntai'), 'decision');
  assert.equal(labelOf('💡 Idea principal: derivadas'), 'idea principal');
  assert.equal(labelOf('sin etiqueta'), '');
});

test('isRepeatedNote: descarta reformulaciones del mismo pendiente', () => {
  const prev = ["✅ Pendiente: Miko debe definir la estructura de datos para 'Casos', incluyendo el campo \"monto total\"."];
  assert.ok(isRepeatedNote("✅ Pendiente: Miko debe definir la estructura de datos para 'Casos' (involucrados, estado, montos pagados).", prev));
});

test('isRepeatedNote: descarta notas que solo repiten un pendiente abierto de la memoria', () => {
  const open = ["Configurar la carpeta 'legal' en el hosting de HL y habilitar el acceso para los usuarios correspondientes."];
  assert.ok(isRepeatedNote("✅ Pendiente: Mauro debe configurar la carpeta 'legal' en el hosting de HL y habilitar el acceso.", [], open));
  // A "Retoma" reports progress on that item: keep it.
  assert.ok(!isRepeatedNote("🔁 Retoma: carpeta 'legal' en el hosting de HL ya configurada.", [], open));
});

test('isRepeatedNote: notas distintas pasan', () => {
  const prev = ["✅ Pendiente: Miko debe definir la estructura de datos para 'Casos'."];
  assert.ok(!isRepeatedNote("✅ Pendiente: Miko investiga dominios para los nombres 'Apuntai' y 'Cachai'.", prev));
  assert.ok(!isRepeatedNote('📌 Decisión: crear la pestaña Pagos con monto acordado.', prev));
});

test('isReply / replyBody: respuesta sugerida a una pregunta dirigida a mí', () => {
  const t = '💬 Respuesta:\n• Odoo 19 es la versión estable actual.\n• Sobre la 20 lo confirmo apenas salga.';
  assert.ok(isReply(t));
  assert.ok(isReply('Respuesta sugerida: • algo'));
  assert.ok(!isReply('💡 Idea: migrar a Odoo 19'));
  assert.equal(replyBody(t), '• Odoo 19 es la versión estable actual.\n• Sobre la 20 lo confirmo apenas salga.');
});
