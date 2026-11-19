'use strict';
// Builds a Markdown log of one interview session (transcript + suggested
// answers) so it can be reviewed later to analyse performance.

const WHO_LABEL = { them: 'Entrevistador', me: 'Yo' };
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

// session: { startedAt, endedAt, transcript: [{who, text, time}], answers: [{who, question, text, mode, time}] }
function buildTranscriptLog(session) {
  const transcript = (Array.isArray(session && session.transcript) ? session.transcript : [])
    .map((t) => ({ who: t.who === 'me' ? 'me' : 'them', text: String(t.text || '').trim(), time: toDate(t.time) }))
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
  if (!transcript.length && !answers.length) return '';

  const times = [...transcript, ...answers].map((x) => x.time).filter(Boolean).sort((a, b) => a - b);
  const start = toDate(session && session.startedAt) || times[0] || new Date();
  const end = toDate(session && session.endedAt) || new Date();
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hms(d)}`;

  const lines = [
    `# Entrevista ${fmtDate(start)}`,
    '',
    `- Inicio: ${fmtDate(start)}`,
    `- Fin: ${fmtDate(end)}`,
    `- Intervenciones: ${transcript.length} (entrevistador ${transcript.filter((t) => t.who === 'them').length}, yo ${transcript.filter((t) => t.who === 'me').length})`,
    `- Respuestas sugeridas: ${answers.length}`,
    '',
    '## Transcripción',
    '',
  ];
  if (!transcript.length) lines.push('_Sin transcripción._', '');
  for (const t of transcript) lines.push(`**[${hms(t.time)}] ${WHO_LABEL[t.who]}:** ${t.text}`, '');

  lines.push('## Respuestas sugeridas', '');
  if (!answers.length) lines.push('_Sin respuestas sugeridas._', '');
  answers.forEach((a, i) => {
    lines.push(`### ${i + 1}. [${hms(a.time)}] (${a.mode})`, '');
    if (a.question) lines.push(`> ${a.question.replace(/\n+/g, ' ')}`, '');
    lines.push(a.text, '');
  });
  return lines.join('\n');
}

module.exports = { buildTranscriptLog, logFileName };
