const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { io } = require('socket.io-client');

const base = process.env.SERVER_URL || 'http://127.0.0.1:3998';
const reportPath = path.resolve(process.env.REPORT_PATH || `reports/guest-performance-${Date.now()}.json`);
const nickname = 'BrowserFrame';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * p / 100) - 1];
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  let control;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      const qa = window.guestPerformance = {
        frames: [], pressFeedback: [], countFeedback: [], presses: 0,
        raceWindows: 0, statusChanges: [], errors: []
      };
      let racing = false;
      let lastFrame = null;
      let lastPress = null;
      let lastCount = null;
      document.addEventListener('mousedown', event => {
        if (!event.target.closest('#btn-tap')) return;
        qa.presses++;
        lastPress = performance.now();
      }, true);
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.id === 'btn-tap' && lastPress !== null) {
          qa.pressFeedback.push(performance.now() - lastPress);
        }
        return animate.apply(this, args);
      };
      document.addEventListener('DOMContentLoaded', () => {
        const count = document.getElementById('my-tap-count');
        if (count) {
          lastCount = count.textContent;
          new MutationObserver(() => {
            const value = count.textContent;
            if (value === lastCount) return;
            lastCount = value;
            if (lastPress !== null && performance.now() - lastPress < 3000) {
              qa.countFeedback.push(performance.now() - lastPress);
            }
          }).observe(count, { childList: true, characterData: true, subtree: true });
        }
        const status = document.getElementById('network-status');
        if (status) new MutationObserver(() => {
          if (!status.hidden) qa.statusChanges.push(status.textContent);
        }).observe(status, { attributes: true, childList: true, subtree: true });
      });
      window.addEventListener('error', event => qa.errors.push(event.message));
      function frame(now) {
        const active = !!document.querySelector('#screen-racing.active');
        if (active && !racing) qa.raceWindows++;
        if (active && lastFrame !== null) qa.frames.push(now - lastFrame);
        lastFrame = active ? now : null;
        racing = active;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    await page.goto(`${base}/guest/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#input-nickname').fill(nickname);
    await page.locator('#btn-join').click();
    await page.locator('#screen-team-select.active').waitFor();
    await page.locator('.team-choice-card[data-team="red"]').click();
    await page.locator('.team-choice-card[data-team="red"].is-current-team').waitFor();

    const login = await fetch(`${base}/staff-login`, { method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'code=1009&next=/control/' });
    if (login.status !== 302) throw new Error(`staff login returned HTTP ${login.status}`);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('staff session cookie missing');
    control = io(base, { transports: ['websocket'], auth: { role: 'control', protocolVersion: 2 },
      extraHeaders: { Cookie: cookie } });
    await new Promise((resolve, reject) => {
      control.once('connect', resolve);
      control.once('connect_error', reject);
    });
    let finished = false;
    let disconnects = 0;
    control.on('game:match_finished', () => { finished = true; });
    control.on('disconnect', () => { disconnects++; });
    const readyDeadline = Date.now() + 30000;
    while (Date.now() < readyDeadline) {
      const response = await fetch(`${base}/api/test-accounting`, { headers: { Cookie: cookie } });
      if (response.ok && (await response.json()).players.length === 190) break;
      await sleep(500);
    }
    const ready = await (await fetch(`${base}/api/test-accounting`, { headers: { Cookie: cookie } })).json();
    if (ready.players.length !== 190) throw new Error(`expected 190 joined players, got ${ready.players.length}`);
    console.log('Guest observer ready: 190 players, 390x844 Chromium; starting round');
    control.emit('control:start_round');

    let lastWindow = 0;
    let clickedInWindow = 0;
    let racingScreenshot = false;
    let quizScreenshot = false;
    const deadline = Date.now() + 600000;
    while (!finished && Date.now() < deadline) {
      const state = await page.evaluate(() => ({
        raceWindow: window.guestPerformance.raceWindows,
        racing: !!document.querySelector('#screen-racing.active'),
        tapping: !document.getElementById('btn-tap').disabled,
        quiz: !!document.querySelector('#screen-quiz.active')
      }));
      if (state.raceWindow !== lastWindow) {
        lastWindow = state.raceWindow;
        clickedInWindow = 0;
      }
      if (state.racing && state.tapping && clickedInWindow < 5) {
        await page.locator('#btn-tap').click({ force: true, timeout: 5000 });
        clickedInWindow++;
        if (!racingScreenshot) {
          await page.screenshot({ path: reportPath.replace(/\.json$/, '-racing390.png') });
          racingScreenshot = true;
        }
        await sleep(180);
      } else if (state.quiz && !quizScreenshot) {
        await page.screenshot({ path: reportPath.replace(/\.json$/, '-quiz390.png') });
        quizScreenshot = true;
      } else await sleep(100);
    }
    if (!finished) throw new Error('guest observer did not receive match finish');
    const audit = await (await fetch(`${base}/api/test-accounting`, { headers: { Cookie: cookie } })).json();
    const player = audit.players.find(entry => entry.nickname === nickname);
    const displayedAtControlFinish = Number((await page.locator('#my-tap-count').textContent())?.replace(/,/g, '') || 0);
    const settleStartedAt = Date.now();
    let finalCountSettled = false;
    if (player) {
      try {
        await page.waitForFunction(expected => Number(document.getElementById('my-tap-count')?.textContent?.replace(/,/g, '') || 0) === expected,
          player.tapCount, { timeout: 10000 });
        finalCountSettled = true;
      } catch {
        // Keep the raw mismatch in the report if the guest never converges.
      }
    }
    const finalCountSettleMs = Date.now() - settleStartedAt;
    const raw = await page.evaluate(() => window.guestPerformance);
    const displayedTapCount = await page.locator('#my-tap-count').textContent();
    const report = {
      base, finished, viewport: '390x844', raceWindows: raw.raceWindows,
      measuredFrames: raw.frames.length,
      frameP95Ms: percentile(raw.frames, 95),
      frameMaxMs: Math.max(0, ...raw.frames),
      framesWithin25MsPercent: raw.frames.filter(value => value <= 25).length / raw.frames.length * 100,
      presses: raw.presses, measuredPressFeedback: raw.pressFeedback.length,
      pressFeedbackP95Ms: percentile(raw.pressFeedback, 95),
      measuredCountFeedback: raw.countFeedback.length,
      countFeedbackP95Ms: percentile(raw.countFeedback, 95),
      displayedAtControlFinish, finalCountSettled, finalCountSettleMs,
      displayedTapCount: Number(displayedTapCount?.replace(/,/g, '') || 0),
      serverTapCount: player?.tapCount ?? null,
      controlDisconnects: disconnects, statusChanges: raw.statusChanges,
      pageErrors: [...raw.errors, ...pageErrors]
    };
    report.passed = report.raceWindows >= 6 && report.measuredFrames >= 1000
      && report.framesWithin25MsPercent >= 95 && report.presses >= 20
      && report.measuredPressFeedback >= 20 && report.pressFeedbackP95Ms <= 100
      && report.measuredCountFeedback >= 20 && report.countFeedbackP95Ms <= 250
      && report.displayedTapCount === report.serverTapCount
      && report.controlDisconnects === 0 && report.pageErrors.length === 0;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
    if (!report.passed) process.exitCode = 1;
  } finally {
    control?.disconnect();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
