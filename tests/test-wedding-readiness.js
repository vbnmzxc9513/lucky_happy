const assert = require('assert');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const GameManager = require('../server/game/GameManager');
const Validators = require('../shared/validators');
const config = require('../shared/game-config');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

class MockIo extends EventEmitter {
  constructor() {
    super();
    this.events = [];
  }

  emit(event, data) {
    this.events.push({ event, data });
    return true;
  }
}

function loadQuizCatalog() {
  const quizDir = path.join(__dirname, '../data/quizzes');
  const catalog = new Map();
  for (const file of fs.readdirSync(quizDir)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(quizDir, file), 'utf8'));
    for (const quiz of data.quizzes || []) {
      assert.ok(quiz.id, `${file} contains a quiz without id`);
      assert.ok(!catalog.has(quiz.id), `duplicate quiz id: ${quiz.id}`);
      catalog.set(quiz.id, quiz);
    }
  }
  return catalog;
}

test('Formal wedding map has exactly 10 valid ordered quiz checkpoints', () => {
  const map = require('../data/maps/wedding-final-showdown.json');
  const quizzes = loadQuizCatalog();
  assert.strictEqual(config.totalRounds, 1);
  assert.strictEqual(map.checkpoints.length, 10);
  assert.deepStrictEqual(
    map.checkpoints.map(checkpoint => checkpoint.trigger.percent),
    [9, 18, 27, 36, 45, 54, 63, 72, 81, 90]
  );
  assert.strictEqual(new Set(map.checkpoints.map(checkpoint => checkpoint.id)).size, 10);

  for (const checkpoint of map.checkpoints) {
    assert.strictEqual(checkpoint.trigger.type, 'team_progress');
    assert.ok(quizzes.has(checkpoint.quizId), `missing quiz: ${checkpoint.quizId}`);
    assert.ok(checkpoint.timeLimit >= 5 && checkpoint.timeLimit <= 30);
  }
});

test('Formal capacity and final sprint guardrails are enabled', () => {
  assert.strictEqual(config.maxPlayersPerTeam, 50);
  assert.strictEqual(config.finalSprint.enabled, true);
  assert.strictEqual(config.finalSprint.startAfterSeconds, 540);
  assert.strictEqual(config.finalSprint.hardFinishAfterSeconds, 600);
  assert.ok(config.finalSprint.tapBoostMultiplier > 1);
});

test('Every configured quiz has usable options and a valid correct answer', () => {
  const quizzes = loadQuizCatalog();
  assert.ok(quizzes.size >= 10);
  for (const quiz of quizzes.values()) {
    const options = Array.isArray(quiz.options) ? quiz.options : Object.values(quiz.options || {});
    assert.ok(typeof quiz.question === 'string' && quiz.question.trim().length > 0, quiz.id);
    assert.ok(options.length >= 2 && options.length <= 8, quiz.id);
    assert.ok(options.every(option => typeof option === 'string' && option.trim().length > 0), quiz.id);
    const answerIsLabel = typeof quiz.correctAnswer === 'string' && /^[A-H]$/i.test(quiz.correctAnswer.trim());
    const answerIsText = options.includes(quiz.correctAnswer);
    const answerIsIndex = Number.isInteger(quiz.correctAnswer) && quiz.correctAnswer >= 0 && quiz.correctAnswer < options.length;
    assert.ok(answerIsLabel || answerIsText || answerIsIndex, `${quiz.id} has invalid correctAnswer`);
  }
});

test('Guest payload validation rejects oversized or malformed realtime input', () => {
  assert.strictEqual(Validators.validateJoin({ nickname: 'A'.repeat(13) }).valid, false);
  assert.strictEqual(Validators.validateJoin({ nickname: 'Amy', sessionId: '../bad' }).valid, false);
  assert.strictEqual(Validators.validateTap({ timestamp: Number.POSITIVE_INFINITY }).valid, false);
  assert.strictEqual(Validators.validateQuizAnswer({ quizId: 'q1', answer: 'Z' }).valid, false);
  const valid = Validators.validateJoin({
    nickname: 'Amy',
    avatar: 'A'.repeat(100),
    sessionId: 'valid-session-1234567890'
  });
  assert.strictEqual(valid.valid, true);
  assert.strictEqual(valid.avatar.length, 16);
});

test('GameManager instances do not leak mutable configuration into each other', () => {
  const first = new GameManager(new MockIo());
  const second = new GameManager(new MockIo());
  first.config.tapCooldown = 999;
  first.config.TEAMS[0].name = 'Changed';
  assert.notStrictEqual(second.config.tapCooldown, 999);
  assert.notStrictEqual(second.config.TEAMS[0].name, 'Changed');
});

test('Reset during an active quiz cancels stale timers and stays in lobby', async () => {
  const io = new MockIo();
  const game = new GameManager(io);
  game.config.racePacing.quizPrepareSeconds = 0;
  game.config.racePacing.quizResultSeconds = 0;
  game.teamManager.addPlayer('p1', 'Guest', 'G', 'reset-session-123456789');
  game.teamManager.chooseTeam('p1', 'red');
  game.state = 'RACING';

  assert.strictEqual(game.triggerQuiz('wc_001', 1), true);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(game.quizManager.currentQuiz);
  game.resetGame();
  await new Promise(resolve => setTimeout(resolve, 1100));

  assert.strictEqual(game.state, 'LOBBY');
  assert.strictEqual(game.quizManager.currentQuiz, null);
  assert.strictEqual(game.loopInterval, null);
  const resetIndex = io.events.findLastIndex(entry => entry.event === 'game:state_sync' && entry.data.state === 'LOBBY');
  assert.ok(resetIndex >= 0);
  assert.ok(!io.events.slice(resetIndex + 1).some(entry => entry.event === 'game:quiz_result'));
});

test('Public state never exposes stable reconnect session identifiers', () => {
  const game = new GameManager(new MockIo());
  const secretSession = 'secret-session-123456789';
  game.teamManager.addPlayer('socket1', 'Guest', 'G', secretSession);
  const serialized = JSON.stringify(game.getGameState());
  assert.ok(!serialized.includes(secretSession));
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const entry of tests) {
    try {
      await entry.fn();
      console.log(`PASS ${entry.name}`);
      passed++;
    } catch (error) {
      console.error(`FAIL ${entry.name}: ${error.message}`);
      failed++;
    }
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
