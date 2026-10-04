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

describe('robots.txt edge cases (RFC 9309)', () => {
  const allowed = (txt: string, bot: string, path = '/') => isAllowed(parseRobots(txt), bot, path).allowed;

  it('matches whole product tokens: an Applebot group does not bind Applebot-Extended', () => {
    expect(allowed('User-agent: Applebot\nDisallow: /', 'Applebot-Extended')).toBe(true);
    expect(allowed('User-agent: ChatGPT\nDisallow: /', 'ChatGPT-User')).toBe(true);
    expect(allowed('User-agent: Applebot\nDisallow: /', 'Applebot')).toBe(false);
  });

  it('reads the product token out of a versioned user-agent line', () => {
    expect(allowed('User-agent: GPTBot/1.1\nDisallow: /', 'GPTBot')).toBe(false);
  });

  it('does not let Crawl-delay or Sitemap lines split a group', () => {
    const txt = 'User-agent: GPTBot\nCrawl-delay: 5\nSitemap: https://x.test/s.xml\nUser-agent: CCBot\nDisallow: /';
    expect(allowed(txt, 'GPTBot')).toBe(false);
    expect(allowed(txt, 'CCBot')).toBe(false);
    expect(parseRobots(txt).groups).toHaveLength(1);
  });

  it('merges every group that names the bot', () => {
    const txt = 'User-agent: gptbot\nDisallow: /x\n\nUser-agent: GPTBot\nDisallow: /y';
    expect(allowed(txt, 'GPTBot', '/x')).toBe(false);
    expect(allowed(txt, 'GPTBot', '/y')).toBe(false);
  });

  it('uses the named group instead of *, never both', () => {
    const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /';
    expect(allowed(txt, 'GPTBot')).toBe(true);
    expect(allowed(txt, 'ClaudeBot')).toBe(false);
  });

  it('applies $ to the end of the path including the query string', () => {
    expect(allowed('User-agent: *\nDisallow: /*.php$', 'GPTBot', '/a.php')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /*.php$', 'GPTBot', '/a.php?x=1')).toBe(true);
  });

  it('matches paths case-sensitively', () => {
    expect(allowed('User-agent: *\nDisallow: /Admin', 'GPTBot', '/admin')).toBe(true);
  });

  it('percent-encodes non-ASCII rules before comparing with the encoded path', () => {
    expect(allowed('User-agent: *\nDisallow: /café', 'GPTBot', new URL('https://x.test/café').pathname)).toBe(false);
  });

  it('handles a BOM, CR line endings and many wildcards without hanging', () => {
    expect(allowed('﻿User-agent: *\rDisallow: /private', 'GPTBot', '/private/x')).toBe(false);
    const started = Date.now();
    expect(allowed(`User-agent: *\nDisallow: /${'*a'.repeat(40)}b`, 'GPTBot', `/${'a'.repeat(60)}`)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
