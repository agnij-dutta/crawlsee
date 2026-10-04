#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { analyzeHtml, VERSION } from './analyze.js';
import { analyzeUrl, normalizeInput } from './analyze-url.js';
import { renderTerminal } from './report/terminal.js';
import type { Report } from './types.js';

const HELP = `crawlsee ${VERSION}
See what crawlers and AI answer engines actually read on your page.

Usage
  crawlsee <url> [options]
  crawlsee --html <file> [options]     analyze a saved HTML file (offline)

Options
  -q, --query <text>        "Would an AI recommend you for <text>?" vocabulary check (heuristic)
  -r, --render              also render with headless Chromium and diff against the raw HTML
                            (needs: npm i -g playwright && npx playwright install chromium)
      --json                print the full report as JSON
      --ua <string>         user agent for the crawler fetch
      --indexnow-key <key>  verify /<key>.txt is served
      --no-ua-probe         skip re-fetching the page as GPTBot, ClaudeBot, etc.
      --timeout <ms>        per-request timeout (default 15000)
      --fail-under <n>      exit 1 if the overall score is below n (for CI)
  -v, --verbose             show every detail line
      --html <file>         analyze a saved HTML file offline (no network)
      --no-color            disable colors (also honors NO_COLOR)
  -h, --help                show this help
      --version             print the version

Exit codes
  0  report printed (and score >= --fail-under, if given)
  1  score below --fail-under
  2  usage error, or the report could not be produced

Examples
  npx crawlsee agnij.me
  npx crawlsee https://example.com --query "freelance web3 engineer"
  npx crawlsee https://example.com --render --json > report.json
`;

/** Thrown for bad input; printed without a stack trace, exit code 2. */
class UsageError extends Error {}

function numberFlag(flag: string, raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n) || n < min || n > max) {
    throw new UsageError(`--${flag} expects a number from ${min} to ${max}, got "${raw}"`);
  }
  return n;
}

async function main(): Promise<number> {
  let parsed: ReturnType<typeof parseCli>;
  try {
    parsed = parseCli();
  } catch (e) {
    // parseArgs throws a TypeError with a readable message for unknown or malformed flags.
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const { values, positionals } = parsed;
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const target = positionals[0];
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (!target && !values.html) throw new UsageError('missing <url> (or --html <file>). Run crawlsee --help for usage.');
  if (positionals.length > 1) throw new UsageError(`expected one URL, got ${positionals.length}: ${positionals.join(' ')}`);
  const timeoutMs = numberFlag('timeout', values.timeout, 1, 600_000);
  const failUnder = numberFlag('fail-under', values['fail-under'], 0, 100);

  const color = !values['no-color'] && !values.json && !process.env.NO_COLOR && process.stdout.isTTY === true;
  const progress = (msg: string) => {
    if (!values.json && process.stderr.isTTY) process.stderr.write(`\x1b[2K\r\x1b[2m${msg}...\x1b[0m`);
  };

  let report: Report;
  if (values.html) {
    let html: string;
    try {
      html = await readFile(values.html, 'utf8');
    } catch (e) {
      throw new UsageError(`cannot read ${values.html}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    }
    report = analyzeHtml(html, { pageUrl: target ? normalizeInput(target) : undefined, query: values.query });
  } else {
    report = await analyzeUrl(target, {
      query: values.query,
      render: values.render,
      ua: values.ua,
      timeoutMs,
      indexNowKey: values['indexnow-key'],
      noUaProbe: values['no-ua-probe'],
      onProgress: progress,
    });
  }
  if (process.stderr.isTTY && !values.json) process.stderr.write('\x1b[2K\r');

  if (values.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderTerminal(report, { color, verbose: values.verbose, width: process.stdout.columns }));

  return failUnder !== undefined && report.score < failUnder ? 1 : 0;
}

function parseCli() {
  return parseArgs({
    allowPositionals: true,
    options: {
      query: { type: 'string', short: 'q' },
      render: { type: 'boolean', short: 'r' },
      json: { type: 'boolean' },
      ua: { type: 'string' },
      'indexnow-key': { type: 'string' },
      'no-ua-probe': { type: 'boolean' },
      timeout: { type: 'string' },
      'fail-under': { type: 'string' },
      html: { type: 'string' },
      verbose: { type: 'boolean', short: 'v' },
      'no-color': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    if (process.stderr.isTTY) process.stderr.write('\x1b[2K\r');
    const message = err instanceof Error ? err.message : String(err);
    console.error(`crawlsee: ${message}`);
    // Unexpected errors keep their stack so bug reports are useful.
    if (!(err instanceof UsageError) && err instanceof Error && process.env.CRAWLSEE_DEBUG) console.error(err.stack);
    process.exitCode = 2;
  },
);
