const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const base = process.env.SERVER_URL || 'http://127.0.0.1:3997';
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base)) throw new Error('Use an isolated local server');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await context.request.post(`${base}/staff-login`, { form: { code: '1009' }, maxRedirects: 0 });
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    // Keep the font stylesheet pending while checking that the app stays usable.
    let fontRoute;
    await page.route('https://fonts.googleapis.com/**', route => { fontRoute = route; });
    await page.route('**/socket.io/socket.io.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      window.handlers={}; window.receive=(n,d)=>(handlers[n]||[]).forEach(f=>f(d));
      window.io=()=>({on(n,f){(handlers[n]||=[]).push(f)},emit(){},connect(){setTimeout(()=>receive('connect'),0)}});
    ` }));
    await page.goto(`${base}/host/`, { waitUntil: 'domcontentloaded', timeout: 5000 });
    await page.locator('#qr-placeholder img').waitFor({ timeout: 5000 });
    assert(!requests.some(url => /awards_cheer|rule_explain|_run\.png/.test(url)), 'offscreen images must not block lobby');
    for (const [stage, screen] of [['rules', 'screen-rules'], ['team-select', 'screen-team-select']]) {
      // Presentation names are driven through the real host event handler.
      await page.evaluate(({ stage }) => receive('game:state_sync', {
        state: 'LOBBY', presentation: { stage }, players: []
      }), { stage });
      await page.waitForFunction(screen => document.getElementById(screen).classList.contains('active'), screen);
      await page.waitForFunction(screen => [...document.querySelectorAll(`#${screen} img`)]
        .every(img => img.complete && img.naturalWidth > 0), screen);
    }
    await page.evaluate(() => receive('game:state_sync', { state: 'RACING', players: [] }));
    await page.waitForFunction(() => [...document.querySelectorAll('#screen-racing img, #quiz-overlay img')]
      .every(img => img.complete && img.naturalWidth > 0));
    await page.evaluate(() => receive('game:state_sync', { state: 'MATCH_FINISHED', players: [] }));
    await page.waitForFunction(() => [...document.querySelectorAll('#screen-scoreboard img')]
      .every(img => img.complete && img.naturalWidth > 0));
    await fontRoute?.fulfill({ contentType: 'text/css', body: '' });
    assert.deepEqual(errors, []);
    fs.mkdirSync('reports/page-loading', { recursive: true });
    await page.evaluate(() => receive('game:state_sync', { state: 'LOBBY', presentation: { stage: 'lobby' }, players: [] }));
    await page.screenshot({ path: 'reports/page-loading/lobby.png' });
    console.log('PASS: pending fonts do not block QR; deferred rules, teams, race, quiz and awards images load');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
