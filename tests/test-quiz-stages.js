const assert = require('node:assert/strict');
const { test } = require('node:test');
const GameManager = require('../server/game/GameManager');
const StagePlan = require('../shared/stage-plan');

function setup(t, players = 5) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000000 });
  const events = [];
  const game = new GameManager({ emit(event, data) { events.push({ event, data, at: Date.now() }); } });
  // Physics is stepped explicitly; the production timers remain unchanged.
  game.startLoop = () => {};
  for (let i = 0; i < players; i++) {
    game.teamManager.addPlayer(`p${i}`, `Guest${i}`);
    game.teamManager.chooseTeam(`p${i}`, game.config.TEAMS[i % 5].id);
  }
  t.after(() => game.resetGame());
  return { game, events, advance(ms) { for (let i = 0; i < ms; i += 100) t.mock.timers.tick(Math.min(100, ms - i)); } };
}

for (const style of ['all-correct', 'no-answers', 'mixed', 'fast-taps']) {
  test(`Six groups finish after 343 seconds: ${style}`, t => {
    const { game, events, advance } = setup(t, 150);
    const estimate = StagePlan.estimate(game.mapManager.getCurrentMap().checkpoints, game.config);
    assert.equal(estimate.totalSeconds, 343);
    const beganAt = Date.now();
    assert.equal(game.startRound(), true);
    assert.equal(game.startRound(), false);
    advance(3000);
    for (let group = 1; group <= 6; group++) {
      assert.equal(game.quizStage.stageNumber, group);
      assert.equal(game.quizStage.phase, 'tap');
      if (style === 'fast-taps') {
        game.teamManager.teams.red.position = 1000000;
        game.update();
        assert.equal(game.state, 'RACING', 'finish line cannot skip questions');
      }
      advance(7900);
      assert.equal(game.quizStage.phase, 'tap');
      advance(100);
      assert.equal(game.quizStage.phase, 'prepare');
      assert.equal(game.triggerQuiz(null), false);
      advance(3000);
      const before = Object.fromEntries(Object.entries(game.teamManager.teams).map(([id, team]) => [id, team.position]));
      for (let q = 1; q <= 3; q++) {
        assert.equal(game.quizStage.phase, 'answer');
        assert.equal(game.quizStage.questionNumber, q);
        const quiz = game.quizManager.currentQuiz;
        if (q > 1) {
          game.handleQuizResults(game.quizStage.results[0]);
          assert.equal(game.quizStage.phase, 'answer', 'old question result cannot settle the next question');
        }
        if (style !== 'no-answers') {
          for (let i = 0; i < 150; i++) {
            const correct = style !== 'mixed' || q <= i % 5;
            const wrong = Object.keys(quiz.optionMap).find(key => key !== quiz.correctAnswer);
            assert.equal(game.handleQuizAnswer(`p${i}`, quiz.id, correct ? quiz.correctAnswer : wrong).success, true);
            assert.equal(game.handleQuizAnswer(`p${i}`, quiz.id, quiz.correctAnswer).reason, 'ALREADY_ANSWERED');
          }
        }
        advance(10000);
        assert.equal(game.quizStage.phase, 'reveal');
        assert.equal(game.teamManager.teams.red.position, before.red, 'no reward before group settlement');
        const result = game.quizStage.reveal;
        game.handleQuizResults(result);
        assert.equal(game.quizStage.results.length, q, 'duplicate result ignored');
        advance(2000);
      }
      assert.equal(game.quizStage.phase, 'summary');
      const snapshot = game.getGameState();
      assert.equal(snapshot.quizStage.completedQuestions, group * 3);
      for (const [index, team] of game.config.TEAMS.entries()) {
        const expected = style === 'no-answers' ? 0 : style === 'mixed' ? Math.min(index, 3) : 3;
        const result = snapshot.quizStage.summary.teamResults[team.id];
        assert.equal(result.correctCount, expected);
        assert.equal(result.rewardPx, [0, 1, 2, 4][expected] * 1500);
        const awardedDistance = game.teamManager.teams[team.id].position - before[team.id];
        assert.ok(
          Math.abs(awardedDistance - result.rewardPx) < 1e-9,
          `expected ${result.rewardPx} reward distance, got ${awardedDistance}`
        );
      }
      assert.equal(game.showStageSummary(game.flowToken), false, 'summary cannot pay twice');
      assert.equal(game.handleTap('p0').success, false);
      advance(8000);
    }
    assert.equal(game.quizStage.phase, 'sprint');
    assert.equal(game.finalSprintActive, true);
    assert.equal(game.quizStage.completedQuestions, 18);
    advance(9900);
    assert.equal(game.state, 'RACING');
    advance(100);
    assert.equal(game.state, 'ROUND_FINISHED');
    assert.equal(Date.now() - beganAt, 343000);
    assert.equal(events.filter(e => e.event === 'game:quiz_start').length, 18);
    assert.equal(events.filter(e => e.event === 'game:quiz_prepare').length, 6);
    assert.equal(events.filter(e => e.event === 'game:quiz_result').length, 18);
    advance(5000);
    assert.equal(game.state, 'MATCH_FINISHED');
    assert.equal(game.buildFinalAwardsPayload().awards.length, 4);
  });
}

