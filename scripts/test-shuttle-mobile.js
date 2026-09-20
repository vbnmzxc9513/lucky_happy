const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.SERVER_URL || 'http://127.0.0.1:3000';
async function main() {
  fs.mkdirSync('reports/shuttle', { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const size of [{ width:390, height:844 }, { width:320, height:568 }]) {
      const context = await browser.newContext({ viewport: size });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/socket.io/socket.io.js', route => route.fulfill({ contentType: 'text/javascript', body: `
        window.handlers = {}; window.sent = [];
        window.io = () => ({ id: 'qa', on(name, fn) { (window.handlers[name] ||= []).push(fn); }, emit(name, data) { window.sent.push({name,data}); } });
        window.receive = (name, data) => (window.handlers[name] || []).forEach(fn => fn(data));
      ` }));
      await page.addInitScript(() => localStorage.setItem('luckyHorseGuestSessionV1', JSON.stringify({
        sessionId:'qa-mobile-shuttle-session', nickname:'測試玩家', teamId:'red', isJoined:true, avatar:'A'
      })));
      await page.goto(`${url}/guest/`);
      await page.evaluate(() => {
        const E = window.GameEvents.SERVER_TO_CLIENT;
        window.receive(E.GAME_STATE_SYNC, { state:'RACING', config:window.GameConfig, serverNow:Date.now(),
          teams:[], quizStage:{ phase:'tap', stageNumber:1, stageCount:6, questionNumber:1, endsAt:Date.now()+8000 } });
        window.receive(E.GAME_POSITION_UPDATE, {teams:{ red:{position:29999,speed:15}, blue:{position:20000,speed:10} }});
        window.receive(E.GAME_PLAYER_STATUS, {tapCount:9999,teamRank:1,teamShuttle:window.ShuttleRace.measure(29999,window.GameConfig)});
      });
      await page.waitForTimeout(200);
      await page.screenshot({path:`reports/shuttle/mobile-race-${size.width}.png`});
      const issues = await page.evaluate(() => {
        const problems=[];
        for (const el of document.querySelectorAll('.player-live-stats strong, #btn-tap, .stage-clock')) {
          const r=el.getBoundingClientRect();
          const parent=el.parentElement.getBoundingClientRect();
          if (!r.width || !r.height || r.top<parent.top || r.bottom>parent.bottom+1) problems.push(`clipped ${el.id}`);
          if (r.left<0 || r.right>innerWidth || r.bottom>innerHeight || r.top<0 || el.scrollWidth>el.clientWidth+1) problems.push(el.id || el.className);
        }
        if (document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight) problems.push('page scroll');
        return problems;
      });
      assert.deepEqual(issues, []);
      const timings = await page.evaluate(async () => {
        const b=document.getElementById('btn-tap'), samples=[];
        for(let i=0;i<12;i++) {
          const start=performance.now(); b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
          await new Promise(requestAnimationFrame);
          if (!b.getAnimations().length) throw new Error('missing immediate feedback');
          samples.push(performance.now()-start);
          await new Promise(resolve=>setTimeout(resolve,120));
        }
        return samples.sort((a,b)=>a-b);
      });
      assert.ok(timings.at(-1)<100, `press latency ${timings.at(-1)}`);
      assert.equal(await page.locator('#my-tap-count').textContent(), '9,999', 'press alone cannot increment accepted count');
      await page.evaluate(() => {
        const E=window.GameEvents.SERVER_TO_CLIENT;
        window.receive(E.GAME_STATE_SYNC,{state:'QUIZ',config:window.GameConfig,serverNow:Date.now(),teams:[]});
        window.receive(E.GAME_QUIZ_OPTIONS,{quizId:'qa',options:{A:'A',B:'B',C:'C',D:'D'},timeLimit:10});
      });
      await page.locator('.opt-btn').first().click();
      assert.equal(await page.locator('.opt-btn:disabled').count(),4);
      await page.evaluate(() => window.receive(window.GameEvents.SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK,{success:true,isCorrect:true}));
      assert.ok((await page.locator('#quiz-lock-msg').textContent()).includes('等待隊伍多數決'));
      await page.evaluate(() => window.receive(window.GameEvents.SERVER_TO_CLIENT.GAME_QUIZ_RESULT,{teamResults:{red:{isCorrect:false,teamAnswer:'B'}}}));
      assert.ok((await page.locator('#quiz-lock-msg').textContent()).includes('隊伍答錯'));
      assert.deepEqual(errors,[]);
      console.log(`PASS mobile ${size.width}: layout, feedback max ${timings.at(-1).toFixed(1)}ms, authoritative tap count, personal vs team result`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
