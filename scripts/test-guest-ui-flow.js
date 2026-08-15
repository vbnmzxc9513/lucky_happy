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
  runScripts: "dangerously",
  resources: "usable"
});

dom.window.GameEvents = {
  CLIENT_TO_SERVER: { GUEST_JOIN: 'guest:join', GUEST_CHOOSE_TEAM: 'guest:choose_team', GUEST_TAP: 'guest:tap', GUEST_QUIZ_ANSWER: 'guest:quiz_answer' },
  SERVER_TO_CLIENT: { GAME_STATE_SYNC: 'game:state_sync', GAME_TEAM_UPDATED: 'game:team_updated', SYSTEM_ERROR: 'system:error', GAME_JOIN_LOCKED: 'game:join_locked' }
};
dom.window.GameConfig = {
  TEAMS: [
    { id: 'red', name: 'Red Team', color: 'red' },
    { id: 'blue', name: 'Blue Team', color: 'blue' }
  ]
};
dom.window.TapHandler = class { init() {} stop() {} };
dom.window.QuizUI = class { init() {} showOptions() {} hide() {} };
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

  console.log("\n--- TEST 2: Guest Login ---");
  dom.window.document.getElementById('input-nickname').value = "Test User";
  dom.window.document.getElementById('btn-join').click();
  
  // Pretend server accepted
  socket.trigger('game:team_updated', {
    teamId: null,
    playerInfo: { nickname: 'Test User', avatar: '😎', joinedAt: Date.now() },
    teamScores: { red: 0, blue: 0 }
  });
  // Without a teamId, should go to team select
  assertActiveScreen('screen-team-select');

  console.log("\n--- TEST 3: Choose Team ---");
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

  console.log("\n--- TEST 4: Race Starts ---");
  socket.trigger('game:state_sync', { state: 'RACING', teams: [] });
  assertActiveScreen('screen-racing');

  console.log("\n--- TEST 5: Return to Lobby (HOST_RESET_GAME) ---");
  socket.trigger('game:state_sync', { state: 'LOBBY', teams: [] });
  assertActiveScreen('screen-team-select');

  console.log("\n--- TEST 6: Next Round Start ---");
  socket.trigger('game:state_sync', { state: 'COUNTDOWN', teams: [] });
  assertActiveScreen('screen-racing');

  console.log("\n🎉 ALL GUEST UI LOGIC TESTS PASSED SUCCESSFULLY! 🎉");
  process.exit(0);
}
