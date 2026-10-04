# crawlsee

See what crawlers and AI answer engines actually read on your page, versus what your eyes see.

```bash
npx crawlsee https://your.site
npx crawlsee https://your.site --query "freelance web3 engineer"
npx crawlsee https://your.site --render        # also diff raw HTML vs headless Chromium
npx crawlsee https://your.site --json > report.json
```

Your browser shows the page after CSS and JavaScript. Googlebot's first pass, Bing, link unfurlers (Slack, X, iMessage) and most AI fetchers read the HTML your server sends. crawlsee fetches that HTML the way they do (no JS, redirects followed and reported) and tells you what they get.

## Why this exists

Every check comes from a real bug:

| What happened | What crawlsee checks |
| --- | --- |
| Google read an H1 as **"Webuy,operate,andscalesmallsoftwarebusinesses"**. Each word was its own `<span>` on its own JSX line; JSX drops whitespace that contains a newline, and CSS `gap` hid it visually. Fix: `{" "}`. | **Glued words**: adjacent inline elements whose text touches with no whitespace, in headings (fail) and the rest of the body (info). Per-letter split animations are ignored. |
| An agency's headline stats were JS counters animating from zero, so every crawler, link preview and AI summarizer read **"0 M+ Views/Month"**. | **Zero-state counters**: `0`, `0+`, `0 M+`, `$0K` next to units, plus counter markup (`data-target`, `.counter`, `.number-ticker`). With `--render`, confirms what the number animates to. |
| A homepage scored 39 on mobile Lighthouse: an icon wrapper did `import * as` on six icon packs (3.3 MB chunk) and the hero sat at `opacity: 0` until hydration. | **JS weight** of the initial HTML's scripts (flags any chunk over 500 KB) and **hidden at load** (inline `opacity:0`, `display:none`, `visibility:hidden`, Tailwind `opacity-0`, `hidden` attribute). |
| ChatGPT recommended strangers for "web3 engineer open to freelance" because the site said "select engagements" and buyers say "available for freelance". | **"Would an AI recommend you for X?"**: buyer-vocabulary overlap between your query and crawler-visible text (title, H1, meta, headings, JSON-LD, llms.txt, body), seller-speak detection, and suggested phrases. Heuristic, labeled as such, no API calls. |
| A "verify it yourself" `curl` returned nothing: the apex domain 308-redirected (needed `-L`) and the number and its unit were in separate elements, so `grep` needed tag-stripping first. | **Redirect chain** report, and a note when stats split the number and unit across elements. |

Plus the basics, aimed at answer engines: title, meta description, canonical (and whether it resolves), meta robots and `X-Robots-Tag`, Open Graph and Twitter cards (and whether `og:image` resolves), JSON-LD validity and types (FAQPage, Person, Organization...), `llms.txt` / `llms-full.txt`, sitemap, IndexNow key file, and robots.txt verdicts for AI bots (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, Bingbot, Applebot-Extended, CCBot). It also re-fetches the page with those bots' user agents, because a WAF "block AI bots" toggle can 403 a bot that robots.txt allows.

## Options

```
-q, --query <text>        "Would an AI recommend you for <text>?" (heuristic)
-r, --render              render with headless Chromium and diff against the raw HTML
    --json                full report as JSON
    --ua <string>         user agent for the crawler fetch
    --indexnow-key <key>  verify /<key>.txt is served (key files are not discoverable)
    --no-ua-probe         skip re-fetching as GPTBot, ClaudeBot, PerplexityBot...
    --timeout <ms>        per-request timeout (default 15000)
    --fail-under <n>      exit 1 if the overall score is below n (CI)
    --html <file>         analyze a saved HTML file offline
-v, --verbose             every detail line, untruncated
    --no-color            also honors NO_COLOR
```

`--render` uses Playwright, which is an optional peer dependency so `npx crawlsee` stays light:

```bash
npm i -g playwright && npx playwright install chromium
```

## Web UI

`web/index.html` is a static page (open it directly or host it anywhere). Browsers can't fetch other sites (CORS), so it runs in paste-HTML mode: paste your `view-source:` and it runs every markup-only check locally in the browser. Nothing is uploaded. For redirects, robots.txt, llms.txt, bot probes, JS sizes and the rendered diff, use the CLI.

## Examples

Real runs, saved in [`examples/`](examples/) (terminal `.txt` plus `.json`):

- `agnij.me.txt`: 99/100. Redirect `agnij.me -> www.agnij.me` (308), 100% of rendered text present in raw HTML, but 10 glued-word blocks such as "Rump LabsCo-founder" in the experience list. `agnij.me-hire.txt` shows `/hire` scoring 100 on the buyer query that the homepage only scores 87 on.
- `trywend.txt` (trywend.vercel.app): canonical and `og:image` point at `https://trywend.app`, which does not resolve (NXDOMAIN), so every link preview image is broken; the H1 "Notes that act." is `opacity:0` until hydration.
- `linear.app.txt`: the H1's crawler text is the headline three times glued together ("...for teams and agentsThe product development system..."), from an animated copy plus a screen-reader copy; one 548 KB JS chunk; "issue tracker" is not in the title, H1 or description.
- `nytimes.com.txt`: robots.txt blocks OAI-SearchBot, PerplexityBot and Claude-SearchBot (so no ChatGPT search citations), and the edge 403s spoofed bot user agents.

## How it compares

There are good SEO linters and auditors already, e.g. Lighthouse's SEO category, `seo-linter`, `@seomator/seo-audit`, `@ranklint/cli`, `@davo20019/seo-audit`, and `geo-checker` (which also checks llms.txt, schema.org and AI-crawler robots rules). Judging from their docs, crawlsee is narrower and differs in focus:

- **AI answer engines first.** It scores what ChatGPT search, Perplexity and Claude can read and cite, including the bot user-agent probe, the Bing/IndexNow path ChatGPT search depends on, and a buyer-vocabulary check.
- **Raw vs rendered diff.** It reports the text that only exists after JavaScript, block by block, and confirms what counters animate to.
- **Glued-word detection.** Crawler text is built with block/inline semantics, so JSX whitespace bugs show up exactly the way Google reads them.
- **One page, one command, no API keys.**

## Develop

```bash
npm install
npm test          # vitest, HTML fixtures per detector
npm run build     # tsc -> dist/, esbuild -> web/crawlsee.js
node dist/cli.js https://example.com
```

Layout: `src/dom.ts` (crawler text + glue detection), `src/detectors/*` (pure, browser-safe), `src/site/*` and `src/analyze-url.ts` (network), `src/render.ts` (Playwright), `src/web/main.ts` (paste UI).

Scores are heuristics. Read the findings, not just the number.

MIT, Agnij Dutta ([@0xholmesdev](https://x.com/0xholmesdev)).
