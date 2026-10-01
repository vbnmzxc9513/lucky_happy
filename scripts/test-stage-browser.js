const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const config = require('../shared/game-config');
const fixturesOnly = process.argv.includes('--fixturesOnly');
const url = fixturesOnly ? 'http://lucky.test' : process.env.SERVER_URL || 'http://127.0.0.1:3000';

async function checkBounds(page, selector) {
  const issues = await page.locator(selector).evaluate(el => {
    const box = el.getBoundingClientRect();
    const issues = [];
    if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) issues.push('summary outside viewport');
    for (const node of el.querySelectorAll('h2, h3, .stage-stars, .stage-score, .stage-reward, .stage-next, .stage-next-label, .stage-next-countdown, .stage-next-seconds, img')) {
      const rect = node.getBoundingClientRect();
      if (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) issues.push(node.className || node.tagName);
      if (node.tagName === 'IMG' && (!node.complete || !node.naturalWidth)) issues.push('broken image');
    }
    if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) issues.push('scrolling');
    return issues;
  });
  assert.deepEqual(issues, []);
}

async function main() {
  fs.mkdirSync('reports/stages', { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL } : {}) });
  try {
    const context = await browser.newContext();
    if (fixturesOnly) {
      await context.route('**/*', route => {
        const resource = new URL(route.request().url());
        if (resource.hostname !== 'lucky.test') return route.abort();
        if (resource.pathname === '/socket.io/socket.io.js') return route.fulfill({contentType: 'text/javascript', body: 'window.io=()=>({on(){},emit(){},connect(){}})'});
        if (resource.pathname === '/api/join-info') return route.fulfill({contentType: 'application/json', body: '{}'});
        const name = resource.pathname.endsWith('/') ? resource.pathname + 'index.html' : resource.pathname;
        const file = path.resolve('.' + (name.startsWith('/assets/') ? '/host' + name : name));
        if (!file.startsWith(process.cwd() + path.sep) || !fs.existsSync(file)) return route.fulfill({status:404,body:''});
        return route.fulfill({contentType: {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'}[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
      });
    } else {
    const login = await context.request.post(`${url}/staff-login`, {
      form: { code: process.env.STAFF_ACCESS_CODE || '1009', next: '/host/' }, maxRedirects: 0
    });
    assert.equal(login.status(), 302);
    }
    const pages = [];
    const errors = [];
    if (!process.argv.includes('--fixturesOnly')) {
    for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1134, height: 855 }]) {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize(size);
      await page.goto(`${url}/host/`, { waitUntil: 'domcontentloaded' });
      pages.push(page);
    }
    await pages[0].locator('.stage-summary:not([hidden])').waitFor({ timeout: 75000 });
    // Capture a complete reveal after the star and reward animations have played.
    await pages[0].waitForTimeout(5700);
    for (const page of pages) {
      await checkBounds(page, '.stage-host');
      await page.screenshot({ path: `reports/stages/live-host-${page.viewportSize().width}.png` });
    }
    assert.deepEqual(errors, []);
    console.log('PASS live host summary, all five images, no clipping or scrolling at three desktop sizes');
    }

    const hostFixture = await context.newPage();
    await hostFixture.setViewportSize({ width: 1280, height: 720 });
    await hostFixture.goto(`${url}/host/`, { waitUntil: 'domcontentloaded' });
    await hostFixture.evaluate(config => {
      const display = new window.StageDisplay('host');
      display.summary.id = 'fixture-summary';
      const teamResults = Object.fromEntries(config.TEAMS.map((team, index) => {
        const count = Math.min(index, 4);
        return [team.id, { answers: [0, 1, 2, 3].map(i => i < count), correctCount: count, steps: [0, 1, 2, 4, 6][count], position: 10 + [0, 1, 2, 4, 6][count] * 1500 }];
      }));
      display.sync({ config, serverNow: Date.now(), quizStage: {
        stageNumber: 4, stageCount: 4, questionNumber: 4, phase: 'summary', endsAt: Date.now() + 8000,
        summary: { teamResults }
      } });
      // The fixture's rendering is isolated from incoming lobby snapshots.
      document.body.classList.add('stage-summary-active');
    }, config);
    assert.equal(await hostFixture.locator('#fixture-summary .stage-stars span').count(), 20);
    assert.equal(await hostFixture.locator('#fixture-summary .stage-reward-steps i').count(), 30);
    assert.equal(await hostFixture.locator('#fixture-summary .stage-reward-steps .is-earned').count(), 13);
    assert.deepEqual(await hostFixture.locator('#fixture-summary .stage-reward').allTextContents(), [0,1,2,4,6].map(n => `前進 ${n} 格`));
    const startX = await hostFixture.locator('#fixture-summary img').last().evaluate(el => el.getBoundingClientRect().x);
    await hostFixture.waitForTimeout(3200);
    await hostFixture.screenshot({ path: 'reports/stages/host-celebration-1280.png' });
    await hostFixture.waitForTimeout(3900);
    await hostFixture.evaluate(() => document.body.classList.add('stage-summary-active'));
    const endX = await hostFixture.locator('#fixture-summary img').last().evaluate(el => el.getBoundingClientRect().x);
    assert.ok(endX > startX + 18, 'reward horse visibly moves');
    await checkBounds(hostFixture, '#fixture-summary');
    assert.deepEqual(await hostFixture.locator('#fixture-summary .stage-cheer').allTextContents(), [10, 1510, 3010, 6010, 9010].map(n => `權威距離 ${n}`));
    const footerVisible = await hostFixture.locator('#fixture-summary .stage-next').evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    assert.equal(footerVisible, true, 'sound button must not cover next-stage countdown');
    await hostFixture.screenshot({ path: 'reports/stages/host-rewards-1280.png' });
    await hostFixture.setViewportSize({ width: 1134, height: 855 });
    await hostFixture.waitForTimeout(100);
    await hostFixture.evaluate(() => document.body.classList.add('stage-summary-active'));
    await checkBounds(hostFixture, '#fixture-summary');
    assert.equal(await hostFixture.locator('#app-container').evaluate(el => getComputedStyle(el, '::after').backgroundColor), 'rgb(161, 215, 207)');
    await hostFixture.screenshot({ path: 'reports/stages/host-rewards-1134.png' });
    await hostFixture.setViewportSize({ width: 1920, height: 1080 });
    await checkBounds(hostFixture, '#fixture-summary');
    await hostFixture.screenshot({path:'reports/stages/host-rewards-1920.png'});
    for (const correctCount of [4, 0]) {
      await hostFixture.evaluate(({ config, correctCount }) => {
        document.getElementById('fixture-summary').remove();
        const display = new window.StageDisplay('host');
        display.summary.id = 'fixture-summary';
        display.sync({ config, serverNow: Date.now(), quizStage: {
          stageNumber: 4, stageCount: 4, questionNumber: 4, phase: 'summary', endsAt: Date.now() + 1000,
          summary: { teamResults: Object.fromEntries(config.TEAMS.map(t => [t.id, {
            answers: [0, 1, 2, 3].map(i => i < correctCount), correctCount, steps: correctCount ? 6 : 0
          }])) }
        } });
        document.body.classList.add('stage-summary-active');
      }, { config, correctCount });
      await hostFixture.waitForTimeout(150);
      await checkBounds(hostFixture, '#fixture-summary');
      assert.equal(await hostFixture.locator('#fixture-summary .stage-perfect-seal').count(), correctCount ? 5 : 0);
      await hostFixture.screenshot({ path: `reports/stages/host-all-${correctCount}-1920.png` });
    }
    await hostFixture.close();
    console.log('PASS all reward tiers, moving horses, and unobstructed final-sprint countdown');

    // Isolated mobile presentation fixture does not add players to the live stress match.
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const page = await context.newPage();
      await page.setViewportSize(size);
      await page.setContent(`<html><head><base href="${url}/"><style>body{margin:0}#mobile-app{height:100vh}</style><link rel="stylesheet" href="/shared/stage-display.css"></head><body><div id="mobile-app"></div></body></html>`);
      await page.addScriptTag({ path: path.resolve('shared/stage-display.js') });
      await page.evaluate(config => {
        window.display = new window.StageDisplay('guest');
        window.fixture = { serverNow: Date.now(), config, quizStage: {
          stageNumber: 1, stageCount: 4, questionNumber: 4, phase: 'summary', endsAt: Date.now() + 8000,
          summary: { teamResults: { red: { answers: [true, true, true, true], correctCount: 4, steps: 6, position: 9010 } } }
        } };
        window.display.sync(window.fixture, 'red');
      }, config);
      await page.waitForTimeout(7200);
      await checkBounds(page, '.stage-guest');
      await page.screenshot({ path: `reports/stages/mobile-${size.width}.png` });
      await page.evaluate(() => {
        window.display.sync({ ...window.fixture, quizStage: null }, 'red');
        window.fixture.quizStage.summary.teamResults.red = { answers: [false, false, false, false], correctCount: 0, steps: 0 };
        window.fixture.serverNow = Date.now();
        window.fixture.quizStage.endsAt = Date.now() + 1000;
        window.display.sync(window.fixture, 'red');
      });
      await page.waitForTimeout(100);
      await checkBounds(page, '.stage-guest');
      assert.equal(await page.locator('.stage-perfect-seal').count(), 0);
      assert.equal(await page.locator('.stage-guest h2').textContent(), '本關成績揭曉');
      await page.waitForFunction(() => document.querySelector('.stage-guest h2').textContent === '下一關，逆轉吧！', { timeout: 5000 });
      assert.equal(await page.locator('.stage-guest h2').textContent(), '下一關，逆轉吧！');
      await page.evaluate(() => window.display.sync({ serverNow: Date.now(), config: window.fixture.config, quizStage: null }, 'red'));
      assert.equal(await page.locator('.stage-summary').isHidden(), true);
      await page.close();
    }
    console.log('PASS mobile full-correct summary at 390px and 320px; reset hides settlement');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
