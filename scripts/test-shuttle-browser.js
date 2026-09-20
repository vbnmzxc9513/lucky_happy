const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.SERVER_URL || 'http://127.0.0.1:3000';
const output = 'reports/shuttle';
async function bounds(frame) {
  const errors = await frame.evaluate(() => {
    const screen = document.querySelector('#screen-racing');
    const b = screen.getBoundingClientRect();
    const issues = [];
    if (b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1) issues.push('screen bounds');
    for (const el of screen.querySelectorAll('.horse-unit, .lane-label, .race-header, .race-ticker, .shuttle-banner')) {
      const r = el.getBoundingClientRect();
      if (r.left < b.left || r.right > b.right + 1 || r.top < b.top || r.bottom > b.bottom + 1) issues.push(el.className);
    }
    for (const img of screen.querySelectorAll('.horse-emoji')) if (!img.complete || !img.naturalWidth) issues.push('image missing');
    for (const horse of screen.querySelectorAll('.horse-unit')) {
      const h = horse.getBoundingClientRect(), l = screen.querySelector('.lane-label').getBoundingClientRect();
      if (h.left < l.right) issues.push('horse overlaps label');
    }
    if (document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth) issues.push('scrolling');
    return issues;
  });
  assert.deepEqual(errors, []);
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 768 }, recordVideo: { dir: `${output}/video`, size: { width: 1280, height: 768 } } });
  const errors = [];
  try {
    await context.request.post(`${url}/staff-login`, { form: { code: process.env.STAFF_ACCESS_CODE || '1009', next: '/host/' } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    let sockets = 0;
    page.on('websocket', () => sockets++);
    await page.goto(`${url}/host/shuttle-preview.html`);
    const handle = await page.waitForSelector('#preview');
    const frame = await handle.contentFrame();
    await frame.waitForFunction(() => !!window.previewState);
    await frame.evaluate(() => window.previewSeek(0));
    await frame.waitForTimeout(1000);
    await bounds(frame);
    const grass = await frame.evaluate(() => [...document.querySelectorAll('.track-lane')].map(el => getComputedStyle(el).backgroundImage));
    assert.ok(grass[0].includes('rgb(197, 201, 75)') && grass[1].includes('rgb(232, 223, 196)'), 'original grass lanes retained');
    await page.screenshot({ path: `${output}/race-1280.png` });
    const frames = await frame.evaluate(() => new Promise(resolve => {
      const start = performance.now(), samples = []; let previous = start;
      function measure(now) { samples.push(now - previous); previous = now;
        if (now - start < 5000) requestAnimationFrame(measure); else resolve(samples.slice(1)); }
      requestAnimationFrame(measure);
    }));
    const sorted = frames.sort((a,b) => a-b);
    const metrics = { frameP95: sorted[Math.floor(sorted.length * .95)], within25ms: frames.filter(n => n <= 25).length / frames.length };
    assert.ok(metrics.within25ms >= .95, JSON.stringify(metrics));
    await frame.evaluate(() => window.previewPause());
    const position = await frame.locator('#horse-red').getAttribute('style');
    await frame.waitForTimeout(500);
    assert.equal(await frame.locator('#horse-red').getAttribute('style'), position, 'pause freezes distance');
    await frame.evaluate(() => window.previewPause());
    await frame.waitForTimeout(200);
    assert.notEqual(await frame.locator('#horse-red').getAttribute('style'), position, 'resume moves');
    for (const size of [{width:1920,height:1128}, {width:1134,height:855}]) {
      await page.setViewportSize(size);
      await frame.evaluate(() => window.previewSeek(2.5));
      await frame.waitForTimeout(200);
      await bounds(frame);
      await page.screenshot({ path: `${output}/race-${size.width}.png` });
    }
    await page.setViewportSize({width:1280,height:768});
    await frame.evaluate(() => window.previewSeek(47));
    await frame.waitForTimeout(6200);
    await page.screenshot({ path: `${output}/reward.png` });
    assert.ok((await frame.locator('.stage-cheer').last().textContent()).includes('圈'));
    await frame.evaluate(() => window.previewSeek(11));
    await frame.waitForTimeout(300);
    await page.screenshot({ path: `${output}/question.png` });
    assert.equal(await frame.locator('#quiz-options-display .quiz-option-card-v2').count(), 4);
    assert.equal(sockets, 0, 'preview has no connection to a real match');
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${output}/browser-metrics.json`, JSON.stringify(metrics, null, 2));
    console.log('PASS preview, images, three desktop sizes, pause/resume, question, reward, no live socket;', metrics);
    await page.close();
  } finally { await context.close(); await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
