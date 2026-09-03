const { io } = require('socket.io-client');
const SERVER_URL = 'http://localhost:3000';
const ITERATIONS = 5;
const GUEST_COUNT = 100;
const TEAM_IDS = ['red', 'blue', 'yellow', 'pink', 'purple'];
const STAFF_ACCESS_CODE = process.env.STAFF_ACCESS_CODE || '1009';

function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-TW');
  console.log(`[${ts}] ${msg}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getStaffCookie() {
  const res = await fetch(`${SERVER_URL}/staff-login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: STAFF_ACCESS_CODE, next: '/control/' })
  });
  const cookie = res.headers.get('set-cookie');
  if (res.status !== 302 || !cookie) throw new Error(`無法建立工作人員連線: HTTP ${res.status}`);
  return cookie.split(';')[0];
}

async function runSuperChaos() {
  log(`Setting up Host, Admin, and ${GUEST_COUNT} Guests...`);
  const staffCookie = await getStaffCookie();
  const socketOptions = { extraHeaders: { Cookie: staffCookie } };
  const host = io(SERVER_URL, { ...socketOptions, auth: { role: 'control' } });
  const admin = io(SERVER_URL, { ...socketOptions, auth: { role: 'admin' } });
  const guests = Array.from({ length: GUEST_COUNT }, () => io(SERVER_URL));
  
  await sleep(1000); // Wait for connections

  for (let iter = 1; iter <= ITERATIONS; iter++) {
    log(`\n=== 🧨 開始第 ${iter} 次超級混沌測試 ===`);

    // 1. Spammer loop
    const spammers = guests.map((g, i) => setInterval(() => {
      // randomly do things out of order
      const r = Math.random();
      if (r < 0.1) g.emit('guest:join', { nickname: `Spammer_${i}`, avatar: '😈' });
      else if (r < 0.2) g.emit('guest:choose_team', { teamId: TEAM_IDS[Math.floor(Math.random() * TEAM_IDS.length)] });
      else if (r < 0.8) g.emit('guest:tap', { timestamp: Date.now() });
      else g.emit('guest:quiz_answer', { quizId: 'q1', answer: ['A','B','C','D'][Math.floor(Math.random()*4)] });
    }, 50)); // 20 times per second per guest! That's 2000 events/sec

    // 2. Admin goes crazy
    const adminSpammer = setInterval(() => {
      const r = Math.random();
      if (r < 0.3) admin.emit('admin:force_trigger', { type: 'ITEM', teamId: 'red', itemType: 'stun' });
      else if (r < 0.6) admin.emit('admin:force_trigger', { type: 'QUIZ', targetId: 'q2' });
      else admin.emit('admin:update_config', { tapCooldown: Math.floor(Math.random() * 500) });
    }, 500);

    // 3. Host goes crazy
    const hostSpammer = setInterval(() => {
      const r = Math.random();
      if (r < 0.2) host.emit('control:start_round');
      else if (r < 0.4) host.emit('control:pause_game');
      else if (r < 0.6) host.emit('control:resume_game');
      else if (r < 0.8) host.emit('host:next_round');
      else host.emit('control:reset_game'); // RESET GAME CONSTANTLY!
    }, 1500);

    await sleep(8000); // Let them wreak havoc for 8 seconds

    spammers.forEach(clearInterval);
    clearInterval(adminSpammer);
    clearInterval(hostSpammer);

    log(`🧹 清理階段...`);
    host.emit('control:reset_game');
    await sleep(1000);
  }

  log('🎉 所有 5 次超級混沌測試完成，伺服器存活！');
  process.exit(0);
}

runSuperChaos().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
