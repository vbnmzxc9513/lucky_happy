const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function createInput() {
  const dom = new JSDOM('<button id="btn-tap"></button><div id="my-stun-alert"></div><div id="tap-feedback-layer"></div>', {
    runScripts: 'outside-only'
  });
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../guest/js/tap-handler.js'), 'utf8'));
  return { dom, button: dom.window.document.getElementById('btn-tap') };
}

test('tap responds locally before network send and ignores disabled or stunned input', () => {
  const { dom, button } = createInput();
  const steps = [];
  button.animate = () => {
    steps.push('animation');
    return { cancel() {} };
  };
  const tap = new dom.window.TapHandler(() => { steps.push('send'); return true; });

  tap.setEnabled(false);
  assert.equal(button.disabled, true);
  button.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
  assert.deepEqual(steps, []);

  tap.setEnabled(true);
  button.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
  assert.deepEqual(steps, ['animation', 'send']);

  tap.setStunned(true);
  tap.lastTapTime = 0;
  button.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
  assert.deepEqual(steps, ['animation', 'send']);
  dom.window.close();
});

test('critical feedback never forces a synchronous layout read', () => {
  const { dom, button } = createInput();
  button.animate = () => ({ cancel() {} });
  Object.defineProperty(button, 'offsetWidth', { get() { throw new Error('layout was forced'); } });
  const tap = new dom.window.TapHandler(() => true);
  tap.showAckFeedback({ success: true, critical: true });
  assert.equal(dom.window.document.querySelectorAll('.critical-hit-feedback').length, 1);
  dom.window.close();
});

test('an expired race does not show a press before the button redraws', () => {
  const { dom, button } = createInput();
  let canTap = true;
  const steps = [];
  button.animate = () => { steps.push('animation'); return { cancel() {} }; };
  const tap = new dom.window.TapHandler(() => { steps.push('send'); return true; }, () => canTap);
  tap.setEnabled(true);
  canTap = false;
  button.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
  assert.deepEqual(steps, []);
  dom.window.close();
});


test('question entry blocks spillover for 500ms, keeps one-click answers and cancels stale callbacks', () => {
  const dom = new JSDOM('<div class="quiz-ctrl-box"><div id="quiz-lock-msg"></div><div id="mobile-quiz-timer"></div>' +
    ['A','B','C','D'].map(opt => `<button class="opt-btn" data-opt="${opt}"><span class="opt-text"></span></button>`).join('') + '</div>', {runScripts:'outside-only'});
  const pending = []; let answers = 0, ready = 0, clock = 0;
  dom.window.performance.now = () => clock;
  dom.window.setTimeout = (fn, ms) => { pending.push({fn,ms}); return pending.length; };
  dom.window.clearTimeout = () => {};
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../guest/js/quiz-ui.js'), 'utf8'));
  const ui = new dom.window.QuizUI(() => { answers++; }, () => {
    ready++; if (!ui.paused && !ui.isAnswered) dom.window.document.querySelectorAll('.opt-btn').forEach(b => b.disabled = false);
  });
  const button = dom.window.document.querySelector('.opt-btn');
  ui.beginQuestion('run:1:1'); ui.showOptions(['one','two','three','four'], 10, () => 7);
  assert.equal(pending[0].ms, 500);
  assert.equal(dom.window.document.getElementById('mobile-quiz-timer').innerText, 7);
  assert.equal(button.disabled, true); button.onclick(); assert.equal(answers, 0);
  ui.beginQuestion('run:1:1'); assert.equal(pending.length, 1);
  clock += 500; pending[0].fn(); button.click(); button.onclick(); assert.equal(answers, 1);
  ui.beginQuestion('run:1:2'); ui.showOptions([], 10); ui.beginQuestion('run:1:3');
  pending[1].fn(); assert.equal(ui.entering, true); assert.equal(ready, 1);
  ui.showTeamResult({correctCount:0,totalCount:1,correctRate:0,isCorrect:false});
  pending[2].fn(); assert.equal(ready, 1); assert.equal(button.disabled, true);
  ui.beginQuestion('run:2:1'); ui.showOptions([], 10); ui.paused = true;
  clock += 500; pending[3].fn(); button.onclick(); assert.equal(answers, 1); assert.equal(button.disabled, true);
  ui.hide(); dom.window.close();
});