for (const [phase, elapsed] of [['tap', 4000], ['prepare', 12000], ['answer', 15000], ['reveal', 24000], ['summary', 50000], ['sprint', 334000]]) {
  test(`Pause, recover and reset during ${phase}`, t => {
    const { game, advance } = setup(t);
    game.startRound();
    advance(elapsed);
    assert.equal(game.quizStage.phase, phase);
    const deadline = game.quizStage.endsAt;
    const phaseBefore = game.quizStage.phase;
    assert.ok(game.pauseGame());
    assert.equal(game.pauseGame(), false);
    advance(20000);
    assert.equal(game.quizStage.phase, phaseBefore);
    assert.equal(game.handleTap('p0').reason, 'GAME_PAUSED');
    assert.ok(game.resumeGame());
    assert.equal(game.quizStage.endsAt, deadline + 20000);
    assert.equal(game.resumeGame(), false);
    const oldToken = game.flowToken;
    game.resetGame();
    game.evaluateRaceGuard(oldToken);
    advance(700000);
    assert.equal(game.state, 'LOBBY');
    assert.equal(game.quizStage, null);
    assert.equal(game.managedTimeouts.size, 0);
    assert.equal(game.quizManager.currentQuiz, null);
  });
}

test('Invalid or duplicate planned questions refuse start before locking players', t => {
  const { game } = setup(t);
  const map = game.mapManager.getCurrentMap();
  map.checkpoints[1].quizId = map.checkpoints[0].quizId;
  assert.equal(game.startRound(), false);
  assert.equal(game.state, 'LOBBY');
});

test('Force starts the scheduled group once and keeps the three-question order', t => {
  const { game, advance } = setup(t);
  game.startRound();
  advance(3000);
  assert.equal(game.forceTriggerQuiz('party_008'), false);
  assert.equal(game.forceTriggerQuiz(null), true);
  assert.equal(game.forceTriggerQuiz(null), false);
  assert.equal(game.managedTimeouts.has('stage-tap'), false);
  advance(3000);
  const quiz = game.quizManager.currentQuiz;
  game.handleQuizAnswer('p0', quiz.id, 'A');
  game.migratePlayerConnection('p0', 'reconnected');
  assert.equal(game.quizManager.handleAnswer('reconnected', 'red', quiz.id, 'A').reason, 'ALREADY_ANSWERED');
  let recovery;
  game.emitActiveQuizRecovery({ id: 'reconnected', emit(event, payload) { recovery = payload; } }, 'guest');
  assert.equal(recovery.alreadyAnswered, true);
});
