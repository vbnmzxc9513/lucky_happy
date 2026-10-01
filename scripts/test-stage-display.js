const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const config = require('../shared/game-config');
const dom = new JSDOM('<body><div id="app-container"></div><div id="mobile-app"></div></body>', { runScripts: 'outside-only' });
const window = dom.window;
window.GameConfig = config;
window.requestAnimationFrame = () => 1;
window.cancelAnimationFrame = () => {};
for (const file of ['distance-display', 'summary-motion']) window.eval(fs.readFileSync(require.resolve('../shared/' + file), 'utf8'));
window.eval(fs.readFileSync(require.resolve('../shared/stage-display.js'), 'utf8'));
const stage = {
  phase: 'summary', stageNumber: 1, stageCount: 4, questionNumber: 4, endsAt: Date.now() + 8000,
  summary: { summaryStartedAt: Date.now(), movementStartedAt: Date.now()+800, movementEndsAt: Date.now()+3800, readyAt: Date.now()+4800, teamResults: Object.fromEntries(config.TEAMS.map((team, index) => {
    const count = Math.min(index, 4);
    return [team.id, { correctCount: count, steps: [0, 1, 2, 4, 6][count], position: 10 + [0, 1, 2, 4, 6][count] * 1500, answers: [0, 1, 2, 3].map(i => i < count) }];
  })) }
};
const state = { config, serverNow: Date.now(), quizStage: stage };
try {
  const host = new window.StageDisplay('host');
  host.sync(state);
  assert.equal(host.summary.querySelectorAll('.stage-team').length, 5);
  assert.equal(host.summary.querySelectorAll('.stage-stars span').length, 20);
  assert.deepEqual([...host.summary.querySelectorAll('.stage-reward')].map(el => el.textContent), [0, 1, 2, 4, 6].map(n => `前進 ${n*100} m`));
  assert.deepEqual([...host.summary.querySelectorAll('.stage-distance')].map(el => el.textContent), [10, 1510, 3010, 6010, 9010].map(n => `總距離 ${Math.floor(n/15)} m`));
  assert.equal(host.summary.querySelectorAll('.stage-perfect-seal, .stage-confetti').length, 0);
  const firstStar = host.summary.querySelector('.stage-stars span');
  host.sync(state);
  assert.equal(host.summary.querySelector('.stage-stars span'), firstStar, 'sync must not restart animation');
  host.sync({ ...state, paused: true });
  assert.ok(host.summary.classList.contains('is-paused'));
  assert.ok(window.document.body.classList.contains('stage-summary-active'));
  const guest = new window.StageDisplay('guest');
  guest.sync(state, 'pink');
  assert.equal(guest.summary.querySelectorAll('.stage-team').length, 1);
  assert.equal(guest.summary.querySelector('.stage-reward').textContent, '前進 400 m');
  host.sync({ ...state, quizStage: null });
  guest.sync({ ...state, quizStage: null }, 'pink');
  assert.ok(host.summary.hidden && guest.summary.hidden);
  assert.ok(!window.document.body.classList.contains('stage-summary-active'));
  const current = {...state, runId:'new-run', stateVersion:10, paused:true, pausedAt:state.serverNow,
    quizStage:{...stage,flowRevision:10}};
  host.sync(current);
  const runner = host.runners[4].runner;
  host.sync({...current,stateVersion:9,quizStage:{...stage,phase:'tap',flowRevision:9}});
  assert.equal(host.runners[4].runner,runner); assert.equal(host.stage.phase,'summary');
  host.sync({...current,stateVersion:11,quizStage:{...stage,phase:'tap',flowRevision:9}});
  assert.equal(host.stage.phase,'summary');
  host.sync({...current,runId:'reset-run',stateVersion:0,quizStage:null});
  host.sync({...current,stateVersion:999});assert.equal(host.summary.hidden,true,'old run stays hidden');
  console.log('PASS stage display: five teams, private team summary, idempotent sync, pause, reset');
} finally {
  window.close();
}
