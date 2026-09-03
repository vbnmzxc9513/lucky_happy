const assert = require('assert');
const GameManager = require('../server/game/GameManager');
const EventEmitter = require('events');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

class MockIo extends EventEmitter {
  emit(event, data) {
    this.lastEvent = event;
    this.lastData = data;
  }
}

test('update() should apply physics to all 5 teams', () => {
  const gm = new GameManager(new MockIo());
  gm.state = 'RACING';
  let physicsCalls = 0;
  gm.physicsEngine.updateTeamPhysics = (team) => { physicsCalls++; };
  gm.update();
  assert.strictEqual(physicsCalls, 5);
});

test('Any team reaching finish line should end the round', () => {
  const gm = new GameManager(new MockIo());
  gm.state = 'RACING';
  const trackLen = gm.mapManager.getCurrentMap().track ? gm.mapManager.getCurrentMap().track.length : 1000;
  gm.teamManager.teams['purple'].position = trackLen + 10;
  gm.update();
  assert.strictEqual(gm.state, 'ROUND_FINISHED');
});

test('GAME_POSITION_UPDATE should contain all 5 teams', () => {
  const io = new MockIo();
  const gm = new GameManager(io);
  gm.state = 'RACING';
  gm.update();
  assert.strictEqual(io.lastEvent, 'game:position_update');
  assert.strictEqual(Object.keys(io.lastData.teams).length, 5);
});

test('startRound() should call autoAssignUnselectedPlayers', () => {
  const gm = new GameManager(new MockIo());
  let called = false;
  gm.teamManager.autoAssignUnselectedPlayers = () => { called = true; return { count: 0, assignments: [] }; };
  gm.startRound();
  assert.strictEqual(called, true);
});

test('Bot simulation should distribute across all teams', () => {
  const gm = new GameManager(new MockIo());
  gm.startBotSimulation(10);
  assert.strictEqual(gm.simBots.length, 10);
  const teamCounts = {};
  gm.simBots.forEach(bot => {
    teamCounts[bot.teamId] = (teamCounts[bot.teamId] || 0) + 1;
  });
  assert.strictEqual(Object.keys(teamCounts).length, 5);
  gm.stopBotSimulation();
});

test('Personal award stats should track taps and quiz answers', () => {
  const gm = new GameManager(new MockIo());
  gm.config.tapCooldown = 0;
  gm.teamManager.addPlayer('p1', '雅婷', '婷');
  gm.teamManager.chooseTeam('p1', 'blue');
  gm.teamManager.addPlayer('p2', '小宇', '宇');
  gm.teamManager.chooseTeam('p2', 'red');

  gm.state = 'RACING';
  gm.handleTap('p1', Date.now());
  gm.handleTap('p1', Date.now());
  gm.handleTap('p2', Date.now());

  gm.recordPlayerQuizResult('p1', true);
  gm.recordPlayerQuizResult('p1', false);
  gm.recordPlayerQuizResult('p2', false);
  gm.recordPlayerQuizResult('p2', false);

  gm.roundManager.recordRoundWinner('blue');
  gm.roundManager.recordRoundWinner('red');
  gm.roundManager.recordRoundWinner('blue');
  const awards = gm.buildFinalAwardsPayload();

  assert.strictEqual(awards.awards.length, 4);
  assert.strictEqual(awards.awards[0].winner.id, 'blue');
  assert.strictEqual(awards.awards[1].winner.name, '雅婷');
  assert.strictEqual(awards.awards[2].winner.name, '雅婷');
  assert.strictEqual(awards.awards[3].winner.name, '小宇');
});

test('Quiz awards should break ties by average answer speed', () => {
  const gm = new GameManager(new MockIo());
  gm.teamManager.addPlayer('p1', '慢答高手', '慢');
  gm.teamManager.chooseTeam('p1', 'blue');
  gm.teamManager.addPlayer('p2', '快答高手', '快');
  gm.teamManager.chooseTeam('p2', 'red');
  gm.teamManager.addPlayer('p3', '沒作答賓客', '沒');
  gm.teamManager.chooseTeam('p3', 'yellow');

  gm.recordPlayerQuizResult('p1', true, 2000);
  gm.recordPlayerQuizResult('p1', true, 1800);
  gm.recordPlayerQuizResult('p2', true, 900);
  gm.recordPlayerQuizResult('p2', true, 1100);

  gm.recordPlayerQuizResult('p1', false, 2200);
  gm.recordPlayerQuizResult('p1', false, 2000);
  gm.recordPlayerQuizResult('p2', false, 800);
  gm.recordPlayerQuizResult('p2', false, 1000);

  const awards = gm.buildFinalAwardsPayload();
  const correctAward = awards.awards.find(award => award.id === 'most-correct');
  const wrongAward = awards.awards.find(award => award.id === 'most-wrong');

  assert.strictEqual(correctAward.winner.name, '快答高手');
  assert.strictEqual(correctAward.winner.value, 2);
  assert.strictEqual(correctAward.winner.averageAnswerMs, 950);
  assert.strictEqual(wrongAward.winner.name, '快答高手');
  assert.strictEqual(wrongAward.winner.value, 2);
  assert.ok(!wrongAward.ranking.some(player => player.name === '沒作答賓客'));
});

