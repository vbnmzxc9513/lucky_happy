const test = require('node:test');
const assert = require('node:assert/strict');
const GameManager = require('../server/game/GameManager');
const Delivery = require('../server/websocket/RealtimeDelivery');
const GuestNetwork = require('../guest/js/guest-network');

function setup() {
  const events = [];
  const io = { sockets: { sockets: new Map() }, emit(event, data) { events.push({ event, data }); },
    to(room) { return { emit(event, data) { events.push({ room, event, data }); },
      volatile: { emit(event, data) { events.push({ room, event, data }); } } }; } };
  const game = new GameManager(io);
  const delivery = game.delivery = new Delivery(io, game);
  return { io, game, delivery, events };
}

test('position rates separate projection, guests and control without changing distances', t => {
  const { delivery, events } = setup(); t.after(() => delivery.close());
  for (let now = 0; now < 1000; now += 34) delivery.positions({ red: { position: now } }, now);
  for (const [role, expected] of Object.entries({ host: 30, guest: 5, control: 2, admin: 2 })) {
    assert.equal(events.filter(e => e.room === (role === 'guest' ? 'team:red' : `role:${role}`)).length, expected);
  }
  assert.equal(events.find(e => e.room === 'role:host').data.teams.red.position, 0);
});

test('190-player guest snapshots and tap receipts shed bulk while preserving authoritative counts', t => {
  const { io, game, delivery } = setup(); t.after(() => delivery.close());
  for (let i = 0; i < 190; i++) {
    game.teamManager.addPlayer(`p${i}`, `Guest${i}`, 'A', `stable-session-${i}`);
    game.teamManager.chooseTeam(`p${i}`, ['red','blue','yellow','pink','purple'][i % 5]);
    game.upsertPlayerStats(game.teamManager.getPlayer(`p${i}`));
  }
  const sent = [];
  const socket = { id: 'p0', data: { role: 'guest', protocolVersion: 2 }, emit: (event, data) => sent.push(data) };
  io.sockets.sockets.set(socket.id, socket);
  delivery.sendState(socket);
  assert.equal(sent[0].self.joined, true);
  assert.equal(sent[0].players, undefined);
  assert.equal(sent[0].activeItems, undefined);
  assert.ok(JSON.stringify(sent[0]).length < JSON.stringify(game.getGameState()).length * .4);
  delivery.sendState(socket);
  assert.equal(sent[1].config, undefined);
  const full = game.buildPlayerStatus('p0'), compact = game.buildTapStatus('p0');
  assert.equal(compact.tapCount, full.tapCount);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length * .4);
});

test('operation IDs prevent double accounting across reconnection and reject stale/conflicting requests', t => {
  const { game, delivery } = setup(); t.after(() => delivery.close());
  game.teamManager.addPlayer('p1', 'One', 'A', 'stable-session-one');
  const payload = { runId: game.runId, stateVersion: game.stateVersion, requestId: 'answer-1', quizId: 'q', answer: 'A' };
  let count = 0;
  const execute = () => ({ success: true, answerTimeMs: ++count * 100 });
  const first = delivery.operation({ id: 'p1' }, 'answer', payload, execute);
  game.teamManager.addPlayer('p2', 'One', 'A', 'stable-session-one');
  game.stateVersion++;
  assert.deepEqual(delivery.operation({ id: 'p2' }, 'answer', payload, execute), first);
  assert.equal(count, 1);
  assert.equal(delivery.operation({ id: 'p2' }, 'answer', { ...payload, answer: 'B' }, execute).reason, 'REQUEST_ID_CONFLICT');
  assert.equal(delivery.operation({ id: 'p2' }, 'tap', { ...payload, requestId: 'new' }, execute).reason, 'STALE_STATE');
  game.resetGame();
  assert.equal(delivery.operation({ id: 'p2' }, 'answer', payload, execute).reason, 'STALE_RUN');
  assert.equal(delivery.operations.size, 0);
});

