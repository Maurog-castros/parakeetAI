'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const llm = require('../src/llm');
const mm = require('../src/meetingMemory');
const sessionFiles = require('../src/sessionFiles');
const transcriptLog = require('../src/transcriptLog');
const exportDoc = require('../src/exportDoc');

test('class is a valid mode and shares the meeting pipeline', () => {
  assert.strictEqual(llm.normalizeMode('class'), 'class');
  assert.strictEqual(llm.normalizeMode('otro'), 'interview');
  assert.ok(llm.isMeetingLike('class'));
  assert.ok(llm.isMeetingLike('meeting'));
  assert.ok(!llm.isMeetingLike('interview'));
  const ins = llm.buildInstructions({ mode: 'class' });
  for (const tag of ['Idea principal', 'Ejemplo', 'Tarea']) assert.match(ins, new RegExp(tag));
  assert.match(llm.buildContextBlock({ mode: 'class', meetingContext: 'Cálculo I' }), /CONTEXTO DE LA CLASE[\s\S]*Cálculo I/);
  const sum = llm.buildClassSummaryPrompt({ mode: 'class' });
  assert.match(sum, /"examples"/);
  assert.match(sum, /"due"/);
  assert.match(llm.buildInitiativesPrompt({ mode: 'class' }), /PLAN DE ESTUDIO|plan de estudio/);
  assert.match(llm.transcriptText([{ who: 'them', text: 'Hola' }], 'class'), /^Clase: Hola/);
});

test('class summaries and homework stay apart from meetings in memory', () => {
  let mem = mm.emptyMemory();
  mem = mm.applySummary(mem, { title: 'Reunión', actionItems: [{ text: 'enviar acta' }] }, { startedAt: '2026-11-20T10:00:00Z' }).memory;
  const r = mm.applySummary(mem, {
    title: 'Derivadas',
    summary: 'Se vio la regla de la cadena.',
    ideas: ['La derivada mide el cambio instantáneo'],
    examples: ['Velocidad como derivada de la posición'],
    actionItems: [{ text: 'Guía 3, ejercicios 1-10', due: 'viernes' }],
    questions: ['¿Cuándo usar la regla del producto?'],
  }, { startedAt: '2026-11-21T10:00:00Z', kind: 'class' });
  mem = r.memory;
  assert.strictEqual(r.meeting.kind, 'class');
  assert.deepStrictEqual(r.meeting.examples, ['Velocidad como derivada de la posición']);
  assert.strictEqual(r.newItems[0].due, 'viernes');
  assert.strictEqual(r.newItems[0].kind, 'class');
  const classCtx = mm.buildMemoryContext(mem, { kind: 'class' });
  assert.match(classCtx, /TAREAS ABIERTAS[\s\S]*Guía 3[\s\S]*entrega: viernes/);
  assert.doesNotMatch(classCtx, /enviar acta/);
  const meetingCtx = mm.buildMemoryContext(mem, { kind: 'meeting' });
  assert.match(meetingCtx, /enviar acta/);
  assert.doesNotMatch(meetingCtx, /Guía 3/);
  assert.strictEqual(mm.openItems(mem, '', 'class').length, 1);
  // A class summary cannot close a meeting item.
  const meetingItem = mem.items.find((it) => it.kind === 'meeting');
  const r2 = mm.applySummary(mem, { title: 'x', resolvedItemIds: [meetingItem.id] }, { startedAt: '2026-11-22T10:00:00Z', kind: 'class' });
  assert.strictEqual(r2.resolvedItems.length, 0);
});

test('class session files: summary, main ideas, tasks, examples', () => {
  const r = mm.applySummary(mm.emptyMemory(), {
    title: 'Derivadas', summary: 'Resumen.', ideas: ['Idea A'], examples: ['Ejemplo B'],
    actionItems: [{ text: 'Tarea C', due: 'lunes' }], nextSteps: ['Repasar D'], questions: ['Duda E'],
  }, { startedAt: '2026-11-21T10:00:00Z', kind: 'class' });
  const files = sessionFiles.meetingFiles(r.meeting, r.newItems, [], []);
  assert.deepStrictEqual(Object.keys(files).sort(), ['ejemplos.md', 'ideas.md', 'proximos-pasos.md', 'resumen.md', 'reunion.json', 'tareas.md']);
  assert.match(files['ideas.md'], /Idea A/);
  assert.match(files['ejemplos.md'], /Ejemplo B/);
  assert.match(files['tareas.md'], /\[ \] Tarea C _\(entrega: lunes\)_/);
  assert.match(files['proximos-pasos.md'], /Repasar D[\s\S]*Duda E/);
});

