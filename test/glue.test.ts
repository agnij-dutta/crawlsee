import { describe, expect, it } from 'vitest';
import { extractBodyGlue, extractHeadings, headingsSection } from '../src/detectors/headings.js';
import { crawlerText, gluedTokens, parseHtml } from '../src/dom.js';
import { doc } from './helpers.js';

describe('glued-word detector', () => {
  it('reads the span-per-word H1 the way Google did', () => {
    const [h1] = extractHeadings(doc('glued-h1.html'));
    expect(h1.text).toBe('Webuy,operate,andscalesmallsoftwarebusinesses');
    expect(h1.glued).toEqual(['Webuy,operate,andscalesmallsoftwarebusinesses']);
  });

  it('fails the headings section on a glued H1', () => {
    const s = headingsSection(doc('glued-h1.html'));
    const f = s.findings.find((x) => x.id === 'headings.glued-words');
    expect(f?.severity).toBe('fail');
    expect(f?.message).toContain('Webuy,operate,andscalesmallsoftwarebusinesses');
  });

  it('flags glued nav links outside headings as info', () => {
    const glue = extractBodyGlue(doc('glued-h1.html'), ['Webuy,operate,andscalesmallsoftwarebusinesses']);
    expect(glue.flatMap((g) => g.glued)).toContain('HomeAbout');
  });

  it('passes once {" "} separates the spans', () => {
    const hs = extractHeadings(doc('glued-fixed.html'));
    expect(hs[0].text).toBe('We buy, operate, and scale small software businesses');
    expect(hs.every((h) => h.glued.length === 0)).toBe(true);
  });

  it('ignores per-letter split animations', () => {
    const hs = extractHeadings(doc('glued-fixed.html'));
    expect(hs[1]).toMatchObject({ level: 2, text: 'Hello', glued: [] });
  });

  it('ignores adjacent text inside one element (React <!-- --> interpolation)', () => {
    const hs = extractHeadings(doc('glued-fixed.html'));
    expect(hs[2]).toMatchObject({ level: 3, text: 'Hello, Agnij', glued: [] });
  });

  it('treats block elements as separators', () => {
    const d = parseHtml('<div><div>Fast</div><div>Cheap</div></div><p>One<br>Two</p>');
    const ct = crawlerText(d);
    expect(ct.text).toBe('Fast\nCheap\nOne\nTwo');
    expect(ct.glue).toEqual([]);
  });

  it('catches a word glued to a nested inline element', () => {
    const ct = crawlerText(parseHtml('<h1>Build<em>faster</em> today</h1>'));
    expect(gluedTokens(ct)).toEqual(['Buildfaster']);
  });

  it('catches a number glued to a word', () => {
    const ct = crawlerText(parseHtml('<p><b>10</b><span>years</span> shipping</p>'));
    expect(gluedTokens(ct)).toEqual(['10years']);
  });

  it('does not flag a number next to its unit', () => {
    const ct = crawlerText(parseHtml('<p><b>12</b><span>M+</span></p>'));
    expect(ct.glue).toEqual([]);
  });
});
