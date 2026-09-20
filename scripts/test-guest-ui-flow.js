const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');
const path = require('path');

const guestHtmlPath = path.join(__dirname, '../guest/index.html');
const htmlContent = fs.readFileSync(guestHtmlPath, 'utf8');

const guestAppJsPath = path.join(__dirname, '../guest/js/guest-app.js');
const guestAppJs = fs.readFileSync(guestAppJsPath, 'utf8');

const dom = new JSDOM(htmlContent, {
  url: "http://localhost:3000/guest/",
  runScripts: "outside-only"
});

dom.window.GameEvents = {
  CLIENT_TO_SERVER: { GUEST_JOIN: 'guest:join', GUEST_CHOOSE_TEAM: 'guest:choose_team', GUEST_TAP: 'guest:tap', GUEST_QUIZ_ANSWER: 'guest:quiz_answer' },
  SERVER_TO_CLIENT: {
    GAME_STATE_SYNC: 'game:state_sync',
    GAME_TEAM_UPDATED: 'game:team_updated',
    GUEST_JOIN_ACK: 'guest:join_ack',
    SYSTEM_ERROR: 'system:error',
    GAME_JOIN_LOCKED: 'game:join_locked',
    GAME_TEAM_FULL: 'game:team_full',
    GAME_FINAL_SPRINT: 'game:final_sprint'
  }
};
dom.window.GameConfig = {
  TEAMS: [
    { id: 'red', name: 'Red Team', color: 'red' },
    { id: 'blue', name: 'Blue Team', color: 'blue' }
  ]
};
dom.window.TapHandler = class { init() {} stop() {} };
dom.window.QuizUI = class { init() {} showOptions() {} hide() {} };
dom.window.alert = () => {};
dom.window.io = () => {
  const socket = {
    handlers: {},
    id: "guest-socket-123",
    on(event, cb) { this.handlers[event] = cb; },
    emit(event, data) { console.log(`[Mock Socket Emit] ${event}`, data); },
    trigger(event, data) { if (this.handlers[event]) this.handlers[event](data); }
  };
  dom.window.mockSocket = socket;
  return socket;
};

// Wait for JSDOM to parse and run script
const modifiedGuestAppJs = guestAppJs.replace("document.addEventListener('DOMContentLoaded', () => {", "(() => {").replace(/}\);\s*$/, "})();");
try {
  dom.window.eval(modifiedGuestAppJs);
} catch (err) {
  console.error("Error evaluating guest-app.js:", err);
}

setTimeout(runTests, 500);

function assertActiveScreen(expectedId) {
  const active = dom.window.document.querySelector('.screen.active');
  if (!active || active.id !== expectedId) {
    console.error(`❌ ASSERTION FAILED: Expected active screen to be ${expectedId}, but got ${active ? active.id : 'none'}`);
    process.exit(1);
  }
  console.log(`✅ Verified active screen is ${expectedId}`);
}

function runTests() {
  const socket = dom.window.mockSocket;
  if (!socket) { console.error("Mock socket not found!"); process.exit(1); }

  console.log("\n--- TEST 1: Initial Sync (LOBBY) ---");
  socket.trigger('game:state_sync', { state: 'LOBBY', teams: [] });
  assertActiveScreen('screen-login');

  console.log("\n--- TEST 2: Duplicate nickname is explained before entering team selection ---");
  dom.window.document.getElementById('input-nickname').value = "Taken Name";
  dom.window.document.getElementById('btn-join').click();
  assertActiveScreen('screen-login');
  socket.trigger('guest:join_ack', {
    success: false,
    reason: 'DUPLICATE_NICKNAME',
    nickname: 'Taken Name'
  });
  const duplicateMessage = String(dom.window.document.getElementById('login-error').innerText || '');
  if (!duplicateMessage.includes('已有人使用')) {
    console.error('❌ ASSERTION FAILED: duplicate nickname should have a clear message.');
    process.exit(1);
  }
  assertActiveScreen('screen-login');

  console.log("\n--- TEST 3: Unique guest login waits for server acceptance ---");
  dom.window.document.getElementById('input-nickname').value = "Test User";
  dom.window.document.getElementById('btn-join').click();
  assertActiveScreen('screen-login');
  socket.trigger('guest:join_ack', { success: true, teamId: null });
  assertActiveScreen('screen-team-select');

  console.log("\n--- TEST 4: Choose Team ---");
  const redBtn = dom.window.document.querySelector('.team-btn[data-team="red"]');
  if (redBtn) redBtn.click();
  
  // Pretend server accepted
  socket.trigger('guest:team_chosen', { teamId: 'red' });
  socket.trigger('game:team_updated', {
    teamId: 'red',
    playerInfo: { nickname: 'Test User', avatar: '😎' },
    teamScores: { red: 0, blue: 0 }
  });
  // Should STILL be on team select because the game state is LOBBY
  assertActiveScreen('screen-team-select');

  console.log("\n--- TEST 5: Full Team Is Disabled ---");
  socket.trigger('game:team_updated', {
    teams: [
      { id: 'red', name: 'Red Team', memberCount: 1, maxMembers: 50, isFull: false },
      { id: 'blue', name: 'Blue Team', memberCount: 50, maxMembers: 50, isFull: true }
    ]
  });
  const blueCard = dom.window.document.querySelector('.team-choice-card[data-team="blue"]');
  if (!blueCard.classList.contains('is-full') || !blueCard.querySelector('button').disabled) {
    console.error('❌ ASSERTION FAILED: full team should be disabled.');
    process.exit(1);
  }
  socket.trigger('game:team_full', { teamId: 'blue', maxPlayersPerTeam: 50 });
  if (!String(dom.window.document.getElementById('team-select-message').innerText || '').includes('50')) {
    console.error('❌ ASSERTION FAILED: full-team message should show the capacity.');
    process.exit(1);
  }
  console.log('✅ Verified full team is disabled and explained');

  console.log("\n--- TEST 6: Race Starts ---");
  socket.trigger('game:state_sync', { state: 'RACING', teams: [] });
  assertActiveScreen('screen-racing');

  socket.trigger('game:final_sprint', { hardFinishAt: Date.now() + 60000, durationSeconds: 60 });
  if (!dom.window.document.getElementById('final-sprint-mobile').classList.contains('active')) {
    console.error('❌ ASSERTION FAILED: mobile final sprint banner should be active.');
    process.exit(1);
  }
  console.log('✅ Verified mobile final sprint banner is active');

  console.log("\n--- TEST 7: Return to Lobby (HOST_RESET_GAME) ---");
  socket.trigger('game:state_sync', { state: 'LOBBY', teams: [] });
  assertActiveScreen('screen-team-select');

  console.log("\n--- TEST 8: Next Round Start ---");
  socket.trigger('game:state_sync', { state: 'COUNTDOWN', teams: [] });
  assertActiveScreen('screen-racing');

  console.log("\n🎉 ALL GUEST UI LOGIC TESTS PASSED SUCCESSFULLY! 🎉");
  process.exit(0);
}
