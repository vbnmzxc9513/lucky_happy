const assert = require('node:assert/strict');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { CLIENT_TO_SERVER: C, SERVER_TO_CLIENT: S } = require('../shared/events');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:3995';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server;
let browser, control;
(async () => {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(3995, '127.0.0.1', () => probe.close(resolve));
  });
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env,
  PORT: '3995', BIND_HOST: '127.0.0.1', QUIET_SOCKET_LOGS: '1', ENABLE_TEST_DIAGNOSTICS: '1' }, stdio: 'ignore' });
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
  const login = await fetch(`${base}/staff-login`, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'code=1009&next=/control/' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  control = io(base, { transports: ['websocket'], auth: { role: 'control', protocolVersion: 2 }, extraHeaders: { Cookie: cookie } });
  await new Promise((resolve, reject) => { control.once('connect', resolve); control.once('connect_error', reject); });
  control.on(S.GAME_STATE_SYNC, state => {
    if (state.quizStage?.phase !== 'awaiting_question') return;
    control.emit(C.CONTROL_ADVANCE_QUIZ_FLOW, { requestId: randomUUID(), runId: state.runId,
      stageNumber: state.quizStage.stageNumber, flowRevision: state.quizStage.flowRevision });
  });
  control.emit(C.CONTROL_START_ROUND);
  await page.waitForFunction(() => !document.getElementById('btn-tap').disabled && document.querySelector('#screen-racing.active'));
  for (let i = 0; i < 5; i++) { await page.locator('#btn-tap').click(); await sleep(110); }
  await page.waitForFunction(() => document.getElementById('my-tap-count').innerText === '5');
  await page.screenshot({ path: 'reports/network-v2-mobile390.png' });
  await page.setViewportSize({ width: 320, height: 568 });
  await context.setOffline(true);
  await page.waitForFunction(() => !document.getElementById('network-status').hidden && document.getElementById('btn-tap').disabled);
  await page.screenshot({ path: 'reports/network-v2-mobile320-offline.png' });
  await context.setOffline(false);
  await page.waitForFunction(() => document.querySelector('#screen-quiz.active') && !document.querySelector('.opt-btn').disabled, { timeout: 25000 });
  await page.locator('.opt-btn').first().click();
  await page.waitForFunction(() => /is-correct|is-wrong/.test(document.getElementById('quiz-lock-msg').className));
  const audit = await (await fetch(`${base}/api/test-accounting`, { headers: { Cookie: cookie } })).json();
  const player = audit.players.find(p => p.nickname === 'BrowserQA');
  assert.equal(player.tapCount, 5);
  assert.equal(player.answeredCount, 1);
  assert.equal(await page.locator('.opt-btn:enabled').count(), 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'reports/network-v2-mobile320-answer.png' });
  console.log('PASS real browser: 390/320px, authoritative taps, offline lock, identity recovery, single confirmed answer, no page errors');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  control?.disconnect();
  await browser?.close();
  server?.kill();
  await new Promise(resolve => { if (!server || server.exitCode !== null) resolve(); else server.once('exit', resolve); });
});
