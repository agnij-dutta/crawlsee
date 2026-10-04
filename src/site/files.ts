import { crawlerFetch, type FetchResult, pool } from '../fetch.js';
import { type Finding, type Section, section } from '../types.js';
import { AI_BOTS, isAllowed, parseRobots, type Robots } from './robots.js';

/** 5xx or 429: the server could not answer, which is not the same as "this file does not exist". */
const serverError = (r: FetchResult) => r.status >= 500 || r.status === 429;

const looksLikeHtml = (r: FetchResult) =>
  /text\/html/i.test(r.headers['content-type'] ?? '') || /^\s*(<!doctype html|<html)/i.test(r.body.slice(0, 200));

/** A fetched well-known file. `status` is 0 and `error` is set when the request itself failed. */
export interface FetchedFile {
  status: number;
  error?: string;
}

export interface RobotsFile extends FetchedFile {
  text: string;
  parsed: Robots;
  /** RFC 9309 section 2.3.1.4: a 5xx robots.txt means "assume complete disallow". */
  unreachable: boolean;
}

export interface SiteFiles {
  origin: string;
  /** Unknown paths answer 200, so a 200 alone proves nothing. */
  softNotFound: boolean;
  robots: RobotsFile;
  llms: FetchedFile & { text: string; html: boolean };
  llmsFull: FetchedFile & { bytes: number; html: boolean };
  sitemap: FetchedFile & { url: string; kind: 'urlset' | 'sitemapindex' | 'invalid'; urls: number; containsPage?: boolean };
  indexNow: { checked: boolean; key?: string; status?: number; error?: string; matches?: boolean };
}

const DISALLOW_ALL: Robots = { groups: [{ agents: ['*'], rules: [{ allow: false, path: '/' }] }], sitemaps: [] };

