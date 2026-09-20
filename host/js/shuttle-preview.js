/* Isolated visual fixture. No Socket.IO client is loaded by the preview wrapper. */
(() => {
  const handlers = {};
  const emit = (name, value) => (handlers[name] || []).forEach(fn => fn(value));
  window.io = () => ({ on(name, fn) { (handlers[name] ||= []).push(fn); }, emit() {}, connect() {} });
  let elapsed = 0, paused = false, lastKey, lastTime, interval;
  const questions = ['今天最重要的任務是什麼？', '隊伍的答案如何決定？', '三題全對可以前進幾格？'];
  const answers = [['一起祝福新人', '偷偷先回家', '忘記吃喜酒', '躲起來'], ['隊伍多數決', '看誰先按', '主持人猜', '隨機決定'], ['1 格', '2 格', '3 格', '4 格']];
  function tick() {
    const now = performance.now();
    if (!paused && lastTime) elapsed += (now - lastTime) / 1000;
    lastTime = now;
    if (elapsed >= 55) { elapsed = 0; lastKey = null; }
    const config = window.GameConfig;
    if (!config) return;
    const phase = elapsed < 8 ? 'tap' : elapsed < 11 ? 'prepare' : elapsed < 47 ? ((elapsed - 11) % 12 < 10 ? 'answer' : 'reveal') : 'summary';
    const questionNumber = elapsed < 11 ? 1 : Math.min(3, Math.floor((elapsed - 11) / 12) + 1);
    const end = phase === 'tap' ? 8 : phase === 'prepare' ? 11 : phase === 'summary' ? 55 : 11 + (questionNumber - 1) * 12 + (phase === 'answer' ? 10 : 12);
    const teamResults = Object.fromEntries(config.TEAMS.map((team, index) => {
      const count = Math.min(3, index), steps = [0,1,2,4][count];
      const beforePosition = 900 + 8 * (310 + index * 48);
      return [team.id, { answers: [0,1,2].map(q => q < count), correctCount: count, steps,
        rewardPx: steps * 1500, beforePosition, position: beforePosition + steps * 1500,
        isCorrect: questionNumber <= count, effect: questionNumber <= count ? 'stage_correct' : 'none',
        val: 0, teamAnswer: questionNumber <= count ? 'A' : 'B', voteCounts: { A: 20, B: 10 } }];
    }));
    const teams = config.TEAMS.map((team, i) => ({ ...team, memberCount: 30, speed: phase === 'tap' ? 12 + i * 2 : 0,
      position: phase === 'summary' ? teamResults[team.id].position : 900 + Math.min(8, elapsed) * (310 + i * 48) }));
    const reveal = { correctAnswer: questionNumber === 3 ? 'D' : 'A', explanation: '一起為自己的隊伍加油！', teamResults };
    const state = { state: phase === 'tap' ? 'RACING' : 'QUIZ', paused, serverNow: Date.now(), config,
      teams, totalPlayers: 150, players: [], currentMap: { id: 'preview', trackLength: 76000 }, activeItems: {},
      quizStage: { stageNumber: 1, stageCount: 6, questionNumber, completedQuestions: questionNumber - 1,
        phase, endsAt: Date.now() + (end - elapsed) * 1000, summary: { teamResults }, reveal: phase === 'reveal' ? reveal : null } };
    const key = `${phase}:${questionNumber}:${paused}`;
    if (key !== lastKey) {
      emit('game:state_sync', state);
      if (phase === 'prepare') emit('game:quiz_prepare', { seconds: Math.ceil(end - elapsed) });
      if (phase === 'answer') emit('game:quiz_start', { question: questions[questionNumber - 1], options: answers[questionNumber - 1], timeLimit: Math.ceil(end - elapsed) });
      if (phase === 'reveal') emit('game:quiz_result', reveal);
      lastKey = key;
    }
    if (phase === 'tap' && !paused) emit('game:position_update', { teams: Object.fromEntries(teams.map(t => [t.id,t])) });
    window.previewState = state;
  }
  window.previewSeek = seconds => {
    emit('game:state_sync', { state: 'LOBBY', config: window.GameConfig, teams: [] });
    elapsed = seconds; lastKey = null; lastTime = performance.now(); paused = false; tick();
  };
  window.previewPause = () => { paused = !paused; lastKey = null; tick(); };
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { tick(); interval = setInterval(tick, 33); }, 100);
  });
  window.addEventListener('pagehide', () => clearInterval(interval));
})();
