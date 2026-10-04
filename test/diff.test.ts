import { describe, expect, it } from 'vitest';
import { analyzeHtml } from '../src/analyze.js';
import { findZeroStats } from '../src/detectors/counters.js';
import { confirmZeroStats, diffDocs, diffSection } from '../src/detectors/diff.js';
import { doc, fixture } from './helpers.js';

describe('raw vs rendered diff', () => {
  const raw = doc('spa-raw.html');
  const rendered = doc('spa-rendered.html');

  it('lists text that only exists after JavaScript', () => {
    const d = diffDocs(raw, rendered);
    expect(d.jsOnly).toContain('Book a strategy call with our team today.');
    expect(d.coverage).toBeLessThan(1);
  });

  it('confirms what a zero counter animates to', () => {
    const zeros = confirmZeroStats(findZeroStats(raw), rendered);
    const views = zeros.find((z) => z.context === '0 M+ Views/Month');
    expect(views?.renderedAs).toBe('12 M+ Views/Month');
    const s = diffSection(diffDocs(raw, rendered), zeros, 1000);
    expect(s.findings.some((f) => f.id === 'diff.counter' && f.message.includes('12 M+ Views/Month'))).toBe(true);
  });

  it('identical documents have full coverage', () => {
    expect(diffDocs(rendered, rendered).coverage).toBe(1);
  });
});

describe('analyzeHtml (paste mode)', () => {
  it('produces a report with an overall score and no network sections', () => {
    const r = analyzeHtml(fixture('glued-h1.html'), { query: 'software acquisitions' });
    expect(r.sections.map((s) => s.id)).toEqual(['meta', 'headings', 'jsonld', 'counters', 'hidden', 'query', 'js']);
    expect(r.score).toBeGreaterThan(0);
  });
});
