'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, serialize } = require('../src/assistantConf');

const full = {
  mode: 'meeting',
  userName: 'Ana Pérez',
  meetingContext: 'Kick off Odoo 19 con Acme.\nMódulos: Ventas, Inventario.',
  meetingDocuments: [{ name: 'alcance.pdf', text: 'Fase 1: ventas\n[cv]\nFase 2' }],
  cv: '# Ana\n[2020] Consultora Odoo\n\[x] literal',
  jd: '',
  responseChars: 600,
  responseFormat: 'paragraph',
  responseInstructions: 'viñetas STAR',
  meetingInstructions: 'Eres mi asistente en el kick off.\n\nPRIORIDAD\n1. Responder',
  classInstructions: '',
  shareInterfaceVisible: true,
  transparency: 20,
  logDir: 'D:\Actas',
};

test('serialize -> parse conserva todos los ajustes', () => {
  const { values, warnings } = parse(serialize(full));
  assert.deepEqual(warnings, []);
  for (const k of Object.keys(full)) {
    if (k === 'responseChars' || k === 'transparency') assert.equal(Number(values[k]), full[k], k);
    else assert.deepEqual(values[k], full[k], k);
  }
});

test('parse: archivo escrito a mano, con acentos, CRLF y comentarios', () => {
  const text = '\uFEFF# mi config\r\nModo = Reunión\r\nnombre =  Ana  \r\nformato = párrafo\r\nmostrar_en_pantalla_compartida = sí\r\n\r\n[Instrucciones Reunion]\r\n\r\nHabla corto.\r\n# esto es parte del texto\r\n\r\n[cv]\r\nNada\r\n';
  const { values, warnings } = parse(text);
  assert.deepEqual(warnings, []);
  assert.equal(values.mode, 'meeting');
  assert.equal(values.userName, 'Ana');
  assert.equal(values.responseFormat, 'paragraph');
  assert.equal(values.shareInterfaceVisible, true);
  assert.equal(values.meetingInstructions, 'Habla corto.\n# esto es parte del texto');
  assert.equal(values.cv, 'Nada');
});

test('parse: solo devuelve lo que trae el archivo y avisa lo desconocido', () => {
  const { values, warnings } = parse('modo = fiesta\ncolor = azul\nsin igual\nnombre = Luis\n[otra cosa]\n');
  assert.deepEqual(values, { userName: 'Luis' });
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /línea 1/);
});

test('parse: secciones desconocidas dentro de un texto quedan como texto', () => {
  const { values } = parse('[cv]\nExperiencia\n[2019 - 2021] Analista\n[instrucciones_clase]\nResume');
  assert.equal(values.cv, 'Experiencia\n[2019 - 2021] Analista');
  assert.equal(values.classInstructions, 'Resume');
});
