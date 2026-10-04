import { attr, byTag, type Document, findAll, findFirst } from '../dom.js';
import { type Finding, type Section, section } from '../types.js';

export interface MetaData {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: string;
  lang?: string;
  og: Record<string, string>;
  twitter: Record<string, string>;
}

export function extractMeta(doc: Document): MetaData {
  const titleEl = findFirst(doc, byTag('title'));
  const metas = findAll(doc, byTag('meta'));
  const get = (key: string) => {
    const m = metas.find((el) => (attr(el, 'name') ?? attr(el, 'property'))?.toLowerCase() === key);
    return attr(m, 'content')?.trim();
  };
  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  for (const m of metas) {
    const key = (attr(m, 'property') ?? attr(m, 'name') ?? '').toLowerCase();
    const content = attr(m, 'content');
    if (content === undefined) continue;
    if (key.startsWith('og:')) og[key.slice(3)] ??= content.trim();
    if (key.startsWith('twitter:')) twitter[key.slice(8)] ??= content.trim();
  }
  const canonicalEl = findAll(doc, byTag('link')).find((l) => (attr(l, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'));
  const html = findFirst(doc, byTag('html'));
  const title = titleEl
    ? titleEl.children
        .map((c) => ('data' in c ? String(c.data) : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    : undefined;
  return {
    title,
    description: get('description'),
    canonical: attr(canonicalEl, 'href')?.trim(),
    robots: get('robots') ?? get('googlebot'),
    lang: attr(html, 'lang'),
    og,
    twitter,
  };
}

const isAbsolute = (u: string) => /^https?:\/\//i.test(u);

export function metaSection(doc: Document, pageUrl?: string): Section {
  const m = extractMeta(doc);
  const f: Finding[] = [];

  if (!m.title) f.push({ id: 'meta.title.missing', severity: 'fail', message: 'No <title> in the served HTML' });
  else if (m.title.length > 65)
    f.push({
      id: 'meta.title.long',
      severity: 'warn',
      message: `Title is ${m.title.length} chars; results usually cut near 60`,
      detail: [m.title],
    });
  else if (m.title.length < 10)
    f.push({ id: 'meta.title.short', severity: 'warn', message: `Title is only ${m.title.length} chars`, detail: [m.title] });
  else f.push({ id: 'meta.title.ok', severity: 'pass', message: `Title: "${m.title}"` });

  if (!m.description)
    f.push({ id: 'meta.description.missing', severity: 'fail', message: 'No meta description; snippets and AI summaries will improvise' });
  else if (m.description.length > 170)
    f.push({ id: 'meta.description.long', severity: 'info', message: `Description is ${m.description.length} chars (cut near 160)` });
  else if (m.description.length < 50)
    f.push({
      id: 'meta.description.short',
      severity: 'warn',
      message: `Description is only ${m.description.length} chars`,
      detail: [m.description],
    });
  else f.push({ id: 'meta.description.ok', severity: 'pass', message: `Description (${m.description.length} chars)` });

  if (!m.canonical) f.push({ id: 'meta.canonical.missing', severity: 'warn', message: 'No <link rel="canonical">' });
  else if (!isAbsolute(m.canonical))
    f.push({ id: 'meta.canonical.relative', severity: 'warn', message: `Canonical is relative: ${m.canonical}` });
  else if (pageUrl && normalizeUrl(m.canonical) !== normalizeUrl(pageUrl))
    f.push({
      id: 'meta.canonical.mismatch',
      severity: 'info',
      message: 'Canonical points somewhere other than the final URL',
      detail: [`canonical: ${m.canonical}`, `final:     ${pageUrl}`],
    });
  else f.push({ id: 'meta.canonical.ok', severity: 'pass', message: `Canonical: ${m.canonical}` });

  if (m.robots && /noindex/i.test(m.robots))
    f.push({ id: 'meta.robots.noindex', severity: 'fail', message: `meta robots says "${m.robots}": this page asks not to be indexed` });
  else if (m.robots && /nosnippet|max-snippet:\s*0/i.test(m.robots))
    f.push({ id: 'meta.robots.nosnippet', severity: 'warn', message: `meta robots "${m.robots}" limits snippets (and AI Overviews)` });

  const ogMissing = ['title', 'description', 'image'].filter((k) => !m.og[k]);
  if (ogMissing.length)
    f.push({
      id: 'meta.og.missing',
      severity: ogMissing.includes('image') || ogMissing.length > 1 ? 'warn' : 'info',
      message: `Open Graph missing: ${ogMissing.map((k) => `og:${k}`).join(', ')} (link previews in Slack, X, iMessage)`,
    });
  else f.push({ id: 'meta.og.ok', severity: 'pass', message: 'Open Graph title, description and image present' });
  if (m.og.image && !isAbsolute(m.og.image))
    f.push({
      id: 'meta.og.image.relative',
      severity: 'warn',
      message: `og:image is not absolute (${m.og.image}); many unfurlers ignore it`,
    });

  if (!m.twitter.card)
    f.push({ id: 'meta.twitter.missing', severity: 'info', message: 'No twitter:card (X falls back to OG, small card)' });
  if (!m.lang) f.push({ id: 'meta.lang.missing', severity: 'info', message: 'No <html lang>' });

  return section('meta', 'Meta and link previews', f, { weight: 1, data: { ...m } });
}

export function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    let s = x.toString();
    if (s.endsWith('/') && x.pathname !== '/') s = s.slice(0, -1);
    return s.replace(/\/$/, '');
  } catch {
    return u;
  }
}
