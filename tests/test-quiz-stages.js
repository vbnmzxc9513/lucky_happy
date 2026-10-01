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

const command = game => ({ requestId: require('node:crypto').randomUUID(), runId: game.runId, stageNumber: game.quizStage?.stageNumber,
  flowRevision: game.quizStage?.flowRevision });
const next = game => assert.equal(game.advanceQuizFlow(command(game)).success, true);

test('Formal catalog exactly matches the sixteen ordered prompt questions and letter answers', t => {
  const { game } = setup(t);
  const expected = require('./fixtures/formal-questions.json');
  const map = game.mapManager.getCurrentMap();
  const actual = map.checkpoints.map(cp => {
    const { question, options, correctAnswer } = game.quizLoader.getQuizById(cp.quizId);
    return { question, options, correctAnswer };
  });
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.map(q => q.correctAnswer), ['B', 'C', 'D', 'C', 'A', 'C', 'A', 'D', 'B', 'C', 'B', 'D', 'A', 'B', 'D', 'A']);
  assert.deepEqual(map.quizPool, map.checkpoints.map(cp => cp.quizId));
  assert.equal(game.config.quizStages.questionsPerStage, 4);
  assert.deepEqual(game.config.quizStages.rewardSteps, [0, 1, 2, 4, 6]);
});

for (const settings of [{ questionsPerStage: 3 }, { questionsPerStage: 8 }, { stageCount: 5 }, { enabled: false }]) {
  test(`Formal map rejects invalid structure ${JSON.stringify(settings)}`, t => {
    const { game } = setup(t);
    const map = game.mapManager.getCurrentMap();
    map.config.quizStages = settings;
    assert.equal(game.mapManager.saveMap(map), false);
    assert.equal(game.startRound(), false);
    delete map.config.quizStages;
    Object.assign(game.config.quizStages, settings);
    assert.equal(game.startRound(), false);
    assert.equal(game.teamManager.isJoinLocked, false);
    // A matching map override must not hide an invalid runtime configuration.
    map.config.quizStages = { enabled: true, questionsPerStage: 4 };
    assert.equal(game.startRound(), false);
  });
}

for (const style of ['all-correct', 'no-answers', 'mixed', 'fast-taps']) {
  test(`Four manually controlled groups: ${style}`, t => {
    const { game, events, advance } = setup(t, 150);
    const map = game.mapManager.getCurrentMap();
    assert.equal(map.checkpoints.length, 16);
    assert.equal(new Set(map.quizPool).size, 16);
    const plan = StagePlan.estimate(map.checkpoints, game.config);
    assert.equal(plan.stageCount, 4);
    assert.equal(plan.totalSeconds, null);
    assert.equal(plan.timedSeconds, 205);
    assert.equal(game.startRound(), true);
    assert.equal(game.startRound(), false);
    advance(3000);
    let settlements = 0;
    for (let group = 1; group <= 4; group++) {
      assert.equal(game.quizStage.stageNumber, group);
      assert.equal(game.quizStage.phase, 'tap');
      if (style === 'fast-taps') {
        game.teamManager.teams.red.position = 1000000;
        game.update();
        assert.equal(game.state, 'RACING');
      }
      advance(8000);
      t.mock.timers.tick(0);
      assert.equal(game.quizStage.phase, 'answer', 'first question starts without a control command');
      assert.equal(game.startStageQuestions(), false, 'tap transition is consumed');
      const before = Object.fromEntries(Object.entries(game.teamManager.teams).map(([id, team]) => [id, team.position]));
      for (let q = 1; q <= 4; q++) {
        assert.equal(game.quizStage.phase, 'answer');
        assert.equal(game.quizStage.questionNumber, q);
        const quiz = game.quizManager.currentQuiz;
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
        assert.equal(game.teamManager.teams.red.position, before.red);
        game.handleQuizResults(game.quizStage.reveal);
        assert.equal(game.quizStage.results.length, q);
        advance(3600000);
        assert.equal(game.quizStage.phase, 'reveal', 'including question four: no automatic settlement');
        assert.equal(game.quizStage.summary, null);
        next(game); t.mock.timers.tick(0);
      }
      assert.equal(game.quizStage.phase, 'summary'); settlements++;
      for (const [index, team] of game.config.TEAMS.entries()) {
        const expected = style === 'no-answers' ? 0 : style === 'mixed' ? Math.min(index, 4) : 4;
        const result = game.quizStage.summary.teamResults[team.id];
        assert.equal(result.correctCount, expected);
        assert.equal(result.rewardPx, [0, 1, 2, 4, 6][expected] * 1500);
        assert.ok(Math.abs(game.teamManager.teams[team.id].position - before[team.id] - result.rewardPx) < 1e-9);
      }
      assert.equal(game.showStageSummary(game.flowToken), false);
      advance(3600000);
      assert.equal(game.quizStage.phase, 'summary');
      next(game);
    }
    assert.equal(settlements, 4);
    assert.equal(game.quizStage.phase, 'sprint');
    assert.equal(game.quizStage.completedQuestions, 16);
    advance(9900); assert.equal(game.state, 'RACING');
    advance(100); assert.equal(game.state, 'ROUND_FINISHED');
    assert.equal(events.filter(e => e.event === 'game:quiz_start').length, 16);
    assert.equal(events.filter(e => e.event === 'game:quiz_result').length, 16);
    advance(5000);
    assert.equal(game.state, 'MATCH_FINISHED');
    assert.equal(game.buildFinalAwardsPayload().awards.length, 4);
    if (style === 'no-answers') assert.ok([...game.playerStats.values()].every(s => s.wrongCount === 0));
  });
}