test('190-player finish sends full awards only to staff and a bounded guest notification', t => {
  const { game, delivery, events } = setup(); t.after(() => delivery.close());
  for (let i = 0; i < 190; i++) {
    game.teamManager.addPlayer(`p${i}`, `Guest${i}`, 'A', `session-${i}`);
    game.teamManager.chooseTeam(`p${i}`, ['red', 'blue', 'yellow', 'pink', 'purple'][i % 5]);
    const stat = game.upsertPlayerStats(game.teamManager.getPlayer(`p${i}`));
    Object.assign(stat, { correctCount: 8, wrongCount: 7, answeredCount: 15, tapCount: 200 });
  }
  game.state = 'MATCH_FINISHED';
  const payload = { finalWinner: 'red', finalAwards: game.buildFinalAwardsPayload() };
  delivery.matchFinished(payload);
  const guest = events.find(e => e.room === 'role:guest');
  const staff = events.find(e => Array.isArray(e.room));
  assert.equal(guest.event, 'game:match_finished');
  assert.equal(guest.data.state, 'MATCH_FINISHED');
  assert.equal(guest.data.runId, game.runId);
  assert.equal(guest.data.finalAwards, undefined);
  assert.equal(staff.data, payload);
  assert.deepEqual(staff.room, ['role:host', 'role:control', 'role:admin']);
  const bytes = Buffer.byteLength(JSON.stringify(guest.data));
  assert.ok(bytes < 256);
  assert.ok(bytes < Buffer.byteLength(JSON.stringify(payload)) * .01);
  assert.ok(bytes * 190 < 50000);
});

test('answer receipts are private, survive reconnect/retry and reset with the match', t => {
  const { game, delivery } = setup(); t.after(() => delivery.close());
  game.teamManager.addPlayer('a', 'One', 'A', 'session-one');
  game.teamManager.addPlayer('b', 'Two', 'B', 'session-two');
  const payload = { runId: game.runId, stateVersion: game.stateVersion, requestId: 'answer-1', quizId: 'q', answer: 'A' };
  let executions = 0;
  const execute = () => { executions++; return { success: true, answer: 'A', isCorrect: true, answerTimeMs: 125 }; };
  delivery.operation({ id: 'a' }, 'answer', payload, execute);
  assert.equal(delivery.answerReceipts('b').length, 0);
  game.teamManager.addPlayer('reconnected-a', 'One', 'A', 'session-one');
  game.stateVersion++;
  delivery.operation({ id: 'reconnected-a' }, 'answer', payload, execute);
  assert.equal(executions, 1);
  const [receipt] = delivery.answerReceipts('reconnected-a');
  assert.equal(receipt.requestId, 'answer-1');
  assert.equal(receipt.quizId, 'q');
  assert.equal(receipt.answer, 'A');
  assert.equal(receipt.isCorrect, true);
  assert.equal(receipt.answerTimeMs, 125);
  assert.ok(Number.isFinite(receipt.receivedAt));
  assert.equal(delivery.answerReceipts('a').length, 0);
  game.resetGame();
  assert.equal(delivery.answerReceipts('reconnected-a').length, 0);
});

test('diagnostic tap receipts record accepted IDs once and clear on reset', t => {
  const previous = process.env.ENABLE_TEST_DIAGNOSTICS;
  process.env.ENABLE_TEST_DIAGNOSTICS = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.ENABLE_TEST_DIAGNOSTICS;
    else process.env.ENABLE_TEST_DIAGNOSTICS = previous;
  });
  const { game, delivery } = setup(); t.after(() => delivery.close());
  game.teamManager.addPlayer('p1', 'One', 'A', 'session-one');
  const payload = { runId: game.runId, stateVersion: game.stateVersion,
    requestId: 'tap-1', timestamp: 1000 };
  let applied = 0;
  const execute = () => ({ success: true, status: { tapCount: ++applied } });
  delivery.operation({ id: 'p1' }, 'tap', payload, execute);
  delivery.operation({ id: 'p1' }, 'tap', payload, execute);
  assert.equal(applied, 1);
  assert.deepEqual(delivery.tapReceipts('p1'), [{ runId: game.runId, requestId: 'tap-1' }]);
  game.teamManager.addPlayer('p2', 'One', 'A', 'session-one');
  assert.equal(delivery.tapReceipts('p2').length, 1);
  game.resetGame();
  assert.equal(delivery.tapReceipts('p2').length, 0);
});

