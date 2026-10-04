import { describe, expect, it } from 'vitest';
import { countersSection, findSplitStats, findZeroStats } from '../src/detectors/counters.js';
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
