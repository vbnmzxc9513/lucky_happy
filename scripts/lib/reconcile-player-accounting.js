function reconcilePlayerAccounting(client, actual, auditRunId, answerLabels) {
  const acknowledged = { tapCount: client.requests.summary('tap').accepted,
    answeredCount: client.requests.summary('quiz').accepted,
    correctCount: client.expectedCorrect, wrongCount: client.expectedWrong };
  const expected = { tapCount: 0, answeredCount: 0, correctCount: 0, wrongCount: 0 };
  const issues = [], recoveredReceipts = [], recoveredTapReceipts = [], ids = new Set(), quizzes = new Set();
  const tapIds = new Set();
  if (!actual || !Array.isArray(actual.tapReceipts)) issues.push('TAP_RECEIPTS_UNAVAILABLE');
  for (const receipt of actual?.tapReceipts || []) {
    if (receipt.runId !== auditRunId || !client.sentTapIds?.has(receipt.requestId)) {
      issues.push(`UNMATCHED_TAP_RECEIPT:${receipt.requestId}`);
      continue;
    }
    if (tapIds.has(receipt.requestId)) {
      issues.push(`DUPLICATE_TAP_RECEIPT:${receipt.requestId}`);
      continue;
    }
    tapIds.add(receipt.requestId);
    expected.tapCount++;
    if (!client.acceptedTapIds?.has(receipt.requestId)) recoveredTapReceipts.push(receipt.requestId);
  }
  for (const id of client.acceptedTapIds || []) if (!tapIds.has(id)) issues.push(`TAP_ACK_WITHOUT_RECEIPT:${id}`);
  const acceptedIds = client.acceptedAnswerIds || new Set();
  if (!actual || !Array.isArray(actual.answerReceipts)) issues.push('RECEIPTS_UNAVAILABLE');
  for (const receipt of actual?.answerReceipts || []) {
    const input = client.quizInputs.get(receipt.requestId);
    if (!input || input.runId !== auditRunId || receipt.runId !== auditRunId
      || input.quizId !== receipt.quizId || input.answer !== receipt.answer) {
      issues.push(`UNMATCHED_RECEIPT:${receipt.requestId}`);
      continue;
    }
    if (ids.has(receipt.requestId) || quizzes.has(receipt.quizId)) {
      issues.push(`DUPLICATE_RECEIPT:${receipt.requestId}`);
      continue;
    }
    ids.add(receipt.requestId); quizzes.add(receipt.quizId);
    const correctAnswer = answerLabels.get(input.quizId);
    const correct = input.answer === correctAnswer;
    if (!correctAnswer || receipt.isCorrect !== correct) issues.push(`ANSWER_OUTCOME_MISMATCH:${receipt.requestId}`);
    expected.answeredCount++;
    expected[correct ? 'correctCount' : 'wrongCount']++;
    if (!acceptedIds.has(receipt.requestId)) recoveredReceipts.push(receipt.requestId);
  }
  for (const id of acceptedIds) if (!ids.has(id)) issues.push(`ACK_WITHOUT_RECEIPT:${id}`);
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) issues.push(`TOTAL_MISMATCH:${key}`);
  }
  return { passed: issues.length === 0, expected, acknowledged, issues, recoveredReceipts, recoveredTapReceipts };
}

module.exports = reconcilePlayerAccounting;