test('roster/progress bursts coalesce and reset cancels pending updates', async t => {
  const { delivery, events } = setup(); t.after(() => delivery.close());
  for (let i = 0; i < 190; i++) { delivery.scheduleRoster(); delivery.scheduleProgress({ teamId: 'red', answeredCount: i }); }
  await new Promise(r => setTimeout(r, 270));
  assert.equal(events.filter(e => e.event === 'game:team_updated' && e.room === 'role:guest').length, 1);
  assert.equal(events.filter(e => e.event === 'game:quiz_progress').length, 1);
  assert.equal(events.find(e => e.event === 'game:quiz_progress').data.answeredCount, 189);
  events.length = 0;
  delivery.scheduleRoster(); delivery.scheduleProgress({ teamId: 'blue' }); delivery.reset();
  await new Promise(r => setTimeout(r, 270));
  assert.equal(events.length, 0);
});

test('operation cache bounds cannot evict same-phase IDs and allow duplicate rewards', t => {
  const { game, delivery } = setup(); t.after(() => delivery.close());
  game.teamManager.addPlayer('p1', 'One', 'A', 'stable-session-one');
  let calls = 0;
  const execute = () => ({ success: true, status: { tapCount: ++calls } });
  const payload = { runId: game.runId, stateVersion: game.stateVersion, requestId: 'tap-0' };
  for (let i = 0; i < 256; i++) delivery.operation({ id: 'p1' }, 'tap', { ...payload, requestId: `tap-${i}` }, execute);
  assert.equal(delivery.operation({ id: 'p1' }, 'tap', { ...payload, requestId: 'extra' }, execute).reason, 'RATE_LIMITED');
  assert.equal(delivery.operation({ id: 'p1' }, 'tap', payload, execute).status.tapCount, 1);
  assert.equal(calls, 256);
  game.stateVersion++;
  assert.equal(delivery.operation({ id: 'p1' }, 'tap', { ...payload, requestId: 'new-phase', stateVersion: game.stateVersion }, execute).success, true);
  assert.equal(delivery.operation({ id: 'p1' }, 'tap', payload, execute).reason, 'STALE_STATE');
  game.quizStage = { endsAt: Date.now() - 1 };
  assert.equal(delivery.operation({ id: 'p1' }, 'tap', { ...payload, requestId: 'late', stateVersion: game.stateVersion }, execute).reason, 'WINDOW_CLOSED');
  assert.equal(calls, 257);
});

function phone() {
  let now = 1000, seq = 0;
  const sent = [], socket = { connected: true, emit: (event, data) => sent.push({ event, data }) };
  const client = new GuestNetwork({ socket, now: () => now, requestId: () => `op-${++seq}` });
  client.connect(false);
  const state = { runId: 'run-1', stateVersion: 1, serverNow: 1000, state: 'RACING', paused: false,
    endsAt: 9000, quizStage: { phase: 'tap', endsAt: 9000 }, self: { joined: true, teamId: 'red' } };
  client.applySnapshot(state);
  return { client, socket, sent, state, advance: ms => { now += ms; } };
}

test('edited question banks reach control/admin only, never guests', () => {
  const AdminHandler = require('../server/websocket/AdminHandler');
  const handlers = {}, broadcasts = [];
  const io = { to: rooms => ({ emit: (event, data) => broadcasts.push({ rooms, event, data }) }) };
  const game = { config: {}, mapManager: { getMapList: () => [] },
    quizLoader: { getAllQuizzes: () => [{ id: 'q', answer: 'A' }], saveQuiz: () => true, deleteQuiz: () => true } };
  new AdminHandler(io, game).register({ emit() {}, on: (event, handler) => { handlers[event] = handler; } });
  handlers['admin:save_quiz']({ id: 'q' });
  handlers['admin:delete_quiz']({ quizId: 'q' });
  assert.equal(broadcasts.length, 2);
  for (const broadcast of broadcasts) {
    assert.deepEqual(broadcast.rooms, ['role:admin', 'role:control']);
    assert.equal(broadcast.event, 'admin:quiz_list');
  }
});

