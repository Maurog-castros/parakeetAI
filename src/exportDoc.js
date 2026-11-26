'use strict';
// Export a saved session (its Markdown files) to Word (.docx) or to an HTML
// page that main.js prints to PDF. No dependencies: the .docx is a minimal
// OOXML package written with a tiny "stored" (uncompressed) ZIP writer.
// The Markdown is the subset the app writes: #/##/### headings, "- " bullets
// with optional [ ]/[x] checkboxes, "> " quotes, **bold**, _italic_.

// Order of the sections in the exported document.
const EXPORT_ORDER = ['resumen.md', 'ideas.md', 'ejemplos.md', 'tareas.md', 'pendientes.md', 'proximos-pasos.md', 'transcripcion.md'];

// --- Markdown -> blocks ---
// block: { type: 'h', level, runs } | { type: 'li', check: null|true|false, runs } | { type: 'quote', runs } | { type: 'p', runs, muted }
// run: { text, bold, italic }
function inlineRuns(text) {
  const runs = [];
  for (const part of String(text).split(/(\*\*[^*]+\*\*|(?:^|(?<=\s))_[^_]+_(?=\s|$|[.,;:)]))/)) {
    if (!part) continue;
    if (/^\*\*[^*]+\*\*$/.test(part)) runs.push({ text: part.slice(2, -2), bold: true });
    else if (/^_[^_]+_$/.test(part)) runs.push({ text: part.slice(1, -1), italic: true });
    else runs.push({ text: part });
  }
  return runs;
}

function mdBlocks(md) {
  const blocks = [];
  for (const raw of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    // Screenshot lines: "- [hh:mm:ss] ![captura](file) — prompt" -> plain text.
    const clean = line.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_m, alt, src) => `${alt || 'imagen'}: ${decodeURI(src)}`);
    const h = clean.match(/^(#{1,4})\s+(.*)$/);
    const li = clean.match(/^\s*[-*•]\s+(?:\[( |x|X)\]\s+)?(.*)$/);
    if (h) blocks.push({ type: 'h', level: h[1].length, runs: inlineRuns(h[2]) });
    else if (li) blocks.push({ type: 'li', check: li[1] == null ? null : li[1] !== ' ', runs: inlineRuns(li[2]) });
    else if (/^>\s?/.test(clean)) blocks.push({ type: 'quote', runs: inlineRuns(clean.replace(/^>\s?/, '')) });
    else blocks.push({ type: 'p', muted: /^_[^_]+_$/.test(clean), runs: inlineRuns(clean) });
  }
  return blocks;
}

// Section files in export order; each file's own "# Title · …" heading is
// kept (it names the section). Returns [{ name, blocks }].
function sections(files) {
  const names = Object.keys(files || {});
  const ordered = EXPORT_ORDER.filter((n) => names.includes(n))
    .concat(names.filter((n) => !EXPORT_ORDER.includes(n) && /\.md$/i.test(n)));
  return ordered.map((name) => ({ name, blocks: mdBlocks(files[name]) })).filter((s) => s.blocks.length);
}

// --- HTML (for PDF) ---
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const runsHtml = (runs) => runs.map((r) => {
  let t = escHtml(r.text);
  if (r.bold) t = `<strong>${t}</strong>`;
  if (r.italic) t = `<em>${t}</em>`;
  return t;
}).join('');

