/**
 * Lucky Horse 全流程自動化測試腳本
 * 模擬 20 位賓客 + 主持人的完整遊戲流程
 * 
 * 使用方式：在另一個終端執行 node test-simulation.js
 * (確保伺服器已在 localhost:3000 運行)
 */
const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const BOT_COUNT = 20;
const TEAM_IDS = ['red', 'blue', 'yellow', 'pink', 'purple'];
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'lucky2026';
const BASIC_AUTH = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
const NICKNAMES = [
  '大表哥', '小美', '阿姨', '舅舅', '堂弟',
  '花花', '阿寶', '小強', '美美', '大叔',
  '學妹', '同事A', '閨蜜', '伴郎', '伴娘',
  '老闆', '鄰居', '叔公', '表妹', '死黨'
];
const AVATARS = ['🥳', '😎', '😻', '👑', '🚀', '🍻', '💖', '🔥', '🎉', '🌟'];

let hostSocket = null;
let guestSockets = [];
let currentPhase = 'INIT';
let testResults = { passed: 0, failed: 0, errors: [] };

function log(msg, type = 'INFO') {
  const icon = type === 'OK' ? '✅' : type === 'FAIL' ? '❌' : type === 'WARN' ? '⚠️' : 'ℹ️';
  const ts = new Date().toLocaleTimeString('zh-TW');
  console.log(`[${ts}] ${icon} ${msg}`);
}

