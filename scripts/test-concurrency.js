/**
 * Lucky Horse v1.1 - 100+ 人高並發模擬測試腳本
 * 
 * 測試項目：
 * 1. 同時建立 100+ 個 Socket 連線
 * 2. 模擬賓客登入加入遊戲與選擇隊伍
 * 3. 模擬高頻點擊 (Tapping)
 * 4. 模擬答題分屏作答與鎖定
 */

const { io } = require('socket.io-client');
const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = require('../shared/events');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const TOTAL_CLIENTS = 120; // 模擬 120 人並發
const CLIENTS = [];

console.log('==================================================');
console.log(`🚀 開始執行 Lucky Horse 高並發測試: ${TOTAL_CLIENTS} 個客戶端`);
console.log(`🎯 目標伺服器: ${SERVER_URL}`);
console.log('==================================================');

let connectedCount = 0;
let joinedCount = 0;
let teamChosenCount = 0;
let quizAnsweredCount = 0;

function createClient(index) {
  const socket = io(SERVER_URL, {
    reconnection: false,
    transports: ['websocket', 'polling']
  });

  const nickname = `賓客_${index + 1}`;
  const avatarList = ['🥳', '😎', '😻', '👑', '🚀', '🍻', '💖', '🔥'];
  const avatar = avatarList[index % avatarList.length];
  const teamId = index % 2 === 0 ? 'red' : 'blue';

  socket.on('connect', () => {
    connectedCount++;
    if (connectedCount === TOTAL_CLIENTS) {
      console.log(`✅ [成功] 所有 ${TOTAL_CLIENTS} 個連線已建立！開始模擬登入...`);
      startJoinPhase();
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, (state) => {
    // 當進入 RACING 狀態時，開始模擬高頻點擊
    if (state.state === 'RACING') {
      startTapping(socket);
    } else {
      stopTapping(socket);
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_OPTIONS, (data) => {
    stopTapping(socket);
    // 隨機在 1~5 秒內作答
    const delay = Math.floor(Math.random() * 4000) + 500;
    setTimeout(() => {
      const opts = ['A', 'B', 'C', 'D'];
      const randomOpt = opts[Math.floor(Math.random() * opts.length)];
      socket.emit(CLIENT_TO_SERVER.GUEST_QUIZ_ANSWER, { quizId: data.quizId, answer: randomOpt });
      quizAnsweredCount++;
      if (quizAnsweredCount % 30 === 0) {
        console.log(`📝 [答題] 已有 ${quizAnsweredCount} 人完成突襲關卡作答！`);
      }
    }, delay);
  });

  socket.on(SERVER_TO_CLIENT.GAME_ROUND_FINISHED, () => {
    stopTapping(socket);
  });

  socket.on('disconnect', () => {
    // 斷線處理
  });

  CLIENTS.push({ socket, nickname, avatar, teamId });
}

function startJoinPhase() {
  console.log(`⏳ 正在發送 ${TOTAL_CLIENTS} 個登入與選隊請求...`);
  CLIENTS.forEach((client, idx) => {
    setTimeout(() => {
      client.socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, { nickname: client.nickname, avatar: client.avatar });
      joinedCount++;

      setTimeout(() => {
        client.socket.emit(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, { teamId: client.teamId });
        teamChosenCount++;
        if (teamChosenCount === TOTAL_CLIENTS) {
          console.log(`✅ [成功] 全部 ${TOTAL_CLIENTS} 名賓客已完成登入並加入紅/藍兩隊！`);
          console.log(`📊 紅隊人數: ${Math.ceil(TOTAL_CLIENTS / 2)} | 藍隊人數: ${Math.floor(TOTAL_CLIENTS / 2)}`);
          console.log(`👉 請在瀏覽器或伺服器端按下「開始對抗賽」以測試高頻點擊與關卡觸發！`);
        }
      }, 200);
    }, idx * 20); // 分散發送，模擬真實湧入
  });
}

function startTapping(socket) {
  if (socket._tapTimer) return;
  // 每 120ms~250ms 點擊一次
  const rate = Math.floor(Math.random() * 130) + 120;
  socket._tapTimer = setInterval(() => {
    socket.emit(CLIENT_TO_SERVER.GUEST_TAP, { timestamp: Date.now() });
  }, rate);
}

function stopTapping(socket) {
  if (socket._tapTimer) {
    clearInterval(socket._tapTimer);
    socket._tapTimer = null;
  }
}

// 啟動連線建立
for (let i = 0; i < TOTAL_CLIENTS; i++) {
  createClient(i);
}

// 30 秒後若測試未結束自動提示
setTimeout(() => {
  console.log('🏁 模擬測試腳本監控中... 按 Ctrl+C 可隨時結束腳本。');
}, 30000);
