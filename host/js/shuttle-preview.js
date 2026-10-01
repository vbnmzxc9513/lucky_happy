/* Isolated visual fixture: no Socket.IO connection and no real game operations. */
(() => {
  const handlers = {};
  const emit = (name, value) => (handlers[name] || []).forEach(fn => fn(value));
  window.io = () => ({ on(name, fn) { (handlers[name] ||= []).push(fn); }, emit() {}, connect() {} });
  let phase = 'tap', stageNumber = 1, questionNumber = 1, elapsed = 0;
  let paused = false, lastKey, lastTime, interval;
  const questions = ['今天最重要的任務是什麼？', '隊伍答對的門檻是什麼？', '四題全對可以前進幾格？', '第四關之後是什麼？'];
  const answers = [['一起祝福新人', '偷偷先回家', '忘記吃喜酒', '躲起來'],
    ['全隊超過 50% 答對', '看誰先按', '主持人猜', '最高票選項'], ['1 格', '2 格', '4 格', '6 格'], ['最後衝刺', '第五關', '重新報到', '直接離開']];
  const setPhase = value => { phase = value; elapsed = 0; lastKey = null; };
  function tick() {
    const now = performance.now();
    if (!paused && lastTime) elapsed += (now - lastTime) / 1000;
    lastTime = now;
    const config = window.GameConfig;
    if (!config) return;
    if (!paused && phase === 'tap' && elapsed >= 8) setPhase('answer');
    if (!paused && phase === 'answer' && elapsed >= 10) setPhase('reveal');
    const correctAnswer = questionNumber === 3 ? 'D' : 'A';
    const optionMap = Object.fromEntries(answers[questionNumber - 1].map((text, i) => [String.fromCharCode(65 + i), text]));
    const distribution = { totalPlayers: 150, answeredCount: 120, unansweredCount: 30, responseRate: .8,
      options: Object.fromEntries(Object.keys(optionMap).map(label => [label, { count: 0, answeredPercent: 0 }])) };
    const teamResults = Object.fromEntries(config.TEAMS.map((team, i) => {
      const correctCount = [0, 15, 16, 20, 24][i];
      const wrong = correctAnswer === 'A' ? 'B' : 'A';
      distribution.options[correctAnswer].count += correctCount;
      distribution.options[wrong].count += 24 - correctCount;
      return [team.id, { totalCount: 30, answeredCount: 24, unansweredCount: 6,
        correctCount, wrongCount: 24 - correctCount, correctRate: correctCount / 30, isCorrect: correctCount / 30 > .5, effect: 'stage_pending' }];
    }));
    Object.values(distribution.options).forEach(option => { option.answeredPercent = option.count / 120; });
    const summaryResults = Object.fromEntries(config.TEAMS.map((team, i) => {
      const correctCount = Math.min(4, i), steps = config.quizStages.rewardSteps[correctCount];
      const beforePosition = 900 + 8 * (310 + i * 48);
      return [team.id, { answers: [0, 1, 2, 3].map(q => q < correctCount), correctCount, steps,
        rewardPx: steps * 1500, beforePosition, position: beforePosition + steps * 1500 }];
    }));
    const teams = config.TEAMS.map((team, i) => ({ ...team, memberCount: 30,
      speed: phase === 'tap' ? 12 + i * 2 : 0,
      position: phase === 'summary' ? summaryResults[team.id].position : 900 + Math.min(8, elapsed) * (310 + i * 48) }));
    const reveal = { correctAnswer, correctAnswerText: optionMap[correctAnswer], options: optionMap, distribution, teamResults };
    const state = { state: phase === 'tap' || phase === 'sprint' ? 'RACING' : 'QUIZ', paused, serverNow: Date.now(), config,
      teams, totalPlayers: 150, players: [], currentMap: { id: 'preview', trackLength: 76000 }, activeItems: {},
      quizStage: { stageNumber, stageCount: 4, questionsPerStage: 4, questionNumber, completedQuestions: (stageNumber - 1) * 4 + questionNumber - 1,
        phase, endsAt: ['tap', 'answer', 'sprint'].includes(phase) ? Date.now() + ((phase === 'tap' ? 8 : 10) - elapsed) * 1000 : null,
        summary: phase === 'summary' ? { teamResults: summaryResults } : null, reveal: phase === 'reveal' ? reveal : null } };
    const key = `${stageNumber}:${phase}:${questionNumber}:${paused}`;
    if (key !== lastKey) {
      emit('game:state_sync', state);
      if (phase === 'answer') emit('game:quiz_start', { question: questions[questionNumber - 1], options: optionMap, timeLimit: Math.ceil(10 - elapsed), endsAt: state.quizStage.endsAt, serverNow: state.serverNow });
      if (phase === 'reveal') emit('game:quiz_result', reveal);
      lastKey = key;
    }
    if (phase === 'tap' && !paused) emit('game:position_update', { teams: Object.fromEntries(teams.map(t => [t.id, t])) });
    window.previewState = state;
  }
  window.previewAdvance = () => {
    if (paused) return;
    if (phase === 'reveal' && questionNumber < 4) { questionNumber++; setPhase('answer'); }
    else if (phase === 'reveal') setPhase('summary');
    else if (phase === 'summary' && stageNumber < 4) { stageNumber++; questionNumber = 1; setPhase('tap'); }
    else if (phase === 'summary') setPhase('sprint');
    tick();
  };
  // Explicit navigation for screenshots; waiting phases never advance on their own.
  window.previewSeek = seconds => {
    emit('game:state_sync', { state: 'LOBBY', config: window.GameConfig, teams: [] });
    stageNumber = 1; questionNumber = seconds >= 47 ? 4 : 1;
    setPhase(seconds >= 47 ? 'summary' : seconds >= 21 ? 'reveal' : seconds >= 8 ? 'answer' : 'tap');
    if (phase === 'tap') elapsed = seconds;
    lastTime = performance.now(); paused = false; tick();
  };
  window.previewPause = () => { paused = !paused; lastKey = null; tick(); };
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { tick(); interval = setInterval(tick, 33); }, 100);
  });
  window.addEventListener('pagehide', () => clearInterval(interval));
})();
