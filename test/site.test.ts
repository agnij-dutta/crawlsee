import { afterEach, describe, expect, it } from 'vitest';
import { aiAccessSection, discoverySection, fetchSiteFiles } from '../src/site/files.js';
import { deadUrl, html, startServer, text } from './server.js';

const servers: { close: () => Promise<void> }[] = [];
async function serve(...args: Parameters<typeof startServer>) {
  const s = await startServer(...args);
  servers.push(s);
  return s;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const baseline = { status: 200, bytes: 5000 };

describe('fetchSiteFiles', () => {
  it('reads robots.txt, llms.txt and a sitemap that lists the page', async () => {
    const s = await serve({
      '/robots.txt': text('User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n'),
      '/llms.txt': text('# Site\n\n> Summary\n\n- [Hire](https://x.test/hire): available for freelance work\n'),
      '/sitemap.xml': (req, res) =>
        res.writeHead(200, { 'content-type': 'application/xml' }).end(`<urlset><url><loc>http://${req.headers.host}/</loc></url></urlset>`),
    });
    const files = await fetchSiteFiles(`${s.url}/`);
    expect(files.softNotFound).toBe(false);
    expect(files.llms.text).toContain('# Site');
    expect(files.sitemap).toMatchObject({ kind: 'urlset', urls: 1, containsPage: true });

    const access = aiAccessSection(files, `${s.url}/`, baseline, []);
    expect(access.findings.find((f) => f.id === 'robots.blocked.GPTBot')?.severity).toBe('info');
    expect(access.findings.some((f) => f.id === 'robots.blocked.OAI-SearchBot')).toBe(false);
  });

  it('treats a 5xx robots.txt as "disallow everything" (RFC 9309)', async () => {
    const s = await serve({ '/robots.txt': text('oops', 'text/plain', 503) });
    const files = await fetchSiteFiles(`${s.url}/`);
    expect(files.robots.unreachable).toBe(true);
    const access = aiAccessSection(files, `${s.url}/`, baseline, []);
    expect(access.findings.map((f) => f.id)).toEqual(expect.arrayContaining(['robots.unreachable', 'robots.blocked.Googlebot']));
  });

  it('does not mistake an SPA shell answering every path for real files', async () => {
    const shell = html('<!doctype html><html><body><div id="root"></div></body></html>');
    const s = await serve({}, shell);
    const files = await fetchSiteFiles(`${s.url}/`);
    expect(files.softNotFound).toBe(true);
    expect(files.llms).toMatchObject({ text: '', html: true });
    const ids = discoverySection(files, `${s.url}/`).findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['files.soft-404', 'llms.html', 'sitemap.missing']));
  });

  it('reports unreachable files as errors, never as "missing" or "allowed"', async () => {
    const url = await deadUrl();
    const files = await fetchSiteFiles(`${url}/`, { timeoutMs: 2000 });
    expect(files.robots.error).toBeTruthy();

    const discovery = discoverySection(files, `${url}/`).findings.map((f) => f.id);
    expect(discovery).toEqual(expect.arrayContaining(['llms.error', 'sitemap.error']));
    expect(discovery).not.toContain('llms.missing');

    const access = aiAccessSection(files, `${url}/`, baseline, []);
    expect(access.score).toBeNull();
    expect(access.findings.map((f) => f.id)).toEqual(['robots.error']);
  });

  it('keeps file bodies out of the report data', async () => {
    const s = await serve({ '/llms.txt': text('# Me\n\nEmail: someone@example.com\n') });
    const files = await fetchSiteFiles(`${s.url}/`);
    const data = JSON.stringify(discoverySection(files, `${s.url}/`).data);
    expect(data).not.toContain('someone@example.com');
    expect(data).toContain('"chars"');
  });

  it('verifies an IndexNow key file when given the key', async () => {
    const s = await serve({ '/abc123.txt': text('abc123') });
    const files = await fetchSiteFiles(`${s.url}/`, { indexNowKey: 'abc123' });
    expect(files.indexNow).toMatchObject({ checked: true, matches: true });
  });
});

describe('aiAccessSection user-agent probes', () => {
  it('flags a 403 for a bot that robots.txt allows, without costing points', async () => {
    const s = await serve({ '/robots.txt': text('User-agent: *\nAllow: /\n') });
    const files = await fetchSiteFiles(`${s.url}/`);
    const access = aiAccessSection(files, `${s.url}/`, baseline, [{ bot: 'OAI-SearchBot', status: 403, bytes: 100 }]);
    const probe = access.findings.find((f) => f.id === 'ua.blocked.OAI-SearchBot');
    expect(probe?.severity).toBe('info');
    expect(probe?.message).toContain('although robots.txt allows it');
    expect(access.score).toBe(100);
  });
});

describe('server errors on optional files', () => {
  it('reports a 5xx or 429 llms.txt, sitemap or IndexNow key as "could not check", not "missing"', async () => {
    const s = await serve({
      '/robots.txt': text('User-agent: *\nAllow: /\n'),
      '/llms.txt': text('busy', 'text/plain', 503),
      '/llms-full.txt': text('slow down', 'text/plain', 429),
      '/sitemap.xml': text('oops', 'text/plain', 500),
      '/key1.txt': text('oops', 'text/plain', 502),
    });
    const files = await fetchSiteFiles(`${s.url}/`, { indexNowKey: 'key1' });
    expect(files.llms.error).toBe('HTTP 503');
    expect(files.robots.error).toBeUndefined();
    const ids = discoverySection(files, `${s.url}/`).findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['llms.error', 'llms-full.error', 'sitemap.error', 'indexnow.error']));
    expect(ids).not.toEqual(expect.arrayContaining(['llms.missing']));
    expect(ids.some((id) => id === 'sitemap.missing' || id === 'indexnow.bad')).toBe(false);
  });
});