export async function fetchSiteFiles(
  pageUrl: string,
  opts: { ua?: string; timeoutMs?: number; indexNowKey?: string } = {},
): Promise<SiteFiles> {
  const origin = new URL(pageUrl).origin;
  const get = (path: string, accept = 'text/plain,*/*') =>
    crawlerFetch(new URL(path, origin).toString(), { ua: opts.ua, timeoutMs: opts.timeoutMs, accept });
  const probe = `/crawlsee-${Math.random().toString(36).slice(2, 10)}.txt`;
  const [robotsR, llmsR, llmsFullR, probeR] = await Promise.all([get('/robots.txt'), get('/llms.txt'), get('/llms-full.txt'), get(probe)]);

  // Some hosts answer 200 with the app shell for any path, which would fake every file check.
  const softNotFound = probeR.status === 200;
  const real = (r: FetchResult) => r.status === 200 && !looksLikeHtml(r) && r.body.trim().length > 0;
  const meta = (r: FetchResult): FetchedFile => (r.error ? { status: r.status, error: r.error } : { status: r.status });
  // For optional files, a server error or rate limit says nothing about whether the file exists.
  const fileMeta = (r: FetchResult): FetchedFile => (serverError(r) ? { status: r.status, error: `HTTP ${r.status}` } : meta(r));

  const robotsText = real(robotsR) ? robotsR.body : '';
  const unreachable = robotsR.status >= 500;
  const robots: RobotsFile = {
    ...meta(robotsR),
    text: robotsText,
    parsed: unreachable ? DISALLOW_ALL : parseRobots(robotsText),
    unreachable,
  };

  const sitemapUrl = robots.parsed.sitemaps[0] ?? new URL('/sitemap.xml', origin).toString();
  const sm = await crawlerFetch(sitemapUrl, { ua: opts.ua, timeoutMs: opts.timeoutMs, accept: 'application/xml,text/xml,*/*' });
  const kind = /<urlset[\s>]/i.test(sm.body) ? 'urlset' : /<sitemapindex[\s>]/i.test(sm.body) ? 'sitemapindex' : 'invalid';
  const locs = [...sm.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  const norm = (u: string) => u.replace(/\/$/, '').replace(/^https?:\/\/(www\.)?/, '');

  const files: SiteFiles = {
    origin,
    softNotFound,
    robots,
    llms: { ...fileMeta(llmsR), text: real(llmsR) ? llmsR.body : '', html: llmsR.status === 200 && looksLikeHtml(llmsR) },
    llmsFull: {
      ...fileMeta(llmsFullR),
      bytes: real(llmsFullR) ? llmsFullR.bytes : 0,
      html: llmsFullR.status === 200 && looksLikeHtml(llmsFullR),
    },
    sitemap: {
      ...fileMeta(sm),
      url: sitemapUrl,
      kind: sm.status === 200 ? kind : 'invalid',
      urls: locs.length,
      containsPage: sm.status === 200 && kind === 'urlset' ? locs.some((l) => norm(l) === norm(pageUrl)) : undefined,
    },
    indexNow: { checked: false },
  };

  if (opts.indexNowKey) {
    const r = await get(`/${opts.indexNowKey}.txt`);
    files.indexNow = {
      checked: true,
      key: opts.indexNowKey,
      status: r.status,
      ...(r.error || serverError(r) ? { error: r.error ?? `HTTP ${r.status}` } : {}),
      matches: r.status === 200 && r.body.trim() === opts.indexNowKey,
    };
  }
  return files;
}

export function discoverySection(files: SiteFiles, pageUrl: string): Section {
  const f: Finding[] = [];
  if (files.softNotFound)
    f.push({
      id: 'files.soft-404',
      severity: 'warn',
      message: 'Unknown paths return 200 (soft 404). File checks below ignore HTML responses for that reason.',
    });

  const l = files.llms;
  if (l.text) {
    const h1 = /^#\s+\S/m.test(l.text);
    const links = (l.text.match(/\]\(https?:\/\//g) ?? []).length;
    const avail = /\b(available|availability|hire|hiring|freelance|contract|contact)\b/i.test(l.text);
    f.push({
      id: 'llms.ok',
      severity: 'pass',
      message: `llms.txt: ${l.text.length.toLocaleString('en-US')} chars, ${links} link(s)${h1 ? '' : ', no "# Title" line'}`,
    });
    if (!h1)
      f.push({ id: 'llms.format', severity: 'info', message: 'llms.txt should start with "# Name" then a "> summary" line (llmstxt.org)' });
    if (!avail)
      f.push({
        id: 'llms.availability',
        severity: 'info',
        message:
          'llms.txt never mentions how to contact, hire or buy. If you sell anything, add an "Availability" or "Contact" section in buyer words.',
      });
  } else if (l.error)
    f.push({ id: 'llms.error', severity: 'warn', message: `Could not fetch /llms.txt (${l.error}); its presence is unknown` });
  else if (l.html) f.push({ id: 'llms.html', severity: 'warn', message: '/llms.txt returns an HTML page, not text (SPA fallback?)' });
  else
    f.push({
      id: 'llms.missing',
      severity: 'warn',
      message: `No /llms.txt (HTTP ${l.status}). Cheap to add, and some agents read it first.`,
    });

  if (files.llmsFull.bytes)
    f.push({ id: 'llms-full.ok', severity: 'pass', message: `llms-full.txt: ${files.llmsFull.bytes.toLocaleString('en-US')} bytes` });
  else if (files.llmsFull.error)
    f.push({ id: 'llms-full.error', severity: 'info', message: `Could not fetch /llms-full.txt (${files.llmsFull.error})` });
  else f.push({ id: 'llms-full.missing', severity: 'info', message: 'No /llms-full.txt (optional: full content in one file for agents)' });

  const s = files.sitemap;
  if (s.error) f.push({ id: 'sitemap.error', severity: 'warn', message: `Could not fetch the sitemap at ${s.url} (${s.error})` });
  else if (s.status !== 200 || s.kind === 'invalid')
    f.push({ id: 'sitemap.missing', severity: 'warn', message: `No valid sitemap at ${s.url} (HTTP ${s.status})` });
  else {
    f.push({
      id: 'sitemap.ok',
      severity: 'pass',
      message: `Sitemap (${s.kind}) with ${s.urls} <loc> entr${s.urls === 1 ? 'y' : 'ies'}: ${s.url}`,
    });
    if (s.containsPage === false)
      f.push({ id: 'sitemap.page', severity: 'info', message: `This URL is not listed in the sitemap: ${pageUrl}` });
  }
  if (files.robots.status === 200 && files.robots.text && !files.robots.parsed.sitemaps.length)
    f.push({ id: 'sitemap.robots', severity: 'info', message: 'robots.txt has no Sitemap: line' });

  if (files.indexNow.checked) {
    if (files.indexNow.matches)
      f.push({ id: 'indexnow.ok', severity: 'pass', message: `IndexNow key file /${files.indexNow.key}.txt is live and matches` });
    else if (files.indexNow.error)
      f.push({
        id: 'indexnow.error',
        severity: 'warn',
        message: `Could not fetch the IndexNow key file /${files.indexNow.key}.txt (${files.indexNow.error}); whether it is live is unknown`,
      });
    else
      f.push({
        id: 'indexnow.bad',
        severity: 'fail',
        message: `IndexNow key file /${files.indexNow.key}.txt missing or wrong (HTTP ${files.indexNow.status})`,
      });
  } else
    f.push({
      id: 'indexnow.unchecked',
      severity: 'info',
      message:
        'IndexNow: key files are not discoverable. Pass --indexnow-key <key> to verify yours. Worth having: ChatGPT search reads the Bing index, and IndexNow is how Bing hears about changes within minutes.',
    });

  // Report data keeps sizes, not file bodies: llms.txt often carries contact details and third-party copy.
  const { text, ...llms } = files.llms;
  return section('discovery', 'Discovery files (llms.txt, sitemap, IndexNow)', f, {
    weight: 1,
    data: {
      origin: files.origin,
      softNotFound: files.softNotFound,
      llms: { ...llms, chars: text.length },
      llmsFull: files.llmsFull,
      sitemap: files.sitemap,
      indexNow: files.indexNow,
    },
  });
}

export interface UaProbe {
  bot: string;
  status: number;
  bytes: number;
  error?: string;
}

const BOT_UAS: Record<string, string> = {
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'OAI-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  Bingbot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
};

/** Fetch the page again with real bot user agents: WAFs often block them even when robots.txt allows. */
export async function probeBotAccess(url: string, timeoutMs?: number): Promise<UaProbe[]> {
  return pool(Object.entries(BOT_UAS), 3, async ([bot, ua]) => {
    const r = await crawlerFetch(url, { ua, timeoutMs });
    return { bot, status: r.status, bytes: r.bytes, error: r.error };
  });
}

export function aiAccessSection(
  files: SiteFiles,
  pageUrl: string,
  baseline: { status: number; bytes: number },
  probes: UaProbe[],
): Section {
  const f: Finding[] = [];
  const path = new URL(pageUrl).pathname + new URL(pageUrl).search;
  const robots = files.robots;
  if (robots.error) {
    // An unreadable robots.txt is not an absent one: don't print verdicts we can't back up.
    f.push({ id: 'robots.error', severity: 'warn', message: `Could not fetch robots.txt (${robots.error}); bot verdicts are unknown` });
    return section(
      'ai-access',
      'AI crawler access (robots.txt + user-agent test)',
      [...f, ...probeFindings(probes, baseline, robots, path)],
      {
        weight: 1.25,
        score: null,
        data: { probes },
      },
    );
  }
  if (robots.unreachable)
    f.push({
      id: 'robots.unreachable',
      severity: 'fail',
      message: `robots.txt returns HTTP ${robots.status}. Per RFC 9309, crawlers treat a 5xx robots.txt as "disallow everything"`,
    });
  else if (robots.status === 200 && !robots.text)
    f.push({
      id: 'robots.html',
      severity: 'info',
      message: 'robots.txt answers 200 with an HTML page or nothing; crawlers read it as "allow all"',
    });
  else if (robots.status !== 200)
    f.push({ id: 'robots.missing', severity: 'info', message: `No robots.txt (HTTP ${robots.status}): every bot is allowed by default` });

  const table: string[] = [];
  const verdicts: Record<string, unknown> = {};
  for (const bot of AI_BOTS) {
    const v = isAllowed(robots.parsed, bot.name, path);
    verdicts[bot.name] = v;
    table.push(
      `${v.allowed ? 'allowed' : 'BLOCKED'}  ${bot.name.padEnd(18)} ${bot.owner}${v.explicit || !v.allowed ? `  (${v.reason})` : ''}`,
    );
    if (!v.allowed)
      f.push({
        id: `robots.blocked.${bot.name}`,
        severity: bot.impact,
        message:
          bot.role === 'training'
            ? `robots.txt blocks ${bot.name} (${bot.owner}). Fine if deliberate; it does not affect search answers.`
            : `robots.txt blocks ${bot.name}: this page cannot appear in ${bot.owner}`,
      });
  }
  f.push({ id: 'robots.table', severity: 'info', message: `robots.txt verdicts for ${path}`, detail: table });
  f.push(...probeFindings(probes, baseline, robots, path));
  return section('ai-access', 'AI crawler access (robots.txt + user-agent test)', f, { weight: 1.25, data: { verdicts, probes } });
}

function probeFindings(probes: UaProbe[], baseline: { status: number; bytes: number }, robots: RobotsFile, path: string): Finding[] {
  const f: Finding[] = [];
  for (const p of probes) {
    const blocked = p.status === 401 || p.status === 403 || p.status === 429 || p.status >= 500 || p.status === 0;
    const shrunk = p.status === 200 && baseline.bytes > 2000 && p.bytes < baseline.bytes * 0.3;
    if (blocked || shrunk) {
      const bot = AI_BOTS.find((b) => b.name === p.bot);
      f.push({
        id: `ua.blocked.${p.bot}`,
        // Spoofed UA: a 403 may just be the WAF catching a fake bot, so this never costs points.
        severity: 'info',
        message: blocked
          ? `Server answers ${p.status || p.error} to the ${p.bot} user agent (normal fetch: ${baseline.status})${bot?.role !== 'training' && !robots.error && isAllowed(robots.parsed, p.bot, path).allowed ? ', although robots.txt allows it' : ''}`
          : `${p.bot} user agent gets ${p.bytes} bytes vs ${baseline.bytes} normally (challenge page?)`,
        detail: [
          'Tested with a spoofed user agent. A WAF that verifies bot IPs may let the real bot through; "block AI bots" toggles usually match on the user agent alone. Check your WAF/CDN bot settings.',
        ],
      });
    }
  }
  if (probes.length && !f.some((x) => x.id.startsWith('ua.')))
    f.push({ id: 'ua.ok', severity: 'pass', message: `Page served normally to ${probes.map((p) => p.bot).join(', ')} user agents` });
  return f;
}
