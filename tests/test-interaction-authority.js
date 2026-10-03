const { test } = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../server/game/GameManager');
const Delivery = require('../server/websocket/RealtimeDelivery');
const Race = require('../shared/shuttle-race');

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000000 });
  const events = [];
  const io = { sockets: { sockets: new Map() }, emit(event, data) { events.push({ event, data }); },
    to(room) { return { emit(event, data) { events.push({ room, event, data }); }, volatile: { emit() {} } }; } };
  const game = new Game(io), delivery = game.delivery = new Delivery(io, game);
  game.startLoop = () => {};
  const sockets = ['p', 'silent'].map(id => {
    game.teamManager.addPlayer(id, id, 'A', `session-${id}`);
    game.teamManager.chooseTeam(id, 'red');
    const socket = { id, data: { role: 'guest', protocolVersion: 2 }, emit(event, data) { events.push({ id, event, data }); } };
    io.sockets.sockets.set(id, socket);
    return socket;
  });
  const advance = ms => { for (let i = 0; i < ms; i += 50) t.mock.timers.tick(Math.min(50, ms - i)); };
  const answer = (socket, data) => delivery.operation(socket, 'answer', data,
    () => game.handleQuizAnswer(socket.id, data.quizId, data.answer));
  t.after(() => { game.resetGame(); delivery.close(); });
  return { game, delivery, events, sockets, advance, answer };
}

test('reading is authoritative; delayed reading packets cannot become answers; full ten-second window', t => {
  const { game, advance, answer, sockets } = setup(t);
  game.startRound(); advance(11000);
  const quizId = game.quizManager.currentQuiz.id;
  const packet = { requestId: 'early', runId: game.runId, stateVersion: game.stateVersion, quizId, answer: 'B' };
  assert.equal(game.quizStage.phase, 'reading');
  assert.equal(game.handleQuizAnswer('p', quizId, 'B').success, false);
  assert.equal(answer(sockets[0], packet).success, false);
  advance(2999); assert.equal(game.quizStage.phase, 'reading');
  advance(1); assert.equal(game.quizStage.phase, 'answer');
  assert.equal(game.quizManager.answerDeadlineAt - Date.now(), 10000);
  assert.equal(answer(sockets[0], { ...packet, requestId: 'delayed' }).reason, 'STALE_ANSWER_WINDOW');
  assert.equal(answer(sockets[0], { ...packet, requestId: 'new-gesture', stateVersion: game.stateVersion }).success, true);
  advance(9999); assert.equal(game.quizStage.phase, 'answer');
  advance(1); assert.equal(game.quizStage.phase, 'reveal');
});

for (const value of ['B', 'A']) test(`ACK/retry/session recovery with ${value} is neutral until reveal, including silent members`, t => {
  const { game, delivery, events, advance, sockets, answer } = setup(t);
  game.startRound(); advance(14000);
  const quizId = game.quizManager.currentQuiz.id;
  const packet = { requestId: 'answer', runId: game.runId, stateVersion: game.stateVersion, quizId, answer: value };
  const accepted = answer(sockets[0], packet);
  assert.equal(accepted.success, true);
  assert.equal(Object.hasOwn(accepted, 'isCorrect'), false);
  assert.deepEqual(answer(sockets[0], packet), accepted);
  const neutral = payload => assert.doesNotMatch(JSON.stringify(payload), /isCorrect|correctAnswer|correctCount|wrongCount/);
  neutral(delivery.answerReceipts('p'));
  delivery.sendState(sockets[0]);
  neutral(events.at(-1).data);
  game.teamManager.disconnectPlayer('p', true);
  const rejoined = game.teamManager.addPlayer('replacement', 'p', 'A', 'session-p');
  game.migratePlayerConnection(rejoined.previousSocketId, 'replacement');
  const restored = { ...sockets[0], id: 'replacement' };
  game.emitActiveQuizRecovery(restored);
  const recovery = events.at(-1).data;
  neutral(recovery);
  assert.equal(recovery.alreadyAnswered, true);
  assert.equal(recovery.receipt.answer, value);
  assert.deepEqual(answer(restored, packet), accepted);
  advance(10000);
  assert.equal(game.quizStage.phase, 'reveal');
  assert.equal(delivery.answerReceipts('replacement')[0].isCorrect, value === 'B');
  assert.equal(answer(restored, packet).isCorrect, value === 'B');
  delivery.sendState(sockets[1]);
  const silent = events.at(-1).data.quizStage.reveal;
  assert.equal(silent.correctAnswer, 'B');
  assert.equal(silent.alreadyAnswered, false);
  assert.equal(silent.teamResult.totalCount, 2);
});

