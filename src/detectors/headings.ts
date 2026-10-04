import { body, byTag, crawlerText, type Document, findAll, gluedTokens } from '../dom.js';
import { type Finding, type Section, section } from '../types.js';

export interface HeadingInfo {
  level: number;
  text: string;
  glued: string[];
}

export function extractHeadings(doc: Document): HeadingInfo[] {
  return findAll(body(doc), byTag('h1', 'h2', 'h3')).map((el) => {
    const ct = crawlerText(el);
    return { level: Number(el.name[1]), text: ct.text.replace(/\n/g, ' '), glued: gluedTokens(ct) };
  });
}

/** Glued words anywhere in the body (nav links, buttons, stats), excluding ones already in headings. */
export function extractBodyGlue(doc: Document, exclude: string[] = [], limit = 10): { text: string; glued: string[] }[] {
  const ct = crawlerText(body(doc));
  const out: { text: string; glued: string[] }[] = [];
  const seen = new Set(exclude);
  let lineStart = 0;
  for (const line of ct.text.split('\n')) {
    const lineEnd = lineStart + line.length;
    const local = {
      text: line,
      glue: ct.glue.filter((g) => g.at > lineStart && g.at < lineEnd).map((g) => ({ ...g, at: g.at - lineStart })),
    };
    const glued = gluedTokens(local).filter((t) => !seen.has(t));
    for (const t of glued) seen.add(t);
    if (glued.length) out.push({ text: line.length > 140 ? `${line.slice(0, 137)}...` : line, glued });
    lineStart = lineEnd + 1;
    if (out.length >= limit) break;
  }
  return out;
}

/** "agentsThe" x2, "Webuy,operate" */
function countTokens(tokens: string[]): string {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => `"${t}"${n > 1 ? ` x${n}` : ''}`).join(', ');
}

export function headingsSection(doc: Document): Section {
  const hs = extractHeadings(doc);
  const f: Finding[] = [];
  const h1s = hs.filter((h) => h.level === 1);

  if (h1s.length === 0) f.push({ id: 'headings.h1.missing', severity: 'fail', message: 'No <h1> in the served HTML' });
  else if (h1s.every((h) => h.text.trim() === ''))
    f.push({ id: 'headings.h1.empty', severity: 'fail', message: '<h1> exists but has no text before JavaScript runs' });
  else if (h1s.length > 1)
    f.push({ id: 'headings.h1.multiple', severity: 'info', message: `${h1s.length} <h1> elements`, detail: h1s.map((h) => h.text) });
  else
    f.push({ id: 'headings.h1.ok', severity: h1s[0].glued.length ? 'info' : 'pass', message: `H1 as crawlers read it: "${h1s[0].text}"` });

  const gluedHeadings = hs.filter((h) => h.glued.length);
  for (const h of gluedHeadings) {
    f.push({
      id: 'headings.glued-words',
      severity: h.level === 1 ? 'fail' : 'warn',
      message: `H${h.level} has glued words: crawlers read ${countTokens(h.glued)}`,
      detail: [
        `crawler text: ${h.text}`,
        'Cause: adjacent inline elements with no whitespace between them (JSX drops newline-only whitespace; CSS gap hides it).',
        'Fix: put {" "} between the elements, or a real space inside each one.',
      ],
    });
  }

  const bodyGlue = extractBodyGlue(
    doc,
    hs.flatMap((h) => h.glued),
  );
  if (bodyGlue.length)
    f.push({
      id: 'body.glued-words',
      severity: 'info',
      message: `${bodyGlue.length} other text block(s) glue words together`,
      detail: bodyGlue.map((g) => `"${g.glued.join(' ')}"  in  "${g.text}"`),
    });

  const empties = hs.filter((h) => h.level > 1 && !h.text.trim());
  if (empties.length)
    f.push({ id: 'headings.empty', severity: 'warn', message: `${empties.length} H2/H3 with no text in the served HTML` });

  const outline = hs.slice(0, 25).map((h) => `${'  '.repeat(h.level - 1)}H${h.level} ${h.text || '(empty)'}`);
  if (outline.length) f.push({ id: 'headings.outline', severity: 'info', message: `Outline (${hs.length} headings)`, detail: outline });

  return section('headings', 'Headings as crawler text', f, { weight: 1.5, data: { headings: hs, bodyGlue } });
}
