import { describe, expect, it } from 'vitest';
import { findHidden, hiddenSection } from '../src/detectors/hidden.js';
import { doc } from './helpers.js';

describe('hidden-at-load detector', () => {
  const blocks = findHidden(doc('hidden-hero.html'));

  it('finds the opacity:0 hero containing the H1', () => {
    const hero = blocks.find((b) => b.containsH1);
    expect(hero?.reason).toBe('style opacity:0');
    expect(hero?.text).toContain('Ship faster with fewer bugs');
  });

  it('finds Tailwind opacity-0, display:none and streamed hidden chunks', () => {
    const reasons = blocks.map((b) => b.reason);
    expect(reasons).toContain('class opacity-0');
    expect(reasons).toContain('style display:none');
    expect(reasons).toContain('hidden attribute (streamed Suspense chunk)');
  });

  it('ignores Tailwind responsive "hidden md:block"', () => {
    expect(blocks.some((b) => b.text.includes('responsive hiding'))).toBe(false);
  });

  it('fails the section for a hidden H1', () => {
    const s = hiddenSection(doc('hidden-hero.html'));
    expect(s.findings[0]).toMatchObject({ id: 'hidden.h1', severity: 'fail' });
    expect(s.findings[1]).toMatchObject({ id: 'hidden.headings', severity: 'warn' });
  });
});