function sessionHtml(title, subtitle, files) {
  const body = [];
  for (const sec of sections(files)) {
    body.push('<section>');
    let inList = false;
    for (const b of sec.blocks) {
      if (b.type !== 'li' && inList) { body.push('</ul>'); inList = false; }
      if (b.type === 'h') body.push(`<h${b.level + 1}>${runsHtml(b.runs)}</h${b.level + 1}>`);
      else if (b.type === 'li') {
        if (!inList) { body.push('<ul>'); inList = true; }
        const box = b.check == null ? '' : `<span class="box">${b.check ? '☑' : '☐'}</span> `;
        body.push(`<li${b.check == null ? '' : ' class="check"'}>${box}${runsHtml(b.runs)}</li>`);
      } else if (b.type === 'quote') body.push(`<blockquote>${runsHtml(b.runs)}</blockquote>`);
      else body.push(`<p${b.muted ? ' class="muted"' : ''}>${runsHtml(b.runs)}</p>`);
    }
    if (inList) body.push('</ul>');
    body.push('</section>');
  }
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Segoe UI", -apple-system, Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #1d2330; }
  h1 { font-size: 20pt; margin: 0 0 2pt; }
  .sub { color: #6b7280; margin: 0 0 14pt; }
  section { margin-top: 14pt; }
  section + section { border-top: 1px solid #d9dde5; padding-top: 10pt; page-break-before: auto; }
  h2 { font-size: 15pt; color: #1f4fa3; margin: 4pt 0 6pt; }
  h3 { font-size: 12.5pt; margin: 10pt 0 4pt; }
  h4, h5 { font-size: 11pt; margin: 8pt 0 3pt; }
  ul { margin: 2pt 0 6pt; padding-left: 18pt; }
  li { margin: 1.5pt 0; }
  li.check { list-style: none; margin-left: -14pt; }
  .box { font-size: 11pt; }
  blockquote { margin: 3pt 0 6pt; padding: 2pt 8pt; border-left: 3px solid #c7cdd8; color: #4b5563; }
  p { margin: 3pt 0 5pt; }
  .muted { color: #6b7280; }
</style></head>
<body>
<h1>${escHtml(title)}</h1>
<p class="sub">${escHtml(subtitle || '')}</p>
${body.join('\n')}
</body></html>`;
}

// --- DOCX ---
const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function runXml(r, extra) {
  const props = [r.bold ? '<w:b/>' : '', r.italic ? '<w:i/>' : '', extra || ''].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escXml(r.text)}</w:t></w:r>`;
}
function paraXml(style, runs, opts) {
  const o = opts || {};
  const ppr = style || o.ppr ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${o.ppr || ''}</w:pPr>` : '';
  return `<w:p>${ppr}${(o.prefix ? [{ text: o.prefix }] : []).concat(runs).map((r) => runXml(r, o.rpr)).join('')}</w:p>`;
}

function documentXml(title, subtitle, files) {
  const out = [paraXml('Title', [{ text: title }])];
  if (subtitle) out.push(paraXml('Subtitle', [{ text: subtitle }]));
  for (const sec of sections(files)) {
    for (const b of sec.blocks) {
      if (b.type === 'h') out.push(paraXml('Heading' + Math.min(3, b.level), b.runs));
      else if (b.type === 'li') out.push(paraXml('ListBullet', b.runs, { prefix: b.check == null ? '•\t' : (b.check ? '☑\t' : '☐\t') }));
      else if (b.type === 'quote') out.push(paraXml('Quote', b.runs));
      else out.push(paraXml(null, b.runs, b.muted ? { rpr: '<w:color w:val="6B7280"/>' } : null));
    }
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + out.join('')
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1077" w:bottom="1134" w:left="1077" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
}

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="es-CL"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="6B7280"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4FA3"/><w:sz w:val="30"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs><w:spacing w:after="40"/><w:ind w:left="360" w:hanging="360"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="6" w:color="C7CDD8"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="4B5563"/></w:rPr></w:style>'
  + '</w:styles>';

const CONTENT_TYPES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
  + '</Types>';

const RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
  + '</Relationships>';

const DOC_RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '</Relationships>';

function coreXml(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${escXml(title)}</dc:title><dc:creator>ParakeetAI</dc:creator>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`
    + '</cp:coreProperties>';
}

// --- minimal ZIP (stored entries) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);      // version needed
    local.writeUInt16LE(0x0800, 6);  // UTF-8 names
    local.writeUInt16LE(0, 8);       // stored
    local.writeUInt16LE(0, 10);      // time
    local.writeUInt16LE(0x21, 12);   // date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function sessionDocx(title, subtitle, files) {
  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES_XML },
    { name: '_rels/.rels', data: RELS_XML },
    { name: 'docProps/core.xml', data: coreXml(title) },
    { name: 'word/document.xml', data: documentXml(title, subtitle, files) },
    { name: 'word/styles.xml', data: STYLES_XML },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS_XML },
  ]);
}

// File name for the save dialog: "2026-11-23 Clase - Derivadas.docx".
function exportFileName(startedAt, kindLabel, title, ext) {
  const d = new Date(startedAt);
  const day = Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10) + ' ';
  const safe = String(title || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${day}${kindLabel}${safe && safe !== kindLabel ? ' - ' + safe : ''}.${ext}`;
}

module.exports = { EXPORT_ORDER, mdBlocks, sections, sessionHtml, sessionDocx, documentXml, zip, crc32, exportFileName };
