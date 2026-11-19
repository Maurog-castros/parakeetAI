'use strict';
// Builds a Markdown log of one session (transcript + suggested answers or
// live notes, plus the meeting summary when there is one) so it can be
// reviewed later.

const WHO_LABEL = { them: 'Entrevistador', me: 'Yo' };
const MEETING_WHO_LABEL = { them: 'Otros', me: 'Yo' };
const MODE_LABEL = { auto: 'auto', manual: 'manual', mine: 'mi pregunta' };

const pad = (n) => String(n).padStart(2, '0');
const toDate = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const hms = (d) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '--:--:--');

function logFileName(date) {
  const d = toDate(date) || new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.md`;
}

// session: { mode, startedAt, endedAt, transcript: [{who, text, time}], answers: [{who, question, text, mode, time}], summary }
function buildTranscriptLog(session) {
  const meeting = session && session.mode === 'meeting';
  const who = meeting ? MEETING_WHO_LABEL : WHO_LABEL;
  const summary = String(session && session.summary || '').trim();
  const transcript = (Array.isArray(session && session.transcript) ? session.transcript : [])
    .map((t) => ({
      who: t.who === 'me' ? 'me' : 'them',
      text: String(t.text || '').trim(),
      translation: String(t.translation || '').trim(), // Chinese mode: Spanish translation
      time: toDate(t.time),
    }))
    .filter((t) => t.text);
  const answers = (Array.isArray(session && session.answers) ? session.answers : [])
    .map((a) => ({
      who: a.who === 'me' ? 'me' : 'them',
      question: String(a.question || '').trim(),
      text: String(a.text || '').trim(),
      mode: MODE_LABEL[a.mode] || 'auto',
      time: toDate(a.time),
    }))
    .filter((a) => a.text);
  if (!transcript.length && !answers.length && !summary) return '';

  const times = [...transcript, ...answers].map((x) => x.time).filter(Boolean).sort((a, b) => a - b);
  const start = toDate(session && session.startedAt) || times[0] || new Date();
  const end = toDate(session && session.endedAt) || new Date();
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hms(d)}`;

  const lines = [
    `# ${meeting ? 'Reunión' : 'Entrevista'} ${fmtDate(start)}`,
    '',
    `- Inicio: ${fmtDate(start)}`,
    `- Fin: ${fmtDate(end)}`,
    `- Intervenciones: ${transcript.length} (${meeting ? 'otros' : 'entrevistador'} ${transcript.filter((t) => t.who === 'them').length}, yo ${transcript.filter((t) => t.who === 'me').length})`,
    `- ${meeting ? 'Notas en vivo' : 'Respuestas sugeridas'}: ${answers.length}`,
    '',
  ];
  if (summary) lines.push(summary, '');
  lines.push('## Transcripción', '');
  if (!transcript.length) lines.push('_Sin transcripción._', '');
  for (const t of transcript) {
    lines.push(`**[${hms(t.time)}] ${who[t.who]}:** ${t.text}`, '');
    if (t.translation) lines.push(`> **Traducción:** ${t.translation}`, '');
  }

  lines.push(meeting ? '## Notas en vivo' : '## Respuestas sugeridas', '');
  if (!answers.length) lines.push(meeting ? '_Sin notas._' : '_Sin respuestas sugeridas._', '');
  answers.forEach((a, i) => {
    lines.push(`### ${i + 1}. [${hms(a.time)}] (${a.mode})`, '');
    if (a.question) lines.push(`> ${a.question.replace(/\n+/g, ' ')}`, '');
    lines.push(a.text, '');
  });
  return lines.join('\n');
}

module.exports = { buildTranscriptLog, logFileName };