test('phone gives no offline or stale taps, never replays them and rejects old run/position', () => {
  const { client, socket, sent, state, advance } = phone();
  assert.equal(client.tap(1), true);
  socket.connected = false; client.disconnect();
  assert.equal(client.tap(2), false);
  assert.equal(client.taps.size, 0);
  socket.connected = true; client.connect(true);
  assert.equal(client.tap(3), false);
  client.identityRestored(); client.applySnapshot(state);
  assert.equal(client.tap(4), true);
  advance(3100); client.tick();
  assert.equal(client.tap(5), false);
  assert.equal(sent.filter(e => e.event === 'guest:tap').length, 2);
  client.applySnapshot({ ...state, runId: 'run-2', serverNow: 4100 });
  assert.equal(client.applySnapshot({ ...state, serverNow: 4100 }), false);
  assert.equal(client.position({ ...state, seq: 100, serverNow: 4100 }), false);
});

test('answer retries use one ID, pause/deadline stop retries and confirmed answer stays locked', () => {
  const { client, sent, state, advance } = phone();
  const quizState = { ...state, state: 'QUIZ', stateVersion: 2, quizStage: { phase: 'answer', endsAt: 5000 }, endsAt: 5000 };
  client.applySnapshot(quizState);
  client.applyOptions({ ...quizState, quizId: 'q', options: { A: 'A' }, alreadyAnswered: false });
  assert.equal(client.answer('A'), true);
  advance(1000); client.tick(); advance(1000); client.tick(); advance(100); client.tick();
  const attempts = sent.filter(e => e.event === 'guest:quiz_answer');
  assert.equal(attempts.length, 3);
  assert.equal(new Set(attempts.map(e => e.data.requestId)).size, 1);
  assert.equal(client.answerAck({ ...attempts[0].data, success: true }), true);
  assert.equal(client.canAnswer(), false);
  client.applySnapshot({ ...quizState, paused: true, stateVersion: 3, serverNow: 3100 });
  assert.equal(client.canAnswer(), false);
});

test('a rejected answer unlocks only after authoritative unanswered recovery', () => {
  const { client, sent, state } = phone();
  const quizState = { ...state, state: 'QUIZ', stateVersion: 2, quizStage: { phase: 'answer', endsAt: 5000 }, endsAt: 5000 };
  const options = { ...quizState, quizId: 'q', options: { A: 'A' }, alreadyAnswered: false };
  client.applySnapshot(quizState); client.applyOptions(options);
  client.answer('A');
  const payload = sent.find(e => e.event === 'guest:quiz_answer').data;
  client.answerAck({ ...payload, success: false, reason: 'GAME_PAUSED' });
  assert.equal(client.canAnswer(), false);
  client.applySnapshot(quizState);
  assert.equal(client.canAnswer(), false);
  client.applyOptions(options);
  assert.equal(client.canAnswer(), true);
  client.answer('A');
  const attempts = sent.filter(e => e.event === 'guest:quiz_answer');
  assert.notEqual(attempts[0].data.requestId, attempts[1].data.requestId);
  client.requireSync(); client.applySnapshot(quizState);
  client.applyOptions({ ...options, alreadyAnswered: true });
  assert.equal(client.canAnswer(), false);
});

