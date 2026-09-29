const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const events = require('../shared/events');
const config = require('../shared/game-config');

const html = fs.readFileSync(path.join(__dirname, '../control/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../control/js/control-app.js'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://192.168.172.2:3997/control/' });
const { window } = dom;
const handlers = {};
const emitted = [];

const socket = {
  auth: {}, connected: true,
  on(event, handler) { handlers[event] = handler; },
  emit(event, data) { emitted.push({ event, data }); },
  connect() { if (handlers.connect) handlers.connect(); }
};

window.GameEvents = events;
window.GameConfig = config;
window.io = () => socket;
window.confirm = () => true;
window.eval(fs.readFileSync(path.join(__dirname, '../shared/client-id.js'), 'utf8'));
Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true });
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

const flowState = { runId: 'flow-run', state: 'QUIZ', paused: false, teams, config,
  currentMap: { id: 'wedding-final-showdown', trackLength: 1000 } };
for (const [phase, questionNumber, stageNumber, label] of [
  ['awaiting_question', 1, 1, '開始第 1 題'], ['reveal', 1, 1, '下一題'],
  ['reveal', 3, 1, '顯示本關結算'], ['summary', 3, 1, '開始下一關'],
  ['summary', 3, 5, '開始最後衝刺']
]) {
  const state = { ...flowState, quizStage: { phase, questionNumber, stageNumber, stageCount: 5, flowRevision: 7 } };
  handlers[events.SERVER_TO_CLIENT.GAME_STATE_SYNC](state);
  const button = window.document.getElementById('btn-advance-quiz');
  assert.equal(button.textContent, label);
  assert.equal(button.disabled, false);
  button.click();
  assert.equal(button.disabled, true);
  const operation = emitted.at(-1);
  assert.equal(operation.event, events.CLIENT_TO_SERVER.CONTROL_ADVANCE_QUIZ_FLOW);
  assert.equal(operation.data.flowRevision, 7);
  assert.ok(operation.data.requestId);
  button.click(); assert.equal(emitted.at(-1), operation);
  handlers[events.SERVER_TO_CLIENT.CONTROL_ACTION_RESULT]({ action: 'ADVANCE_QUIZ_FLOW',
    requestId: operation.data.requestId, success: false, reason: 'STALE_FLOW', state });
  assert.ok(window.document.getElementById('control-toast').textContent.includes('STALE_FLOW'));
  handlers[events.SERVER_TO_CLIENT.GAME_STATE_SYNC]({ ...state, paused: true });
  assert.equal(button.disabled, true);
  handlers[events.SERVER_TO_CLIENT.GAME_STATE_SYNC](state);
  socket.connected = false; handlers.disconnect(); assert.equal(button.disabled, true);
  socket.connected = true; handlers.connect(); assert.equal(button.disabled, true);
  const beforeSync = emitted.length;
  // Exercise even previously enabled controls: the shared event gate must reject them all.
  const controlSelectors = ['#stage-controls button', '#btn-reset', '#btn-award-reveal',
    '#btn-award-prev', '#btn-award-next', '#btn-force-quiz', '#btn-force-boost', '#btn-force-stun'];
  for (const selector of controlSelectors) {
    const control = window.document.querySelector(selector);
    control.disabled = false;
    control.click();
  }
  window.document.getElementById('map-select').dispatchEvent(new window.Event('change'));
  assert.equal(emitted.length, beforeSync, 'no control event may use the stale reconnect snapshot');
  assert.ok(window.document.getElementById('control-toast').textContent.includes('正在同步'));
  handlers[events.SERVER_TO_CLIENT.GAME_STATE_SYNC](state); assert.equal(button.disabled, false);
  window.document.querySelector('#stage-controls button').click();
  assert.equal(emitted.at(-1).event, events.CLIENT_TO_SERVER.CONTROL_SET_PRESENTATION);
}
for (const phase of ['tap', 'answer', 'prepare', 'sprint']) {
  handlers[events.SERVER_TO_CLIENT.GAME_STATE_SYNC]({ ...flowState, quizStage: { phase } });
  assert.equal(window.document.getElementById('btn-advance-quiz').disabled, true);
}

// A missing ACK must still be able to request a fresh snapshot through the gate.
handlers[events.SERVER_TO_CLIENT.GAME_STATE_SYNC]({ ...flowState,
  quizStage: { phase: 'reveal', questionNumber: 1, stageNumber: 1, stageCount: 5, flowRevision: 9 } });
const originalTimeout = window.setTimeout;
let expireAdvance;
window.setTimeout = (fn, ms) => ms === 5000 ? (expireAdvance = fn, 0) : originalTimeout(fn, ms);
window.document.getElementById('btn-advance-quiz').click();
assert.equal(typeof expireAdvance, 'function');
expireAdvance();
assert.equal(emitted.at(-1).event, events.CLIENT_TO_SERVER.GUEST_SYNC);
const syncCount = emitted.length;
window.document.querySelector('#stage-controls button').click();
assert.equal(emitted.length, syncCount);
window.setTimeout = originalTimeout;

socket.connected = false;
handlers.connect_error(new Error('websocket error'));
assert.equal(window.document.getElementById('connection-status').textContent, '網路中斷，正在重連');
assert.ok(!window.document.getElementById('control-toast').textContent.includes('驗證碼'));
assert.ok(window.document.getElementById('btn-pause').disabled);
handlers.connect_error(new Error('UNAUTHORIZED_STAFF_SOCKET'));
assert.ok(window.document.getElementById('control-toast').textContent.includes('驗證碼'));
const requestIds = emitted.filter(e => e.event === events.CLIENT_TO_SERVER.CONTROL_ADVANCE_QUIZ_FLOW).map(e => e.data.requestId);
assert.equal(new Set(requestIds).size, requestIds.length);
requestIds.forEach(id => assert.match(id, /^[A-Za-z0-9_.:-]{1,100}$/));
Object.defineProperty(window, 'crypto', { value: undefined });
assert.match(window.GameClientId.create(), /^[A-Za-z0-9_.:-]{16,100}$/);
clearInterval(window.raceClockTimer);
console.log('PASS control UI flow');
window.close();
process.exit(0);
