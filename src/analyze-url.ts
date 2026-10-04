import { analyzeDocument, VERSION } from './analyze.js';
import { countersSection, findZeroStats } from './detectors/counters.js';
import { confirmZeroStats, diffDocs, diffSection } from './detectors/diff.js';
import { extractScripts, type ScriptRef, scriptsSection } from './detectors/scripts.js';
import { parseHtml } from './dom.js';
import { crawlerFetch, errMessage, type FetchResult, pool } from './fetch.js';
import { RenderUnavailable, renderPage } from './render.js';
import { aiAccessSection, discoverySection, fetchSiteFiles, probeBotAccess } from './site/files.js';
import { type Finding, overallScore, type Report, type Section, section } from './types.js';

export interface UrlOptions {
  /** Buyer query for the "would an AI recommend you" check. */
  query?: string;
  /** Also render with headless Chromium (needs the optional `playwright` peer dependency). */
  render?: boolean;
  /** User agent for the crawler fetch. */
  ua?: string;
  /** Per-request timeout in ms (default 15000; rendering gets twice this). */
  timeoutMs?: number;
  /** IndexNow key to verify at /<key>.txt. */
  indexNowKey?: string;
  /** Skip the per-bot user-agent probes. */
  noUaProbe?: boolean;
  /** Called with short progress messages, e.g. for a spinner. */
  onProgress?: (msg: string) => void;
}

export type { Finding, Report, Section, Severity } from './types.js';

/** Accept bare hosts ("agnij.me") the way people type them; reject anything that is not an http(s) URL. */
export function normalizeInput(input: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${input}" is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`only http and https URLs are supported, got ${url.protocol}`);
  return url.toString();
}

/**
 * The page itself failed: network error, 4xx/5xx, or an empty 200. Search engines drop error pages
 * from the index, so the overall score is 0 however good the error page's markup is.
 */
function pageUnusable(r: FetchResult): boolean {
  return Boolean(r.error) || r.status >= 400 || (r.status === 200 && r.body.trim() === '');
}

function fetchSection(r: FetchResult, input: string): Section {
  const f: Finding[] = [];
  const hops = r.chain.filter((h) => h.location);
  if (r.error) f.push({ id: 'fetch.error', severity: 'fail', message: `Fetch failed: ${r.error}` });
  else if (r.status !== 200) f.push({ id: 'fetch.status', severity: 'fail', message: `Final response is HTTP ${r.status}` });
  else if (r.body.trim() === '')
    f.push({ id: 'fetch.empty', severity: 'fail', message: 'HTTP 200 with an empty body: crawlers get no content at all' });
  else f.push({ id: 'fetch.ok', severity: 'pass', message: `HTTP 200, ${(r.bytes / 1024).toFixed(1)} KB of HTML in ${r.ms} ms` });

  if (hops.length) {
    f.push({
      id: 'fetch.redirects',
      severity: hops.length > 2 ? 'warn' : 'info',
      message: `${hops.length} redirect(s) before the page. A bare \`curl ${input}\` stops at the first one; use curl -L.`,
      detail: r.chain.map((h) => `${h.status}  ${h.url}${h.location ? `  ->  ${h.location}` : ''}`),
    });
    const temp = hops.filter((h) => h.status === 302 || h.status === 307);
    if (temp.length)
      f.push({
        id: 'fetch.temp-redirect',
        severity: 'info',
        message: `${temp.length} temporary (302/307) redirect(s); permanent 301/308 consolidates signals faster`,
      });
  }
  const xr = r.headers['x-robots-tag'];
  if (xr && /noindex/i.test(xr)) f.push({ id: 'fetch.x-robots', severity: 'fail', message: `X-Robots-Tag header says "${xr}"` });
  const ct = r.headers['content-type'] ?? '';
  if (r.status === 200 && !/html/i.test(ct))
    f.push({ id: 'fetch.content-type', severity: 'warn', message: `Content-Type is "${ct}", not HTML` });
  if (r.bytes > 1024 * 1024)
    f.push({
      id: 'fetch.size',
      severity: 'warn',
      message: `HTML is ${(r.bytes / 1024 / 1024).toFixed(1)} MB; some crawlers truncate long documents`,
    });
  return section('fetch', 'Fetch like a crawler (no JS)', f, {
    weight: 1,
    ...(pageUnusable(r) ? { score: 0 } : {}),
    data: { status: r.status, finalUrl: r.finalUrl, chain: r.chain, ms: r.ms, bytes: r.bytes },
  });
}

