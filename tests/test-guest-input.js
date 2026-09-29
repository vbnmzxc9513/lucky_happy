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
