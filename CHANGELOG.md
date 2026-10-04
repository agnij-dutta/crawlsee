# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
