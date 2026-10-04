# crawlsee

A CLI that shows what Google, link previews and AI answer engines actually read on your page, not what your browser shows you. It's for people who ship websites with React, Next.js or any JS framework and want to know why ChatGPT, Perplexity or a Slack unfurl gets their page wrong.

```
$ npx crawlsee trywend.vercel.app --render

crawlsee v0.1.0  https://trywend.vercel.app/
what crawlers and AI answer engines read, before any JavaScript runs

Overall  █████████████████░░░ 84/100

 53  Meta and link previews
     ✓ Title: "Wend · Notes that act."
     ✗ Canonical points to https://trywend.app, which does not resolve (ENOTFOUND)
         Search engines are told the "real" copy of this page lives at a URL that does not work.
     ! og:image does not resolve (ENOTFOUND): https://trywend.app/opengraph-image?ddfad0fcdcb6b9d3

 98  Raw HTML vs rendered (what JS adds)
     ✓ 98% of the rendered text is in the raw HTML (3,641 vs 3,721 chars, rendered in 5.7s)

 41  Hidden at load
     ✗ Your H1 is invisible until JavaScript runs (style opacity:0)
         "Notes that act."
...
```

That is an excerpt of a real run, captured on 2026-10-05. The full report is in [`examples/trywend.txt`](examples/trywend.txt).

## Why

Your browser shows the page after CSS and JavaScript have run. Googlebot's first pass, Bing, link unfurlers and most AI fetchers read the HTML your server sends. The gap between the two is where real bugs hide. One H1 that looked fine on screen was read by Google as "Webuy,operate,andscalesmallsoftwarebusinesses", because JSX dropped the whitespace between per-word `<span>`s. An agency's stats were served as "0 M+ Views/Month" because the counter animated up from zero in the browser. A portfolio said "select engagements" while buyers asked ChatGPT for "available for freelance". crawlsee fetches the page the way crawlers do and reports that version.

## Quickstart

crawlsee is not on npm yet, so run it from a clone. You need Node 22.12+ to build and test; the built CLI runs on Node 20.19+.

```bash
git clone https://github.com/agnij-dutta/crawlsee.git
cd crawlsee
npm ci
npm test
npm run build

# run the build directly
node dist/cli.js https://example.com

# or package it and run it with npx, the way it will run once published
npm pack
npx --yes ./crawlsee-0.1.0.tgz https://example.com --query "example domain"
```

Optional, for `--render` (raw vs rendered diff):

```bash
npx playwright install chromium
node dist/cli.js https://example.com --render
```

Outside this repo, `--render` needs Playwright installed next to crawlsee (`npm i playwright`), because it is an optional peer dependency.

## Usage

```
crawlsee <url> [options]
crawlsee --html <file> [options]
```

A bare host like `agnij.me` is treated as `https://agnij.me`.

### Options

| Flag | Description |
| --- | --- |
| `-q, --query <text>` | Run the "Would an AI recommend you for `<text>`?" check. Heuristic: vocabulary overlap with buyer phrasing, with no API calls. |
| `-r, --render` | Also render with headless Chromium and diff against the raw HTML. Needs Playwright. |
| `--json` | Print the full report as JSON. |
| `--ua <string>` | User agent for the crawler fetch. Default: `Mozilla/5.0 (compatible; crawlsee/0.1.0)`. |
| `--indexnow-key <key>` | Verify that `/<key>.txt` is served. IndexNow key files can't be discovered without the key. |
| `--no-ua-probe` | Skip re-fetching the page with GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot and Bingbot user agents. |
| `--timeout <ms>` | Per-request timeout, from 1 to 600000. Default 15000. Rendering gets twice this. |
| `--fail-under <n>` | Exit 1 if the overall score is below `n` (0 to 100). For CI. |
| `--html <file>` | Analyze a saved HTML file offline. Pass a URL as well to resolve relative links against it. |
| `-v, --verbose` | Show every detail line, untruncated. |
| `--no-color` | Disable colors. |
| `-h, --help` | Show help. |
| `--version` | Print the version. |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Report printed, and the score is at or above `--fail-under` if given. |
| `1` | Score is below `--fail-under`. |
| `2` | Usage error (bad flag, bad URL, unreadable file) or an unexpected failure. |

A site that is down or returns errors still produces a report (exit 0, or 1 under `--fail-under`) with the failure as a finding.

### Environment variables

