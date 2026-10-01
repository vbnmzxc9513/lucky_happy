const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { io } = require('socket.io-client');
const Store = require('../server/results/MatchResultStore');
const Game = require('../server/game/GameManager');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horse-results-browser-'));
  const file = path.join(dir, 'results.json');
  const official = path.resolve('data/runtime/match-results.json');
  const before = fs.existsSync(official) ? fs.readFileSync(official) : null;
  let server, browser, socket; let output = '';
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const url = `http://127.0.0.1:${port}`;
  async function start() {
    server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, NODE_ENV: 'test', BIND_HOST: '127.0.0.1', PORT: String(port), MATCH_RESULTS_FILE: file, STAFF_ACCESS_CODE: '876543', STAFF_SESSION_SECRET: 'results-browser-isolated-secret-for-testing', QUIET_SOCKET_LOGS: '1' }, stdio: ['ignore','pipe','pipe'] });
    server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
    for (let n = 0; n < 100; n++) { try { if ((await fetch(url + '/healthz')).ok) return; } catch {} if (server.exitCode !== null) throw new Error(output); await new Promise(r => setTimeout(r, 100)); }
    throw new Error('Isolated server failed to start');
  }
  async function stop() { if (server && server.exitCode === null) { const done = new Promise(r => server.once('exit', r)); server.kill(); await done; } }
  try {
    await start();
    for (const route of ['/results/', '/results/results.js', '/api/match-results']) {
      const res = await fetch(url + route, { redirect: 'manual' }); assert.equal(res.status, 302); assert.match(res.headers.get('location'), /staff-login/);
    }
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL } : {}) });
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url + '/staff-login?next=%2Fresults%2F'); await page.locator('input[name=code]').fill('876543'); await page.locator('button[type=submit]').click();
    await page.waitForURL(url + '/results/'); await page.locator('#empty').waitFor({ state: 'visible' });
    const response = await page.request.get(url + '/api/match-results'); assert.equal(response.status(), 200); assert.equal(response.headers()['cache-control'], 'no-store');
    await stop();
    const store = new Store(file); const g = new Game({ emit() {} }, store);
    const malicious = '<img src=x onerror=alert(1)>';
    for (let i = 0; i < 32; i++) { const id = `p${i}`; g.teamManager.addPlayer(id, i === 0 ? malicious : `完整勝隊成員${i}${'很長的暱稱'.repeat(3)}`, '🥳', `session${i}`); g.teamManager.chooseTeam(id, 'red'); }
    g.teamManager.addPlayer('blue', '其他隊伍'); g.teamManager.chooseTeam('blue', 'blue');
    g.teamManager.teams.red.position = 27840.9; g.roundManager.recordRoundWinner('red'); g.setState('MATCH_FINISHED');
    const base = store.read().matches[0];
    for (let i = 1; i < 10; i++) store.add({ ...base, id: `history-${i}`, finishedAt: new Date(Date.now() + i * 1000).toISOString(), ...(i === 8 ? { winner: { type: 'tie', teamIds: ['red', 'blue'] } } : {}) });
    await start(); await page.reload(); await page.locator('#detail').waitFor({ state: 'visible' });
    for (const [width, height] of [[390,844],[320,568]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.locator('#matches option').count(), 10);
      assert.match(await page.locator('#teams').innerText(), /總距離 1,856 m/);
      for (const option of await page.locator('#matches option').evaluateAll(els => els.map(e => e.value))) {
        await page.locator('#matches').selectOption(option);
        assert.equal(await page.locator('#winners li').count(), option === 'history-8' ? 33 : 32);
        if (option === 'history-8') assert.match(await page.locator('#summary').innerText(), /並列/);
      }
      assert.ok((await page.locator('#winners').innerText()).includes(malicious)); assert.equal(await page.locator('#winners img').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.evaluate(() => document.querySelector('#winners').getBoundingClientRect().top < document.querySelector('#teams').getBoundingClientRect().top), true);
      for (const box of await page.locator('button,select').evaluateAll(els => els.map(e => {const r=e.getBoundingClientRect();return {x:r.x,w:r.width,h:r.height};}))) { assert.ok(box.h >= 44); assert.ok(box.x >= 0 && box.x + box.w <= width); }
      await page.locator('#team').selectOption('blue'); assert.equal(await page.locator('#players article').count(), 1);
      await page.locator('#only-winners').check(); assert.equal(await page.locator('#players article').count(), 0);
      await page.locator('#team').selectOption(''); assert.equal(await page.locator('#players article').count(), 32);
      await page.locator('#only-winners').uncheck();
      for (const sort of ['tapCount','nickname','correctCount']) await page.locator('#sort').selectOption(sort);
      fs.mkdirSync('reports/results', { recursive: true }); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: `reports/results/viewport-${width}x${height}.png` }); await page.screenshot({ path: `reports/results/${width}x${height}.png`, fullPage: true });
    }
    const chosenId = await page.locator('#matches').inputValue();
    const jsonDownload = page.waitForEvent('download'); await page.locator('#json').click();
    const exported = JSON.parse(fs.readFileSync(await (await jsonDownload).path(), 'utf8'));
    assert.equal(exported.match.id, chosenId); assert.equal(exported.match.teams.find(t=>t.id==='red').position, base.teams.find(t=>t.id==='red').position); assert.equal(exported.matches, undefined);
    const csvDownload = page.waitForEvent('download'); await page.locator('#csv').click();
    const csv = fs.readFileSync(await (await csvDownload).path(), 'utf8'); assert.equal(csv.split('\r\n').length, 34);
    const cookie = (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ');
    socket = io(url, { auth: { role: 'control', protocolVersion: 2 }, extraHeaders: { Cookie: cookie } });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const resetAck = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Reset ACK missing')), 5000);
      socket.on('control:action_result', payload => { if (payload.action === 'RESET_GAME') { clearTimeout(timer); resolve(payload); } });
    });
    socket.emit('control:reset_game');
    assert.equal((await resetAck).success, true);
    await page.locator('#refresh').click(); assert.equal(await page.locator('#matches option').count(), 10);
    await page.reload(); await page.locator('#detail').waitFor({ state: 'visible' }); assert.equal(await page.locator('#winners li').count(), 32);
    assert.deepEqual(errors, []); socket.disconnect();
    await stop(); fs.writeFileSync(file, '{corrupt'); await start(); await page.reload(); await page.locator('#empty').waitFor({ state: 'visible' }); assert.match(await page.locator('#warning').innerText(), /異常/);
    const safe = await (await page.request.get(url + '/api/match-results')).text(); assert.ok(!safe.includes(dir)); assert.ok(!safe.includes('stack'));
    console.log('PASS results browser: staff auth, empty, winner roster, tie, ten matches, filters, XSS, 390x844, 320x568, reset/reload, restart, corruption warning');
  } finally {
    socket?.disconnect(); await browser?.close(); await stop(); fs.rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(fs.existsSync(official) ? fs.readFileSync(official) : null, before, 'official runtime untouched');
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
