import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeHtml, VERSION } from '../src/analyze.js';
import { analyzeUrl, normalizeInput } from '../src/analyze-url.js';
import { SYNONYMS } from '../src/detectors/query.js';
import { renderTerminal } from '../src/report/terminal.js';
import { overallScore, section } from '../src/types.js';
import { fixture } from './helpers.js';
import { deadUrl, html, redirect, startServer, text } from './server.js';

describe('analyzeHtml', () => {
  it('returns a scored report with every markup section', () => {
    const r = analyzeHtml(fixture('glued-h1.html'), { query: 'software businesses' });
    expect(r.tool).toBe('crawlsee');
    expect(r.input).toBe('(pasted HTML)');
    expect(r.sections.map((s) => s.id)).toEqual(['meta', 'headings', 'jsonld', 'counters', 'hidden', 'query', 'js']);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
    // Sizes need the network, so the JS section is skipped rather than scored as zero.
    expect(r.sections.find((s) => s.id === 'js')?.score).toBeNull();
  });

  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });
});

describe('scoring', () => {
  it('weights sections and ignores skipped ones', () => {
    const a = section('a', 'A', [], { score: 100, weight: 3 });
    const b = section('b', 'B', [], { score: 0, weight: 1 });
    const skipped = section('c', 'C', [], { score: null });
    expect(overallScore([a, b, skipped])).toBe(75);
  });

  it('deducts per finding when a section has no explicit score', () => {
    const s = section('x', 'X', [
      { id: 'w', severity: 'warn', message: '' },
      { id: 'f', severity: 'fail', message: '' },
      { id: 'i', severity: 'info', message: '' },
    ]);
    expect(s.score).toBe(53);
  });
});

describe('normalizeInput', () => {
  it('adds https to bare hosts', () => expect(normalizeInput('agnij.me')).toBe('https://agnij.me/'));
  it('keeps http', () => expect(normalizeInput('http://localhost:3000/a')).toBe('http://localhost:3000/a'));
  it('rejects other schemes', () => expect(() => normalizeInput('ftp://x')).toThrow(/only http and https/));
});

describe('synonym table', () => {
  it('puts every word in exactly one group, so lookups are unambiguous', () => {
    const words = SYNONYMS.flat();
    const dupes = words.filter((w, i) => words.indexOf(w) !== i);
    expect(dupes).toEqual([]);
  });
});

describe('renderTerminal', () => {
  it('prints scores and findings without color codes when color is off', () => {
    const out = renderTerminal(analyzeHtml(fixture('zero-counters.html')), { color: false, width: 100 });
    expect(out).not.toContain('\u001b[');
    expect(out).toContain('Zero-state counters');
    expect(out).toContain('✗ Crawlers, link previews and AI summaries read "0 M+ Views/Month"');
  });
});

describe('analyzeUrl against a local site', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    server = await startServer({
      '/': redirect('/home', 301),
      '/home': (req, res) =>
        res.writeHead(200, { 'content-type': 'text/html' }).end(
          `<html lang="en"><head><title>Local test site for crawlsee</title><link rel="canonical" href="http://${req.headers.host}/home"></head>
          <body><h1><span>We</span><span>build</span></h1><span class="counter" data-target="9">0</span><span>+ clients</span>
          <script src="/app.js"></script></body></html>`,
        ),
      '/app.js': text('console.log(1)'.repeat(100), 'application/javascript'),
      '/robots.txt': text('User-agent: *\nAllow: /\n'),
    });
  });
  afterAll(() => server.close());

  it('runs every network check and reports what crawlers read', async () => {
    const r = await analyzeUrl(server.url, { noUaProbe: true, timeoutMs: 5000 });
    expect(r.finalUrl).toBe(`${server.url}/home`);
    expect(r.sections.map((s) => s.id)).toEqual([
      'fetch',
      'meta',
      'headings',
      'counters',
      'hidden',
      'jsonld',
      'ai-access',
      'discovery',
      'js',
    ]);
    const ids = r.sections.flatMap((s) => s.findings.map((f) => f.id));
    expect(ids).toEqual(
      expect.arrayContaining(['fetch.redirects', 'headings.glued-words', 'counters.zero-state', 'llms.missing', 'js.total']),
    );
    expect(r.sections.find((s) => s.id === 'js')?.data?.totalBytes).toBe(1400);
  });

  it('fails a canonical that does not resolve and warns on a broken og:image', async () => {
    const dead = await deadUrl();
    const site = await startServer({
      '/': html(
        `<html><head><title>Broken canonical test page</title><link rel="canonical" href="${dead}/"><meta property="og:image" content="${dead}/og.png"></head><body><h1>Hi</h1></body></html>`,
      ),
    });
    try {
      const r = await analyzeUrl(site.url, { noUaProbe: true, timeoutMs: 2000 });
      const meta = r.sections.find((s) => s.id === 'meta');
      expect(meta?.findings.find((f) => f.id === 'meta.canonical.broken')?.severity).toBe('fail');
      expect(meta?.findings.some((f) => f.id === 'meta.og.image.broken')).toBe(true);
    } finally {
      await site.close();
    }
  });

  it('turns an unreachable site into a failing report, not an exception', async () => {
    const r = await analyzeUrl('http://127.0.0.1:9', { noUaProbe: true, timeoutMs: 2000 });
    expect(r.score).toBe(0);
    expect(r.sections[0].findings[0].id).toBe('fetch.error');
  });
});
