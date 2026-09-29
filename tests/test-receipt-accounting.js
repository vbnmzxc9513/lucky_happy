const test = require('node:test');
const assert = require('node:assert/strict');
const reconcile = require('../scripts/lib/reconcile-player-accounting');

function fixture() {
  const tapIds = Array.from({ length: 10 }, (_, index) => `tap-${index}`);
  const client = { requests: { summary: kind => ({ accepted: kind === 'tap' ? 10 : 0 }) },
    expectedCorrect: 0, expectedWrong: 0, acceptedAnswerIds: new Set(),
    sentTapIds: new Set(tapIds), acceptedTapIds: new Set(tapIds),
    quizInputs: new Map([['answer-1', { runId: 'run', quizId: 'q', answer: 'A' }]]) };
  const actual = { tapCount: 10, answeredCount: 1, correctCount: 1, wrongCount: 0,
    tapReceipts: tapIds.map(requestId => ({ runId: 'run', requestId })),
    answerReceipts: [{ requestId: 'answer-1', runId: 'run', quizId: 'q', answer: 'A', isCorrect: true }] };
  return { client, actual, labels: new Map([['q', 'A']]) };
}

test('a lost ACK is reconciled by a matching receipt without rewriting ACK counts', () => {
  const { client, actual, labels } = fixture();
  const result = reconcile(client, actual, 'run', labels);
  assert.equal(result.passed, true);
  assert.deepEqual(result.recoveredReceipts, ['answer-1']);
  assert.equal(result.acknowledged.answeredCount, 0);
  assert.equal(result.expected.answeredCount, 1);
});

test('a lost tap ACK is reconciled by its accepted request ID', () => {
  const { client, actual, labels } = fixture();
  client.acceptedTapIds.delete('tap-9');
  client.requests.summary = kind => ({ accepted: kind === 'tap' ? 9 : 0 });
  const result = reconcile(client, actual, 'run', labels);
  assert.equal(result.passed, true);
  assert.deepEqual(result.recoveredTapReceipts, ['tap-9']);
  assert.equal(result.acknowledged.tapCount, 9);
  assert.equal(result.expected.tapCount, 10);
});

test('duplicate, foreign, stale or inconsistent receipts fail closed', () => {
  for (const mutate of [
    a => a.answerReceipts.push({ ...a.answerReceipts[0] }),
    a => { a.answerReceipts[0].requestId = 'foreign'; },
    a => { a.answerReceipts[0].runId = 'old'; },
    a => { a.answerReceipts[0].answer = 'B'; },
    a => { a.answerReceipts[0].isCorrect = false; },
    a => { a.correctCount = 2; },
    a => { a.tapCount = 11; },
    a => { a.tapReceipts.push({ ...a.tapReceipts[0] }); },
    a => { a.tapReceipts[0].requestId = 'foreign'; },
    a => { a.tapReceipts[0].runId = 'old'; },
    a => { delete a.tapReceipts; },
    a => { delete a.answerReceipts; }
  ]) {
    const { client, actual, labels } = fixture();
    mutate(actual);
    assert.equal(reconcile(client, actual, 'run', labels).passed, false);
  }
});

test('an accepted ACK missing from server receipts cannot pass', () => {
  const { client, actual, labels } = fixture();
  client.acceptedAnswerIds.add('missing');
  assert.ok(reconcile(client, actual, 'run', labels).issues.includes('ACK_WITHOUT_RECEIPT:missing'));
  actual.tapReceipts.pop();
  assert.ok(reconcile(client, actual, 'run', labels).issues.includes('TAP_ACK_WITHOUT_RECEIPT:tap-9'));
});
