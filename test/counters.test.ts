import { describe, expect, it } from 'vitest';
import { countersSection, findSplitStats, findZeroStats } from '../src/detectors/counters.js';
import { confirmZeroStats } from '../src/detectors/diff.js';
import { parseHtml } from '../src/dom.js';
import { doc } from './helpers.js';

describe('zero-state counter detector', () => {
  it('finds the "0 M+ Views/Month" counter crawlers see', () => {
    const zeros = findZeroStats(doc('zero-counters.html'));
    const contexts = zeros.map((z) => z.context);
    expect(contexts).toContain('0 M+ Views/Month');
    expect(contexts).toContain('0 + Brands served');
    expect(contexts).toContain('0 % Client retention');
  });

  it('records counter markup as evidence', () => {
    const z = findZeroStats(doc('zero-counters.html')).find((x) => x.context.startsWith('0 M+'));
    expect(z?.strength).toBe('strong');
    expect(z?.evidence.join(' ')).toContain('data-target="12"');
  });

  it('does not flag "0% fees" written in a sentence', () => {
    const contexts = findZeroStats(doc('zero-counters.html')).map((z) => z.context);
    expect(contexts.some((c) => c.includes('platform fees'))).toBe(false);
  });

  it('stays quiet on legit zeros, years and versions', () => {
    expect(findZeroStats(doc('zero-legit.html'))).toEqual([]);
  });

  it('fails the section when counters are found', () => {
    const s = countersSection(doc('zero-counters.html'));
    expect(s.findings.filter((f) => f.id === 'counters.zero-state').every((f) => f.severity === 'fail')).toBe(true);
    expect(s.score).toBeLessThan(50);
  });

  it('notes stats whose number and unit live in separate elements (grep-hostile)', () => {
    const splits = findSplitStats(doc('zero-legit.html'));
    expect(splits).toEqual([{ number: '98', context: '98 % uptime' }]);
  });
});

describe('zero-state counter false positives', () => {
  const zerosIn = (markup: string) => findZeroStats(parseHtml(`<body>${markup}</body>`));

  it('does not treat a spaced zero in running text as a counter', () => {
    expect(zerosIn('<p>Plans from $0 + VAT per month.</p>')).toEqual([]);
    expect(zerosIn('<p>Disk: 0 B used</p>')).toEqual([]);
  });

  it('still flags the same spaced shape when the zero has its own element', () => {
    expect(zerosIn('<div><span>0</span><span>+</span><p>Brands served</p></div>')[0]?.strength).toBe('strong');
  });

  it('drops weak zeros that --render shows are really zero', () => {
    const markup = '<div><span>0</span> stars</div><div><span>0</span> forks</div>';
    const raw = parseHtml(`<body>${markup}</body>`);
    const zeros = confirmZeroStats(findZeroStats(raw), parseHtml(`<body>${markup}</body>`));
    expect(zeros.every((z) => z.staysZero)).toBe(true);
    expect(countersSection(raw, zeros).findings.map((f) => f.id)).toContain('counters.none');
  });

  it('keeps counters with markup even if the render still shows zero', () => {
    const raw = doc('zero-counters.html');
    const zeros = confirmZeroStats(findZeroStats(raw), raw);
    expect(countersSection(raw, zeros).findings.filter((f) => f.id === 'counters.zero-state').length).toBe(3);
  });
});
