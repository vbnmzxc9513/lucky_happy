(function (root) {
  function estimate(checkpoints, config) {
    const stages = config.quizStages;
    const questionCount = checkpoints.length;
    const stageCount = Math.ceil(questionCount / stages.questionsPerStage);
    const answerSeconds = checkpoints.reduce((sum, cp) => sum + Math.max(1, Math.min(60,
      Number(cp.timeLimit) || config.quizTimeLimit || 10)), 0);
    const racingSeconds = stageCount * stages.tapSeconds + stages.sprintSeconds;
    const timedSeconds = (config.countdownSeconds || 0) + racingSeconds + answerSeconds;
    return { questionCount, stageCount, answerSeconds, racingSeconds, timedSeconds, totalSeconds: null, manualAdvance: true };
  }
  const api = { estimate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StagePlan = api;
})(typeof window === 'undefined' ? globalThis : window);