function assert(condition, testName) {
  if (condition) {
    testResults.passed++;
    log(`通過: ${testName}`, 'OK');
  } else {
    testResults.failed++;
    testResults.errors.push(testName);
    log(`失敗: ${testName}`, 'FAIL');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSocketToken(role) {
  const res = await fetch(`${SERVER_URL}/socket-token/${role}`, {
    headers: { Authorization: BASIC_AUTH }
  });
  if (!res.ok) {
    throw new Error(`無法取得 ${role} socket token: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.token;
}

// ========== Phase 1: 主持端連線 ==========
async function phase1_hostConnect() {
  log('=== Phase 1: 主持端連線 ===');
  const hostToken = await getSocketToken('host');
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (state) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      resolve(state);
    };
    const timeoutId = setTimeout(() => {
      log('主持端連線逾時', 'FAIL');
      finish(null);
    }, 5000);

    hostSocket = io(SERVER_URL, { auth: { role: 'host', token: hostToken } });
    
    hostSocket.on('connect', () => {
      assert(true, '主持端成功連線 (socket.id=' + hostSocket.id + ')');
    });

    hostSocket.on('game:state_sync', (state) => {
      assert(state.state !== undefined, '收到 GAME_STATE_SYNC (state=' + state.state + ')');
      assert(state.teams && state.teams.length === 5, '包含 5 個隊伍');
      finish(state);
    });
  });
}

// ========== Phase 2: 模擬賓客加入 ==========
async function phase2_guestsJoin() {
  log(`\n=== Phase 2: ${BOT_COUNT} 位賓客加入遊戲 ===`);
  
  const joinPromises = [];
  
  for (let i = 0; i < BOT_COUNT; i++) {
    const promise = new Promise((resolve) => {
      const guest = io(SERVER_URL);
      guestSockets.push(guest);

      guest.on('connect', () => {
        // 登入
        const nickname = NICKNAMES[i % NICKNAMES.length] + (i >= NICKNAMES.length ? `_${Math.floor(i/NICKNAMES.length)+1}` : '');
        const avatar = AVATARS[i % AVATARS.length];
        guest.emit('guest:join', { nickname, avatar });
        guest._nickname = nickname;
        guest._index = i;
      });

      guest.on('guest:team_chosen', (data) => {
        guest._teamId = data.teamId;
        resolve({ index: i, teamId: data.teamId, success: true });
      });

      // 選隊
      guest.on('game:state_sync', (state) => {
        if (!guest._teamChosen) {
          guest._teamChosen = true;
          const teamId = TEAM_IDS[i % TEAM_IDS.length];
          guest.emit('guest:choose_team', { teamId });
        }
      });

      setTimeout(() => resolve({ index: i, success: false, error: 'timeout' }), 5000);
    });
    
    joinPromises.push(promise);
    await sleep(100); // 每 100ms 加入一位，模擬現實
  }
  
  const results = await Promise.all(joinPromises);
  const successCount = results.filter(r => r.success).length;
  assert(successCount === BOT_COUNT, `${successCount}/${BOT_COUNT} 位賓客成功加入並選隊`);
  
  // 驗證隊伍分配
  const teamCounts = {};
  results.filter(r => r.success).forEach(r => {
    teamCounts[r.teamId] = (teamCounts[r.teamId] || 0) + 1;
  });
  log(`隊伍分配: ${JSON.stringify(teamCounts)}`);
  assert(Object.keys(teamCounts).length === 5, '5 個隊伍都有人加入');
}

// ========== Phase 3: 主持人開始比賽 ==========
async function phase3_startRound() {
  log('\n=== Phase 3: 主持人開始比賽 ===');
  
  return new Promise((resolve) => {
    let countdownReceived = false;
    let racingReceived = false;
    
    const stateHandler = (state) => {
      if (state.state === 'COUNTDOWN' && !countdownReceived) {
        countdownReceived = true;
        assert(true, '收到 COUNTDOWN 狀態 (3-2-1 倒數中)');
      }
      if (state.state === 'RACING' && !racingReceived) {
        racingReceived = true;
        assert(true, '收到 RACING 狀態 (比賽開始)');
        hostSocket.off('game:state_sync', stateHandler);
        resolve();
      }
    };
    
    hostSocket.on('game:state_sync', stateHandler);
    hostSocket.emit('host:start_round');
    log('已發送 HOST_START_ROUND');
    
    setTimeout(() => {
      if (!racingReceived) {
        assert(false, '未在 10 秒內收到 RACING 狀態');
        hostSocket.off('game:state_sync', stateHandler);
        resolve();
      }
    }, 10000);
  });
}

// ========== Phase 4: 模擬瘋狂點擊衝刺 ==========
async function phase4_racingTaps() {
  log('\n=== Phase 4: 模擬賓客瘋狂點擊衝刺 (5秒) ===');
  
  let positionUpdates = 0;
  
  hostSocket.on('game:position_update', (data) => {
    positionUpdates++;
  });
  
  // 每 80ms 每位賓客發送一次 tap
  const tapInterval = setInterval(() => {
    guestSockets.forEach(g => {
      if (g.connected) {
        g.emit('guest:tap', { timestamp: Date.now() });
      }
    });
  }, 80);
  
  await sleep(5000);
  clearInterval(tapInterval);
  
  assert(positionUpdates > 50, `收到 ${positionUpdates} 次位置更新 (>50 次 = 30fps 正常)`);
}

// ========== Phase 5: 等待突發關卡觸發 ==========
async function phase5_quizTrigger() {
  log('\n=== Phase 5: 等待突發關卡觸發 ===');
  
  return new Promise((resolve) => {
    let quizPrepareReceived = false;
    let quizStartReceived = false;
    let quizOptionsReceived = 0;
    let quizResultReceived = false;
    
    // 主持端監聽
    hostSocket.on('game:quiz_prepare', (data) => {
      quizPrepareReceived = true;
      assert(data.seconds > 0, `收到 QUIZ_PREPARE (倒數 ${data.seconds} 秒)`);
    });
    
    hostSocket.on('game:quiz_start', (data) => {
      quizStartReceived = true;
      assert(!!data.question, `收到 QUIZ_START 題目: "${data.question}"`);
      assert(data.options && data.options.length >= 2, `包含 ${data.options ? data.options.length : 0} 個選項`);
      assert(data.timeLimit > 0, `限時 ${data.timeLimit} 秒`);
    });
    
    // 賓客端監聽選項並隨機答題
    guestSockets.forEach(g => {
      g.on('game:quiz_options', (data) => {
        quizOptionsReceived++;
        // 隨機延遲後作答
        const delay = 500 + Math.random() * 2000;
        setTimeout(() => {
          const opts = ['A', 'B', 'C', 'D'];
          const answer = opts[Math.floor(Math.random() * opts.length)];
          g.emit('guest:quiz_answer', { quizId: data.quizId, answer });
        }, delay);
      });
    });
    
    // 監聽答題結果
    hostSocket.on('game:quiz_result', (data) => {
      quizResultReceived = true;
      assert(!!data.correctAnswer, `答題結果揭曉: 正確答案 = ${data.correctAnswer}`);
      
      if (data.teamResults) {
        const teamNames = { red: '牛仔隊', blue: '氣球隊', yellow: '生日隊', pink: '公主隊', purple: '格格隊' };
        for (const [tid, res] of Object.entries(data.teamResults)) {
          const ratePct = Math.round(res.rate * 100);
          log(`  ${teamNames[tid] || tid}: 答對率 ${ratePct}%, 效果=${res.effect} (${res.val})`);
        }
      }
      
      // 等一下看是否恢復 RACING
      setTimeout(() => {
        assert(quizPrepareReceived, 'QUIZ_PREPARE 事件已觸發');
        assert(quizStartReceived, 'QUIZ_START 事件已觸發');
        assert(quizOptionsReceived >= BOT_COUNT * 0.5, `${quizOptionsReceived}/${BOT_COUNT} 位賓客收到選項`);
        assert(quizResultReceived, 'QUIZ_RESULT 事件已觸發');
        resolve();
      }, 2000);
    });
    
    // 持續點擊推動比賽至關卡觸發
    const tapInterval = setInterval(() => {
      guestSockets.forEach(g => {
        if (g.connected) {
          g.emit('guest:tap', { timestamp: Date.now() });
        }
      });
    }, 80);
    
    // 最多等 60 秒
    setTimeout(() => {
      clearInterval(tapInterval);
      if (!quizPrepareReceived) {
        log('60 秒內未觸發關卡 (可能需要更多點擊)', 'WARN');
      }
      resolve();
    }, 60000);
    
    // 關卡觸發後停止點擊
    hostSocket.on('game:quiz_prepare', () => {
      setTimeout(() => clearInterval(tapInterval), 1000);
    });
  });
}

// ========== Phase 6: 等待比賽結束 ==========
async function phase6_roundFinish() {
  log('\n=== Phase 6: 等待比賽結束 ===');
  
  return new Promise((resolve) => {
    // 繼續點擊直到比賽結束
    const tapInterval = setInterval(() => {
      guestSockets.forEach(g => {
        if (g.connected) {
          g.emit('guest:tap', { timestamp: Date.now() });
        }
      });
    }, 80);
    
    hostSocket.on('game:round_finished', (data) => {
      clearInterval(tapInterval);
      assert(true, '收到 ROUND_FINISHED 事件');
      if (data.roundInfo && data.roundInfo.winner) {
        log(`🏆 本局冠軍: ${data.roundInfo.winner}`);
      }
      if (data.matchStatus) {
        log(`賽事進度: 第 ${data.matchStatus.currentRound}/${data.matchStatus.totalRounds} 局`);
      }
      resolve(data);
    });
    
    hostSocket.on('game:match_finished', (data) => {
      clearInterval(tapInterval);
      assert(true, '收到 MATCH_FINISHED 事件 (全部完賽!)');
      if (data.finalWinner) {
        log(`🎉 總冠軍: ${data.finalWinner}`);
      }
      resolve(data);
    });
    
    setTimeout(() => {
      clearInterval(tapInterval);
      log('120 秒未結束比賽', 'WARN');
      resolve(null);
    }, 120000);
  });
}

// ========== 清理 ==========
function cleanup() {
  log('\n=== 清理連線 ===');
  guestSockets.forEach(g => g.disconnect());
  if (hostSocket) hostSocket.disconnect();
  guestSockets = [];
}

// ========== 主流程 ==========
async function runFullTest() {
  console.log('\n' + '='.repeat(60));
  console.log('  🐴 Lucky Horse 全流程自動化模擬測試');
  console.log('  模擬 20 位賓客 + 1 位主持人的完整遊戲體驗');
  console.log('='.repeat(60) + '\n');

  try {
    // Phase 1: 主持端連線
    const initState = await phase1_hostConnect();
    if (!initState) {
      log('主持端無法連線，終止測試', 'FAIL');
      return;
    }
    
    // Phase 2: 賓客加入
    await phase2_guestsJoin();
    await sleep(1000);
    
    // Phase 3: 開始比賽
    await phase3_startRound();
    await sleep(500);
    
    // Phase 4: 瘋狂點擊
    await phase4_racingTaps();
    
    // Phase 5: 等待突發關卡
    await phase5_quizTrigger();
    await sleep(1000);
    
    // Phase 6: 等待比賽結束
    await phase6_roundFinish();
    
  } catch (err) {
    log(`測試過程發生異常: ${err.message}`, 'FAIL');
    console.error(err);
  } finally {
    cleanup();
  }

  // 輸出最終報告
  console.log('\n' + '='.repeat(60));
  console.log('  📊 測試結果報告');
  console.log('='.repeat(60));
  console.log(`  ✅ 通過: ${testResults.passed}`);
  console.log(`  ❌ 失敗: ${testResults.failed}`);
  if (testResults.errors.length > 0) {
    console.log(`  失敗項目:`);
    testResults.errors.forEach(e => console.log(`    - ${e}`));
  }
  console.log('='.repeat(60) + '\n');
  
  process.exit(testResults.failed > 0 ? 1 : 0);
}

runFullTest();
