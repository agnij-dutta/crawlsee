import { body, type Document, spacedText, textBlocks } from '../dom.js';
import { type Finding, type Section, section } from '../types.js';
import type { ZeroStat } from './counters.js';
import { extractHeadings } from './headings.js';
import { extractMeta } from './meta.js';

export interface TextDiff {
  /** Share of rendered text (by characters) that already exists in the raw HTML. */
  coverage: number;
  rawChars: number;
  renderedChars: number;
  /** Blocks that only exist after JavaScript. */
  jsOnly: string[];
  /** Blocks in the raw HTML that disappear after rendering. */
  rawOnly: string[];
  changed: { field: string; raw: string; rendered: string }[];
}

/** Compare with all whitespace removed so glued words and spacing don't count as differences. */
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

export function diffDocs(raw: Document, rendered: Document): TextDiff {
  const rawBlocks = textBlocks(body(raw));
  const renBlocks = textBlocks(body(rendered));
  const rawAll = squash(rawBlocks.join(''));
  const renAll = squash(renBlocks.join(''));

  let covered = 0;
  let total = 0;
  const jsOnly: string[] = [];
  for (const b of renBlocks) {
    const s = squash(b);
    if (s.length < 2) continue;
    total += s.length;
    if (rawAll.includes(s)) covered += s.length;
    else if (!jsOnly.includes(b)) jsOnly.push(b);
  }
  const rawOnly = rawBlocks.filter((b) => squash(b).length >= 2 && !renAll.includes(squash(b)));

  const changed: TextDiff['changed'] = [];
  const mr = extractMeta(raw);
  const mn = extractMeta(rendered);
  for (const k of ['title', 'description', 'canonical', 'robots'] as const)
    if ((mr[k] ?? '') !== (mn[k] ?? '')) changed.push({ field: k, raw: mr[k] ?? '(none)', rendered: mn[k] ?? '(none)' });
  const h1r = extractHeadings(raw)
    .filter((h) => h.level === 1)
    .map((h) => h.text)
    .join(' | ');
  const h1n = extractHeadings(rendered)
    .filter((h) => h.level === 1)
    .map((h) => h.text)
    .join(' | ');
  if (squash(h1r) !== squash(h1n)) changed.push({ field: 'h1', raw: h1r || '(none)', rendered: h1n || '(none)' });

  return {
    coverage: total ? covered / total : 1,
    rawChars: rawAll.length,
    renderedChars: renAll.length,
    jsOnly,
    rawOnly,
    changed,
  };
}

/** For each zero-state stat, find what the rendered page shows in the same spot. */
export function confirmZeroStats(zeros: ZeroStat[], rendered: Document): ZeroStat[] {
  const text = spacedText(body(rendered));
  return zeros.map((z) => {
    const label = z.context.replace(z.token, '').trim();
    const unit = z.token.replace(/^[$€£]?0(?:[.,]0+)?/, '').trim();
    if (!label) return z;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    const re = new RegExp(`([$€£]?\\d[\\d.,]*)\\s*${unit ? esc(unit) : ''}\\s*${esc(label.slice(0, 60))}`);
    const m = re.exec(text);
    if (!m) return z;
    if (/^[$€£]?0(?:[.,]0+)?$/.test(m[1])) return { ...z, staysZero: true };
    return { ...z, renderedAs: m[0].replace(/\s+/g, ' ').trim() };
  });
}

export function diffSection(d: TextDiff, zeros: ZeroStat[], renderMs: number): Section {
  const f: Finding[] = [];
  const pct = Math.round(d.coverage * 100);
  f.push({
    id: 'diff.coverage',
    severity: pct >= 90 ? 'pass' : pct >= 60 ? 'warn' : 'fail',
    message: `${pct}% of the rendered text is in the raw HTML (${d.rawChars.toLocaleString('en-US')} vs ${d.renderedChars.toLocaleString('en-US')} chars, rendered in ${(renderMs / 1000).toFixed(1)}s)`,
  });
  if (d.jsOnly.length) {
    const top = [...d.jsOnly].sort((a, b) => b.length - a.length).slice(0, 12);
    f.push({
      id: 'diff.js-only',
      severity: pct >= 90 ? 'info' : 'warn',
      message: `${d.jsOnly.length} text block(s) only exist after JavaScript. Non-rendering crawlers, link unfurlers and most AI fetchers never see these:`,
      detail: top.map((b) => (b.length > 120 ? `${b.slice(0, 117)}...` : b)),
    });
  }
  for (const c of d.changed)
    f.push({
      id: `diff.changed.${c.field}`,
      severity: c.field === 'h1' || c.field === 'title' ? 'warn' : 'info',
      message: `${c.field} changes after JavaScript`,
      detail: [`raw:      ${c.raw}`, `rendered: ${c.rendered}`],
    });
  for (const z of zeros.filter((z) => z.renderedAs))
    f.push({
      id: 'diff.counter',
      severity: 'fail',
      message: `Counter confirmed: crawlers read "${z.context}", browsers show "${z.renderedAs}"`,
    });
  if (d.rawOnly.length)
    f.push({
      id: 'diff.raw-only',
      severity: 'info',
      message: `${d.rawOnly.length} block(s) in the raw HTML vanish after hydration`,
      detail: d.rawOnly.slice(0, 5).map((b) => (b.length > 120 ? `${b.slice(0, 117)}...` : b)),
    });
  return section('diff', 'Raw HTML vs rendered (what JS adds)', f, {
    weight: 2,
    score: Math.min(
      100,
      Math.max(0, pct - (zeros.some((z) => z.renderedAs) ? 15 : 0) - (d.changed.some((c) => c.field === 'h1') ? 15 : 0)),
    ),
    data: { ...d },
  });
}
