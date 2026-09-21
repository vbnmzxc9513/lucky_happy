const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const config = require('../shared/game-config');
const weddingMap = require('../data/maps/wedding-final-showdown.json');
const weddingQuizzes = require('../data/quizzes/wedding-couples.json').quizzes;
const funQuizzes = require('../data/quizzes/fun-trivia.json').quizzes;

const html = fs.readFileSync(path.join(__dirname, '../admin/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../admin/js/admin-app.js'), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'http://localhost:3000/admin/#tab-quiz'
});

const { window } = dom;
const handlers = {};
const emitted = [];

window.GameConfig = config;
window.StagePlan = require('../shared/stage-plan');
window.confirm = () => true;
window.fetch = async () => ({
  ok: true,
  json: async () => ({ token: 'test-token' })
});
window.io = () => ({
  auth: {},
  on(event, callback) {
    handlers[event] = callback;
  },
  emit(event, data) {
    emitted.push({ event, data });
  },
  connect() {
    if (handlers.connect) handlers.connect();
  }
});

window.eval(script);
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

assert.ok(window.document.getElementById('tab-quiz').classList.contains('active'));

handlers['admin:config_updated'](config);
assert.strictEqual(window.document.getElementById('quizTriggerFrequency').value, '8');
handlers['admin:config_updated']({ ...config, quizStages: { ...config.quizStages, tapSeconds: 12 } });
assert.strictEqual(window.document.getElementById('quizTriggerFrequency').value, '12');
handlers['admin:config_updated'](config);
handlers['admin:map_list']([weddingMap]);
handlers['admin:quiz_list']([...weddingQuizzes, ...funQuizzes, ...require('../data/quizzes/wedding-party.json').quizzes]);

assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 18);
assert.strictEqual(window.document.getElementById('quizMetricCount').textContent, '18 題');
assert.strictEqual(window.document.getElementById('quizMetricAutoDuration').textContent, '6:55');
assert.ok(window.document.querySelector('#questionCountForecast .active').textContent.includes('18 題'));

window.addQuizPlanRow({ quizId: 'wc_004', timeLimit: 8 });
assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 19);
assert.strictEqual(window.document.getElementById('quizMetricCount').textContent, '19 題');
window.saveQuizPlan();
assert.equal(emitted.some(entry => entry.event === 'admin:save_map'), false);

window.autoSpreadQuizPlan();
const percents = Array.from(window.document.querySelectorAll('.plan-percent-input')).map(input => Number(input.value));
assert.strictEqual(JSON.stringify(percents), JSON.stringify(Array.from({ length: 19 }, (_, i) => (i + 1) * 5)));

window.applyRecommendedQuizPacing();
assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 18);
assert.strictEqual(window.document.getElementById('quizTrackLengthInput').value, '76000');
assert.strictEqual(window.document.getElementById('quizMetricAutoDuration').textContent, '6:55');

window.document.getElementById('quizTriggerFrequency').value = '8';
window.applyQuizFrequencyPlan();
assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 18);
assert.strictEqual(window.document.getElementById('quizMetricAutoDuration').textContent, '6:55');

window.saveQuizPlan();
const saveEvent = emitted.find(entry => entry.event === 'admin:save_map');
const configEvent = emitted.find(entry => entry.event === 'admin:update_config');
assert.ok(saveEvent);
assert.ok(configEvent);
assert.strictEqual(saveEvent.data.id, 'wedding-final-showdown');
assert.strictEqual(saveEvent.data.track.length, 76000);
assert.strictEqual(saveEvent.data.checkpoints.length, 18);
assert.strictEqual(new Set(saveEvent.data.checkpoints.map(cp => cp.quizId)).size, 18);
assert.strictEqual(saveEvent.data.quizPool.length, 18);
assert.strictEqual(configEvent.data.racePacing.targetQuizCount, 18);
assert.strictEqual(configEvent.data.racePacing.triggerFrequencyPercent, 8);

console.log('✅ admin quiz planner test passed');
window.close();
process.exit(0);
