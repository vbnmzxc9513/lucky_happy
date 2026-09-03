const assert = require('assert');
const QuizManager = require('../server/quiz/QuizManager');

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

class MockQuizLoader {
  getQuizById(id) {
    return {
      id: 'q1',
      question: 'Test Q',
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 'A',
      timeLimit: 10
    };
  }
  getRandomQuiz() {
    return this.getQuizById();
  }
}

class TextAnswerQuizLoader {
  getQuizById(id) {
    return {
      id: 'q_text',
      question: '新郎最喜歡的食物是？',
      options: ['牛排', '壽司', '拉麵', '披薩'],
      correctAnswer: '壽司',
      timeLimit: 10
    };
  }
  getRandomQuiz() {
    return this.getQuizById();
  }
}

test('startQuiz() should create answer tracking for all 5 teams', () => {
  const qm = new QuizManager(new MockQuizLoader());
  qm.startQuiz('q1', { red: 1, blue: 1, yellow: 1, pink: 1, purple: 1 });
  assert.strictEqual(Object.keys(qm.answers).length, 5);
  ['red', 'blue', 'yellow', 'pink', 'purple'].forEach(id => {
    assert.ok(qm.answers[id]);
  });
});

test('handleAnswer() should record correct answers', () => {
  const qm = new QuizManager(new MockQuizLoader());
  qm.startQuiz('q1', { red: 1 });
  const res = qm.handleAnswer('socket1', 'red', 'q1', 'A');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.isCorrect, true);
  assert.strictEqual(qm.answers.red.votes.A, 1);
  assert.strictEqual(qm.answers.red.responded, 1);
});

test('startQuiz() should provide Host list and Guest A/B/C/D map', () => {
  const qm = new QuizManager(new TextAnswerQuizLoader());
  const payload = qm.startQuiz('q_text', { red: 1 });
  assert.deepStrictEqual(payload.optionList, ['牛排', '壽司', '拉麵', '披薩']);
  assert.strictEqual(payload.optionMap.A, '牛排');
  assert.strictEqual(payload.optionMap.B, '壽司');
});

test('handleAnswer() should accept option label when stored correctAnswer is option text', () => {
  const qm = new QuizManager(new TextAnswerQuizLoader());
  qm.startQuiz('q_text', { red: 1 });
  const res = qm.handleAnswer('socket1', 'red', 'q_text', 'B');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.isCorrect, true);
  assert.strictEqual(qm.answers.red.votes.B, 1);
});

test('handleAnswer() should reject duplicate answers', () => {
  const qm = new QuizManager(new MockQuizLoader());
  qm.startQuiz('q1', { red: 1 });
  qm.handleAnswer('socket1', 'red', 'q1', 'A');
  const res2 = qm.handleAnswer('socket1', 'red', 'q1', 'B');
  assert.strictEqual(res2.success, false);
});

test('Invalid answer should not consume the one allowed answer', () => {
  const qm = new QuizManager(new MockQuizLoader());
  qm.startQuiz('q1', { red: 1 });
  const invalid = qm.handleAnswer('socket1', 'red', 'q1', 'Z');
  const valid = qm.handleAnswer('socket1', 'red', 'q1', 'A');
  assert.strictEqual(invalid.success, false);
  assert.strictEqual(invalid.reason, 'INVALID_ANSWER');
  assert.strictEqual(valid.success, true);
});

test('Checkpoint time limit should override quiz default and be recoverable', () => {
  const qm = new QuizManager(new MockQuizLoader());
  const payload = qm.startQuiz('q1', { red: 1 }, null, 4);
  const recovery = qm.getRecoveryPayload();
  assert.strictEqual(payload.timeLimit, 4);
  assert.ok(recovery.timeLimit >= 3 && recovery.timeLimit <= 4);
  qm.cancelQuiz();
});

test('Answered identity should migrate without allowing a second answer', () => {
  const qm = new QuizManager(new MockQuizLoader());
  qm.startQuiz('q1', { red: 1 });
  assert.strictEqual(qm.handleAnswer('old-socket', 'red', 'q1', 'A').success, true);
  assert.strictEqual(qm.migrateAnswerIdentity('old-socket', 'new-socket'), true);
  const duplicate = qm.handleAnswer('new-socket', 'red', 'q1', 'A');
  assert.strictEqual(duplicate.success, false);
  assert.strictEqual(duplicate.reason, 'ALREADY_ANSWERED');
});

test('calculateResults() should generate results for all 5 teams', () => {
  const qm = new QuizManager(new MockQuizLoader());
  qm.startQuiz('q1', { red: 1, blue: 1, yellow: 1, pink: 1, purple: 1 });
  qm.handleAnswer('socket1', 'red', 'q1', 'A');
  qm.handleAnswer('socket2', 'blue', 'q1', 'B');
  const results = qm.calculateResults();
  
  assert.ok(results.teamResults['red']);
  assert.ok(results.teamResults['blue']);
  assert.ok(results.teamResults['yellow']);
  assert.ok(results.teamResults['pink']);
  assert.ok(results.teamResults['purple']);
  
  assert.strictEqual(results.teamResults.red.teamAnswer, 'A');
  assert.strictEqual(results.teamResults.red.isCorrect, true);
  assert.strictEqual(results.teamResults.blue.teamAnswer, 'B');
  assert.strictEqual(results.teamResults.blue.isCorrect, false);
  assert.strictEqual(results.teamResults.yellow.noAnswer, true);
});

test('Team result should use the most-voted option instead of individual correct rate', () => {
  const qm = new QuizManager(new MockQuizLoader());
  qm.startQuiz('q1', { red: 3 });
  qm.handleAnswer('r1', 'red', 'q1', 'B');
  qm.handleAnswer('r2', 'red', 'q1', 'B');
  qm.handleAnswer('r3', 'red', 'q1', 'A');
  const result = qm.calculateResults().teamResults.red;
  assert.strictEqual(result.teamAnswer, 'B');
  assert.strictEqual(result.isCorrect, false);
  assert.strictEqual(result.effect, 'stun');
  assert.deepStrictEqual(result.voteCounts, { B: 2, A: 1 });
});

test('A tied team vote should not choose an arbitrary answer', () => {
  const qm = new QuizManager(new MockQuizLoader());
  qm.startQuiz('q1', { red: 2 });
  qm.handleAnswer('r1', 'red', 'q1', 'A');
  qm.handleAnswer('r2', 'red', 'q1', 'B');
  const result = qm.calculateResults().teamResults.red;
  assert.strictEqual(result.hasTie, true);
  assert.strictEqual(result.teamAnswer, null);
  assert.strictEqual(result.effect, 'stun');
});

test('Quiz timer should freeze while paused and continue with the remaining time', () => {
  const qm = new QuizManager(new MockQuizLoader());
  qm.startQuiz('q1', { red: 1 }, null, 10);
  const originalDeadline = qm.answerDeadlineAt;
  const pausedAt = Date.now();
  assert.strictEqual(qm.pauseTimer(pausedAt), true);
  assert.strictEqual(qm.timer, null);
  assert.ok(qm.pausedRemainingMs > 9000);
  assert.strictEqual(qm.resumeTimer(pausedAt + 5000), true);
  assert.ok(qm.answerDeadlineAt >= originalDeadline + 4900);
  qm.cancelQuiz();
});

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
