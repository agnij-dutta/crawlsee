import { attr, type Document, findAll, rawText } from '../dom.js';
import { type Finding, type Section, section } from '../types.js';

export interface ScriptRef {
  src: string;
  kind: 'script' | 'modulepreload' | 'preload';
  /** Decoded (uncompressed) bytes, when fetched. */
  bytes?: number;
  /** Bytes on the wire, from content-length, when known. */
  transferBytes?: number;
  error?: string;
}

export interface ScriptInventory {
  external: ScriptRef[];
  inlineCount: number;
  inlineBytes: number;
}

export const BIG_CHUNK = 500 * 1024;

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export function extractScripts(doc: Document, baseUrl?: string): ScriptInventory {
  const resolve = (u: string) => {
    try {
      return baseUrl ? new URL(u, baseUrl).toString() : u;
    } catch {
      return u;
    }
  };
  const seen = new Set<string>();
  const external: ScriptRef[] = [];
  let inlineCount = 0;
  let inlineBytes = 0;
  for (const el of findAll(doc, (e) => e.name === 'script' || e.name === 'link')) {
    if (el.name === 'script') {
      const type = (attr(el, 'type') ?? '').toLowerCase();
      if (type && !/javascript|module|^$/.test(type)) continue; // JSON-LD, templates, data blobs
      const src = attr(el, 'src');
      if (src) {
        const u = resolve(src);
        if (!seen.has(u)) {
          seen.add(u);
          external.push({ src: u, kind: 'script' });
        }
      } else {
        inlineCount++;
        inlineBytes += byteLength(rawText(el));
      }
    } else {
      const rel = (attr(el, 'rel') ?? '').toLowerCase();
      const href = attr(el, 'href');
      if (!href) continue;
      const kind = rel === 'modulepreload' ? 'modulepreload' : rel === 'preload' && attr(el, 'as') === 'script' ? 'preload' : null;
      if (!kind) continue;
      const u = resolve(href);
      if (!seen.has(u)) {
        seen.add(u);
        external.push({ src: u, kind });
      }
    }
  }
  return { external, inlineCount, inlineBytes };
}

export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

export function scriptsSection(inv: ScriptInventory, opts: { fetched: boolean; renderedJsBytes?: number } = { fetched: false }): Section {
  const f: Finding[] = [];
  const sized = inv.external.filter((s) => s.bytes !== undefined);
  const total = sized.reduce((n, s) => n + (s.bytes ?? 0), 0) + inv.inlineBytes;
  // Only report wire size when every file told us its compressed length.
  const wire = sized.length && sized.every((s) => s.transferBytes) ? sized.reduce((n, s) => n + (s.transferBytes ?? 0), 0) : 0;
  const big = sized.filter((s) => (s.bytes ?? 0) > BIG_CHUNK).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));

  if (!opts.fetched) {
    f.push({
      id: 'js.unsized',
      severity: 'info',
      message: `${inv.external.length} external script(s), ${inv.inlineCount} inline (${kb(inv.inlineBytes)}). Sizes need the CLI (fetches each chunk).`,
    });
    return section('js', 'JavaScript weight', f, { weight: 1, score: null, data: { ...inv } });
  }

  f.push({
    id: 'js.total',
    severity: total > 2 * 1024 * 1024 ? 'fail' : total > 1024 * 1024 ? 'warn' : 'pass',
    message: `Initial HTML pulls ${kb(total)} of JS (uncompressed) across ${inv.external.length} file(s) + ${inv.inlineCount} inline${wire ? `, ~${kb(wire)} on the wire` : ''}`,
  });
  for (const s of big)
    f.push({
      id: 'js.big-chunk',
      severity: 'fail',
      message: `${kb(s.bytes ?? 0)} chunk: ${shortUrl(s.src)}`,
      detail: ['Over 500 KB. Common cause: `import * as Icons from "..."` or a barrel file defeating tree shaking.'],
    });
  const failed = inv.external.filter((s) => s.error);
  if (failed.length)
    f.push({
      id: 'js.fetch-failed',
      severity: 'info',
      message: `${failed.length} script(s) could not be fetched`,
      detail: failed.slice(0, 5).map((s) => `${shortUrl(s.src)}: ${s.error}`),
    });
  if (inv.inlineBytes > 100 * 1024)
    f.push({
      id: 'js.inline',
      severity: 'warn',
      message: `${kb(inv.inlineBytes)} of inline script (hydration payloads count toward HTML size)`,
    });
  if (opts.renderedJsBytes !== undefined)
    f.push({
      id: 'js.rendered',
      severity: 'info',
      message: `A real browser ended up loading ${kb(opts.renderedJsBytes)} of JS after hydration`,
    });
  const top = [...sized].sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, 5);
  if (top.length && !big.length)
    f.push({
      id: 'js.top',
      severity: 'info',
      message: 'Largest files',
      detail: top.map((s) => `${kb(s.bytes ?? 0).padStart(9)}  ${shortUrl(s.src)}`),
    });

  return section('js', 'JavaScript weight', f, {
    weight: 1,
    data: { ...inv, totalBytes: total, transferBytes: wire, renderedJsBytes: opts.renderedJsBytes },
  });
}

export function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    const p = x.host + x.pathname + (x.search.length > 30 ? `${x.search.slice(0, 27)}...` : x.search);
    return p.length > 80 ? `${p.slice(0, 30)}...${p.slice(-47)}` : p;
  } catch {
    return u.length > 70 ? `...${u.slice(-67)}` : u;
  }
}
