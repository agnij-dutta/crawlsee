export interface RenderResult {
  html: string;
  jsBytes: number;
  ms: number;
}

/** Playwright or its Chromium is not installed. The message says how to fix it. */
export class RenderUnavailable extends Error {
  override name = 'RenderUnavailable';
}

/**
 * Render with headless Chromium via Playwright (optional peer dependency).
 * Scrolls the page so IntersectionObserver counters fire, then waits for them to settle.
 */
export async function renderPage(url: string, opts: { timeoutMs?: number; settleMs?: number } = {}): Promise<RenderResult> {
  let pw: typeof import('playwright');
  try {
    pw = await import('playwright');
  } catch {
    throw new RenderUnavailable('--render needs Playwright: npm i -g playwright && npx playwright install chromium');
  }
  const started = Date.now();
  let browser: Awaited<ReturnType<typeof pw.chromium.launch>>;
  try {
    browser = await pw.chromium.launch({ headless: true });
  } catch (e) {
    throw new RenderUnavailable(`Could not launch Chromium (${(e as Error).message.split('\n')[0]}). Try: npx playwright install chromium`);
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    let jsBytes = 0;
    page.on('response', async (res) => {
      if (res.request().resourceType() !== 'script') return;
      try {
        jsBytes += (await res.body()).length;
      } catch {
        /* redirects and aborted requests have no body */
      }
    });
    const timeout = opts.timeoutMs ?? 30000;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout });
    } catch {
      // Pages with analytics beacons or websockets never go network-idle; "load" is good enough.
      await page.goto(url, { waitUntil: 'load', timeout });
    }
    await page.evaluate(async () => {
      const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < document.body.scrollHeight && y < 30000; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(opts.settleMs ?? 3000);
    const html = await page.content();
    return { html, jsBytes, ms: Date.now() - started };
  } finally {
    await browser.close();
  }
}
