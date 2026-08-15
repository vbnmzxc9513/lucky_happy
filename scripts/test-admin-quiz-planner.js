const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const config = require('../shared/game-config');
const weddingMap = require('../data/maps/wedding-final-showdown.json');
const weddingQuizzes = require('../data/quizzes/wedding-couples.json').quizzes;

const html = fs.readFileSync(path.join(__dirname, '../admin/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../admin/js/admin-app.js'), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'http://localhost:3000/admin/'
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

handlers['admin:config_updated'](config);
handlers['admin:map_list']([weddingMap]);
handlers['admin:quiz_list'](weddingQuizzes);

assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 3);
assert.strictEqual(window.document.getElementById('quizMetricCount').textContent, '3 題');
assert.strictEqual(window.document.getElementById('quizMetricAutoDuration').textContent, '7:00');
assert.ok(window.document.querySelector('#questionCountForecast .active').textContent.includes('3 題'));

window.addQuizPlanRow({ quizId: 'wc_004', timeLimit: 8 });
assert.strictEqual(window.document.querySelectorAll('.quiz-plan-row').length, 4);
assert.strictEqual(window.document.getElementById('quizMetricCount').textContent, '4 題');
assert.ok(window.document.querySelector('#questionCountForecast .active').textContent.includes('4 題'));

window.autoSpreadQuizPlan();
const percents = Array.from(window.document.querySelectorAll('.plan-percent-input')).map(input => Number(input.value));
assert.strictEqual(JSON.stringify(percents), JSON.stringify([20, 40, 60, 80]));

window.saveQuizPlan();
const saveEvent = emitted.find(entry => entry.event === 'admin:save_map');
assert.ok(saveEvent);
assert.strictEqual(saveEvent.data.id, 'wedding-final-showdown');
assert.strictEqual(saveEvent.data.checkpoints.length, 4);
assert.strictEqual(JSON.stringify(saveEvent.data.checkpoints.map(cp => cp.trigger.percent)), JSON.stringify([20, 40, 60, 80]));
assert.strictEqual(saveEvent.data.quizPool.length, 4);

console.log('✅ admin quiz planner test passed');
