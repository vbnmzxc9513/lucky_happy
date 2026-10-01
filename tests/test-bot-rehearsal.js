const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Game = require('../server/game/GameManager');
const Store = require('../server/results/MatchResultStore');

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000000 });
  let random = 0;
  t.mock.method(Math, 'random', () => ((random++ * 37) % 101) / 101);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horse-bots-'));
  const store = new Store(path.join(dir, 'results.json'));
  const events = [], accepted = [];
  const game = new Game({ emit(event, data) { events.push({ event, data }); } }, store);
  game.startLoop = () => {};
  const answer = game.handleQuizAnswer.bind(game);
  game.handleQuizAnswer = (id, quizId, value) => {
    const result = answer(id, quizId, value);
    if (result.success) accepted.push({ id, quizId, at: Date.now() });
    return result;
  };
  const advance = ms => { for (let i = 0; i < ms; i += 50) t.mock.timers.tick(Math.min(50, ms - i)); };
  const next = () => {
    assert.equal(game.advanceQuizFlow({ requestId: require('node:crypto').randomUUID(), runId: game.runId,
      stageNumber: game.quizStage.stageNumber, flowRevision: game.quizStage.flowRevision }).success, true);
    t.mock.timers.tick(0);
  };
  t.after(() => { game.resetGame(); fs.rmSync(dir, { recursive: true, force: true }); });
  game.startBotSimulation(25);
  return { game, advance, next, events, accepted, store };
}

test('Bots complete all 16 questions once, four settlements, sprint and matching temporary result snapshot', t => {
  const { game, advance, next, events, accepted, store } = setup(t);
  game.startRound(); advance(3000);
  assert.equal(game.startBotSimulation(10).reason, 'JOIN_LOCKED');
  assert.equal(game.simBots.length, 25, 'rejected spawning preserves existing bots');
  let settlements = 0;
  for (let stage = 1; stage <= 4; stage++) {
    const tapsBefore = [...game.playerStats.values()].reduce((n, p) => n + p.tapCount, 0);
    advance(8000); t.mock.timers.tick(0);
    assert.ok([...game.playerStats.values()].reduce((n, p) => n + p.tapCount, 0) > tapsBefore, 'bots tap every stage');
    for (let q = 1; q <= 4; q++) {
      assert.equal(game.quizStage.phase, 'answer');
      const quiz = game.quizManager.currentQuiz;
      advance(10000);
      const answers = accepted.filter(a => a.quizId === quiz.id);
      assert.equal(answers.length, 25);
      assert.equal(new Set(answers.map(a => a.id)).size, 25);
      assert.ok(new Set(answers.map(a => a.at)).size > 1, 'delays distribute answers');
      assert.equal(game.quizStage.phase, 'reveal');
      const count = accepted.length;
      advance(30000);
      assert.equal(game.quizStage.phase, 'reveal');
      assert.equal(accepted.length, count);
      next();
    }
    assert.equal(game.quizStage.phase, 'summary'); settlements++;
    next();
  }
  assert.equal(settlements, 4);
  assert.equal(game.quizStage.phase, 'sprint');
  advance(15000);
  assert.equal(game.state, 'MATCH_FINISHED');
  assert.equal(events.filter(e => e.event === 'game:quiz_start').length, 16);
  assert.equal(events.filter(e => e.event === 'game:quiz_result').length, 16);
  assert.equal(accepted.length, 400);
  const match = store.read().matches[0];
  assert.equal(match.players.length, 25);
  for (const p of match.players) {
    assert.equal(p.answeredCount, 16);
    assert.equal(p.correctCount + p.wrongCount, 16);
    assert.equal(p.unansweredCount, 0);
  }
  assert.equal(match.players.reduce((n, p) => n + p.answeredCount, 0), accepted.length);
  game.stopBotSimulation();
  assert.equal(game.botInterval, null);
  assert.equal(game.simBots.length, 0);
  assert.equal(game.playerStats.size, 0);
  assert.equal(game.teamManager.players.size, 0);
  assert.equal([...game.managedTimeouts.keys()].filter(k => k.startsWith('bot-answer:')).length, 0);
});

test('Bot timers freeze on pause and become invalid after reveal, stop, reset and the next question', t => {
  const { game, advance, next, accepted } = setup(t);
  game.startRound(); advance(11000); t.mock.timers.tick(0);
  const stale = [...game.managedTimeouts.values()].filter(e => e.key.startsWith('bot-answer:')).map(e => e.callback);
  game.pauseGame(); advance(30000); stale.forEach(f => f());
  assert.equal(accepted.length, 0);
  game.resumeGame(); advance(10000);
  assert.equal(accepted.length, 25);
  stale.forEach(f => f()); assert.equal(accepted.length, 25);
  next(); stale.forEach(f => f()); assert.equal(accepted.length, 25);
  const pending = [...game.managedTimeouts.values()].filter(e => e.key.startsWith('bot-answer:')).map(e => e.callback);
  game.stopBotSimulation(); pending.forEach(f => f()); advance(10000);
  assert.equal(accepted.length, 25);
  assert.equal(game.teamManager.players.size, 0);
  assert.equal(game.playerStats.size, 0);
  game.resetGame(); pending.forEach(f => f()); advance(60000);
  assert.equal(game.quizManager.answeredSet.size, 0);
  assert.equal(game.managedTimeouts.size, 0);
  assert.equal(game.state, 'LOBBY');
});
