# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub private vulnerability reporting:
open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue.

You can expect an acknowledgement within a few days. Please include the crawlsee version, the command you ran and what happened.

## Scope

crawlsee fetches URLs you give it, plus files on the same origin (robots.txt, llms.txt, sitemap, scripts), and with `--render` loads the page in headless Chromium. In scope:

- Code execution or file access triggered by a page crawlsee analyzes.
- Script injection in the paste-HTML web UI (`web/`): all page-derived text is escaped before rendering.
- crawlsee sending data anywhere other than the site being checked.

## Non-goals

- crawlsee does not sandbox `--render` beyond what Playwright's Chromium provides. Only render sites you are willing to load in a browser.
- It follows redirects and fetches script URLs found in the page, which may point to other hosts, including private network addresses. Do not run it on untrusted input from a server that can reach internal services.
- Reports may contain text from the analyzed page. Treat `--json` output like the page itself.
