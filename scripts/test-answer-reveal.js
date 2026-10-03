const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const GameManager = require('../server/game/GameManager');

(async () => {
  const game = new GameManager({ emit() {} });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL } : {}) });
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
        window.handlers={}; window.version=0;
        window.receive=(n,d)=>{ if(n==='game:state_sync') d={runId:'browser-run',stateVersion:++version,...d};
          (handlers[n]||[]).forEach(f=>f(d)); };
        window.io=()=>({on(n,f){(handlers[n]||=[]).push(f)},emit(){},connect(){}});
      ` });
      if (url.pathname === '/api/join-info') return route.fulfill({ contentType: 'application/json', body: '{}' });
      const name = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
      const local = path.resolve('.' + (name.startsWith('/assets/') ? '/host' + name : name));
      if (!local.startsWith(process.cwd() + path.sep) || !fs.existsSync(local)) return route.fulfill({ status: 404, body: '' });
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(local)];
      return route.fulfill({ contentType: type || 'application/octet-stream', body: fs.readFileSync(local) });
    });
    fs.mkdirSync('reports/answer-reveal', { recursive: true });
    for (const [width, height] of [[1280, 720], [1920, 1080], [1366, 768], [1134, 855]]) {
      await page.setViewportSize({ width, height });
      await page.goto('http://lucky.test/host/', { waitUntil: 'load' });
      const now = Date.now();
      await page.evaluate(({config, now}) => receive('game:state_sync', {
        state: 'RACING', config, paused: true, pausedAt: now, serverNow: now,
        quizStage: { phase: 'tap', stageNumber: 1, stageCount: 4, endsAt: now + 3000 }
      }), {config: game.config, now});
      assert.equal(await page.locator('.stage-clock-host').innerText(), '3');
      assert.equal(await page.locator('.stage-clock-host.is-urgent').count(), 1);
      await page.waitForTimeout(1100);
      assert.equal(await page.locator('.stage-clock-host').innerText(), '3');
      await page.evaluate(({config, map, teams}) => {
        const now=Date.now();
        receive('game:state_sync', {
          state:'RACING',config,currentMap:map,teams,activeItems:{},paused:false,serverNow:now,
          quizStage:{phase:'tap',stageNumber:1,stageCount:4,endsAt:now+3000}
        });
      }, {config:game.config,map:game.mapManager.getCurrentMap(),teams:game.getGameState().teams});
      assert.equal(await page.locator('.stage-clock-host').evaluate(el=>getComputedStyle(el).animationName), 'stage-entry');
      await page.waitForTimeout(650);
      assert.equal(await page.locator('.stage-clock-host').evaluate(el => {
        const r = el.getBoundingClientRect(), css = getComputedStyle(el);
        return /^\d+$/.test(el.textContent) && css.backgroundColor === 'rgba(0, 0, 0, 0)'
          && Number(css.opacity) <= .4 && css.borderTopWidth === '0px' && css.pointerEvents === 'none'
          && Math.abs(r.x + r.width / 2 - innerWidth / 2) < 1 && Math.abs(r.y + r.height / 2 - innerHeight / 2) < 1
          && r.width < innerWidth * .15;
      }), true, 'tap shows only a translucent centered digit without covering the race');
      await page.screenshot({path: `reports/answer-reveal/tap-entry-${width}.png`});
      await page.evaluate(() => receive('game:state_sync', {state:'RACING',paused:false,serverNow:Date.now(),
        quizStage:{phase:'tap',stageNumber:1,stageCount:4,endsAt:Date.now()+8000}}));
      await page.screenshot({path: `reports/answer-reveal/tap-${width}.png`});
      let lastResult;
      for (const cp of game.mapManager.getCurrentMap().checkpoints) {
        game.quizManager.startQuiz(cp.quizId, Object.fromEntries(game.config.TEAMS.map(t => [t.id, 50])));
        const quiz = game.quizManager.currentQuiz;
        const wrong = Object.keys(quiz.optionMap).find(key => key !== quiz.correctAnswer);
        for (const [index, team] of game.config.TEAMS.entries()) {
          const count = [0, 25, 26, 50, 0][index];
          for (let i = 0; i < [40, 40, 40, 50, 0][index]; i++) game.quizManager.handleAnswer(`${team.id}-${i}`, team.id, quiz.id,
            i < count ? quiz.correctAnswer : wrong);
        }
        const progress = game.quizManager.getProgressSnapshot();
        await page.evaluate(({quiz,config})=>{
          const now=Date.now();receive('game:state_sync',{state:'QUIZ',config,paused:false,serverNow:now,
            quizStage:{phase:'reading',stageNumber:1,stageCount:4,questionNumber:1,endsAt:now+3000}});
          receive('game:quiz_start',{quizId:quiz.id,question:quiz.question,options:quiz.optionMap,phase:'reading',serverNow:now,endsAt:now+3000});
        },{quiz,config:game.config});
        assert.equal(await page.locator('.quiz-option-card-v2').count(),4);
        assert.equal(await page.locator('#quiz-countdown-circle small').count(),0,'single countdown phase label');
        assert.equal(await page.locator('#quiz-countdown-circle').evaluate(el=>getComputedStyle(el,'::after').position),'static','phase label participates in layout instead of overlapping');
        assert.equal(await page.locator('#quiz-countdown-circle').getAttribute('data-phase'),'閱讀');
        assert.equal(await page.locator('.is-correct,.is-wrong').count(),0);
        if(cp===game.mapManager.getCurrentMap().checkpoints[0]) await page.screenshot({path:`reports/answer-reveal/reading-${width}.png`});
        await page.evaluate(({quiz, progress, config}) => {
          const now = Date.now();
          receive('game:state_sync', { state: 'QUIZ', config, serverNow: now, paused: false,
            quizStage: {phase: 'answer', stageNumber: 1, stageCount: 4, questionNumber: 1, endsAt: now + 10000} });
          receive('game:quiz_start', {quizId: quiz.id, question: quiz.question, options: quiz.optionMap,
            timeLimit: 10, endsAt: now + 10000, serverNow: now, progress});
        }, {quiz, progress, config: game.config});
        assert.equal(await page.locator('.quiz-statistics').count(), 0);
        assert.equal(await page.locator('.quiz-team-cell').count(), 5);
        assert.match(await page.locator('#quiz-global-count').innerText(), /已作答 170 \/ 250 人/);
        assert.equal(await page.locator('.is-correct,.team-correct-rate,.statistics-option').count(), 0, 'answer phase exposes only progress');
        const answerIssues = await page.evaluate(() => {
          const issues = [];
          for (const el of document.querySelectorAll('#quiz-question-box,.opt-text,.opt-label,.qt-name,.qt-progress,#quiz-global-count,#quiz-global-rate')) {
            const r = el.getBoundingClientRect();
            if (r.left < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.top < 0
              || el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) issues.push(el.textContent);
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (top && top !== el && !el.contains(top)) issues.push('covered: ' + el.textContent);
          }
          if (document.documentElement.scrollWidth > innerWidth) issues.push('horizontal scrolling');
          return issues;
        });
        if (answerIssues.length) await page.screenshot({path: `reports/answer-reveal/answer-failure-${width}.png`});
        assert.deepEqual(answerIssues, [], `answer ${cp.quizId} at ${width}x${height}`);
        if (cp === game.mapManager.getCurrentMap().checkpoints[0]) await page.screenshot({path: `reports/answer-reveal/answer-${width}.png`});
        // Frequent progress changes preserve the five existing DOM cards.
        assert.equal(await page.evaluate(progress => {
          const card = document.querySelector('.quiz-team-cell');
          document.getElementById('quiz-global-count').textContent = 'await update';
          receive('game:quiz_progress', {progressSnapshot: progress});
          return card === document.querySelector('.quiz-team-cell') && document.getElementById('quiz-global-count').textContent.includes('170 / 250');
        }, progress), true);
        const result = lastResult = game.quizManager.calculateResults();
        await page.evaluate(({ result, config }) => receive('game:state_sync', {
          state: 'QUIZ', config, serverNow: Date.now(), quizStage: { phase: 'reveal', stageNumber: 4,
            stageCount: 4, questionNumber: 4, endsAt: null, reveal: result }
        }), { result, config: game.config });
        await page.waitForTimeout(1300);
        const issues = await page.evaluate(() => {
          const panel = document.querySelector('.quiz-statistics');
          const issues = [];
          for (const el of panel.querySelectorAll('h2,h3,p,strong,b,small,footer,.statistics-option-text')) {
            const r = el.getBoundingClientRect();
            if (r.left < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.top < 0
              || el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) issues.push({text: el.textContent, rect: r.toJSON(), scroll: [el.scrollWidth,el.scrollHeight], client:[el.clientWidth,el.clientHeight]});
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (top && top !== el && !el.contains(top)) issues.push('covered: ' + el.textContent);
          }
          if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) issues.push('scrolling');
          return issues;
        });
        if (issues.length) await page.screenshot({ path: `reports/answer-reveal/failure-${width}.png` });
        assert.deepEqual(issues, [], `${cp.quizId} at ${width}x${height}`);
        assert.equal(await page.locator('.statistics-option').count(), Object.keys(result.options).length);
        assert.equal(await page.locator('.statistics-team').count(), 5);
        assert.equal(await page.locator('.statistics-team.is-correct').count(), 2);
        assert.deepEqual(await page.locator('.team-correct-rate').allTextContents(), ['答對率 0.0%', '答對率 50.0%', '答對率 52.0%', '答對率 100.0%', '答對率 0.0%']);
        assert.equal(await page.locator('.team-threshold').count(), 5);
        assert.equal(await page.locator('.team-answer-stack .correct').count(), 5);
        assert.equal(await page.locator('.team-answer-stack .wrong').count(), 5);
        assert.equal(await page.locator('.team-answer-stack .unanswered').count(), 5);
        assert.match(await page.locator('.statistics-team').nth(1).innerText(), /未超過 50%/);
        assert.match(await page.locator('.statistics-team').nth(2).innerText(), /整隊答對/);
        assert.equal(await page.evaluate(result => {
          const panel = document.querySelector('.quiz-statistics');
          receive('game:quiz_result', {...result, runId: undefined});
          return panel === document.querySelector('.quiz-statistics');
        }, result), true, 'duplicate event must not replay reveal');
      }
      await page.screenshot({ path: `reports/answer-reveal/statistics-${width}.png` });
      const result = lastResult;
      await page.reload();
      await page.evaluate(({result,config}) => receive('game:state_sync', {state:'QUIZ',config,serverNow:Date.now(),
        quizStage:{phase:'reveal',stageNumber:4,stageCount:4,questionNumber:4,reveal:result}}), {result,config:game.config});
      assert.equal(await page.locator('.quiz-statistics.animate-reveal').count(), 0, 'refresh directly renders completed reveal');
      assert.equal(await page.locator('.statistics-team').count(), 5);

      await page.waitForTimeout(200);
      assert.equal(await page.locator('.quiz-statistics').count(), 1, 'fourth question result persists');
    }
    game.quizManager.startQuiz(game.mapManager.getCurrentMap().checkpoints[0].quizId, {});
    const empty = game.quizManager.calculateResults();
    await page.evaluate(({result, config}) => receive('game:state_sync', {state:'QUIZ',config,serverNow:Date.now(),
      quizStage:{phase:'reveal',stageNumber:1,stageCount:4,questionNumber:1,reveal:result}}), {result:empty,config:game.config});
    assert.equal(await page.locator('.statistics-team.is-correct').count(), 0);
    assert.equal(await page.locator('.statistics-option').count(), 4);
    assert.equal(await page.locator('.statistics-team').count(), 5);
    assert.doesNotMatch(await page.locator('.quiz-statistics').innerText(), /NaN|Infinity|undefined/);
    await page.setViewportSize({width:1280,height:720});
    await page.emulateMedia({reducedMotion:'reduce'});
    const longConfig = {...game.config, TEAMS:game.config.TEAMS.map(t => ({...t,name:'永遠幸福快樂相親相愛親友應援隊'}))};
    await page.evaluate(({config, result}) => {
      receive('game:state_sync', {state:'QUIZ',config,serverNow:Date.now(),
        quizStage:{phase:'answer',stageNumber:1,stageCount:4,questionNumber:1,endsAt:Date.now()+10000}});
      receive('game:quiz_start',{quizId:result.quizId,question:'今天來參加婚禮的親朋好友們，最想一起送給新人什麼樣的祝福呢？'.repeat(3),
        options:{A:'永遠幸福快樂相親相愛一起牽手到老'.repeat(3),B:'珍惜每一個一起度過的美好時光'.repeat(3),C:'一起旅行探索更多美麗的新地方'.repeat(3),D:'每一天都充滿歡笑與溫暖的祝福'.repeat(3)},
        endsAt:Date.now()+10000,serverNow:Date.now(),progress:{quizId:result.quizId,teams:[],totalCount:0,answeredCount:0,unansweredCount:0,responseRate:0}});
    }, {config:longConfig,result:empty});
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#quiz-question-box,.opt-text,.qt-name')].filter(el => {
      const r=el.getBoundingClientRect();
      return r.bottom > innerHeight || r.right > innerWidth || el.scrollHeight > el.clientHeight+1 || el.scrollWidth > el.clientWidth+1;
    }).map(el=>el.textContent)), [], 'long question, options and team names fit');
    assert.deepEqual(await page.locator('.quiz-option-card-v2 .opt-text').evaluateAll(els=>els.filter(el=>{
      const text=el.getBoundingClientRect(),card=el.closest('.quiz-option-card-v2').getBoundingClientRect();
      return text.top<card.top || text.bottom>card.bottom || text.left<card.left || text.right>card.right;
    }).map(el=>el.textContent)), [], 'long option text stays inside its own card');
    assert.deepEqual(await page.locator('.qt-bar-fill').evaluateAll(els=>els.map(el=>el.style.width)), ['0%','0%','0%','0%','0%']);
    await page.screenshot({path:'reports/answer-reveal/long-content-1280.png'});
    await page.evaluate(({config,result}) => receive('game:state_sync',{state:'QUIZ',config,serverNow:Date.now(),
      quizStage:{phase:'reveal',stageNumber:1,stageCount:4,questionNumber:1,reveal:result}}), {config:longConfig,result:empty});
    assert.equal(await page.locator('.statistics-bar i').first().evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.statistics-team h3')].filter(el =>
      el.scrollHeight > el.clientHeight+1 || el.scrollWidth > el.clientWidth+1).map(el=>el.textContent)), []);
    assert.deepEqual(errors, []);
    console.log('PASS all 16 formal answer and result screens at 1280x720, 1920x1080, 1366x768 and 1134x855; tap countdown, progress privacy, threshold results and stable DOM');
  } finally { game.resetGame(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