test('Default pacing should use one round and estimate the formal 10-question game', () => {
  const gm = new GameManager(new MockIo());
  const teamIds = Object.keys(gm.teamManager.teams);

  for (let i = 0; i < 150; i++) {
    const playerId = `p${i}`;
    gm.teamManager.addPlayer(playerId, `賓客${i}`, `${i}`);
    gm.teamManager.chooseTeam(playerId, teamIds[i % teamIds.length]);
  }

  const map = gm.mapManager.getCurrentMap();
  const recommendation = gm.calculateRecommendedTrackLength(map);

  assert.strictEqual(gm.roundManager.totalRounds, 1);
  assert.strictEqual(map.id, 'wedding-final-showdown');
  assert.strictEqual(recommendation.quizCount, 10);
  assert.ok(recommendation.trackLength >= 77000 && recommendation.trackLength <= 78000);
  assert.strictEqual(recommendation.targetGameSeconds, 390);
});

test('Checkpoint must trigger before a team can finish the race', () => {
  const gm = new GameManager(new MockIo());
  const map = gm.mapManager.getCurrentMap();
  gm.checkpointEngine.initCheckpoints(map.checkpoints);
  gm.state = 'RACING';
  gm.teamManager.teams.red.position = map.track.length + 100;
  let triggeredQuizId = null;
  gm.triggerQuiz = (quizId) => {
    triggeredQuizId = quizId;
    gm.state = 'QUIZ';
    return true;
  };

  gm.update();
  assert.strictEqual(triggeredQuizId, map.checkpoints[0].quizId);
  assert.strictEqual(gm.state, 'QUIZ');
  assert.strictEqual(gm.roundManager.history.length, 0);
});

test('Reconnect should preserve personal award stats and answer lock', () => {
  const gm = new GameManager(new MockIo());
  const sessionId = 'award-session-123456789';
  gm.teamManager.addPlayer('old-socket', 'Stable Guest', 'S', sessionId);
  gm.teamManager.chooseTeam('old-socket', 'blue');
  gm.upsertPlayerStats(gm.teamManager.getPlayer('old-socket'));
  gm.recordPlayerTap('old-socket');
  gm.recordPlayerQuizResult('old-socket', true, 900);

  gm.quizManager.startQuiz('wc_001', { blue: 1 });
  gm.quizManager.handleAnswer('old-socket', 'blue', 'wc_001', 'A');
  gm.teamManager.setJoinLock(true);
  gm.teamManager.disconnectPlayer('old-socket', true);
  const recovered = gm.teamManager.addPlayer('new-socket', 'Stable Guest', 'S', sessionId);
  gm.migratePlayerConnection(recovered.previousSocketId, 'new-socket');

  assert.ok(!gm.playerStats.has('old-socket'));
  assert.strictEqual(gm.playerStats.get('new-socket').tapCount, 1);
  assert.strictEqual(gm.playerStats.get('new-socket').correctCount, 1);
  const duplicate = gm.quizManager.handleAnswer('new-socket', 'blue', 'wc_001', 'A');
  assert.strictEqual(duplicate.reason, 'ALREADY_ANSWERED');
  gm.quizManager.cancelQuiz();
});

test('Final sprint should clear stuns and multiply tap acceleration', () => {
  const io = new MockIo();
  const gm = new GameManager(io);
  gm.config.tapCooldown = 0;
  gm.config.finalSprint.tapBoostMultiplier = 2;
  gm.teamManager.addPlayer('sprinter', 'Sprinter');
  gm.teamManager.chooseTeam('sprinter', 'red');
  gm.state = 'RACING';
  gm.hardFinishAt = Date.now() + 60000;
  gm.teamManager.teams.red.isStunned = true;
  gm.teamManager.teams.red.stunUntil = Date.now() + 10000;

  assert.strictEqual(gm.activateFinalSprint(gm.flowToken), true);
  assert.strictEqual(gm.teamManager.teams.red.isStunned, false);
  assert.strictEqual(io.lastEvent, 'game:final_sprint');
  const speedBeforeTap = gm.teamManager.teams.red.speed;
  assert.strictEqual(gm.handleTap('sprinter', Date.now()).success, true);
  assert.ok(gm.teamManager.teams.red.speed >= speedBeforeTap + gm.config.baseBoost * 2);
});

