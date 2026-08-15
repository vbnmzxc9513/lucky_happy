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
  assert.strictEqual(qm.answers['red'].correct, 1);
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
  assert.strictEqual(qm.answers['red'].correct, 1);
});

test('handleAnswer() should reject duplicate answers', () => {
  const qm = new QuizManager(new MockQuizLoader());
  qm.startQuiz('q1', { red: 1 });
  qm.handleAnswer('socket1', 'red', 'q1', 'A');
  const res2 = qm.handleAnswer('socket1', 'red', 'q1', 'B');
  assert.strictEqual(res2.success, false);
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
  
  assert.strictEqual(results.teamResults['red'].correctCount, 1);
  assert.strictEqual(results.teamResults['blue'].correctCount, 0);
});

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
