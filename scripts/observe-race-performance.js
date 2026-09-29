const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const base = process.env.SERVER_URL || 'http://127.0.0.1:3998';
  const reportPrefix = process.env.REPORT_PREFIX || 'reports/load190';
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await context.request.post(`${base}/staff-login`, { form: { code: '1009', next: '/host/' }, maxRedirects: 0 });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const qa = window.racePerformance = { frames: [], gaps: [], errors: [], transforms: [], finished: false, racing: false,
        disconnects: 0, maxSilenceMs: 0, ages: [] };
      let factory, lastUpdate, lastFrame, state, offset = -Infinity;
      Object.defineProperty(window, 'io', {
        get() { return factory; },
        set(original) {
          factory = (...args) => {
            const socket = original(...args);
            socket.on('disconnect', () => { qa.disconnects++; });
            socket.on('game:state_sync', s => {
              state = s;
              offset = Math.max(offset, s.serverNow - performance.now());
              if (!qa.racing && s.state === 'RACING') lastUpdate = performance.now();
              qa.racing = s.state === 'RACING' && !s.paused;
              if (!qa.racing) { lastUpdate = null; lastFrame = null; }
              if (s.state === 'MATCH_FINISHED') qa.finished = true;
            });
            socket.on('game:position_update', data => {
              if (!qa.racing) return;
              if (data.runId !== state?.runId || data.stateVersion !== state?.stateVersion) return;
              const now = performance.now();
              offset = Math.max(offset, data.serverNow - now);
              qa.ages.push(Math.max(0, now + offset - data.serverNow));
              if (lastUpdate) qa.gaps.push(now - lastUpdate);
              lastUpdate = now;
            });
            return socket;
          };
        }
      });
      window.addEventListener('error', e => qa.errors.push(e.message));
      function frame(now) {
        if (qa.racing) {
          if (lastUpdate) qa.maxSilenceMs = Math.max(qa.maxSilenceMs, now - lastUpdate);
          if (lastFrame) qa.frames.push(now - lastFrame);
          lastFrame = now;
          if (qa.frames.length % 30 === 0) qa.transforms.push(document.getElementById('horse-red')?.style.transform);
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    await page.goto(`${base}/host/`, { waitUntil: 'domcontentloaded' });
    console.log('Observer ready: 1920x1080 Chromium, real host rendering');
    let captured = false;
    const deadline = Date.now() + Number(process.env.OBSERVE_TIMEOUT_MS || 900000);
    while (Date.now() < deadline) {
      const status = await page.evaluate(() => ({ racing: racePerformance.racing, finished: racePerformance.finished }));
      if (status.racing && !captured) {
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${reportPrefix}-racing.png` });
        captured = true;
      }
      if (status.finished) break;
      await page.waitForTimeout(1000);
    }
    const raw = await page.evaluate(() => window.racePerformance);
    const p95 = values => [...values].sort((a,b) => a-b)[Math.max(0,Math.ceil(values.length*.95)-1)] || 0;
    const report = { finished: raw.finished, frames: raw.frames.length,
      frameP95Ms: p95(raw.frames), framesWithin25msPercent: raw.frames.filter(n => n <= 25).length / raw.frames.length * 100,
      updateP95Ms: p95(raw.gaps),
      updateMaxGapMs: raw.gaps.reduce((max, gap) => Math.max(max, gap), 0),
      updateGapsOver1s: raw.gaps.filter(gap => gap > 1000).length,
      maxSilenceMs: raw.maxSilenceMs, disconnects: raw.disconnects, relativeDataAgeP95Ms: p95(raw.ages),
      distinctPositions: new Set(raw.transforms).size, errors: raw.errors };
    report.renderingPassed = report.finished && report.frames >= 500 && report.framesWithin25msPercent >= 95 && !report.errors.length && report.distinctPositions >= 10;
    // Bursts of delayed packets can hide multi-second stalls behind a low P95.
    report.updateCadencePassed = raw.gaps.length > 0 && report.updateP95Ms <= 100 && report.updateMaxGapMs <= 1000
      && report.maxSilenceMs <= 1000 && report.disconnects === 0;
    report.passed = report.renderingPassed && report.updateCadencePassed;
    fs.writeFileSync(`${reportPrefix}-renderer.json`, JSON.stringify({ ...report, raw }, null, 2));
    console.log(JSON.stringify(report));
    if (!report.passed) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
