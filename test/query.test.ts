import { describe, expect, it } from 'vitest';
import { analyzeQuery, buildCorpus, hireLinks } from '../src/detectors/query.js';
import { parseHtml } from '../src/dom.js';
import { doc } from './helpers.js';

const sellerPage =
  parseHtml(`<html><head><title>Agnij Dutta</title><meta name="description" content="Building onchain systems. Taking select engagements."></head>
<body><h1>Agnij Dutta</h1><p>I craft onchain systems and partner with founders on select engagements.</p></body></html>`);

describe('"would an AI recommend you" check', () => {
  it('scores a buyer-vocabulary page high', () => {
    const r = analyzeQuery('freelance web3 engineer', buildCorpus(doc('meta-good.html')));
    expect(r.concepts.every((c) => c.weight > 0)).toBe(true);
    expect(r.exactPhrase).toBe(true);
    expect(r.availability).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(85);
  });

  it('flags seller-speak and missing buyer words', () => {
    const r = analyzeQuery('freelance web3 engineer', buildCorpus(sellerPage));
    expect(r.concepts.find((c) => c.term === 'freelance')?.weight).toBe(0);
    expect(r.concepts.find((c) => c.term === 'web3')?.matched).toBe('onchain');
    expect(r.sellerSpeak.map((s) => s.phrase.toLowerCase())).toContain('select engagements');
    expect(r.suggestions.join('\n')).toContain('Buyers type "available for freelance / contract work"');
    expect(r.score).toBeLessThan(50);
  });

  it('counts llms.txt text as a source', () => {
    const r = analyzeQuery(
      'freelance web3 engineer',
      buildCorpus(sellerPage, '# Agnij\n\n## Availability\nAvailable for freelance web3 engineer work.'),
    );
    expect(r.concepts.find((c) => c.term === 'freelance')?.foundIn).toContain('llms.txt');
  });

  it('does not count "smart contract" as contract work', () => {
    const page = parseHtml('<h1>Smart contract audits</h1>');
    const r = analyzeQuery('freelance auditor', buildCorpus(page));
    expect(r.concepts.find((c) => c.term === 'freelance')?.weight).toBe(0);
  });
});

describe('hire page hint', () => {
  it('points at a linked /hire page instead of telling you to build one', () => {
    const page = parseHtml('<title>Agnij</title><h1>Agnij Dutta</h1><a href="/hire">Hire me</a><p>Freelance web3 engineer.</p>');
    const r = analyzeQuery('freelance web3 engineer', buildCorpus(page), hireLinks(page));
    expect(r.suggestions.join('\n')).toContain('This page links to /hire');
  });
});
