const test = require('node:test');
const assert = require('node:assert/strict');
const { RequestTracker, applyState, canSend } = require('../scripts/stress-wedding-game');

test('ACK timing matches request and run, never FIFO across reconnections', () => {
  let now = 0;
  const tracker = new RequestTracker('qa', () => now);
  const state = { runId: 'one', stateVersion: 1 };
  const first = tracker.begin('tap', state);
  now = 10;
  const second = tracker.begin('tap', state);
  now = 30;
  assert.equal(tracker.acknowledge('tap', { ...second, success: true }), 20);
  assert.equal(tracker.acknowledge('tap', { ...first, runId: 'old', success: true }), null);
  tracker.abandon();
  now = 100;
  const third = tracker.begin('tap', state);
  assert.equal(tracker.acknowledge('tap', { ...first, success: true }), null);
  now = 115;
  assert.equal(tracker.acknowledge('tap', { ...third, success: false }), 15);
  assert.deepEqual(tracker.summary('tap'), {
    sent: 3, acknowledged: 2, accepted: 1, rejected: 1, missing: 0,
    abandonedOnDisconnect: 1, abandonedOnStateChange: 0, unmatchedAcks: 2, pending: 0
  });
});

test('expired ACKs stay missing and cannot inflate accepted counts', () => {
  let now = 0;
  const tracker = new RequestTracker('qa', () => now);
  const request = tracker.begin('quiz', { runId: 'one', stateVersion: 1 });
  now = 5001;
  tracker.expire(5000);
  assert.equal(tracker.acknowledge('quiz', { ...request, success: true }), null);
  assert.equal(tracker.summary('quiz').missing, 1);
  assert.equal(tracker.summary('quiz').accepted, 0);
});

test('a delayed heartbeat cannot make expired race input fresh again', () => {
  const client = { socket: { connected: true }, connected: true, requests: new RequestTracker('qa'), answeredQuizIds: new Set() };
  const state = { runId: 'one', stateVersion: 1, state: 'RACING', paused: false,
    serverNow: 100000, endsAt: 108000, self: { joined: true, teamId: 'red' } };
  assert.equal(applyState(client, state, 0), true);
  assert.equal(canSend(client, 'RACING', 100), true);
  applyState(client, { ...state, serverNow: 101000 }, 6000);
  assert.equal(canSend(client, 'RACING', 6000), false);
  applyState(client, { ...state, serverNow: 108001 }, 8001);
  assert.equal(canSend(client, 'RACING', 8001), false);
  client.socket.connected = false;
  assert.equal(canSend(client, 'RACING', 100), false);
});
