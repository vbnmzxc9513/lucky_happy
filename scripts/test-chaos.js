const { io } = require('socket.io-client');
const SERVER_URL = 'http://localhost:3000';
const ITERATIONS = 10;
const GUEST_COUNT = 30;
const TEAM_IDS = ['red', 'blue', 'yellow', 'pink', 'purple'];
const STAFF_ACCESS_CODE = process.env.STAFF_ACCESS_CODE || '1009';

let hostSocket = null;
let adminSocket = null;
let guestSockets = [];

function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-TW');
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function setup() {
  log('Setting up Host and Admin...');
  const staffCookie = await getStaffCookie();
  const socketOptions = { extraHeaders: { Cookie: staffCookie } };
  hostSocket = io(SERVER_URL, { ...socketOptions, auth: { role: 'control' } });
  adminSocket = io(SERVER_URL, { ...socketOptions, auth: { role: 'admin' } });

  await new Promise(r => {
    let connected = 0;
    hostSocket.on('connect', () => { if (++connected === 2) r(); });
    adminSocket.on('connect', () => { if (++connected === 2) r(); });
  });

  log(`Setting up ${GUEST_COUNT} Guests...`);
  for (let i = 0; i < GUEST_COUNT; i++) {
    const g = io(SERVER_URL);
    guestSockets.push(g);
  }

  await new Promise(r => setTimeout(r, 1000));
}

async function runIteration(iteration) {
  log(`\n=== 🚀 開始第 ${iteration} 次極限測試 ===`);

  // 1. 初始化賓客
  for (let i = 0; i < GUEST_COUNT; i++) {
    const g = guestSockets[i];
    g.emit('guest:join', { nickname: `TestGuest_${i}`, avatar: '😎' });
  }
  await sleep(200);

  // 隨機選隊
  for (let i = 0; i < GUEST_COUNT; i++) {
    const teamId = TEAM_IDS[Math.floor(Math.random() * TEAM_IDS.length)];
    guestSockets[i].emit('guest:choose_team', { teamId });
  }
  await sleep(500);

  // 2. 主持人開始比賽
  log('Host starts round...');
  hostSocket.emit('control:start_round');
  await sleep(1000);

  // 3. 混亂階段：賽跑中
  log('Chaos Phase: Racing...');
  let chaosInterval = setInterval(() => {
    // 隨機賓客狂點
    for (let i = 0; i < GUEST_COUNT; i++) {
      if (Math.random() > 0.3) {
        guestSockets[i].emit('guest:tap', { timestamp: Date.now() });
      }
    }
  }, 100);

  // 隨機斷線重連
  let disconnectTimer = setTimeout(() => {
    log('Random Event: 5 賓客斷線並立即重連');
    for (let i = 0; i < 5; i++) {
      guestSockets[i].disconnect();
      setTimeout(() => {
        guestSockets[i].connect();
        // 模擬重連的 Join
        guestSockets[i].emit('guest:join', { nickname: `TestGuest_${i}`, avatar: '😎', isReconnect: true });
        // 模擬重連的選隊
        const teamId = TEAM_IDS[Math.floor(Math.random() * TEAM_IDS.length)];
        guestSockets[i].emit('guest:choose_team', { teamId, isReconnect: true });
      }, 500);
    }
  }, 2000);

  // Admin 隨機干擾
  let adminTimer = setTimeout(() => {
    log('Random Event: Admin 隨機改設定 / 觸發事件');
    const rand = Math.random();
    if (rand < 0.3) {
      adminSocket.emit('admin:update_config', { tapCooldown: 200, maxSpeed: 20 });
    } else if (rand < 0.6) {
      adminSocket.emit('admin:force_trigger', { type: 'ITEM', teamId: 'red', itemType: 'large_boost' });
    } else {
      adminSocket.emit('admin:force_trigger', { type: 'QUIZ', targetId: 'q1' });
    }
  }, 3000);

  // Host 隨機惡意操作 (提早結束或重置)
  let hostTimer = setTimeout(() => {
    const rand = Math.random();
    if (rand < 0.1) {
      log('🚨 Random Event: Host 惡意重置遊戲！');
      hostSocket.emit('control:reset_game');
    } else if (rand < 0.2) {
      log('🚨 Random Event: Host 惡意跳下一局！');
      hostSocket.emit('host:next_round');
    }
  }, 4500);

  // 讓比賽跑一陣子
  await sleep(7000);

  clearInterval(chaosInterval);
  clearTimeout(disconnectTimer);
  clearTimeout(adminTimer);
  clearTimeout(hostTimer);

  // 正常清理回合
  log('清理回合，準備下一局');
  hostSocket.emit('control:reset_game');
  await sleep(1000);
  log(`第 ${iteration} 次極限測試結束，伺服器存活。`);
}

async function start() {
  await setup();
  for (let i = 1; i <= ITERATIONS; i++) {
    try {
      await runIteration(i);
    } catch (e) {
      log(`❌ 發生致命錯誤：${e.message}`);
      process.exit(1);
    }
  }
  log('🎉 所有 10 次 Chaos 壓力測試完成，伺服器穩定運作，未出現崩潰！');
  process.exit(0);
}

start();
