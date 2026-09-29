const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const GameManager = require('../server/game/GameManager');

(async () => {
  const game = new GameManager({ emit() {} });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Serve fixtures from disk; never connect to any running game or external service.
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'lucky.test') return route.abort();
      if (url.pathname === '/socket.io/socket.io.js') return route.fulfill({ contentType: 'text/javascript', body: `
        window.handlers={}; window.receive=(n,d)=>(handlers[n]||[]).forEach(f=>f(d));
        window.io=()=>({on(n,f){(handlers[n]||=[]).push(f)},emit(){},connect(){}});
      ` });
      if (url.pathname === '/api/join-info') return route.fulfill({ contentType: 'application/json', body: '{}' });
      const name = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
      const local = path.resolve('.' + name);
      if (!local.startsWith(process.cwd() + path.sep) || !fs.existsSync(local)) return route.fulfill({ status: 404, body: '' });
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(local)];
      return route.fulfill({ contentType: type || 'application/octet-stream', body: fs.readFileSync(local) });
    });
    fs.mkdirSync('reports/answer-reveal', { recursive: true });
    for (const [width, height] of [[1280, 720], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await page.goto('http://lucky.test/host/', { waitUntil: 'load' });
      for (const cp of game.mapManager.getCurrentMap().checkpoints) {
        game.quizManager.startQuiz(cp.quizId, Object.fromEntries(game.config.TEAMS.map(t => [t.id, 50])));
        const quiz = game.quizManager.currentQuiz;
        const wrong = Object.keys(quiz.optionMap).find(key => key !== quiz.correctAnswer);
        for (const [index, team] of game.config.TEAMS.entries()) {
          const count = [50, 25, 26, 0, 10][index];
          for (let i = 0; i < 40; i++) game.quizManager.handleAnswer(`${team.id}-${i}`, team.id, quiz.id,
            i < count ? quiz.correctAnswer : wrong);
        }
        const result = game.quizManager.calculateResults();
        await page.evaluate(({ result, config }) => receive('game:state_sync', {
          state: 'QUIZ', config, serverNow: Date.now(), quizStage: { phase: 'reveal', stageNumber: 5,
            stageCount: 5, questionNumber: 3, endsAt: null, reveal: result }
        }), { result, config: game.config });
        const issues = await page.evaluate(() => {
          const panel = document.querySelector('.quiz-statistics');
          const issues = [];
          for (const el of panel.querySelectorAll('h2,h3,p,strong,b,small,footer,.statistics-option-text')) {
            const r = el.getBoundingClientRect();
            if (r.left < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.top < 0
              || el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) issues.push(el.textContent);
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (top && top !== el && !el.contains(top)) issues.push('covered: ' + el.textContent);
          }
          if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) issues.push('scrolling');
          return issues;
        });
        assert.deepEqual(issues, [], `${cp.quizId} at ${width}x${height}`);
        assert.equal(await page.locator('.statistics-option').count(), Object.keys(result.options).length);
        assert.equal(await page.locator('.statistics-team').count(), 5);
        assert.equal(await page.locator('.statistics-team.is-correct').count(), 2);
      }
      await page.screenshot({ path: `reports/answer-reveal/statistics-${width}.png` });
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.quiz-statistics').count(), 1, 'third question result persists');
    }
    assert.deepEqual(errors, []);
    console.log('PASS all 15 formal result screens: 1280x720 and 1920x1080, no scroll, clipping or covered text');
  } finally { game.resetGame(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
