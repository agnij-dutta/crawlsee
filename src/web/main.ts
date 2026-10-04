import { analyzeHtml } from '../analyze.js';
import type { Finding, Report, Section } from '../types.js';

const EXAMPLE = `<!doctype html>
<html lang="en"><head>
<title>Rump Labs</title>
<meta name="description" content="Building onchain systems. Taking select engagements.">
</head><body>
<section style="opacity:0;transform:translateY(24px)">
  <h1 class="flex gap-x-3"><span>We</span><span>buy,</span><span>operate,</span><span>and</span><span>scale</span><span>small</span><span>software</span><span>businesses</span></h1>
</section>
<div class="stats">
  <div><span class="counter" data-target="12">0</span><span>M+</span><p>Views/Month</p></div>
  <div><span class="counter" data-target="40">0</span><span>+</span><p>Products shipped</p></div>
</div>
<p>We partner with founders on select engagements.</p>
<script src="/_next/static/chunks/icons.js"></script>
</body></html>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Everything rendered comes from the pasted page, so it is escaped before going into innerHTML. */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

const scoreClass = (n: number | null) => (n === null ? 'na' : n >= 85 ? 'good' : n >= 60 ? 'ok' : 'bad');

function finding(f: Finding): string {
  const detail = f.detail?.length ? `<ul class="detail">${f.detail.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '';
  return `<li class="finding ${f.severity}"><span class="sev">${f.severity}</span><div><p>${esc(f.message)}</p>${detail}</div></li>`;
}

function sectionHtml(s: Section): string {
  return `<section class="card">
    <header><span class="score ${scoreClass(s.score)}">${s.score ?? '-'}</span><h3>${esc(s.title)}</h3></header>
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
    <ul class="findings">${s.findings.map(finding).join('')}</ul>
  </section>`;
}

function render(r: Report): string {
  return `<div class="overall"><span class="score big ${scoreClass(r.score)}">${r.score}</span>
    <div><h2>Overall</h2><p>Judged from the markup alone. The CLI adds redirects, robots.txt, llms.txt, sitemap, bot user-agent tests, JS sizes and the rendered diff.</p></div></div>
    ${r.sections.map(sectionHtml).join('')}`;
}

function run() {
  const html = $<HTMLTextAreaElement>('html').value;
  const out = $('out');
  if (!html.trim()) {
    out.innerHTML = '<p class="empty">Paste the HTML your server sends (view-source, or curl -L).</p>';
    return;
  }
  const url = $<HTMLInputElement>('url').value.trim() || undefined;
  const query = $<HTMLInputElement>('query').value.trim() || undefined;
  try {
    out.innerHTML = render(analyzeHtml(html, { pageUrl: url, query }));
  } catch (e) {
    out.innerHTML = `<p class="empty">Could not analyze: ${esc((e as Error).message)}</p>`;
  }
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('run').addEventListener('click', run);
$('example').addEventListener('click', () => {
  $<HTMLTextAreaElement>('html').value = EXAMPLE;
  $<HTMLInputElement>('query').value = 'freelance web3 engineer';
  run();
});
$<HTMLTextAreaElement>('html').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
});
