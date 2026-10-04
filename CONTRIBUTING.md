# Contributing to crawlsee

Thanks for helping. The most useful contributions are new checks backed by a real page that fools crawlers, and fixes for false positives.

## Setup

Requires Node 22.12+ for development (Vitest 5). The published CLI runs on Node 20.19+.

```bash
git clone https://github.com/agnij-dutta/crawlsee.git
cd crawlsee
npm ci
```

`--render` also needs a Chromium for Playwright (a dev dependency here):

```bash
npx playwright install chromium
```

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Vitest: detector fixtures, a local HTTP server for network code, and the CLI in a child process. No internet needed. |
| `npm run test:coverage` | Same, with a v8 coverage summary. |
| `npm run check` | Biome lint and format check (what CI runs). |
| `npm run lint` / `npm run format` | Lint only / rewrite formatting. |
| `npm run typecheck` | `tsc` for the Node code and, separately, the browser bundle. |
| `npm run build` | `dist/` (CLI and library, with `.d.ts`) and `web/crawlsee.js` (paste UI bundle). |
| `node dist/cli.js <url>` | Run your build. |

Before opening a PR, run `npm run check && npm run typecheck && npm test && npm run build`.

## Project layout

```
src/
  cli.ts            argument parsing, exit codes, terminal vs JSON output
  analyze.ts        analyzeHtml / analyzeDocument: markup-only checks (also bundled for the browser)
  analyze-url.ts    analyzeUrl: fetch, site files, script sizing, optional render, section order
  dom.ts            HTML parsing and "crawler text": block vs inline joining, glued-word detection
  fetch.ts          crawlerFetch: manual redirects, timeouts, errors as values
  render.ts         Playwright render (optional peer dependency)
  types.ts          Finding, Section, Report, scoring
  detectors/        one file per section; pure functions of a parsed Document
  site/             robots.txt parsing, llms.txt / sitemap / IndexNow, bot user-agent probes
  report/           terminal renderer
  web/              paste-HTML UI entry (bundled to web/crawlsee.js)
test/
  fixtures/         small HTML pages, one per behavior
  server.ts         throwaway local HTTP server for network tests
web/                static paste UI (index.html, style.css, built crawlsee.js)
examples/           saved reports from real sites
```

Detectors in `src/detectors/` must stay free of Node APIs and network calls, because the same code runs in the browser UI. `npm run typecheck` enforces this through `tsconfig.web.json`, which has no Node types.

## Adding a detector

A detector turns a parsed `Document` into a `Section` of `Finding`s.

1. **Start from a real page.** Save the smallest HTML that reproduces the problem as `test/fixtures/<name>.html`, and a fixed version if one exists. Note in the PR where you saw it.
2. **Write the detector** in `src/detectors/<name>.ts`:

   ```ts
   import { body, crawlerText, type Document } from '../dom.js';
   import { section, type Finding, type Section } from '../types.js';

   /** One line on what crawlers get wrong, and why. */
   export function exampleSection(doc: Document): Section {
     const findings: Finding[] = [];
     const text = crawlerText(body(doc)).text;
     if (/lorem ipsum/i.test(text)) {
       findings.push({
         id: 'example.placeholder',      // stable id: section.problem
         severity: 'fail',               // pass | info | warn | fail
         message: 'Crawlers read placeholder text',
         detail: ['Fix: replace it before launch.'],
       });
     } else {
       findings.push({ id: 'example.ok', severity: 'pass', message: 'No placeholder text' });
     }
     return section('example', 'Placeholder text', findings, { weight: 1 });
   }
   ```

   - Read text through `crawlerText` / `spacedText` from `dom.ts`, not `textContent`-style joins, so results match what crawlers see.
   - Severity: `fail` when crawlers or previews get wrong content, `warn` for likely problems, `info` for context that should not cost points. A section's score is 100 minus 35 per fail and 12 per warn, unless you pass `score`.
   - Every finding says what is wrong and how to fix it. If a check is a guess, say so in the message or the section `note`.
   - Put structured results in `data` for `--json` users. Never put whole fetched files or personal data there.
3. **Register it** in `analyzeDocument` in `src/analyze.ts`. If it needs the network, wire it into `analyzeUrl` in `src/analyze-url.ts` instead and test it with `test/server.ts`. Add its id to the `order` list in `analyzeUrl`.
4. **Test it** in `test/<name>.test.ts`: the broken fixture fails, the fixed one passes, and one or two near misses don't trigger. False positives are the main risk.
5. **Document it**: a row in the README "What it checks" table and a line in `CHANGELOG.md` under Unreleased.

## Other extension points

- **Bots**: add to `AI_BOTS` in `src/site/robots.ts` (and `BOT_UAS` in `src/site/files.ts` to probe the user agent).
- **Buyer vocabulary**: add synonym groups to `SYNONYMS` in `src/detectors/query.ts`. Each word may appear in only one group (a test checks this).

## Style

- Biome formats and lints, so run `npm run format`.
- Comments explain why: the gotcha, the decision, the spec link (for example RFC 9309 in `site/robots.ts`).
- Network and parse failures are values (`error` fields), and findings report them as "could not check", never as "missing" or "allowed".
- No em dashes in copy or docs.

## Commits and releases

Use plain, imperative commit messages ("Add placeholder-text detector"). Maintainers handle releases and npm publishing.
