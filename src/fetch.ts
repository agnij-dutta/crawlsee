import { VERSION } from './analyze.js';
import type { RedirectHop } from './types.js';

export const DEFAULT_UA = `Mozilla/5.0 (compatible; crawlsee/${VERSION})`;

export interface FetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  chain: RedirectHop[];
  headers: Record<string, string>;
  body: string;
  bytes: number;
  ms: number;
  error?: string;
}

export interface FetchOptions {
  ua?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
}

/**
 * Fetch like a crawler: no JavaScript, redirects followed by hand so the
 * chain can be reported (a bare `curl` without -L stops at the first hop).
 */
export async function crawlerFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const chain: RedirectHop[] = [];
  const started = Date.now();
  let current = url;
  const max = opts.maxRedirects ?? 10;
  for (let i = 0; i <= max; i++) {
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: {
          'user-agent': opts.ua ?? DEFAULT_UA,
          accept: opts.accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      });
    } catch (e) {
      return {
        ok: false,
        status: 0,
        finalUrl: current,
        chain,
        headers: {},
        body: '',
        bytes: 0,
        ms: Date.now() - started,
        error: errMessage(e),
      };
    }
    const location = res.headers.get('location') ?? undefined;
    if (res.status >= 300 && res.status < 400 && location) {
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        // A malformed Location header is the site's bug: report it, don't throw out of analyzeUrl.
        await res.body?.cancel().catch(() => {});
        chain.push({ url: current, status: res.status, location });
        return {
          ok: false,
          status: res.status,
          finalUrl: current,
          chain,
          headers: Object.fromEntries(res.headers.entries()),
          body: '',
          bytes: 0,
          ms: Date.now() - started,
          error: `invalid redirect Location header: ${location}`,
        };
      }
      chain.push({ url: current, status: res.status, location: next });
      await res.body?.cancel().catch(() => {});
      current = next;
      continue;
    }
    let body = '';
    try {
      body = await res.text();
    } catch (e) {
      return {
        ok: false,
        status: res.status,
        finalUrl: current,
        chain,
        headers: {},
        body: '',
        bytes: 0,
        ms: Date.now() - started,
        error: errMessage(e),
      };
    }
    chain.push({ url: current, status: res.status });
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: current,
      chain,
      headers: Object.fromEntries(res.headers.entries()),
      body,
      bytes: new TextEncoder().encode(body).length,
      ms: Date.now() - started,
    };
  }
  return {
    ok: false,
    status: 0,
    finalUrl: current,
    chain,
    headers: {},
    body: '',
    bytes: 0,
    ms: Date.now() - started,
    error: `more than ${max} redirects`,
  };
}

export function errMessage(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === 'TimeoutError') return 'timed out';
  return err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(e);
}

/** Run async tasks with a concurrency cap. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
