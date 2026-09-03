const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const events = require('../shared/events');
const config = require('../shared/game-config');

const html = fs.readFileSync(path.join(__dirname, '../control/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../control/js/control-app.js'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost:3000/control/' });
const { window } = dom;
const handlers = {};
const emitted = [];

const socket = {
  auth: {},
  on(event, handler) { handlers[event] = handler; },
  emit(event, data) { emitted.push({ event, data }); },
  connect() { if (handlers.connect) handlers.connect(); }
};

window.GameEvents = events;
window.GameConfig = config;
window.io = () => socket;
window.confirm = () => true;
window.eval(script);
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

assert.strictEqual(socket.auth.role, 'control');
assert.ok(handlers[events.SERVER_TO_CLIENT.GAME_STATE_SYNC]);

const teams = config.TEAMS.map((team, index) => ({
  id: team.id,
  name: team.name,
  memberCount: 30,
  position: (5 - index) * 100,
  isStunned: false
}));

handlers[events.SERVER_TO_CLIENT.GAME_MAP_LIST]([{ id: 'wedding-final-showdown', name: '幸福一戰決勝負' }]);
handlers['admin:quiz_list']([{ id: 'wc_001', question: '測試題目' }]);
handlers[events.SERVER_TO_CLIENT.GAME_STATE_SYNC]({
  state: 'LOBBY',
  paused: false,
  totalPlayers: 150,
  teams,
  currentMap: { id: 'wedding-final-showdown', trackLength: 1000 },
  config,
  finalSprint: { raceStartedAt: null },
  presentation: { stage: 'lobby', awardIndex: 0, revealedAwardIndexes: [] }
});

assert.strictEqual(window.document.getElementById('player-count').textContent, '150');
assert.strictEqual(window.document.querySelectorAll('.team-row').length, 5);
assert.strictEqual(window.document.getElementById('btn-start').disabled, false);
assert.strictEqual(window.document.getElementById('btn-award-reveal').disabled, true);

window.document.getElementById('btn-start').click();
assert.ok(emitted.some(entry => entry.event === events.CLIENT_TO_SERVER.CONTROL_START_ROUND));

const resetCountBeforeCancel = emitted.filter(entry => entry.event === events.CLIENT_TO_SERVER.CONTROL_RESET_GAME).length;
window.confirm = () => false;
window.document.getElementById('btn-reset').click();
assert.strictEqual(
  emitted.filter(entry => entry.event === events.CLIENT_TO_SERVER.CONTROL_RESET_GAME).length,
  resetCountBeforeCancel
);
window.confirm = () => true;

handlers[events.SERVER_TO_CLIENT.GAME_STATE_SYNC]({
  state: 'RACING',
  paused: true,
  pausedAt: Date.now(),
  totalPlayers: 150,
  teams,
  currentMap: { id: 'wedding-final-showdown', trackLength: 1000 },
  config,
  finalSprint: { raceStartedAt: Date.now() - 60000 },
  presentation: { stage: 'race', awardIndex: 0, revealedAwardIndexes: [] }
});

assert.strictEqual(window.document.getElementById('paused-badge').hidden, false);
assert.strictEqual(window.document.getElementById('btn-resume').disabled, false);
assert.strictEqual(window.document.getElementById('btn-award-reveal').disabled, true);
window.document.getElementById('btn-resume').click();
assert.ok(emitted.some(entry => entry.event === events.CLIENT_TO_SERVER.CONTROL_RESUME_GAME));

handlers[events.SERVER_TO_CLIENT.GAME_STATE_SYNC]({
  state: 'MATCH_FINISHED',
  paused: false,
  totalPlayers: 150,
  teams,
  currentMap: { id: 'wedding-final-showdown', trackLength: 1000 },
  config,
  finalSprint: { raceStartedAt: Date.now() - 420000 },
  presentation: { stage: 'awards', awardIndex: 1, revealedAwardIndexes: [0] }
});

handlers[events.SERVER_TO_CLIENT.GAME_PRESENTATION_UPDATED]({
  stage: 'awards',
  awardIndex: 1,
  revealedAwardIndexes: [0]
});
assert.strictEqual(window.document.getElementById('award-counter').textContent, '02 / 04');
assert.strictEqual(window.document.getElementById('btn-award-reveal').disabled, false);
window.document.getElementById('btn-award-reveal').click();
assert.ok(emitted.some(entry => entry.event === events.CLIENT_TO_SERVER.CONTROL_AWARD_ACTION && entry.data.action === 'reveal'));

clearInterval(window.raceClockTimer);
console.log('PASS control UI flow');
window.close();
process.exit(0);
