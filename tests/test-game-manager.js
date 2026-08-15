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
  gm.teamManager.autoAssignUnselectedPlayers = () => { called = true; return 0; };
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

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
