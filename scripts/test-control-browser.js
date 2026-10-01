const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const config = require('../shared/game-config');
const { CLIENT_TO_SERVER: C, SERVER_TO_CLIENT: S } = require('../shared/events');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Reserved HTTP address, intercepted entirely from disk; no running game is contacted.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '192.0.2.1') return route.abort();
      if (url.pathname === '/socket.io/socket.io.js') return route.fulfill({ contentType: 'text/javascript', body: `
        window.handlers={}; window.sent=[];
        window.socket={connected:true,on(n,f){handlers[n]=f},emit(n,d){sent.push({n,d})},connect(){handlers.connect()}};
        window.io=()=>socket;
      ` });
      const name = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
      const file = path.resolve('.' + name);
      if (!file.startsWith(process.cwd() + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)];
      return route.fulfill({ contentType: contentType || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    fs.mkdirSync('reports/control', { recursive: true });
    for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.goto('http://192.0.2.1/control/');
      assert.equal(await page.evaluate(() => isSecureContext), false);
      assert.equal(await page.evaluate(() => typeof crypto.randomUUID), 'undefined');
      const state = { runId: 'lan-browser', state: 'QUIZ', paused: false, config, teams: [],
        quizStage: { phase: 'reveal', questionNumber: 1, stageNumber: 1, stageCount: 4, flowRevision: 3, completedQuestions: 1 } };
      const now = Date.now();
      const tap = { ...state, state: 'RACING', serverNow: now, paused: true, pausedAt: now,
        quizStage: {...state.quizStage, phase: 'tap', flowRevision: 1, endsAt: now + 3000} };
      await page.evaluate(({event, state}) => handlers[event](state), {event:S.GAME_STATE_SYNC, state:tap});
      assert.equal(await page.locator('#btn-advance-quiz').isDisabled(), true);
      assert.match(await page.locator('#auto-question-status').innerText(), /第 1 題將於倒數結束後自動開始.*剩餘 3 秒/);
      await page.waitForTimeout(1100);
      assert.match(await page.locator('#auto-question-status').innerText(), /剩餘 3 秒/);
      assert.equal(await page.locator('#auto-question-status').evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth
          && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), true, 'automatic-start countdown is visible and unobstructed');
      await page.screenshot({path:`reports/control/tap-${width}x${height}.png`});
      await page.reload();
      assert.equal(await page.locator('#btn-advance-quiz').isDisabled(), true);
      await page.evaluate(({event,state}) => handlers[event](state), {event:S.GAME_STATE_SYNC,state:tap});
      assert.match(await page.locator('#auto-question-status').innerText(), /剩餘 3 秒/);
      await page.evaluate(({event,state}) => {const now=Date.now(); handlers[event]({...state,paused:false,serverNow:now,
        quizStage:{...state.quizStage,endsAt:now+3000}});}, {event:S.GAME_STATE_SYNC,state:tap});
      await page.waitForTimeout(1200);
      assert.match(await page.locator('#auto-question-status').innerText(), /剩餘 2 秒/);
      const answer = {...state, serverNow: Date.now(), quizStage: {...state.quizStage,phase:'answer'}};
      await page.evaluate(({event,state}) => handlers[event](state), {event:S.GAME_STATE_SYNC,state:answer});
      assert.equal(await page.locator('#btn-advance-quiz').isDisabled(), true);
      assert.equal(await page.locator('#auto-question-status').isHidden(), true);
      for (let question = 1; question <= 4; question++) {
        const snapshot = { ...state, quizStage: { ...state.quizStage, questionNumber: question } };
        await page.evaluate(({ event, state }) => handlers[event](state), { event: S.GAME_STATE_SYNC, state: snapshot });
        assert.equal(await page.locator('#btn-advance-quiz').innerText(), question < 4 ? '下一題' : '顯示本關結算');
      }
      for (let stage = 1; stage <= 4; stage++) {
        const snapshot = { ...state, quizStage: { ...state.quizStage, phase: 'summary', questionNumber: 4, stageNumber: stage } };
        await page.evaluate(({ event, state }) => handlers[event](state), { event: S.GAME_STATE_SYNC, state: snapshot });
        assert.equal(await page.locator('#btn-advance-quiz').innerText(), stage < 4 ? '開始下一關' : '開始最後衝刺');
      }
      await page.evaluate(({ event, state }) => handlers[event](state), { event: S.GAME_STATE_SYNC, state });
      const checkLayout = async () => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        for (const id of ['btn-advance-quiz', 'btn-pause', 'connection-status']) {
          const box = await page.locator('#' + id).boundingBox();
          assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, id);
          if (id.startsWith('btn')) assert.ok(box.height >= 44);
          assert.equal(await page.evaluate(id => {
            const el = document.getElementById(id), r = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          }, id), true, `${id} is not obscured`);
        }
      };
      await checkLayout();
      await page.locator('#btn-advance-quiz').click();
      const operation = await page.evaluate(() => sent.at(-1));
      assert.equal(operation.n, C.CONTROL_ADVANCE_QUIZ_FLOW);
      assert.match(operation.d.requestId, /^[A-Za-z0-9_.:-]{1,100}$/);
      await page.evaluate(({ event, state, requestId }) => handlers[event]({ action: 'ADVANCE_QUIZ_FLOW', success: true, requestId, state }),
        { event: S.CONTROL_ACTION_RESULT, state, requestId: operation.d.requestId });
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await checkLayout();
      await page.evaluate(() => { socket.connected = false; handlers.disconnect(); handlers.connect_error(new Error('websocket error')); });
      assert.equal(await page.locator('#connection-status').innerText(), '網路中斷，正在重連');
      assert.equal(await page.locator('#btn-advance-quiz').isDisabled(), true);
      assert.equal(await page.locator('#btn-pause').isDisabled(), true);
      await page.evaluate(() => { socket.connected = true; handlers.connect(); });
      assert.equal(await page.locator('#btn-advance-quiz').isDisabled(), true);
      const sentBeforeSync = await page.evaluate(() => sent.length);
      await page.evaluate(() => {
        window.confirm = () => true;
        for (const selector of ['#stage-controls button', '#btn-reset', '#btn-award-reveal', '#btn-force-quiz']) {
          const button = document.querySelector(selector); button.disabled = false; button.click();
        }
      });
      assert.equal(await page.evaluate(() => sent.length), sentBeforeSync);
      await page.evaluate(({ event, state }) => handlers[event](state), { event: S.GAME_STATE_SYNC, state });
      assert.equal(await page.locator('#btn-advance-quiz').isDisabled(), false);
      await page.screenshot({ path: `reports/control/lan-${width}x${height}.png` });
      await page.reload();
      assert.equal(await page.locator('#btn-advance-quiz').isDisabled(), true);
      await page.evaluate(({event,state}) => handlers[event](state), {event:S.GAME_STATE_SYNC,state});
      assert.equal(await page.locator('#btn-advance-quiz').isDisabled(), false);
      assert.equal(await page.locator('#btn-advance-quiz').innerText(), '下一題');
    }
    assert.deepEqual(errors, []);
    console.log('PASS control browser: insecure HTTP fallback, portrait/landscape actions, visible network status and reconnect');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
