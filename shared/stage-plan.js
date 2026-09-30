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
  function validateFormal(map, config) {
    const formal = config.formalGame;
    if (map.id !== formal.mapId) return true;
    const stages = { ...config.quizStages, ...map.config?.quizStages };
    const checkpoints = map.checkpoints;
    return config.quizStages.enabled === true
      && config.quizStages.questionsPerStage === formal.questionsPerStage
      && stages.enabled === true && stages.questionsPerStage === formal.questionsPerStage
      && (config.quizStages.stageCount === undefined || config.quizStages.stageCount === formal.stageCount)
      && (stages.stageCount === undefined || stages.stageCount === formal.stageCount)
      && Array.isArray(checkpoints) && checkpoints.length === formal.questionCount
      && checkpoints.length / stages.questionsPerStage === formal.stageCount
      && new Set(checkpoints.map(cp => cp?.quizId)).size === formal.questionCount
      && checkpoints.every(cp => typeof cp?.quizId === 'string' && cp.quizId.length > 0);
  }
  const api = { estimate, validateFormal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StagePlan = api;
})(typeof window === 'undefined' ? globalThis : window);
