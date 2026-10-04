# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The overall score is 0 when the page itself fails (network error, HTTP 4xx/5xx, or an empty 200), so an error page can no longer pass `--fail-under`.
- robots.txt groups are matched by whole product token (RFC 9309 section 2.2.1): a group for `Applebot` no longer applies to `Applebot-Extended`, and `GPTBot/1.1` matches `GPTBot`.

### Fixed

- Glued-word detection no longer flags Chinese, Japanese, Thai and other scripts written without spaces, or `<sup>`/`<sub>` footnote markers and ordinals.
- Zero-state counters: a spaced zero in running text (`$0 + VAT`, `0 B used`) is no longer a strong match, and with `--render`, weak matches that still read zero after rendering are dropped.
- robots.txt: `Crawl-delay` and `Sitemap` lines no longer split a user-agent group; non-ASCII rules are percent-encoded before matching; a rule with many wildcards can no longer hang the run (the regex matcher was replaced with a linear one).
- A 5xx or 429 on `llms.txt`, `llms-full.txt`, the sitemap or the IndexNow key file is reported as "could not fetch", not as missing.
- An empty 200 body is reported as `fetch.empty` instead of a pass.
- A canonical or `og:image` that only timed out is reported as unverified instead of broken.
- A malformed redirect `Location` header is reported as a fetch error instead of throwing.
- `--query` keeps accented and non-Latin words whole.
- The web UI and CLI help no longer suggest `npx crawlsee` before the package is published.

## [0.1.0] - 2026-10-05

### Added

- `crawlsee <url>` CLI: fetches the page the way a non-rendering crawler does, follows and reports redirects, and scores what crawlers and AI answer engines can read.
- Detectors: meta and link previews (canonical and `og:image` resolution checked live), headings as crawler text with glued-word detection, zero-state counters and split stats, text hidden at load, JSON-LD validity and types, JavaScript weight.
- Site checks: robots.txt verdicts for 11 search, answer-engine and training bots (RFC 9309 matching, 5xx treated as disallow-all), user-agent probes, llms.txt and llms-full.txt, sitemap, IndexNow key file, soft-404 detection.
- `--render`: headless Chromium diff of raw vs rendered text, with counter confirmation (optional Playwright peer dependency).
- `--query`: heuristic buyer-vocabulary check with synonyms, seller-speak detection and suggestions. No API calls.
- `--json` output, `--fail-under` for CI, `--html` for offline files.
- Paste-HTML web UI in `web/` that runs the markup checks in the browser.
- Library entry points: `crawlsee` (`analyzeHtml`, `analyzeDocument`) and `crawlsee/url` (`analyzeUrl`).

[Unreleased]: https://github.com/agnij-dutta/crawlsee/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/agnij-dutta/crawlsee/releases/tag/v0.1.0