test('reading pause/recovery shifts the same opening and deadline; reset invalidates its callback', t => {
  const { game, events, advance, sockets } = setup(t);
  game.startRound(); advance(12200);
  const opened = game.quizStage.opensAt, deadline = game.quizStage.deadlineAt;
  const stale = game.managedTimeouts.get('quiz-open').callback;
  game.pauseGame(); advance(20000);
  game.emitActiveQuizRecovery(sockets[0]);
  assert.equal(events.at(-1).data.endsAt - game.pausedAt, 1800);
  assert.equal(game.quizStage.phase, 'reading');
  game.resumeGame();
  assert.equal(game.quizStage.opensAt, opened + 20000);
  assert.equal(game.quizStage.deadlineAt, deadline + 20000);
  advance(1799); assert.equal(game.quizStage.phase, 'reading');
  advance(1); assert.equal(game.quizStage.phase, 'answer');
  game.resetGame(); stale(); advance(60000);
  assert.equal(game.state, 'LOBBY'); assert.equal(game.quizManager.currentQuiz, null);
});

test('normal physics reaches a visible obstacle exactly once, with provenance; reward bypass never stuns later', t => {
  const { game, events } = setup(t);
  game.state = 'RACING';
  const team = game.teamManager.teams.red;
  team.position = 1480; team.speed = 20;
  game.itemManager.activeItems = { red: [{ id: 'rock', type: 'obstacle', x: 1500, triggered: false }] };
  game.update(); assert.equal(team.isStunned, false); assert.equal(team.position, 1499);
  game.update(); assert.equal(team.isStunned, true);
  const collision = events.find(e => e.event === 'game:item_triggered').data;
  assert.equal(collision.itemId, 'rock'); assert.equal(collision.source, 'obstacle');
  assert.equal(team.stunSource.itemId, 'rock');
  game.update(); assert.equal(events.filter(e => e.event === 'game:item_triggered').length, 1);
  team.position = 100; team.isStunned = false; team.stunUntil = 0; team.speed = 0;
  game.itemManager.activeItems.red = [{ id: 'crossed', type: 'obstacle', x: 2000, triggered: false }];
  game.state = 'QUIZ'; game.stageQuestions = Array(16).fill({});
  game.quizStage = { phase: 'reveal', stageNumber: 1, questionNumber: 4, questionsPerStage: 4,
    results: Array.from({ length: 4 }, () => ({ teamResults: { red: { isCorrect: true } } })) };
  assert.equal(game.showStageSummary(game.flowToken), true);
  assert.equal(team.position, 9100);
  assert.equal(game.itemManager.activeItems.red[0].skipped, 'distance_reward');
  game.state = 'RACING'; game.update();
  assert.equal(team.isStunned, false);
  assert.equal(game.getGameState().activeItems.red[0].triggered, true);
});

test('one camera preserves distance gaps across old turns, full cycles, overtakes and beyond the old finish', () => {
  const positions = [1499, 1500, 3000, 76001, 110000];
  const view = Race.camera(positions);
  for (let i = 1; i < positions.length; i++) assert(Race.project(positions[i], view) > Race.project(positions[i - 1], view));
  assert.equal(Race.project(3000, view), Race.project(3000, view));
  const before = [1000, 4000], after = [10000, 5500];
  const fixed = Race.camera(before, after);
  assert(Race.project(before[0], fixed) < Race.project(before[1], fixed));
  assert(Race.project(after[0], fixed) > Race.project(after[1], fixed));
  for (const steps of [0, 1, 2, 4, 6]) assert(Math.abs(
    Race.project(1000 + steps * 1500, fixed) - Race.project(1000, fixed) - steps * 1500 / (fixed.high - fixed.low)) < 1e-12);
});


test('delayed reading callback opens a complete new answer window only once', t => {
  const { game, advance } = setup(t);
  game.startRound(); advance(11000);
  const callback=game.managedTimeouts.get('quiz-open').callback;
  callback(); assert.equal(game.quizStage.phase,'reading','callback cannot open before authority time');
  t.mock.timers.setTime(Date.now()+5000); callback();
  assert.equal(game.quizStage.phase,'answer');
  const deadline=game.quizManager.answerDeadlineAt;
  assert.equal(deadline-Date.now(),10000);
  callback(); assert.equal(game.quizManager.answerDeadlineAt,deadline,'leftover callback cannot restart the window');
  advance(9999); assert.equal(game.quizStage.phase,'answer');
  advance(1); assert.equal(game.quizStage.phase,'reveal');
});

test('mystery obstacle and GM stun preserve staff provenance', t=>{
  const {game,delivery,sockets,events}=setup(t);
  t.mock.method(Math,'random',()=>.5);
  const team=game.teamManager.teams.red; team.position=99; team.speed=2;
  game.state='RACING'; game.itemManager.activeItems={red:[{id:'box',type:'mystery',x:100,triggered:false}]};
  game.update(); assert.equal(team.stunSource.source,'mystery'); assert.equal(team.stunSource.resolvedType,'obstacle');
  assert.equal(game.getGameState().teams.find(t=>t.id==='red').stunSource.itemId,'box');
  delivery.sendState(sockets[0]); assert.equal(events.at(-1).data.teams.find(t=>t.id==='red').stunSource,undefined);
  game.forceTriggerItem('red','stun'); assert.equal(team.stunSource.source,'gm');
  assert.equal(events.at(-1).data.source,'gm');
});