for (const phase of ['tap', 'prepare', 'answer', 'reveal', 'summary', 'sprint']) {
  test(`Pause, recover, stale operations and reset in ${phase}`, t => {
    const { game, advance } = setup(t);
    game.startRound(); advance(3000);
    if (phase === 'prepare') game.startStageQuestions();
    while (game.quizStage.phase !== phase) {
      if (game.quizStage.phase === 'tap') { advance(7900); t.mock.timers.tick(100); if (phase !== 'prepare') t.mock.timers.tick(0); }
      else if (game.quizStage.phase === 'answer') advance(10000);
      else { next(game); t.mock.timers.tick(0); }
    }
    const deadline = game.quizStage.endsAt;
    const oldCommand = command(game);
    assert.ok(game.pauseGame());
    assert.equal(game.advanceQuizFlow(oldCommand).reason, 'GAME_PAUSED');
    advance(20000);
    assert.equal(game.quizStage.phase, phase);
    assert.equal(game.getGameState().quizStage.phase, phase);
    assert.ok(game.resumeGame());
    assert.equal(game.quizStage.endsAt, deadline === null ? null : deadline + 20000);
    const callbacks = [...game.managedTimeouts.values()].map(entry => entry.callback);
    const oldToken = game.flowToken;
    game.resetGame();
    callbacks.forEach(callback => callback());
    game.handleQuizResults({}, oldToken);
    assert.equal(game.advanceQuizFlow(oldCommand).reason, 'STALE_RUN');
    advance(700000);
    assert.equal(game.state, 'LOBBY');
    assert.equal(game.quizStage, null);
    assert.equal(game.managedTimeouts.size, 0);
    assert.equal(game.quizManager.currentQuiz, null);
  });
}

for (const invalid of ['missing', 'duplicate', 'not-multiple']) {
  test(`Refuse ${invalid} question plan`, t => {
    const { game } = setup(t);
    const map = game.mapManager.getCurrentMap();
    if (invalid === 'missing') map.checkpoints[1].quizId = 'missing';
    if (invalid === 'duplicate') map.checkpoints[1].quizId = map.checkpoints[0].quizId;
    if (invalid === 'not-multiple') map.checkpoints.pop();
    assert.equal(game.startRound(), false);
    assert.equal(game.state, 'LOBBY');
    assert.equal(game.teamManager.isJoinLocked, false);
  });
}

test('Concurrent controls advance once and force quiz cannot bypass the state machine', t => {
  const { game, advance } = setup(t);
  game.startRound(); advance(3000);
  assert.equal(game.forceTriggerQuiz(null), false);
  advance(8000);
  t.mock.timers.tick(0);
  assert.equal(game.advanceQuizFlow(command(game)).reason, 'INVALID_PHASE');
  advance(10000);
  const data = command(game);
  assert.equal(game.advanceQuizFlow(data).success, true);
  assert.equal(game.advanceQuizFlow(data).reason, 'STALE_FLOW');
  t.mock.timers.tick(0);
  assert.equal(game.advanceQuizFlow(command(game)).reason, 'INVALID_PHASE');
  const quiz = game.quizManager.currentQuiz;
  game.handleQuizAnswer('p0', quiz.id, 'A');
  game.migratePlayerConnection('p0', 'reconnected');
  let recovery;
  game.emitActiveQuizRecovery({ id: 'reconnected', emit(event, payload) { recovery = payload; } }, 'guest');
  assert.equal(recovery.alreadyAnswered, true);
});