for (const phase of ['awaiting_question', 'answer', 'reveal', 'summary', 'sprint']) {
  test(`Recovery isolates guest statistics in ${phase}`, t => {
    const { game, delivery, events } = setup(); t.after(() => delivery.close());
    game.teamManager.addPlayer('g', 'Guest', 'A', 'private-result-session');
    game.teamManager.chooseTeam('g', 'red');
    game.quizManager.startQuiz('wc_001', { red: 2, blue: 10 });
    const result = game.quizManager.calculateResults();
    game.quizStage = { phase, stageNumber: 1, stageCount: 4, questionNumber: 3,
      flowRevision: 7, endsAt: null, results: [result], reveal: result,
      summary: { stageNumber: 1, teamResults: { red: { steps: 0 }, blue: { steps: 4 } } } };
    for (const role of ['host', 'control', 'admin', 'guest']) {
      let state;
      delivery.sendState({ id: 'g', data: { role }, emit(event, payload) { state = payload; } });
      assert.equal(state.quizStage.phase, phase);
      if (role === 'guest') {
        assert.equal(state.quizStage.results, undefined);
        assert.equal(state.quizStage.reveal.teamResults, undefined);
        assert.equal(state.quizStage.reveal.distribution, undefined);
        assert.equal(state.quizStage.reveal.options, undefined);
        assert.deepEqual(Object.keys(state.quizStage.summary.teamResults), ['red']);
        assert.equal(state.quizStage.reveal.teamResult.totalCount, 2);
      } else assert.deepEqual(state.quizStage.reveal, result);
    }
    delivery.quizResult(result);
    const guest = events.find(e => e.event === 'game:quiz_result' && e.room === 'team:red');
    assert.equal(guest.data.teamResult.totalCount, 2);
    assert.equal(guest.data.teamResults, undefined);
    assert.equal(guest.data.distribution, undefined);
    assert.ok(events.some(e => Array.isArray(e.room) && e.data.distribution));
    assert.ok(!events.some(e => e.event === 'game:quiz_result' && !e.room));
  });
}

test('Advance authorization rejects projection, guest, unverified and expired staff with explicit private ACK', t => {
  const { game, io, delivery } = setup(); t.after(() => delivery.close());
  const Router = require('../server/websocket/SocketRouter');
  const router = Object.create(Router.prototype); router.gameManager = game; router.io = io;
  for (const [role, authenticated] of [['host', true], ['guest', false], [undefined, false], ['control', false]]) {
    let handler, ack;
    const socket = { data: { role, hasStaffAccess: () => authenticated }, on(event, fn) { handler = fn; },
      emit(event, data) { ack = data; } };
    router.registerQuizFlowEvent(socket);
    handler({ requestId: 'test-advance', runId: game.runId });
    assert.equal(ack.success, false);
    assert.equal(ack.reason, 'FORBIDDEN');
    assert.equal(ack.state, undefined);
  }
  for (const role of ['control', 'admin']) {
    let handler, ack;
    router.registerQuizFlowEvent({ data: { role, hasStaffAccess: () => true }, on(event, fn) { handler = fn; },
      emit(event, data) { ack = data; } });
    handler({ requestId: 'test-advance', runId: game.runId });
    assert.equal(ack.reason, 'INVALID_PHASE');
  }
});

test('Presentation/roster versions cannot discard valid in-flight answers; pause and deadlines still reject', t => {
  const { game, delivery } = setup(); t.after(() => { game.resetGame(); delivery.close(); });
  game.teamManager.addPlayer('p', 'Player', 'A', 'answer-version-session');
  game.teamManager.chooseTeam('p', 'red');
  game.state = 'QUIZ';
  game.quizManager.startQuiz('wc_001', { red: 1 });
  const originalVersion = game.stateVersion;
  const payload = { requestId: 'in-flight', runId: game.runId, stateVersion: originalVersion,
    quizId: 'wc_001', answer: 'A' };
  const execute = () => game.handleQuizAnswer('p', payload.quizId, payload.answer);
  game.setPresentationStage('rules');
  assert.equal(game.stateVersion, originalVersion, 'display-only changes preserve input version');
  game.broadcastStateSync();
  assert.equal(delivery.operation({ id: 'p' }, 'answer', payload, execute).success, true);
  assert.equal(game.playerStats.get('p').answeredCount, 1);
  game.quizManager.startQuiz('wc_002', { red: 1 }); payload.quizId = 'wc_002';
  game.pauseGame();
  assert.equal(delivery.operation({ id: 'p' }, 'answer', { ...payload, requestId: 'paused' }, execute).reason, 'GAME_PAUSED');
  game.resumeGame();
  game.quizManager.answerDeadlineAt = Date.now() - 1;
  assert.equal(delivery.operation({ id: 'p' }, 'answer', { ...payload, requestId: 'late' }, execute).reason, 'ANSWER_WINDOW_CLOSED');
  assert.equal(game.playerStats.get('p').answeredCount, 1);
});
