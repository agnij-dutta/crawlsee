import { describe, expect, it } from 'vitest';
import { extractJsonLd, jsonLdSection } from '../src/detectors/jsonld.js';
import { doc } from './helpers.js';

describe('JSON-LD detector', () => {
  const blocks = extractJsonLd(doc('jsonld.html'));

  it('parses @graph and nested types', () => {
    expect(blocks[0].types).toEqual(['Person', 'WebSite']);
    expect(blocks[1].types).toEqual(expect.arrayContaining(['FAQPage', 'Question', 'Answer']));
  });

  it('reports invalid JSON', () => {
    expect(blocks[2].valid).toBe(false);
    const s = jsonLdSection(doc('jsonld.html'));
    expect(s.findings.some((f) => f.id === 'jsonld.invalid' && f.severity === 'fail')).toBe(true);
    expect(s.findings.some((f) => f.id === 'jsonld.faq.ok')).toBe(true);
  });

  it('warns when there is no JSON-LD at all', () => {
    const s = jsonLdSection(doc('glued-fixed.html'));
    expect(s.findings[0].id).toBe('jsonld.missing');
  });
});