test('Every twentieth accepted tap should be a double critical hit', () => {
  const gm = new GameManager(new MockIo());
  gm.config.tapCooldown = 0;
  gm.teamManager.addPlayer('tapper', 'Tapper');
  gm.teamManager.chooseTeam('tapper', 'red');
  gm.state = 'RACING';
  let result = null;
  for (let index = 0; index < 20; index++) result = gm.handleTap('tapper', Date.now());
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.critical, true);
  assert.strictEqual(result.multiplier, 2);
  assert.strictEqual(result.status.tapCount, 20);
  assert.strictEqual(result.status.nextCriticalIn, 20);
});

test('Pause and resume should freeze and shift all race deadlines', () => {
  const gm = new GameManager(new MockIo());
  const now = Date.now();
  gm.state = 'RACING';
  gm.raceStartedAt = now - 1000;
  gm.hardFinishAt = now + 10000;
  gm.checkpointEngine.gameStartTime = now - 1000;
  gm.teamManager.teams.red.stunUntil = now + 2000;
  gm.scheduleManagedTimeout('test', () => {}, 10000);
  const originalDeadline = gm.hardFinishAt;
  assert.ok(gm.pauseGame());
  gm.pausedAt = now;
  assert.ok(gm.resumeGame(now + 5000));
  assert.strictEqual(gm.hardFinishAt, originalDeadline + 5000);
  assert.strictEqual(gm.teamManager.teams.red.stunUntil, now + 7000);
  gm.clearAllManagedTimeouts();
  gm.clearRaceGuard();
});

test('Race deadline catch-up should preserve all ten checkpoints before finishing', () => {
  const gm = new GameManager(new MockIo());
  const map = gm.mapManager.getCurrentMap();
  gm.checkpointEngine.initCheckpoints(map.checkpoints);
  gm.state = 'RACING';
  gm.raceStartedAt = Date.now() - 600000;
  gm.hardFinishAt = Date.now() - 1;
  gm.hardFinishRequested = true;
  const triggeredQuizIds = [];
  gm.triggerQuiz = (quizId) => {
    triggeredQuizIds.push(quizId);
    gm.state = 'QUIZ';
    return true;
  };

  for (let index = 0; index < 10; index++) {
    gm.state = 'RACING';
    gm.evaluateRaceGuard(gm.flowToken, Date.now());
  }
  assert.deepStrictEqual(triggeredQuizIds, map.checkpoints.map(checkpoint => checkpoint.quizId));
  assert.strictEqual(gm.checkpointEngine.hasTriggeredAll(), true);
  assert.strictEqual(gm.roundManager.history.length, 0);

  gm.state = 'RACING';
  gm.teamManager.teams.purple.position = 500;
  gm.teamManager.teams.red.position = 450;
  gm.triggerQuiz = GameManager.prototype.triggerQuiz.bind(gm);
  assert.strictEqual(gm.finishAtRaceDeadline(), true);
  assert.strictEqual(gm.roundManager.history[0].winner, 'purple');
});

test('Awards should remain server-locked until the match is finished', () => {
  const gm = new GameManager(new MockIo());
  gm.state = 'LOBBY';
  assert.strictEqual(gm.setPresentationStage('awards'), false);
  assert.strictEqual(gm.handleAwardAction('reveal'), false);
  assert.strictEqual(gm.presentation.stage, 'lobby');

  gm.state = 'MATCH_FINISHED';
  assert.strictEqual(gm.setPresentationStage('awards'), true);
  assert.strictEqual(gm.handleAwardAction('reveal'), true);
  assert.deepStrictEqual(gm.presentation.revealedAwardIndexes, [0]);
  assert.strictEqual(gm.handleAwardAction('reveal'), true);
  assert.deepStrictEqual(gm.presentation.revealedAwardIndexes, [0]);
  assert.strictEqual(gm.handleAwardAction('next'), true);
  assert.strictEqual(gm.presentation.awardIndex, 1);
});

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
