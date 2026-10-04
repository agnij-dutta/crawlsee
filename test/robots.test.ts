import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots } from '../src/site/robots.js';

const txt = `
# AI policy
User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: *
Disallow: /admin
Allow: /admin/public$
Disallow: /*.pdf$

User-agent: Bingbot
Disallow:

Sitemap: https://example.com/sitemap.xml
`;

describe('robots.txt evaluation', () => {
  const r = parseRobots(txt);

  it('groups consecutive user-agent lines', () => {
    expect(r.groups[0].agents).toEqual(['gptbot', 'ccbot']);
    expect(r.sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });

  it('blocks bots named in a Disallow: / group', () => {
    expect(isAllowed(r, 'GPTBot', '/').allowed).toBe(false);
    expect(isAllowed(r, 'CCBot', '/blog').allowed).toBe(false);
  });

  it('falls back to * for unnamed bots, longest match wins', () => {
    expect(isAllowed(r, 'ClaudeBot', '/').allowed).toBe(true);
    expect(isAllowed(r, 'ClaudeBot', '/admin/x').allowed).toBe(false);
    expect(isAllowed(r, 'ClaudeBot', '/admin/public').allowed).toBe(true);
    expect(isAllowed(r, 'PerplexityBot', '/files/a.pdf').allowed).toBe(false);
  });

  it('an empty Disallow allows everything for that bot', () => {
    expect(isAllowed(r, 'Bingbot', '/admin').allowed).toBe(true);
  });

  it('everything is allowed with no robots.txt', () => {
    expect(isAllowed(parseRobots(''), 'GPTBot', '/').allowed).toBe(true);
  });
});