/** Canonical and og:image are promises to crawlers and unfurlers: check that they resolve. */
async function checkMetaLinks(meta: Section, finalUrl: string, opts: UrlOptions): Promise<Section> {
  const data = meta.data as { canonical?: string; og?: Record<string, string> } | undefined;
  const findings = [...meta.findings];
  const canonical = data?.canonical && /^https?:\/\//i.test(data.canonical) ? data.canonical : undefined;
  const ogImage = data?.og?.image && /^https?:\/\//i.test(data.og.image) ? data.og.image : undefined;
  const same = (a: string, b: string) => a.replace(/\/$/, '') === b.replace(/\/$/, '');
  const [c, o] = await Promise.all([
    canonical && !same(canonical, finalUrl) ? crawlerFetch(canonical, { ua: opts.ua, timeoutMs: opts.timeoutMs }) : undefined,
    ogImage ? crawlerFetch(ogImage, { ua: opts.ua, timeoutMs: opts.timeoutMs, accept: 'image/*,*/*' }) : undefined,
  ]);
  if (c && c.error === 'timed out') {
    findings.push({
      id: 'meta.canonical.unverified',
      severity: 'info',
      message: `Could not verify the canonical ${canonical}: the request timed out`,
    });
  } else if (c && (c.error || c.status >= 400)) {
    const i = findings.findIndex((f) => f.id.startsWith('meta.canonical'));
    const bad: Finding = {
      id: 'meta.canonical.broken',
      severity: 'fail',
      message: `Canonical points to ${canonical}, which ${c.error ? `does not resolve (${c.error})` : `returns HTTP ${c.status}`}`,
      detail: ['Search engines are told the "real" copy of this page lives at a URL that does not work.'],
    };
    if (i >= 0) findings[i] = bad;
    else findings.push(bad);
  } else if (c && canonical && !same(c.finalUrl, canonical)) {
    findings.push({
      id: 'meta.canonical.redirects',
      severity: 'warn',
      message: `Canonical ${canonical} redirects to ${c.finalUrl}; point it at the final URL`,
    });
  }
  if (o && o.error === 'timed out')
    findings.push({ id: 'meta.og.image.unverified', severity: 'info', message: `Could not verify og:image (timed out): ${ogImage}` });
  else if (o && (o.error || o.status >= 400))
    findings.push({
      id: 'meta.og.image.broken',
      severity: 'warn',
      message: `og:image ${o.error ? `does not resolve (${o.error})` : `returns HTTP ${o.status}`}: ${ogImage}`,
    });
  return section(meta.id, meta.title, findings, { weight: meta.weight, data: meta.data });
}

async function sizeScripts(refs: ScriptRef[], opts: UrlOptions): Promise<void> {
  await pool(refs.slice(0, 60), 6, async (s) => {
    try {
      const res = await fetch(s.src, {
        headers: { 'user-agent': opts.ua ?? 'Mozilla/5.0', 'accept-encoding': 'gzip, br' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      });
      if (!res.ok) {
        s.error = `HTTP ${res.status}`;
        await res.body?.cancel().catch(() => {});
        return;
      }
      // fetch() decodes gzip/br for us, so content-length is the on-the-wire size and the body is the decoded size.
      const len = res.headers.get('content-length');
      if (len) s.transferBytes = Number(len);
      s.bytes = (await res.arrayBuffer()).byteLength;
    } catch (e) {
      s.error = errMessage(e);
    }
  });
}

/**
 * Full live check: fetch like a crawler, analyze the markup, check robots.txt, llms.txt,
 * sitemap and bot user agents, size the JavaScript, and optionally diff against a render.
 * Network failures become findings in the report, never exceptions; only a malformed URL throws.
 * When the page itself fails (network error, 4xx/5xx, empty 200) the overall score is 0.
 */
export async function analyzeUrl(input: string, opts: UrlOptions = {}): Promise<Report> {
  const url = normalizeInput(input);
  const log = opts.onProgress ?? (() => {});
  log(`fetching ${url} without JavaScript`);
  const raw = await crawlerFetch(url, { ua: opts.ua, timeoutMs: opts.timeoutMs });
  const sections: Section[] = [fetchSection(raw, url)];
  const report = (): Report => ({
    tool: 'crawlsee',
    version: VERSION,
    input: url,
    finalUrl: raw.finalUrl,
    fetchedAt: new Date().toISOString(),
    score: pageUnusable(raw) ? 0 : overallScore(sections),
    sections,
  });
  if (!raw.body.trim()) return report();

  const doc = parseHtml(raw.body);
  log('checking robots.txt, llms.txt, sitemap');
  const [files, probes] = await Promise.all([
    fetchSiteFiles(raw.finalUrl, { ua: opts.ua, timeoutMs: opts.timeoutMs, indexNowKey: opts.indexNowKey }),
    opts.noUaProbe ? Promise.resolve([]) : probeBotAccess(raw.finalUrl, opts.timeoutMs),
  ]);

  const htmlSections = analyzeDocument(doc, { pageUrl: raw.finalUrl, query: opts.query, llmsTxt: files.llms.text });
  sections.push(...htmlSections);
  const metaIdx = sections.findIndex((s) => s.id === 'meta');
  if (metaIdx >= 0) sections[metaIdx] = await checkMetaLinks(sections[metaIdx], raw.finalUrl, opts);
  sections.push(aiAccessSection(files, raw.finalUrl, { status: raw.status, bytes: raw.bytes }, probes));
  sections.push(discoverySection(files, raw.finalUrl));

  log('sizing JavaScript');
  const inv = extractScripts(doc, raw.finalUrl);
  await sizeScripts(inv.external, opts);

  let renderedJsBytes: number | undefined;
  if (opts.render) {
    log('rendering with headless Chromium');
    try {
      const r = await renderPage(raw.finalUrl, { timeoutMs: opts.timeoutMs ? opts.timeoutMs * 2 : undefined });
      renderedJsBytes = r.jsBytes;
      const rendered = parseHtml(r.html);
      const zeros = confirmZeroStats(findZeroStats(doc), rendered);
      sections.push(diffSection(diffDocs(doc, rendered), zeros, r.ms));
      const idx = sections.findIndex((s) => s.id === 'counters');
      if (idx >= 0) sections[idx] = countersSection(doc, zeros);
    } catch (e) {
      const msg = e instanceof RenderUnavailable ? e.message : `render failed: ${errMessage(e)}`;
      sections.push(
        section('diff', 'Raw HTML vs rendered (what JS adds)', [{ id: 'diff.unavailable', severity: 'info', message: msg }], {
          score: null,
        }),
      );
    }
  }
  sections.push(scriptsSection(inv, { fetched: true, renderedJsBytes }));

  // Stable, readable order.
  const order = ['fetch', 'meta', 'headings', 'diff', 'counters', 'hidden', 'jsonld', 'ai-access', 'discovery', 'js', 'query'];
  sections.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return report();
}
