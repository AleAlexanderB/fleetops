import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, '..');
const OUT_DIR = join(DOCS_DIR, 'pdf');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// Orden de los documentos en el PDF consolidado
const FILES = [
  { file: 'README.md',                   title: 'README — Paquete de documentos' },
  { file: 'CLAUDE.md',                   title: 'CLAUDE.md — Archivo maestro para Claude' },
  { file: '00-RESUMEN-CONVERSACION.md',  title: '00 · Resumen de decisiones' },
  { file: '02-ARQUITECTURA.md',          title: '02 · Arquitectura del ecosistema' },
  { file: '03-CONSIDERACIONES.md',       title: '03 · Consideraciones de sistema' },
  { file: '04-PROTOCOLO-HANDOFF.md',     title: '04 · Protocolo de handoff' },
  { file: '05-DEPLOYMENT-ACTUAL.md',     title: '05 · Deployment actual' },
  { file: '06-PLAN-MIGRACION.md',        title: '06 · Plan de migración (M1 · M2 · M3)' },
];

const CSS = `
  @page { size: A4; margin: 18mm 15mm 18mm 15mm; }
  html { font-size: 10pt; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    color: #1b1f23;
    line-height: 1.5;
    margin: 0;
  }
  h1, h2, h3, h4 {
    color: #0b3d91;
    margin-top: 1.4em;
    margin-bottom: 0.45em;
    line-height: 1.25;
    page-break-after: avoid;
  }
  h1 { font-size: 1.9em; border-bottom: 2px solid #0b3d91; padding-bottom: 0.2em; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.15em; }
  h3 { font-size: 1.12em; }
  h4 { font-size: 1em; color: #333; }
  p, ul, ol { margin: 0.55em 0; }
  blockquote {
    margin: 0.8em 0;
    padding: 0.5em 0.9em;
    border-left: 4px solid #0b3d91;
    background: #f5f8ff;
    color: #333;
  }
  code {
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
    background: #f3f3f5;
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  pre {
    background: #1f2430;
    color: #e6e6e6;
    padding: 0.8em 1em;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.85em;
    line-height: 1.35;
    page-break-inside: avoid;
  }
  pre code { background: transparent; color: inherit; padding: 0; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.7em 0;
    font-size: 0.92em;
    page-break-inside: auto;
  }
  th, td {
    border: 1px solid #d0d7de;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #eef2f7; color: #0b3d91; font-weight: 600; }
  tr { page-break-inside: avoid; }
  ul, ol { padding-left: 1.6em; }
  li { margin: 0.2em 0; }
  hr { border: 0; border-top: 1px solid #d0d7de; margin: 1.2em 0; }
  a { color: #0b66c3; text-decoration: none; }
  .doc-section { page-break-before: always; }
  .doc-section:first-of-type { page-break-before: avoid; }
  .cover {
    text-align: center;
    padding-top: 5cm;
  }
  .cover h1 {
    font-size: 2.4em;
    border: none;
  }
  .cover .subtitle {
    color: #444;
    font-size: 1.1em;
    margin: 0.5em 0;
  }
  .cover .meta {
    color: #666;
    font-size: 0.95em;
    margin-top: 3em;
  }
  .toc {
    page-break-after: always;
  }
  .toc ol { list-style: none; padding-left: 0; }
  .toc li {
    padding: 0.3em 0;
    border-bottom: 1px dotted #ccc;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .toc .num {
    color: #0b3d91;
    font-weight: 600;
    min-width: 1.6em;
    display: inline-block;
  }
`;

function wrapHtml(bodyHtml, title) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function renderDoc(mdPath, title) {
  const md = readFileSync(mdPath, 'utf8');
  const html = marked.parse(md);
  return `<section class="doc-section"><header><p style="color:#888;font-size:0.85em;margin:0 0 0.4em 0;">${title}</p></header>${html}</section>`;
}

// ── 1. Generar HTML consolidado ────────────────────────────────────────────────
const cover = `
<section class="cover">
  <h1>Ecosistema AB Construcciones</h1>
  <div class="subtitle">Paquete de documentos de arquitectura</div>
  <div class="subtitle">Abril 2026</div>
  <div class="meta">
    Alejandro Barrios · AB Construcciones SRL<br/>
    Jujuy, Argentina
  </div>
</section>
<section class="toc">
  <h2>Contenido</h2>
  <ol>
    ${FILES.map((f, i) => `<li><span><span class="num">${String(i+1).padStart(2,'0')}</span>${f.title}</span><span style="color:#888;font-size:0.85em">${f.file}</span></li>`).join('\n    ')}
  </ol>
</section>
`;

const body = cover + FILES.map(f => renderDoc(join(DOCS_DIR, f.file), f.title)).join('\n');
const consolidatedHtml = wrapHtml(body, 'Ecosistema AB Construcciones');
writeFileSync(join(__dirname, 'ecosistema-consolidado.html'), consolidatedHtml);
console.log('✓ HTML consolidado generado');

// ── 2. Generar HTMLs individuales ──────────────────────────────────────────────
for (const { file, title } of FILES) {
  const md = readFileSync(join(DOCS_DIR, file), 'utf8');
  const html = wrapHtml(`<section>${marked.parse(md)}</section>`, title);
  const htmlOut = join(__dirname, file.replace(/\.md$/, '.html'));
  writeFileSync(htmlOut, html);
}
console.log(`✓ ${FILES.length} HTMLs individuales generados`);

// ── 3. Exportar lista de archivos a convertir (para el paso de Edge) ─────────
const manifest = [
  { html: 'ecosistema-consolidado.html', pdf: join(OUT_DIR, 'ecosistema-ab-construcciones.pdf') },
  ...FILES.map(f => ({
    html: f.file.replace(/\.md$/, '.html'),
    pdf: join(OUT_DIR, f.file.replace(/\.md$/, '.pdf')),
  })),
];
writeFileSync(join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('✓ manifest.json');
