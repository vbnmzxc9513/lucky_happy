const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const config = require('../shared/game-config');
const dom = new JSDOM('<body><div id="app-container"></div><div id="mobile-app"></div></body>', { runScripts: 'outside-only' });
const window = dom.window;
window.eval(fs.readFileSync(require.resolve('../shared/stage-display.js'), 'utf8'));
const stage = {
  phase: 'summary', stageNumber: 1, stageCount: 6, questionNumber: 3, endsAt: Date.now() + 8000,
  summary: { teamResults: Object.fromEntries(config.TEAMS.map((team, index) => {
    const count = Math.min(index, 3);
    return [team.id, { correctCount: count, steps: [0, 1, 2, 4][count], answers: [0, 1, 2].map(i => i < count) }];
  })) }
};
const state = { config, serverNow: Date.now(), quizStage: stage };
try {
  const host = new window.StageDisplay('host');
  host.sync(state);
  assert.equal(host.summary.querySelectorAll('.stage-team').length, 5);
  assert.equal(host.summary.querySelectorAll('.stage-stars span').length, 15);
  const firstStar = host.summary.querySelector('.stage-stars span');
  host.sync(state);
  assert.equal(host.summary.querySelector('.stage-stars span'), firstStar, 'sync must not restart animation');
  host.sync({ ...state, paused: true });
  assert.ok(host.summary.classList.contains('is-paused'));
  assert.ok(window.document.body.classList.contains('stage-summary-active'));
  const guest = new window.StageDisplay('guest');
  guest.sync(state, 'pink');
  assert.equal(guest.summary.querySelectorAll('.stage-team').length, 1);
  assert.equal(guest.summary.querySelector('.stage-reward').textContent, '前進 4 格');
  host.sync({ ...state, quizStage: null });
  guest.sync({ ...state, quizStage: null }, 'pink');
  assert.ok(host.summary.hidden && guest.summary.hidden);
  assert.ok(!window.document.body.classList.contains('stage-summary-active'));
  console.log('PASS stage display: five teams, private team summary, idempotent sync, pause, reset');
} finally {
  window.close();
}
