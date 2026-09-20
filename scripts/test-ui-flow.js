const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');
const path = require('path');

const hostHtmlPath = path.join(__dirname, '../host/index.html');
const htmlContent = fs.readFileSync(hostHtmlPath, 'utf8');

// We need to inject our scripts directly since JSDOM loading external scripts might have cross-origin or path issues locally
const hostAppJsPath = path.join(__dirname, '../host/js/host-app.js');
const hostAppJs = fs.readFileSync(hostAppJsPath, 'utf8');

const dom = new JSDOM(htmlContent, {
  url: "http://localhost:3000/host/",
  runScripts: "outside-only"
});

// Setup mock io()
dom.window.io = () => {
  const socket = {
    handlers: {},
    on(event, cb) {
      this.handlers[event] = cb;
    },
    emit(event, data) {
      console.log(`[Mock Socket Emit] ${event}`, data);
    },
    trigger(event, data) {
      if (this.handlers[event]) {
        this.handlers[event](data);
      }
    }
  };
  dom.window.mockSocket = socket;
  return socket;
};

// Mock other dependencies
dom.window.GameEvents = {
  CLIENT_TO_SERVER: { HOST_START_ROUND: 'host:start_round', HOST_RESET_GAME: 'host:reset_game' },
  SERVER_TO_CLIENT: {
    GAME_STATE_SYNC: 'game:state_sync',
    GAME_FINAL_SPRINT: 'game:final_sprint',
    GAME_ITEM_TRIGGERED: 'game:item_triggered',
    GAME_PRESENTATION_UPDATED: 'game:presentation_updated',
    GAME_QUIZ_RESULT: 'game:quiz_result'
  }
};
dom.window.GameConfig = {
  TEAMS: [
    { id: 'red', name: 'Red Team', color: 'red' },
    { id: 'blue', name: 'Blue Team', color: 'blue' }
  ]
};
dom.window.RaceRenderer = class {
  initTrack() { console.log('[Mock RaceRenderer] initTrack'); }
  updatePositions() {}
};
dom.window.QuizDisplay = class {
  init() {}
  hide() { console.log('[Mock QuizDisplay] hide'); }
  showQuiz() {}
  showResult() {}
};
dom.window.MapSelectUI = class {
  init() {}
  render() {}
};
dom.window.ScoreboardUI = class {
  init() {}
  render() {}
};
dom.window.effects = {
  init: () => {},
  createFireworks: () => {}
};
const playedSounds = [];
dom.window.GameSound = {
  enable: async () => true,
  isEnabled: () => true,
  play: name => {
    playedSounds.push(name);
    return true;
  }
};

// Wait for JSDOM to parse and then run our host-app script
console.log("Injecting host-app.js...");
const modifiedHostAppJs = hostAppJs.replace("document.addEventListener('DOMContentLoaded', () => {", "(() => {").replace(/}\);\s*$/, "})();");
try {
  dom.window.eval(modifiedHostAppJs);
} catch (err) {
  console.error("Error evaluating host-app.js:", err);
}

setTimeout(runTests, 500); // Wait for scripts to bind

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
  if (!socket) {
    console.error("Mock socket not found!");
    process.exit(1);
  }

  console.log("\n--- TEST 1: Initial Sync (LOBBY) ---");
  socket.trigger('game:state_sync', { state: 'LOBBY' });
  assertActiveScreen('screen-lobby');

  console.log("\n--- TEST 2: Start Round flow (UI only) ---");
  dom.window.document.getElementById('btn-start-round').click();
  assertActiveScreen('screen-rules');
  
  dom.window.document.getElementById('btn-rules-proceed').click();
  assertActiveScreen('screen-team-select');

  console.log("\n--- TEST 3: State Sync -> COUNTDOWN -> RACING ---");
  // Server triggers COUNTDOWN
  socket.trigger('game:state_sync', { state: 'COUNTDOWN', currentMap: { trackLength: 1000 } });
  assertActiveScreen('screen-racing');
  if (dom.window._countdownActive !== true) {
    console.error("❌ ASSERTION FAILED: _countdownActive should be true during COUNTDOWN.");
    process.exit(1);
  }
  console.log(`✅ Verified _countdownActive is true`);
  if (!playedSounds.includes('countdown')) {
    console.error('❌ ASSERTION FAILED: countdown should play a sound.');
    process.exit(1);
  }

  // Server triggers RACING
  socket.trigger('game:state_sync', { state: 'RACING' });
  assertActiveScreen('screen-racing');
  if (dom.window._countdownActive !== false) {
    console.error("❌ ASSERTION FAILED: _countdownActive should be false during RACING.");
    process.exit(1);
  }
  console.log(`✅ Verified _countdownActive is false`);

  console.log("\n--- TEST 4: Final Sprint Announcement ---");
  socket.trigger('game:final_sprint', { hardFinishAt: Date.now() + 60000, durationSeconds: 60 });
  const sprintOverlay = dom.window.document.getElementById('final-sprint-overlay');
  if (!sprintOverlay.classList.contains('active')) {
    console.error('❌ ASSERTION FAILED: final sprint overlay should be active.');
    process.exit(1);
  }
  console.log('✅ Verified final sprint overlay is active');
  if (!playedSounds.includes('sprint')) {
    console.error('❌ ASSERTION FAILED: final sprint should play a sound.');
    process.exit(1);
  }

  socket.trigger('game:presentation_updated', { revealedAwardIndexes: [0], awardIndex: 0 });
  if (!playedSounds.includes('award')) {
    console.error('❌ ASSERTION FAILED: award reveal should play a sound.');
    process.exit(1);
  }

  socket.trigger('game:state_sync', { state: 'QUIZ', currentMap: { trackLength: 1000 } });
  socket.trigger('game:quiz_result', { teamResults: { red: { isCorrect: true } } });
  if (!playedSounds.includes('correct')) {
    console.error('❌ ASSERTION FAILED: a correct quiz result should play a sound.');
    process.exit(1);
  }

  console.log("\n--- TEST 5: Return to Lobby (HOST_RESET_GAME) ---");
  // Override confirm to always return true
  dom.window.confirm = () => true;
  dom.window.document.getElementById('btn-back-to-lobby').click();
  
  // The UI should synchronously jump to lobby
  assertActiveScreen('screen-lobby');
  if (dom.window._countdownActive !== false) {
    console.error("❌ ASSERTION FAILED: _countdownActive should be explicitly reset to false after back-to-lobby!");
    process.exit(1);
  }
  console.log(`✅ Verified _countdownActive is reset to false`);
  if (sprintOverlay.classList.contains('active')) {
    console.error('❌ ASSERTION FAILED: final sprint overlay should clear in lobby.');
    process.exit(1);
  }

  console.log("\n--- TEST 6: Start New Game ---");
  // Server responds to HOST_RESET_GAME with LOBBY
  socket.trigger('game:state_sync', { state: 'LOBBY' });
  assertActiveScreen('screen-lobby');

  dom.window.document.getElementById('btn-start-round').click();
  assertActiveScreen('screen-rules');
  
  dom.window.document.getElementById('btn-rules-proceed').click();
  assertActiveScreen('screen-team-select');

  console.log("\n--- TEST 7: Start the Race Again ---");
  dom.window.document.getElementById('btn-team-select-proceed').click();
  
  socket.trigger('game:state_sync', { state: 'COUNTDOWN', currentMap: { trackLength: 1000 } });
  assertActiveScreen('screen-racing');

  console.log("\n🎉 ALL UI LOGIC TESTS PASSED SUCCESSFULLY! 🎉");
  dom.window.close();
  setImmediate(() => process.exit(0));
}
