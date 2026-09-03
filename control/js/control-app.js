document.addEventListener('DOMContentLoaded', () => {
  const socket = io({ autoConnect: false });
  const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = window.GameEvents;
  const awards = ['幸福總冠軍', '答題王', '手速王', '越挫越勇獎'];
  const stateLabels = {
    LOBBY: '大廳等待', MAP_SELECT: '選擇賽道', ROUND_LOBBY: '局間等待',
    COUNTDOWN: '起跑倒數', RACING: '賽事進行', QUIZ: '突襲答題',
    ROUND_FINISHED: '賽事結算', MATCH_FINISHED: '最終頒獎'
  };
  const stageLabels = { lobby: '大廳', rules: '規則', 'team-select': '選隊', race: '賽道', scoreboard: '結算', awards: '頒獎' };

  let gameState = null;
  let presentation = { stage: 'lobby', awardIndex: 0, revealedAwardIndexes: [] };
  let maps = [];
  let quizzes = [];
  let raceClockTimer = null;
  let toastTimer = null;

  const byId = id => document.getElementById(id);
  const emit = (event, data = {}) => socket.emit(event, data);

  function showToast(message, isError = false) {
    const toast = byId('control-toast');
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function teamConfig(teamId) {
    return ((gameState && gameState.config && gameState.config.TEAMS) || window.GameConfig.TEAMS || [])
      .find(team => team.id === teamId) || {};
  }

  function renderMaps() {
    const select = byId('map-select');
    const selectedId = gameState && gameState.currentMap ? gameState.currentMap.id : '';
    select.innerHTML = maps.map(map => `<option value="${map.id}">${map.name}</option>`).join('');
    if (selectedId) select.value = selectedId;
    select.disabled = !gameState || !['LOBBY', 'MAP_SELECT', 'ROUND_LOBBY'].includes(gameState.state);
  }

  function renderQuizzes() {
    const select = byId('quiz-select');
    select.innerHTML = '<option value="">隨機題目</option>' + quizzes
      .map(quiz => `<option value="${quiz.id}">${quiz.question}</option>`).join('');
  }

  function renderTeams() {
    const list = byId('team-status-list');
    const teams = gameState && Array.isArray(gameState.teams) ? [...gameState.teams] : [];
    const trackLength = Math.max(1, Number(gameState && gameState.currentMap && gameState.currentMap.trackLength) || 1);
    teams.sort((a, b) => Number(b.position || 0) - Number(a.position || 0));
    list.innerHTML = teams.map((team, index) => {
      const conf = teamConfig(team.id);
      const progress = Math.min(100, Math.max(0, Number(team.position || 0) / trackLength * 100));
      return `<div class="team-row">
        <span class="team-rank">${index + 1}</span>
        <img src="${conf.imgPath || ''}" alt="">
        <span class="team-name">${team.name}<small>${team.memberCount || 0} 人${team.isStunned ? ' · 暈眩' : ''}</small></span>
        <span class="team-bar"><i style="width:${progress.toFixed(1)}%;background:${conf.hex || '#315E58'}"></i></span>
        <span class="team-progress">${progress.toFixed(0)}%</span>
      </div>`;
    }).join('');

    const gmTeam = byId('gm-team-select');
    const previous = gmTeam.value;
    gmTeam.innerHTML = teams.map(team => `<option value="${team.id}">${team.name}</option>`).join('');
    if (teams.some(team => team.id === previous)) gmTeam.value = previous;
  }

  function renderAward() {
    const index = Math.min(awards.length - 1, Math.max(0, Number(presentation.awardIndex) || 0));
    const revealed = presentation.revealedAwardIndexes.includes(index);
    const finalAwards = gameState && gameState.finalAwards && gameState.finalAwards.awards;
    const award = Array.isArray(finalAwards) ? finalAwards[index] : null;
    byId('award-counter').textContent = `${String(index + 1).padStart(2, '0')} / ${String(awards.length).padStart(2, '0')}`;
    byId('award-seal-state').textContent = revealed ? '已揭曉' : '尚未揭曉';
    byId('award-control-title').textContent = award ? award.title : awards[index];
    byId('award-control-winner').textContent = award && award.winner
      ? `${award.winner.name || '尚無紀錄'} · ${award.winner.value || 0} ${award.unit || ''}`
      : '等待比賽結算';
    byId('btn-award-reveal').textContent = revealed ? '重新顯示揭曉畫面' : '揭曉獎項';
    const awardsReady = gameState && gameState.state === 'MATCH_FINISHED';
    byId('btn-award-reveal').disabled = !awardsReady;
    byId('btn-award-prev').disabled = !awardsReady || index === 0;
    byId('btn-award-next').disabled = !awardsReady || index === awards.length - 1;
  }

  function renderClock() {
    clearInterval(raceClockTimer);
    const tick = () => {
      const startedAt = gameState && gameState.finalSprint && gameState.finalSprint.raceStartedAt;
      if (!startedAt) {
        byId('race-clock').textContent = '00:00';
        return;
      }
      const now = gameState.paused && gameState.pausedAt
        ? gameState.pausedAt
        : Date.now();
      const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
      byId('race-clock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    };
    tick();
    raceClockTimer = setInterval(tick, 1000);
  }

  function render() {
    if (!gameState) return;
    presentation = gameState.presentation || presentation;
    byId('game-state').textContent = stateLabels[gameState.state] || gameState.state;
    byId('player-count').textContent = String(gameState.totalPlayers || 0);
    byId('presentation-state').textContent = stageLabels[presentation.stage] || presentation.stage;
    byId('paused-badge').hidden = !gameState.paused;
    byId('btn-start').disabled = !['LOBBY', 'MAP_SELECT', 'ROUND_LOBBY'].includes(gameState.state);
    byId('btn-pause').disabled = gameState.paused || !['COUNTDOWN', 'RACING', 'QUIZ', 'ROUND_FINISHED'].includes(gameState.state);
    byId('btn-resume').disabled = !gameState.paused;
    document.querySelectorAll('#stage-controls button').forEach(button => {
      button.classList.toggle('active', button.dataset.stage === presentation.stage);
      if (button.dataset.stage === 'awards') button.disabled = gameState.state !== 'MATCH_FINISHED';
    });
    const awardsReady = gameState.state === 'MATCH_FINISHED';
    byId('btn-award-reveal').disabled = !awardsReady;
    byId('btn-award-prev').disabled = !awardsReady || Number(presentation.awardIndex || 0) === 0;
    byId('btn-award-next').disabled = !awardsReady || Number(presentation.awardIndex || 0) >= awards.length - 1;
    renderMaps();
    renderTeams();
    renderAward();
    renderClock();
  }

  socket.on('connect', () => {
    byId('connection-status').textContent = '即時連線';
    byId('connection-status').classList.remove('is-offline');
    byId('connection-status').classList.add('is-online');
  });
  socket.on('disconnect', () => {
    byId('connection-status').textContent = '連線中斷';
    byId('connection-status').classList.remove('is-online');
    byId('connection-status').classList.add('is-offline');
  });
  socket.on('connect_error', () => {
    byId('connection-status').textContent = '驗證失敗';
    showToast('請回到工作人員主頁重新輸入驗證碼', true);
  });
  socket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, state => { gameState = state; render(); });
  socket.on(SERVER_TO_CLIENT.GAME_PRESENTATION_UPDATED, data => { presentation = data; if (gameState) gameState.presentation = data; render(); });
  socket.on(SERVER_TO_CLIENT.GAME_MAP_LIST, data => { maps = Array.isArray(data) ? data : []; renderMaps(); });
  socket.on('admin:quiz_list', data => { quizzes = Array.isArray(data) ? data : []; renderQuizzes(); });
  socket.on(SERVER_TO_CLIENT.GAME_POSITION_UPDATE, data => {
    if (!gameState || !data.teams) return;
    gameState.teams = gameState.teams.map(team => ({ ...team, ...(data.teams[team.id] || {}) }));
    renderTeams();
  });
  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_PREPARE, () => { byId('quiz-state').textContent = '題目準備中'; });
  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_START, data => { byId('quiz-state').textContent = `作答中 · ${data.timeLimit} 秒`; });
  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_PROGRESS, data => { byId('quiz-state').textContent = `已作答 ${data.answeredCount} / ${data.totalCount}`; });
  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_RESULT, () => { byId('quiz-state').textContent = '本題已結算'; });
  socket.on(SERVER_TO_CLIENT.CONTROL_ACTION_RESULT, data => {
    if (data.state) gameState = data.state;
    showToast(data.success ? '操作已同步到大螢幕' : '目前狀態無法執行此操作', !data.success);
    render();
  });

  document.querySelectorAll('#stage-controls button').forEach(button => {
    button.addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_SET_PRESENTATION, { stage: button.dataset.stage }));
  });
  byId('map-select').addEventListener('change', event => emit(CLIENT_TO_SERVER.CONTROL_SELECT_MAP, { mapId: event.target.value }));
  byId('btn-start').addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_START_ROUND));
  byId('btn-pause').addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_PAUSE_GAME));
  byId('btn-resume').addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_RESUME_GAME));
  byId('btn-reset').addEventListener('click', () => {
    if (confirm('確定要清除所有玩家、分數與進度，重新回到大廳嗎？')) emit(CLIENT_TO_SERVER.CONTROL_RESET_GAME);
  });
  byId('btn-award-prev').addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_AWARD_ACTION, { action: 'prev' }));
  byId('btn-award-reveal').addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_AWARD_ACTION, { action: 'reveal' }));
  byId('btn-award-next').addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_AWARD_ACTION, { action: 'next' }));
  byId('gm-unlock').addEventListener('change', event => byId('gm-controls').classList.toggle('is-locked', !event.target.checked));
  byId('btn-force-quiz').addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_FORCE_QUIZ, { quizId: byId('quiz-select').value || null }));
  byId('btn-force-boost').addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_FORCE_ITEM, { teamId: byId('gm-team-select').value, itemType: 'large_boost' }));
  byId('btn-force-stun').addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_FORCE_ITEM, { teamId: byId('gm-team-select').value, itemType: 'stun' }));

  socket.auth = { role: 'control' };
  socket.connect();
});