test('class transcript log round-trips its mode', () => {
  const md = transcriptLog.buildTranscriptLog({
    mode: 'class', startedAt: '2026-11-21T10:00:00Z',
    transcript: [{ who: 'them', text: 'Hoy vemos derivadas', time: '2026-11-21T10:00:05Z' }],
  });
  assert.match(md, /^# Clase /);
  assert.match(md, /Clase:\*\* Hoy vemos derivadas/);
  const parsed = transcriptLog.parseTranscriptLog(md, '2026-11-21T10:00:00Z');
  assert.strictEqual(parsed.mode, 'class');
  assert.strictEqual(parsed.transcript[0].who, 'them');
});

const FILES = {
  'resumen.md': '# Resumen de la clase · Derivadas\n\n_2026-11-21 10:00_\n\nSe vio **la regla** de la cadena & <otros>.\n\n## Ideas principales\n\n- Idea A',
  'tareas.md': '# Tareas · Derivadas\n\n- [ ] Guía 3\n- [x] Guía 2',
  'transcripcion.md': '# Clase\n\n## Transcripción\n\n**[10:00:05] Clase:** Hola\n\n- [10:01:00] ![captura](captura_10-01-00.jpg)',
};

test('export: markdown blocks and HTML escape content', () => {
  const blocks = exportDoc.mdBlocks(FILES['tareas.md']);
  assert.deepStrictEqual(blocks.map((b) => b.type), ['h', 'li', 'li']);
  assert.strictEqual(blocks[1].check, false);
  assert.strictEqual(blocks[2].check, true);
  const html = exportDoc.sessionHtml('Derivadas <x>', 'Clase', FILES);
  assert.match(html, /<title>Derivadas &lt;x&gt;<\/title>/);
  assert.match(html, /<strong>la regla<\/strong>/);
  assert.match(html, /&amp; &lt;otros&gt;/);
  assert.match(html, /captura: captura_10-01-00\.jpg/);
  // resumen before tareas before transcripción
  assert.ok(html.indexOf('Idea A') < html.indexOf('Guía 3'));
  assert.ok(html.indexOf('Guía 3') < html.indexOf('Hola'));
});

// Reads a stored ZIP back (enough to check our own output).
function unzip(buf) {
  const out = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const data = buf.slice(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    assert.strictEqual(method, 0);
    assert.strictEqual(exportDoc.crc32(data), crc);
    out[name] = data.toString('utf8');
    i += 30 + nameLen + extra + size;
  }
  return out;
}

test('export: docx is a valid package with escaped text', () => {
  const buf = exportDoc.sessionDocx('Derivadas', 'Clase · 21 nov', FILES);
  const parts = unzip(buf);
  assert.ok(parts['[Content_Types].xml']);
  assert.ok(parts['word/styles.xml']);
  const doc = parts['word/document.xml'];
  assert.match(doc, /<w:pStyle w:val="Title"\/>.*Derivadas/);
  assert.match(doc, /&amp; &lt;otros&gt;/);
  assert.match(doc, /☐\t<\/w:t>.*Guía 3/);
  assert.match(doc, /<w:b\/>.*la regla/);
  if (zlib.crc32) assert.strictEqual(exportDoc.crc32(Buffer.from('hola')), zlib.crc32(Buffer.from('hola')));
});

test('export file name is safe and readable', () => {
  assert.strictEqual(exportDoc.exportFileName('2026-11-21T10:00:00Z', 'Clase', 'Derivadas: regla/cadena', 'pdf'), '2026-11-21 Clase - Derivadas regla cadena.pdf');
});
