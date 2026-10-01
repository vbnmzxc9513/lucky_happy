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
  let protocolMismatch = false;
  let advancePending = null;
  let advanceTimer = null;
  let awaitingSync = true;
  let receivedAt = performance.now();

  const byId = id => document.getElementById(id);
  const emit = (event, data = {}) => {
    if (!socket.connected || protocolMismatch) return;
    if (awaitingSync && event !== CLIENT_TO_SERVER.GUEST_SYNC) {
      showToast('正在同步最新狀態，請稍候', true);
      return;
    }
    socket.emit(event, data);
  };

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
      const shuttle = window.ShuttleRace?.enabled(gameState.config) ? window.ShuttleRace.measure(team.position, gameState.config) : null;
      return `<div class="team-row">
        <span class="team-rank">${index + 1}</span>
        <img src="${conf.imgPath || ''}" alt="">
        <span class="team-name">${team.name}<small>${team.memberCount || 0} 人${team.isStunned ? ' · 暈眩' : ''}</small></span>
        <span class="team-bar"><i style="width:${(shuttle ? shuttle.progress : progress).toFixed(1)}%;background:${conf.hex || '#315E58'}"></i></span>
        <span class="team-progress">${shuttle ? `${shuttle.laps} 圈` : `${progress.toFixed(0)}%`}</span>
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
      const stage = gameState?.quizStage;
      const auto = byId('auto-question-status');
      auto.hidden = stage?.phase !== 'tap';
      const authorityNow = gameState?.paused ? gameState.pausedAt : gameState?.serverNow + performance.now() - receivedAt;
      if (!auto.hidden) auto.textContent = `第 1 題將於倒數結束後自動開始 · 剩餘 ${Math.max(0, Math.ceil((stage.endsAt - authorityNow) / 1000))} 秒`;
      const startedAt = gameState && gameState.finalSprint && gameState.finalSprint.raceStartedAt;
      if (!startedAt) {
        byId('race-clock').textContent = '00:00';
        return;
      }
      const now = gameState.paused && gameState.pausedAt
        ? gameState.pausedAt
        : authorityNow;
      const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
      byId('race-clock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    };
    tick();
    raceClockTimer = setInterval(tick, 200);
  }

  function render() {
    if (!gameState) return;
    presentation = gameState.presentation || presentation;
    byId('game-state').textContent = stateLabels[gameState.state] || gameState.state;
    byId('player-count').textContent = String(gameState.totalPlayers || 0);
    byId('presentation-state').textContent = stageLabels[presentation.stage] || presentation.stage;
    byId('paused-badge').hidden = !gameState.paused;
    if (!gameState.quizStage) byId('quiz-state').textContent = '尚未開始';
    if (gameState.quizStage) {
      const stage = gameState.quizStage;
      const phase = { awaiting_question: '等待主持開始本題', tap: '連點中', prepare: '準備答題', answer: '作答中', reveal: '顯示統計／等待下一步', summary: '本關結算／等待下一關', sprint: '最後衝刺' };
      byId('quiz-state').textContent = `第 ${stage.stageNumber}/${stage.stageCount} 關 · 第 ${stage.questionNumber}/${stage?.questionsPerStage || gameState?.config?.quizStages?.questionsPerStage} 題 · ${phase[stage.phase]} (${stage.phase}) · ${stage.completedQuestions} 題完成`;
    }
    if (gameState.config?.quizStages?.enabled) {
      byId('quiz-select').disabled = true;
      byId('quiz-select').value = '';
      byId('btn-force-quiz').textContent = '正式模式請使用主要進題按鈕';
      byId('btn-force-quiz').disabled = true;
    }
    renderAdvance();
    renderPrimaryControls();
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

  function renderPrimaryControls() {
    const unavailable = !socket.connected || protocolMismatch || awaitingSync || !gameState;
    byId('btn-start').disabled = unavailable || !['LOBBY', 'MAP_SELECT', 'ROUND_LOBBY'].includes(gameState?.state);
    byId('btn-pause').disabled = unavailable || gameState?.paused || !['COUNTDOWN', 'RACING', 'QUIZ', 'ROUND_FINISHED'].includes(gameState?.state);
    byId('btn-resume').disabled = unavailable || !gameState?.paused;
    byId('btn-pause').hidden = !!gameState?.paused;
    byId('btn-resume').hidden = !gameState?.paused;
    renderAdvance();
  }

  function renderAdvance() {
    const stage = gameState?.quizStage;
    const button = byId('btn-advance-quiz');
    const labels = {
      reveal: stage?.questionNumber < (stage?.questionsPerStage || gameState?.config?.quizStages?.questionsPerStage) ? '下一題' : '顯示本關結算',
      summary: stage?.stageNumber < stage?.stageCount ? '開始下一關' : '開始最後衝刺' };
    button.textContent = advancePending ? '操作送出中…' : labels[stage?.phase] || (stage?.phase === 'tap' ? '第 1 題將自動開始' : '等待可推進階段');
    button.disabled = !socket.connected || protocolMismatch || awaitingSync || !!advancePending || gameState?.paused
      || gameState?.state !== 'QUIZ' || !labels[stage?.phase];
  }

  socket.on('connect', () => {
    clearTimeout(toastTimer);
    byId('control-toast').classList.remove('show');
    renderPrimaryControls();
    byId('connection-status').textContent = '即時連線';
    byId('connection-status').classList.remove('is-offline');
    byId('connection-status').classList.add('is-online');
  });
  socket.on('disconnect', () => {
    awaitingSync = true;
    clearTimeout(advanceTimer); advancePending = null; renderPrimaryControls();
    byId('connection-status').textContent = protocolMismatch ? '版本已過期，請重新整理' : '網路中斷，正在重連';
    byId('connection-status').classList.remove('is-online');
    byId('connection-status').classList.add('is-offline');
  });
  socket.on('connect_error', error => {
    awaitingSync = true;
    renderPrimaryControls();
    const unauthorized = error?.message === 'UNAUTHORIZED_STAFF_SOCKET'
      || error?.data?.code === 'UNAUTHORIZED_STAFF_SOCKET';
    byId('connection-status').textContent = unauthorized ? '驗證失敗，請重新登入' : '網路中斷，正在重連';
    byId('connection-status').classList.remove('is-online');
    byId('connection-status').classList.add('is-offline');
    showToast(unauthorized ? '請回到工作人員主頁重新輸入驗證碼' : '網路中斷，正在重連', true);
  });
  socket.on(SERVER_TO_CLIENT.SYSTEM_ERROR, error => {
    if (error?.code !== 'PROTOCOL_MISMATCH') return;
    protocolMismatch = true;
    renderPrimaryControls();
    byId('connection-status').textContent = '版本已過期，請重新整理';
    byId('connection-status').classList.remove('is-online');
    byId('connection-status').classList.add('is-offline');
    showToast('頁面版本已過期，請重新整理頁面。', true);
  });
  socket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, state => {
    if (gameState?.runId === state.runId && Number.isFinite(state.stateVersion) && state.stateVersion < gameState.stateVersion) return;
    if (Number.isFinite(gameState?.serverNow) && state.serverNow < gameState.serverNow) return;
    gameState = state; receivedAt = performance.now(); awaitingSync = false; render();
  });
  socket.on(SERVER_TO_CLIENT.GAME_PRESENTATION_UPDATED, data => { presentation = data; if (gameState) gameState.presentation = data; render(); });
  socket.on(SERVER_TO_CLIENT.GAME_MAP_LIST, data => { maps = Array.isArray(data) ? data : []; renderMaps(); });
  socket.on('admin:quiz_list', data => { quizzes = Array.isArray(data) ? data : []; renderQuizzes(); });
  socket.on(SERVER_TO_CLIENT.GAME_POSITION_UPDATE, data => {
    if (!gameState || !data.teams) return;
    gameState.teams = gameState.teams.map(team => ({ ...team, ...(data.teams[team.id] || {}) }));
    renderTeams();
  });
  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_PREPARE, () => { if (gameState?.quizStage) return; byId('quiz-state').textContent = '題目準備中'; });
  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_START, data => { if (gameState?.quizStage) return; byId('quiz-state').textContent = `作答中 · ${data.timeLimit} 秒`; });
  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_PROGRESS, data => { if (gameState?.quizStage) return; byId('quiz-state').textContent = `已作答 ${data.answeredCount} / ${data.totalCount}`; });
  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_RESULT, () => { if (gameState?.quizStage) return; byId('quiz-state').textContent = '本題已結算'; });
  socket.on(SERVER_TO_CLIENT.CONTROL_ACTION_RESULT, data => {
    if (data.action === 'ADVANCE_QUIZ_FLOW' && data.requestId === advancePending) {
      clearTimeout(advanceTimer); advancePending = null;
    }
    if (data.state && (!gameState || data.state.serverNow >= gameState.serverNow || !gameState.serverNow)) { gameState = data.state; receivedAt = performance.now(); }
    showToast(data.success ? '操作已同步到大螢幕' : `操作失敗：${data.reason || '目前狀態無法執行此操作'}`, !data.success);
    render();
  });

  document.querySelectorAll('#stage-controls button').forEach(button => {
    button.addEventListener('click', () => emit(CLIENT_TO_SERVER.CONTROL_SET_PRESENTATION, { stage: button.dataset.stage }));
  });
  byId('map-select').addEventListener('change', event => emit(CLIENT_TO_SERVER.CONTROL_SELECT_MAP, { mapId: event.target.value }));
  byId('btn-advance-quiz').addEventListener('click', () => {
    if (byId('btn-advance-quiz').disabled) return;
    const stage = gameState.quizStage;
    advancePending = window.GameClientId.create();
    emit(CLIENT_TO_SERVER.CONTROL_ADVANCE_QUIZ_FLOW, { requestId: advancePending, runId: gameState.runId,
      stageNumber: stage.stageNumber, flowRevision: stage.flowRevision });
    renderAdvance();
    advanceTimer = setTimeout(() => {
      advancePending = null; showToast('未收到操作確認，正在重新同步', true);
      gameState = null; awaitingSync = true; renderPrimaryControls(); emit(CLIENT_TO_SERVER.GUEST_SYNC);
    }, 5000);
  });
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

  socket.auth = { ...socket.auth, role: 'control', protocolVersion: 2 };
  socket.connect();
});