| Variable | Effect |
| --- | --- |
| `NO_COLOR` | Any non-empty value disables color ([no-color.org](https://no-color.org)). |
| `CRAWLSEE_DEBUG` | Any non-empty value prints stack traces for unexpected errors. |

No API keys are needed. See [`.env.example`](.env.example).

### What it checks

| Section | What it reports |
| --- | --- |
| Fetch like a crawler | Status and size, the full redirect chain (a bare `curl` stops at the first hop), temporary vs permanent redirects, `X-Robots-Tag: noindex`, and HTML over 1 MB. |
| Meta and link previews | Title, description, canonical (checked live to confirm it resolves), meta robots, Open Graph and Twitter cards (`og:image` checked live), `<html lang>`. |
| Headings as crawler text | H1 to H3 as crawlers concatenate them, and **glued words**: adjacent inline elements whose text touches with no whitespace, in headings (fail) and the rest of the page (info). Per-letter split animations are ignored. |
| Raw vs rendered (`--render`) | Share of rendered text already in the raw HTML, blocks that only exist after JavaScript, title and H1 changes, and what each zero counter animates to. |
| Zero-state counters | `0+`, `0 M+`, `$0K` and similar next to units, plus counter markup (`data-target`, `.counter`, `.number-ticker`). Also notes stats whose number and unit sit in separate elements, which breaks `grep`. |
| Hidden at load | Text behind inline `opacity:0`, `display:none` or `visibility:hidden`, Tailwind `opacity-0` / `invisible`, or the `hidden` attribute, with H1 and heading blocks called out. |
| Structured data | JSON-LD parse errors, types, minimal required fields, FAQPage structure, and whether a Person or Organization is present. |
| AI crawler access | robots.txt verdicts for 11 bots (Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot), plus a re-fetch with bot user agents to catch WAF blocks. |
| Discovery files | `llms.txt` and `llms-full.txt`, sitemap (and whether this URL is in it), IndexNow key file, and soft-404 detection so an app shell answering 200 doesn't count as a file. |
| JavaScript weight | Every script in the initial HTML, fetched and sized. Chunks over 500 KB fail, plus inline script size and, with `--render`, the JS a real browser loaded. |
| Buyer query (`--query`) | Where each query word or synonym appears (title, H1, description, headings, JSON-LD, llms.txt, body), seller-speak to replace, and suggestions. |

### Library API

```ts
import { analyzeHtml, analyzeDocument, parseHtml, VERSION } from 'crawlsee';
import { analyzeUrl } from 'crawlsee/url';

const report = await analyzeUrl('example.com', { query: 'example domain', noUaProbe: true });
console.log(report.score, report.sections.map((s) => [s.id, s.score]));
```

| Export | Signature | Notes |
| --- | --- | --- |
| `analyzeHtml` | `(html: string, opts?: HtmlAnalysisOptions) => Report` | Markup-only checks. No network, no Node APIs; this is what the web UI runs. |
| `analyzeDocument` | `(doc: Document, opts?: HtmlAnalysisOptions) => Section[]` | Same checks on an already parsed document, without the JS section. |
| `parseHtml` | `(html: string) => Document` | htmlparser2 with entities decoded. |
| `analyzeUrl` (`crawlsee/url`) | `(input: string, opts?: UrlOptions) => Promise<Report>` | Everything above, plus network checks. Throws only for a malformed URL. |
| Types | `Report`, `Section`, `Finding`, `Severity`, `HtmlAnalysisOptions`, `UrlOptions` | Shipped as `.d.ts`. |

`HtmlAnalysisOptions`: `pageUrl`, `query`, `llmsTxt`. `UrlOptions`: `query`, `render`, `ua`, `timeoutMs`, `indexNowKey`, `noUaProbe`, `onProgress(msg)`.

Every `Finding` has a stable `id` (for example `headings.glued-words` or `meta.canonical.broken`), a `severity` (`pass`, `info`, `warn`, `fail`), a `message` and optional `detail` lines. In `--json`, each section's `data` field carries the structured results.

### Web UI

`web/index.html` is a static page you can open directly or host anywhere. Browsers can't fetch other sites (CORS), so it works in paste mode: paste the output of `view-source:` and it runs the markup-only checks locally. Nothing is uploaded. Redirects, robots.txt, llms.txt, bot probes, JS sizes and the rendered diff need the CLI.

## How it works

```
 URL ──> crawlerFetch ──────────> raw HTML ──> parseHtml ──> detectors/* ────────────────┐
         (no JS, manual redirects)                │         (meta, headings, counters,   │
                                                  │          hidden, jsonld, query)      │
         site/files ──> robots.txt, llms.txt,     │                                      ├──> Report
                        sitemap, IndexNow,        ├──> extractScripts ──> fetch + size ──┤    (sections, findings,
                        bot user-agent probes ────┼──────────────────────────────────────┤     weighted score)
                                                  │                                      │
 --render ──> Playwright Chromium ──> rendered HTML ──> diff vs raw, confirm counters ───┘
```

**Crawler text.** The core is `crawlerText` in `src/dom.ts`. It walks the parsed HTML the way a non-rendering text extractor does: block elements (`div`, `p`, `h1`, `li`...) start a new line, and inline elements are joined exactly as written. When two different elements' text touches with no whitespace and a letter on each side, that is a glue point. This is the "Webuy" bug: JSX removes whitespace that contains a newline, and CSS `gap` hides the problem on screen.

**Detectors** are pure functions from a parsed document to a `Section` of findings. They don't use Node APIs, so the same code is bundled into the browser UI. Network work lives in `analyze-url.ts` and `site/`. Failed requests are values, not exceptions, and each one becomes a "could not check" finding, never a "missing" or "allowed" one. A 5xx robots.txt is treated as "disallow everything", as [RFC 9309 section 2.3.1.4](https://www.rfc-editor.org/rfc/rfc9309#section-2.3.1.4) specifies.

**Scoring.** Each section scores 0 to 100: either computed directly (render coverage, query overlap) or 100 minus 35 per `fail` and 12 per `warn`. The overall score is a weighted mean of the sections that ran. `info` and `pass` never cost points.

## Limitations

- **Scores are heuristics.** They rank problems; they don't predict rankings or citations. Read the findings, not just the number.
- **The query check is not an LLM.** It measures vocabulary overlap against a hand-written synonym table. It can't tell whether an answer engine would actually recommend you.
- **Bot probes use spoofed user agents.** A WAF that verifies bot IP ranges may block a fake GPTBot and still let the real one through, so probe results are `info` and never cost points.
- **One page per run.** There is no site crawl. Run it on each page you care about (the homepage often links to a `/hire` or `/pricing` page that matters more).
- **Raw HTML is what crawlsee's own fetch got.** Sites can serve different HTML by user agent, IP or region. Google renders JavaScript later and does see JS-only text eventually; many AI fetchers and unfurlers don't.
- **Hidden-at-load only sees inline styles and common utility classes**, not rules in external stylesheets.
- **Script sizes** are for scripts referenced in the initial HTML (up to 60), uncompressed. Wire size is shown only when every response reported a compressed length.
- **Network scope.** crawlsee follows redirects and fetches script URLs found in the page, which may point to other hosts. Don't point it at untrusted input from a machine that can reach internal services. See [SECURITY.md](SECURITY.md).

## Examples

Real runs saved in [`examples/`](examples/) as terminal `.txt`, with `.json` for the first three. All were captured on 2026-10-05 from a home connection in India, on an Apple M4 laptop running Node 22.14 and crawlsee 0.1.0, with `--render --verbose`. Live sites change, so a run today may differ.

- **`trywend.txt`** (trywend.vercel.app, 84/100): the canonical and `og:image` point at `https://trywend.app`, which does not resolve, so link previews have no image. The H1 is `opacity:0` until hydration.
- **`linear.app.txt`** (83/100): the H1's crawler text is the headline three times, glued ("...for teams and agentsThe product development system..."). There is a 548 KB JS chunk, and "issue tracker" appears nowhere in the title, H1 or description.
- **`agnij.me.txt`** (99/100): one 308 redirect to `www`, 100% of rendered text present in raw HTML, but ten glued-word blocks such as "Rump LabsCo-founder". `agnij.me-hire.txt` shows `/hire` scoring 100 on a buyer query where the homepage scores 87.
- **`nytimes.com.txt`** (79/100, no `--render`): robots.txt blocks OAI-SearchBot, PerplexityBot and Claude-SearchBot, and the server answers 403 to every spoofed bot user agent.

## Prior art

- [Lighthouse SEO audits](https://developer.chrome.com/docs/lighthouse/seo/) check meta tags, crawlability and structured data on the rendered page.
- [geo-checker](https://www.npmjs.com/package/geo-checker) audits generative engine optimization: llms.txt, schema.org, AI crawler robots rules and citation signals.
- [@seomator/seo-audit](https://www.npmjs.com/package/@seomator/seo-audit), [@ranklint/cli](https://www.npmjs.com/package/@ranklint/cli) and [@davo20019/seo-audit](https://www.npmjs.com/package/@davo20019/seo-audit) are broad SEO audit CLIs with site crawling, rendering and many rules.
- [seo-linter](https://www.npmjs.com/package/seo-linter) lints local HTML files against SEO rules.
- [robots-parser](https://www.npmjs.com/package/robots-parser) is a standalone robots.txt parser.

The comparison above is based on each project's own description. crawlsee is narrower, and adds:

- **Crawler text with glued-word detection**, built from block and inline semantics, so JSX whitespace bugs show up the way crawlers read them.
- **Zero-state counter detection**, confirmed against the rendered page.
- **A block-level raw vs rendered diff** that lists the text only JavaScript adds.
- **Answer-engine access as one picture**: robots.txt for search, answer and training bots separately, a WAF probe with bot user agents, and the Bing/IndexNow path that ChatGPT search depends on.
- **A buyer-vocabulary check** that is labeled as a heuristic and needs no API keys.

## Roadmap

- Publish to npm so `npx crawlsee <url>` works without a clone.
- A GitHub Action wrapping `--fail-under` for preview deployments.
- Multi-page mode: follow the sitemap or internal links, report per page.
- Read external stylesheets for hidden-at-load checks.
- Report compressed script sizes by requesting each encoding explicitly.
- Grow the synonym table from real queries, and allow a user-supplied vocabulary file.
- Host the paste-HTML UI.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). It covers setup, tests, lint, the project layout and how to add a detector. To report security issues, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

## Author

Agnij Dutta ([@0xholmesdev](https://x.com/0xholmesdev), [github.com/agnij-dutta](https://github.com/agnij-dutta))
