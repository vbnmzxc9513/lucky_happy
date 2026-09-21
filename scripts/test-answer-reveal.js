const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const config = require('../shared/game-config');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  try {
    const context = await browser.newContext();
    const base = 'http://127.0.0.1:3997';
    await context.request.post(`${base}/staff-login`, { form: { code: '1009' }, maxRedirects: 0 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/socket.io/socket.io.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      window.handlers={}; window.receive=(n,d)=>(handlers[n]||[]).forEach(f=>f(d));
      window.io=()=>({on(n,f){(handlers[n]||=[]).push(f)},emit(){},connect(){}});
    ` }));
    const result = { correctAnswer: 'A', correctAnswerText: '日本京都與奈良', teamResults: {} };
    for (const [index, team] of config.TEAMS.entries()) {
      const correctCount = [50, 0, 20, 15, 0][index];
      const wrongCount = [0, 40, 20, 30, 0][index];
      result.teamResults[team.id] = { correctCount, wrongCount, unansweredCount: 50 - correctCount - wrongCount,
        answeredCount: correctCount + wrongCount, totalCount: 50, voteCounts: { A: correctCount, B: wrongCount },
        isCorrect: correctCount > wrongCount, hasTie: index === 2, noAnswer: index === 4,
        teamAnswer: index === 2 || index === 4 ? null : index === 0 ? 'A' : 'B', effect: 'stage_pending' };
    }
    fs.mkdirSync('reports/answer-reveal', { recursive: true });
    for (const [width, height] of [[1920, 1080], [1280, 720], [1134, 855]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/host/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(({ result, config }) => receive('game:state_sync', {
        state: 'QUIZ', config, serverNow: Date.now(), quizStage: { phase: 'reveal', stageNumber: 1,
          stageCount: 6, questionNumber: 1, endsAt: Date.now() + 6000, reveal: result }
      }), { result, config });
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 4000))]));
      await page.waitForTimeout(800);
      const stats = await page.evaluate(() => [...document.querySelectorAll('.quiz-res-card')].map(card => ({
        values: [...card.querySelectorAll('dd')].map(el => parseInt(el.textContent)),
        clipped: [...card.querySelectorAll('h4,dt,dd,.rate-val,.team-verdict,.effect-badge')].filter(el => {
          const r = el.getBoundingClientRect();
          return r.left < 0 || r.right > innerWidth || r.bottom > innerHeight || r.top < 0 || el.scrollWidth > el.clientWidth + 1;
        }).map(el => ({ text: el.textContent, width: el.clientWidth, scroll: el.scrollWidth }))
      })));
      assert.deepEqual(stats.map(s => s.values), [[50,0,0],[0,40,10],[20,20,10],[15,30,5],[0,0,50]]);
      await page.screenshot({ path: `reports/answer-reveal/${width}.png` });
      assert(stats.every(s => !s.clipped.length), `readable counts at ${width}x${height}: ${JSON.stringify(stats)}`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: five team counts, tie, no-answer and reconnect reveal at three projection sizes');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
