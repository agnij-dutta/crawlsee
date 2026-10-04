import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crawlerFetch, pool } from '../src/fetch.js';
import { deadUrl, html, redirect, startServer } from './server.js';

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer({
    '/': html('<h1>Hi</h1>'),
    '/a': redirect('/b', 308),
    '/b': redirect('/', 302),
    '/loop': redirect('/loop', 301),
    '/bad-location': redirect('http://[bad', 301),
    '/ua': (req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end(req.headers['user-agent']),
    '/slow': (_req, res) => setTimeout(() => res.end('late'), 2000),
  });
});
afterAll(() => server.close());

describe('crawlerFetch', () => {
  it('follows redirects by hand and reports every hop', async () => {
    const r = await crawlerFetch(`${server.url}/a`);
    expect(r.ok).toBe(true);
    expect(r.finalUrl).toBe(`${server.url}/`);
    expect(r.chain.map((h) => h.status)).toEqual([308, 302, 200]);
    expect(r.body).toContain('<h1>Hi</h1>');
  });

  it('gives up on redirect loops with an error instead of hanging', async () => {
    const r = await crawlerFetch(`${server.url}/loop`, { maxRedirects: 3 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('more than 3 redirects');
  });

  it('reports a malformed Location header as an error instead of throwing', async () => {
    const r = await crawlerFetch(`${server.url}/bad-location`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid redirect Location header/);
    expect(r.chain).toEqual([{ url: `${server.url}/bad-location`, status: 301, location: 'http://[bad' }]);
  });

  it('reports connection failures as errors, with status 0', async () => {
    const r = await crawlerFetch(await deadUrl());
    expect(r.status).toBe(0);
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it('reports timeouts', async () => {
    const r = await crawlerFetch(`${server.url}/slow`, { timeoutMs: 100 });
    expect(r.error).toBe('timed out');
  });

  it('sends the requested user agent', async () => {
    const r = await crawlerFetch(`${server.url}/ua`, { ua: 'TestBot/1.0' });
    expect(r.body).toBe('TestBot/1.0');
  });
});

describe('pool', () => {
  it('keeps order and caps concurrency', async () => {
    let running = 0;
    let peak = 0;
    const out = await pool([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});
