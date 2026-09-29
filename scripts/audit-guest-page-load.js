const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.SERVER_URL || 'https://luckyhappy1009.com';
const reportPath = path.resolve(process.env.REPORT_PATH || `reports/guest-page-load-${Date.now()}.json`);
const executablePath = process.env.CHROME_PATH || undefined;
const enforceBudget = process.env.ENFORCE_BUDGET === '1';
const maxInitialTransferBytes = Number(process.env.MAX_INITIAL_TRANSFER_BYTES || 600000);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.route(/\/socket\.io\/\?/, route => route.abort());
    const page = await context.newPage();
    const responses = new Map();
    const failures = [];
    page.on('requestfailed', request => {
      if (!request.url().includes('/socket.io/?')) failures.push({ url: request.url(), error: request.failure()?.errorText });
    });
    page.on('response', async response => {
      const request = response.request();
      try {
        const headers = await response.allHeaders();
        responses.set(request.url(), { status: response.status(), resourceType: request.resourceType(),
          cacheControl: headers['cache-control'] || null, contentEncoding: headers['content-encoding'] || null,
          contentType: headers['content-type'] || null });
      } catch (error) {
        failures.push({ url: request.url(), error: error.message });
      }
    });
    const navigationStarted = Date.now();
    await page.goto(`${base}/guest/`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate(() => document.fonts?.ready);
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => ({
      name: entry.name, initiatorType: entry.initiatorType, durationMs: entry.duration,
      dnsMs: entry.domainLookupEnd - entry.domainLookupStart,
      connectMs: entry.connectEnd - entry.connectStart,
      tlsMs: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0,
      ttfbMs: entry.responseStart - entry.requestStart,
      downloadMs: entry.responseEnd - entry.responseStart,
      transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize
    })));
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return entry && { durationMs: entry.duration, dnsMs: entry.domainLookupEnd - entry.domainLookupStart,
        connectMs: entry.connectEnd - entry.connectStart,
        tlsMs: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0,
        ttfbMs: entry.responseStart - entry.requestStart,
        domContentLoadedMs: entry.domContentLoadedEventEnd,
        loadMs: entry.loadEventEnd, transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize };
    });
    const enriched = resources.map(resource => ({ ...resource, ...(responses.get(resource.name) || {}) }));
    const report = { generatedAt: new Date().toISOString(), base, wallTimeMs: Date.now() - navigationStarted,
      navigation, failures, requests: enriched.length,
      transferBytes: (navigation?.transferSize || 0) + enriched.reduce((sum, item) => sum + item.transferSize, 0),
      encodedBodyBytes: (navigation?.encodedBodySize || 0) + enriched.reduce((sum, item) => sum + item.encodedBodySize, 0),
      decodedBodyBytes: (navigation?.decodedBodySize || 0) + enriched.reduce((sum, item) => sum + item.decodedBodySize, 0),
      thirdParty: enriched.filter(item => new URL(item.name).origin !== new URL(base).origin),
      largestDecoded: [...enriched].sort((a, b) => b.decodedBodySize - a.decodedBodySize).slice(0, 15),
      resources: enriched };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ navigation: report.navigation, wallTimeMs: report.wallTimeMs,
      requests: report.requests, transferBytes: report.transferBytes,
      decodedBodyBytes: report.decodedBodyBytes, thirdPartyRequests: report.thirdParty.length,
      failures: report.failures, largestDecoded: report.largestDecoded.slice(0, 8) }, null, 2));
    if (enforceBudget) {
      const eagerTeamImages = enriched.filter(item => /\/heipi_[^/]+_nobg\.(?:png|webp)(?:\?|$)/i.test(item.name));
      const violations = [];
      if (report.failures.length) violations.push(`${report.failures.length} resource request(s) failed`);
      if (report.transferBytes > maxInitialTransferBytes) {
        violations.push(`initial transfer ${report.transferBytes} exceeds ${maxInitialTransferBytes} bytes`);
      }
      if (eagerTeamImages.length) {
        violations.push(`team images loaded before team selection: ${eagerTeamImages.map(item => item.name).join(', ')}`);
      }
      if (violations.length) throw new Error(`Guest initial-load budget failed: ${violations.join('; ')}`);
      console.log(`PASS guest initial-load budget: ${report.transferBytes} bytes, zero eager team images`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
