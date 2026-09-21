const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Read-only browser audit: staff authentication does not start or reset a match.
(async () => {
  const base = process.env.SERVER_URL || 'http://127.0.0.1:3000';
  const out = path.resolve(process.env.LOAD_REPORT || 'reports/page-load.json');
  const browser = await chromium.launch({ headless: true,
    args: JSON.parse(process.env.BROWSER_DIAGNOSTIC_ARGS || '[]'),
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const report = { base, diagnosticArgs: JSON.parse(process.env.BROWSER_DIAGNOSTIC_ARGS || '[]'),
    measuredAt: new Date().toISOString(), pages: [] };
  try {
    for (const pathname of ['/manage', '/host/']) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      try {
        const login = await context.request.post(`${base}/staff-login`, {
          form: { code: process.env.STAFF_ACCESS_CODE || '1009', next: pathname }, maxRedirects: 0
        });
        if (login.status() !== 302) throw new Error(`Login failed: ${login.status()}`);
        const page = await context.newPage();
        for (const cache of ['cold', 'warm']) {
          const errors = [], failed = [];
          const pending = new Set();
          const onRequest = request => pending.add(request.url());
          const onFinished = request => pending.delete(request.url());
          const onError = error => errors.push(error.message);
          const onFailure = request => failed.push({ url: request.url(), error: request.failure()?.errorText });
          page.on('pageerror', onError);
          page.on('requestfailed', onFailure);
          page.on('request', onRequest);
          page.on('requestfinished', onFinished);
          try {
            await page.goto(`${base}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          } catch (error) {
            const entry = { pathname, cache, error: error.message, pending: [...pending], failed };
            report.pages.push(entry);
            console.log(JSON.stringify(entry));
            throw error;
          }
          if (pathname === '/host/') await page.locator('#qr-placeholder img').waitFor({ state: 'attached', timeout: 15000 });
          await page.waitForTimeout(3000);
          const metrics = await page.evaluate(() => ({
            navigation: performance.getEntriesByType('navigation')[0].toJSON(),
            paints: performance.getEntriesByType('paint').map(p => p.toJSON()),
            resources: performance.getEntriesByType('resource').map(r => r.toJSON()),
            fonts: document.fonts.status,
            qrReady: !!document.querySelector('#qr-placeholder img')
          }));
          report.pages.push({ pathname, cache, errors, failed, ...metrics });
          console.log(JSON.stringify({ pathname, cache, ttfb: Math.round(metrics.navigation.responseStart),
            domReady: Math.round(metrics.navigation.domContentLoadedEventEnd),
            load: Math.round(metrics.navigation.loadEventEnd), paints: metrics.paints,
            transferBytes: metrics.resources.reduce((sum, r) => sum + r.transferSize, 0),
            requests: metrics.resources.length, errors, failed }));
          page.off('pageerror', onError);
          page.off('requestfailed', onFailure);
          page.off('request', onRequest);
          page.off('requestfinished', onFinished);
        }
      } finally { await context.close(); }
    }
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