for (const count of [0, 12, 15, 17, 18, 20, 24]) {
  test(`Formal map refuses ${count} questions at start and save`, t => {
    const { game } = setup(t);
    const map = game.mapManager.getCurrentMap();
    map.checkpoints = game.quizLoader.getAllQuizzes().slice(0, count).map(quiz => ({ quizId: quiz.id }));
    assert.equal(game.startRound(), false);
    assert.equal(game.mapManager.saveMap(map), false);
  });
}
test('Malformed advance IDs cannot change the waiting state', t => {
  const { game, advance } = setup(t); game.startRound(); advance(11000);
  for (const requestId of [undefined, null, '', {}, 'bad id', 'x'.repeat(101)]) {
    const data = { ...command(game), requestId };
    assert.equal(game.advanceQuizFlow(data).reason, 'INVALID_REQUEST_ID');
    assert.equal(game.quizStage.phase, 'answer');
  }
});

test('Consumed request ID cannot advance a later revision; reset clears the run ledger', t => {
  const { game, advance } = setup(t);
  game.startRound(); advance(11000);
  advance(10000);
  const first = command(game);
  assert.equal(game.advanceQuizFlow(first).success, true);
  t.mock.timers.tick(0); advance(10000);
  const revision = game.quizStage.flowRevision;
  assert.equal(game.advanceQuizFlow({ ...command(game), requestId: first.requestId }).reason, 'STALE_REQUEST');
  assert.equal(game.quizStage.flowRevision, revision);
  assert.equal(game.quizStage.questionNumber, 2);
  assert.equal(game.quizStage.phase, 'reveal');
  next(game);
  game.resetGame();
  assert.equal(game.quizFlowRequests.size, 0);
  assert.equal(game.advanceQuizFlow(first).reason, 'STALE_RUN');
});

test('Paused host recovery preserves authority time and progress without revealing answers', t => {
  const { game, advance } = setup(t);
  game.startRound(); advance(11000); t.mock.timers.tick(0);
  const quiz = game.quizManager.currentQuiz;
  game.handleQuizAnswer('p0', quiz.id, 'A');
  advance(2000); game.pauseGame(); advance(20000);
  let recovery;
  game.emitActiveQuizRecovery({emit(event, payload) { recovery = payload; }}, 'host');
  assert.equal(recovery.paused, true);
  assert.equal(recovery.endsAt - recovery.pausedAt, 8000);
  assert.equal(recovery.progress.answeredCount, 1);
  assert.equal(recovery.progress.totalCount, 5);
  assert.doesNotMatch(JSON.stringify(recovery.progress), /correct|votes|option|answer:/i);
  game.resumeGame(); advance(8000);
  assert.equal(game.quizStage.phase, 'reveal');
  assert.equal(game.handleQuizAnswer('p1', quiz.id, 'A').reason, 'ANSWER_WINDOW_CLOSED');
});

test('Old tap and prepare callbacks cannot reopen questions after a transition', t => {
  const { game, advance, events } = setup(t);
  game.startRound(); advance(3000);
  const tap = game.managedTimeouts.get('stage-tap').callback;
  advance(7900); t.mock.timers.tick(100);
  const prepare = game.managedTimeouts.get('quiz-prepare')?.callback;
  t.mock.timers.tick(0); tap(); prepare?.();
  assert.equal(events.filter(e => e.event === 'game:quiz_start').length, 1);
  advance(10000); next(game); t.mock.timers.tick(0);
  const quiz = game.quizManager.currentQuiz;
  tap(); prepare?.();
  assert.equal(game.quizManager.currentQuiz, quiz);
  assert.equal(events.filter(e => e.event === 'game:quiz_start').length, 2);
});

test('Queued timer generations from before pause cannot fire after resume', t => {
  const { game, advance } = setup(t);
  const scheduled = [];
  const schedule = global.setTimeout;
  t.mock.method(global, 'setTimeout', (callback, delay, ...args) => {
    scheduled.push({callback, delay});
    return schedule(callback, delay, ...args);
  });
  game.startRound(); advance(3000);
  const oldTap = scheduled.findLast(e => e.delay === 8000).callback;
  advance(2000); game.pauseGame(); advance(15000); game.resumeGame();
  oldTap();
  assert.equal(game.quizStage.phase, 'tap');
  advance(6000); t.mock.timers.tick(0);
  const oldAnswer = scheduled.findLast(e => e.delay === 10000).callback;
  advance(2000); game.pauseGame(); advance(15000); game.resumeGame();
  oldAnswer();
  assert.equal(game.quizStage.phase, 'answer');
  advance(8000);
  assert.equal(game.quizStage.phase, 'reveal');
});
