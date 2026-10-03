const resultsFs = require('node:fs');
const resultsPath = require('node:path');
const resultsTemp = resultsFs.mkdtempSync(resultsPath.join(require('node:os').tmpdir(), 'horse-isolated-'));
process.env.MATCH_RESULTS_FILE = resultsPath.join(resultsTemp, 'results.json');
process.on('exit', () => resultsFs.rmSync(resultsTemp, { recursive: true, force: true }));
const assert = require('node:assert/strict');
const net = require('node:net');
const { CLIENT_TO_SERVER: C, SERVER_TO_CLIENT: S } = require('../shared/events');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let base;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server;
let browser, control;
(async () => {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${probe.address().port}`; probe.close(resolve); });
  });
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env,
  PORT: new URL(base).port, BIND_HOST: '127.0.0.1', QUIET_SOCKET_LOGS: '1', ENABLE_TEST_DIAGNOSTICS: '1' }, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; } } catch {}
    await sleep(100);
  }
  assert(ready, 'isolated browser server started');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/guest/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#input-nickname').fill('BrowserQA');
  await page.locator('#btn-join').click();
  await page.locator('#screen-team-select.active').waitFor();
  await page.locator('.team-choice-card[data-team="red"]').click();
  await page.locator('.team-choice-card[data-team="red"].is-current-team').waitFor();
  await page.locator('#btn-rename').click();
  await page.locator('#input-new-nickname').fill('RenamedQA');
  await page.screenshot({path:'reports/guest-rename-390.png'});
  await page.setViewportSize({width:320,height:568});
  await page.screenshot({path:'reports/guest-rename-320.png',fullPage:true});
  await page.locator('#btn-save-nickname').click();
  await page.waitForFunction(() => document.getElementById('rename-form').hidden);
  await page.reload();
  await page.locator('.team-choice-card[data-team="red"].is-current-team').waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('luckyHorseGuestSessionV1')).nickname), 'RenamedQA');
  await page.setViewportSize({width:390,height:844});
  const login = await fetch(`${base}/staff-login`, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'code=1009&next=/control/' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  await context.addCookies([{name:'lucky_horse_staff',value:cookie.slice(cookie.indexOf('=')+1),url:base}]);
  const host = await context.newPage(); await host.setViewportSize({width:1280,height:720});
  host.on('pageerror', error => errors.push(error.message));
  await host.goto(base+'/host/',{waitUntil:'domcontentloaded'});
  control = io(base, { transports: ['websocket'], auth: { role: 'control', protocolVersion: 2 }, extraHeaders: { Cookie: cookie } });
  await new Promise((resolve, reject) => { control.once('connect', resolve); control.once('connect_error', reject); });
  let latestState;
  control.on(S.GAME_STATE_SYNC, state => {latestState=state;});
  control.emit(C.CONTROL_START_ROUND);
  await page.waitForFunction(() => !document.getElementById('btn-tap').disabled && document.querySelector('#screen-racing.active'));
  for (let i = 0; i < 5; i++) { await page.locator('#btn-tap').click(); await sleep(110); }
  await page.waitForFunction(() => document.getElementById('my-tap-count').innerText === '5');
  await page.screenshot({ path: 'reports/network-v2-mobile390.png' });
  const watermark = await page.locator('.stage-clock-guest.is-tap').evaluate(el => ({text:el.textContent,opacity:getComputedStyle(el).opacity,pointer:getComputedStyle(el).pointerEvents}));
  assert.match(watermark.text, /^\d+$/); assert.equal(watermark.opacity,'0.4'); assert.equal(watermark.pointer,'none');
  await page.screenshot({path:'reports/guest-countdown-390.png'});
  await page.setViewportSize({ width: 320, height: 568 });
  await page.screenshot({path:'reports/guest-countdown-320.png'});
  await context.setOffline(true);
  await page.waitForFunction(() => !document.getElementById('network-status').hidden && document.getElementById('btn-tap').disabled);
  await page.screenshot({ path: 'reports/network-v2-mobile320-offline.png' });
  await context.setOffline(false);
  await page.waitForFunction(() => document.querySelector('#screen-quiz.active') && document.getElementById('quiz-lock-msg').textContent === '閱讀中', null, {timeout:25000});
  assert.equal(await page.locator('.opt-btn:enabled').count(),0);
  await page.screenshot({path:'reports/guest-entry-320.png'});
  await page.evaluate(()=>document.querySelector('.opt-btn').click());
  const buttonBox=await page.locator('.opt-btn').first().boundingBox();
  await page.mouse.move(buttonBox.x+buttonBox.width/2,buttonBox.y+buttonBox.height/2);
  await page.mouse.down();
  await page.waitForFunction(() => !document.querySelector('.opt-btn').disabled, null, {timeout:15000});
  await page.mouse.up();
  const before = await (await fetch(`${base}/api/test-accounting`, {headers:{Cookie:cookie}})).json();
  assert.equal(before.players.find(p => p.nickname === 'RenamedQA').answeredCount,0);
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth),true);
  await page.screenshot({path:'reports/guest-options-320.png'});
  await page.locator('.opt-btn').first().click();
  await page.waitForFunction(() => document.getElementById('quiz-lock-msg').textContent === '已作答');
  assert.equal(await page.locator('#quiz-lock-msg.is-correct,#quiz-lock-msg.is-wrong').count(),0);
  const audit = await (await fetch(`${base}/api/test-accounting`, { headers: { Cookie: cookie } })).json();
  const player = audit.players.find(p => p.nickname === 'RenamedQA');
  assert.equal(player.tapCount, 5);
  assert.equal(player.answeredCount, 1);
  assert.equal(await page.locator('.opt-btn:enabled').count(), 0);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('.opt-btn.selected').count(),1,'confirmed answer remains visibly selected');
  assert.equal(await page.locator('.opt-btn.selected').getAttribute('data-opt'),'A');
  await page.waitForTimeout(250); // Capture the settled existing button transition.
  await page.screenshot({ path: 'reports/network-v2-mobile320-answer.png' });
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('quiz-lock-msg').textContent==='已作答');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.opt-btn.selected').getAttribute('data-opt'),'A','receipt restores the same neutral selection');
  assert.equal(await page.locator('#quiz-lock-msg.is-correct,#quiz-lock-msg.is-wrong').count(),0);
  await page.screenshot({path:'reports/guest-answer-restored-320.png'});
  const until = async predicate => { const end=Date.now()+15000; while(!predicate()){assert(Date.now()<end,'authority phase timeout');await sleep(50);} };
  const advance = () => control.emit(C.CONTROL_ADVANCE_QUIZ_FLOW,{requestId:require('node:crypto').randomUUID(),runId:latestState.runId,stageNumber:latestState.quizStage.stageNumber,flowRevision:latestState.quizStage.flowRevision});
  const formal=require('../tests/fixtures/formal-questions.json');
  for(let q=1;q<=4;q++){
    await until(()=>latestState?.quizStage?.phase==='reveal' && latestState.quizStage.questionNumber===q);
    advance();
    if(q<4){
      await page.waitForFunction(()=>!document.querySelector('.opt-btn').disabled && !document.querySelector('.quiz-entering'));
      await page.locator('[data-opt="'+formal[q].correctAnswer+'"]').click();
    }
  }
  await page.locator('.stage-guest:not([hidden])').waitFor();
  await host.screenshot({path:'reports/stages/live-main-0.png'});
  await page.waitForTimeout(900);
  await host.screenshot({path:'reports/stages/live-main-900.png'});
  await page.waitForTimeout(300);
  await page.reload();
  await page.locator('.stage-guest:not([hidden])').waitFor();
  const transform=()=>page.locator('.stage-guest .stage-runner').evaluate(el=>Number(getComputedStyle(el).transform.split(',')[4]));
  assert(await transform()>0,'real reload resumes movement');
  await host.reload();
  await host.locator('#screen-racing.active').waitFor();
  await host.screenshot({path:'reports/stages/live-main-reloaded.png'});
  assert.equal(await page.locator('.stage-guest .stage-team').count(),1);
  assert.equal(await page.locator('.stage-guest .stage-reward').textContent(),'前進 400 m');
  control.emit(C.CONTROL_PAUSE_GAME);
  await until(()=>latestState.paused);
  await page.waitForTimeout(100);const frozen=await transform();await page.waitForTimeout(250);
  assert.equal(await transform(),frozen,'real pause freezes');
  control.emit(C.CONTROL_RESUME_GAME);await until(()=>!latestState.paused);
  for(const elapsed of [300,600,900,1200,1500]) {
    await page.waitForTimeout(300); await host.screenshot({path:'reports/stages/live-main-resume-'+elapsed+'.png'});
  }
  await page.waitForTimeout(1800);
  await page.screenshot({path:'reports/stages/guest-live-reloaded-320.png'});
  const locked=await (await fetch(base+'/api/test-accounting',{headers:{Cookie:cookie}})).json();
  assert.equal(locked.players.find(p=>p.nickname==='RenamedQA').answeredCount,4);
  assert.deepEqual(errors,[]);
  console.log('PASS real summary: 400m, reload continuation, private team, pause/resume, no duplicate answers');
  console.log('PASS real browser: 390/320px, authoritative taps, offline lock, identity recovery, single confirmed answer, no page errors');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  control?.disconnect();
  await browser?.close();
  server?.kill();
  await new Promise(resolve => { if (!server || server.exitCode !== null) resolve(); else server.once('exit', resolve); });
});
