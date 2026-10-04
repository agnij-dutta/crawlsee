import { describe, expect, it } from 'vitest';
import { extractMeta, metaSection } from '../src/detectors/meta.js';
import { extractScripts, scriptsSection } from '../src/detectors/scripts.js';
import { doc } from './helpers.js';

describe('meta detector', () => {
  it('extracts title, description, canonical, OG and Twitter', () => {
    const m = extractMeta(doc('meta-good.html'));
    expect(m.title).toBe('Agnij Dutta: freelance web3 and AI engineer');
    expect(m.canonical).toBe('https://agnij.me/');
    expect(m.og.image).toBe('https://agnij.me/og.png');
    expect(m.twitter.card).toBe('summary_large_image');
  });

  it('scores a complete head at 100', () => {
    expect(metaSection(doc('meta-good.html'), 'https://agnij.me/').score).toBe(100);
  });

  it('flags noindex, missing title, relative canonical and og:image', () => {
    const ids = metaSection(doc('meta-bad.html')).findings.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(['meta.title.missing', 'meta.robots.noindex', 'meta.canonical.relative', 'meta.og.image.relative']),
    );
  });
});

describe('script inventory', () => {
  it('resolves script, module and modulepreload URLs and skips JSON-LD', () => {
    const inv = extractScripts(doc('meta-good.html'), 'https://agnij.me/');
    expect(inv.external.map((s) => s.src)).toEqual([
      'https://agnij.me/_next/static/chunks/main.js',
      'https://cdn.example.com/app.js',
      'https://agnij.me/assets/vendor.js',
    ]);
    expect(inv.inlineCount).toBe(1);
  });

  it('flags chunks over 500 KB', () => {
    const inv = extractScripts(doc('meta-good.html'), 'https://agnij.me/');
    inv.external[0].bytes = 3.3 * 1024 * 1024;
    inv.external[1].bytes = 20_000;
    inv.external[2].bytes = 40_000;
    const s = scriptsSection(inv, { fetched: true });
    expect(s.findings.filter((f) => f.id === 'js.big-chunk')).toHaveLength(1);
    expect(s.findings.find((f) => f.id === 'js.total')?.severity).toBe('fail');
  });
});
