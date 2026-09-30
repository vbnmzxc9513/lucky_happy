const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const config = require('../shared/game-config');
const weddingMap = require('../data/maps/wedding-final-showdown.json');
const weddingQuizzes = require('../data/quizzes/wedding-formal.json').quizzes;
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

assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 16);
assert.strictEqual(window.document.getElementById('quizMetricCount').textContent, '16 題');
assert.strictEqual(window.document.getElementById('quizMetricAutoDuration').textContent, '3:25');
assert.ok(window.document.querySelector('#questionCountForecast .active').textContent.includes('16 題'));

window.addQuizPlanRow({ quizId: 'wc_004', timeLimit: 8 });
assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 17);
assert.strictEqual(window.document.getElementById('quizMetricCount').textContent, '17 題');
window.saveQuizPlan();
assert.equal(emitted.some(entry => entry.event === 'admin:save_map'), false);

window.autoSpreadQuizPlan();
const percents = Array.from(window.document.querySelectorAll('.plan-percent-input')).map(input => Number(input.value));
assert.strictEqual(JSON.stringify(percents), JSON.stringify(Array.from({ length: 17 }, (_, i) => Math.round((i + 1) / 18 * 100))));

window.applyRecommendedQuizPacing();
assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 16);
assert.strictEqual(window.document.getElementById('quizTrackLengthInput').value, '76000');
assert.strictEqual(window.document.getElementById('quizMetricAutoDuration').textContent, '3:25');

window.document.getElementById('quizTriggerFrequency').value = '8';
window.applyQuizFrequencyPlan();
assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 16);
assert.strictEqual(window.document.getElementById('quizMetricAutoDuration').textContent, '3:25');

window.saveQuizPlan();
const saveEvent = emitted.find(entry => entry.event === 'admin:save_map');
const configEvent = emitted.find(entry => entry.event === 'admin:update_config');
assert.ok(saveEvent);
assert.ok(configEvent);
assert.strictEqual(saveEvent.data.id, 'wedding-final-showdown');
assert.strictEqual(saveEvent.data.track.length, 76000);
assert.strictEqual(saveEvent.data.checkpoints.length, 16);
assert.strictEqual(new Set(saveEvent.data.checkpoints.map(cp => cp.quizId)).size, 16);
assert.strictEqual(saveEvent.data.quizPool.length, 16);
assert.strictEqual(configEvent.data.racePacing.targetQuizCount, 16);
assert.strictEqual(configEvent.data.racePacing.triggerFrequencyPercent, 8);

const savedCount = emitted.filter(entry => entry.event === 'admin:save_map').length;
handlers['admin:config_updated']({ ...config, quizStages: { ...config.quizStages, questionsPerStage: 8 } });
window.saveQuizPlan();
assert.equal(emitted.filter(entry => entry.event === 'admin:save_map').length, savedCount, '16 questions in two groups must be rejected');
handlers['admin:config_updated'](config);
window.document.querySelector('.quiz-plan-row:last-child').remove();
window.saveQuizPlan();
assert.equal(emitted.filter(entry => entry.event === 'admin:save_map').length, savedCount, '15 questions must be rejected');

assert.ok(window.document.querySelector('#mapListContainer .btn-danger').disabled);
const beforeDelete = emitted.length;
window.deleteMap('wedding-final-showdown');
assert.strictEqual(emitted.length, beforeDelete, 'protected map must not emit delete');
console.log('✅ admin quiz planner test passed');
window.close();
process.exit(0);
