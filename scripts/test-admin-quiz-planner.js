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
handlers['admin:map_list']([weddingMap]);
handlers['admin:quiz_list']([...weddingQuizzes, ...funQuizzes]);

assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 10);
assert.strictEqual(window.document.getElementById('quizMetricCount').textContent, '10 題');
assert.strictEqual(window.document.getElementById('quizMetricAutoDuration').textContent, '6:30');
assert.ok(window.document.querySelector('#questionCountForecast .active').textContent.includes('10 題'));

window.addQuizPlanRow({ quizId: 'wc_004', timeLimit: 8 });
assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 11);
assert.strictEqual(window.document.getElementById('quizMetricCount').textContent, '11 題');
assert.ok(window.document.querySelector('#questionCountForecast .active').textContent.includes('11 題'));

window.autoSpreadQuizPlan();
const percents = Array.from(window.document.querySelectorAll('.plan-percent-input')).map(input => Number(input.value));
assert.strictEqual(JSON.stringify(percents), JSON.stringify([8, 17, 25, 33, 42, 50, 58, 67, 75, 83, 92]));

window.applyRecommendedQuizPacing();
assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 10);
assert.strictEqual(window.document.getElementById('quizTrackLengthInput').value, '76000');
assert.strictEqual(JSON.stringify(Array.from(window.document.querySelectorAll('.plan-percent-input')).map(input => Number(input.value))), JSON.stringify([9, 18, 27, 36, 45, 54, 63, 72, 81, 90]));

window.document.getElementById('quizTriggerFrequency').value = '8';
window.applyQuizFrequencyPlan();
assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 11);
assert.strictEqual(JSON.stringify(Array.from(window.document.querySelectorAll('.plan-percent-input')).map(input => Number(input.value))), JSON.stringify([8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88]));

window.saveQuizPlan();
const saveEvent = emitted.find(entry => entry.event === 'admin:save_map');
const configEvent = emitted.find(entry => entry.event === 'admin:update_config');
assert.ok(saveEvent);
assert.ok(configEvent);
assert.strictEqual(saveEvent.data.id, 'wedding-final-showdown');
assert.strictEqual(saveEvent.data.track.length, 76000);
assert.strictEqual(saveEvent.data.checkpoints.length, 11);
assert.strictEqual(JSON.stringify(saveEvent.data.checkpoints.map(cp => cp.trigger.percent)), JSON.stringify([8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88]));
assert.strictEqual(saveEvent.data.quizPool.length, 11);
assert.strictEqual(configEvent.data.racePacing.targetQuizCount, 11);
assert.strictEqual(configEvent.data.racePacing.triggerFrequencyPercent, 8);

console.log('✅ admin quiz planner test passed');
window.close();
process.exit(0);
