/**
 * 手機賓客端主程式：管理登入、選隊、點擊與分屏答題
 */
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const stageDisplay = window.StageDisplay ? new window.StageDisplay('guest') : null;
  const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = window.GameEvents;

  const SESSION_STORAGE_KEY = 'luckyHorseGuestSessionV1';
  const createSessionId = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `guest_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  };
  const loadSavedPlayer = () => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || 'null');
      if (saved && typeof saved.sessionId === 'string' && saved.sessionId.length >= 16) {
        return {
          nickname: typeof saved.nickname === 'string' ? saved.nickname : '',
          avatar: typeof saved.avatar === 'string' ? saved.avatar : '🥳',
          teamId: typeof saved.teamId === 'string' ? saved.teamId : null,
          isJoined: saved.isJoined === true,
          sessionId: saved.sessionId
        };
      }
    } catch (err) {
      console.warn('無法讀取賓客連線會話:', err);
    }
    return { nickname: '', avatar: '🥳', teamId: null, isJoined: false, sessionId: createSessionId() };
  };

  let myPlayerInfo = loadSavedPlayer();
  let registrationPending = false;
  let currentGameState = 'LOBBY';
  let finalSprintCountdownTimer = null;
  let finalSprintCompactTimer = null;

  const persistPlayer = () => {
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(myPlayerInfo));
    } catch (err) {
      console.warn('無法儲存賓客連線會話:', err);
    }
  };

  const setJoinPending = (pending) => {
    const button = document.getElementById('btn-join');
    if (!button) return;
    button.disabled = pending;
    button.innerText = pending ? '正在確認名稱...' : '🎉 確定名稱，進入選隊';
  };

  const emitJoin = (allowUnjoined = false) => {
    if ((!myPlayerInfo.isJoined && !allowUnjoined) || !myPlayerInfo.nickname || registrationPending) return;
    registrationPending = true;
    setJoinPending(true);
    socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
      nickname: myPlayerInfo.nickname,
      avatar: myPlayerInfo.avatar,
      sessionId: myPlayerInfo.sessionId,
      teamId: myPlayerInfo.teamId
    });
  };

  const tapHandler = new window.TapHandler((timestamp) => {
    socket.emit(CLIENT_TO_SERVER.GUEST_TAP, { timestamp });
  });

  const quizUI = new window.QuizUI((answer) => {
    socket.emit(CLIENT_TO_SERVER.GUEST_QUIZ_ANSWER, { quizId: window.currentQuizId, answer });
  });

  // 畫面切換
  const showScreen = (screenId) => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.add('active');
      target.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  };

  const showTeamSelectMessage = (message = '') => {
    const messageEl = document.getElementById('team-select-message');
    if (messageEl) messageEl.innerText = message;
  };

  const showPauseOverlay = (visible) => {
    const overlay = document.getElementById('mobile-pause-overlay');
    if (overlay) overlay.classList.toggle('active', !!visible);
  };

  const updatePlayerStatus = (status) => {
    if (!status) return;
    const tapCount = Number(status.tapCount || 0);
    const rank = status.teamRank ? `第 ${status.teamRank}` : '--';
    const progress = Math.min(100, Math.max(0, Number(status.teamProgressPercent || 0)));
    const nextCritical = Number(status.nextCriticalIn || 20);
    const tapEl = document.getElementById('my-tap-count');
    const rankEl = document.getElementById('my-team-rank');
    const progressEl = document.getElementById('my-team-progress');
    const criticalEl = document.getElementById('next-critical-count');
    const criticalFill = document.getElementById('critical-progress-fill');
    if (tapEl) tapEl.innerText = tapCount.toLocaleString('zh-TW');
    if (rankEl) rankEl.innerText = rank;
    if (progressEl) progressEl.innerText = status.teamShuttle
      ? `${status.teamShuttle.laps} 圈 · ${Math.floor(status.teamShuttle.progress)}%` : `${progress.toFixed(0)}%`;
    if (criticalEl) criticalEl.innerText = nextCritical;
    if (criticalFill) criticalFill.style.width = `${(tapCount % 20) / 20 * 100}%`;
    showPauseOverlay(!!status.paused);
  };

  const hideFinalSprint = () => {
    const banner = document.getElementById('final-sprint-mobile');
    if (finalSprintCountdownTimer) clearInterval(finalSprintCountdownTimer);
    if (finalSprintCompactTimer) clearTimeout(finalSprintCompactTimer);
    finalSprintCountdownTimer = null;
    finalSprintCompactTimer = null;
    if (banner) {
      banner.classList.remove('active', 'compact');
      banner.setAttribute('aria-hidden', 'true');
    }
  };

  const showFinalSprint = (data, announce = true) => {
    const banner = document.getElementById('final-sprint-mobile');
    const secondsEl = document.getElementById('final-sprint-mobile-seconds');
    if (!banner || !secondsEl) return;
    const hardFinishAt = Number(data && data.hardFinishAt) ||
      (Date.now() + Math.max(0, Number(data && data.durationSeconds) || 60) * 1000);

    if (finalSprintCountdownTimer) clearInterval(finalSprintCountdownTimer);
    if (finalSprintCompactTimer) clearTimeout(finalSprintCompactTimer);
    banner.classList.add('active');
    banner.classList.toggle('compact', !announce);
    banner.setAttribute('aria-hidden', 'false');

    const updateCountdown = () => {
      secondsEl.innerText = String(Math.max(0, Math.ceil((hardFinishAt - Date.now()) / 1000)));
    };
    updateCountdown();
    finalSprintCountdownTimer = setInterval(updateCountdown, 250);
    if (announce) {
      finalSprintCompactTimer = setTimeout(() => banner.classList.add('compact'), 3000);
    }
  };

  // 1. 頭像選擇邏輯
  document.querySelectorAll('.avatar-opt').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('.avatar-opt').forEach(opt => opt.classList.remove('selected'));
      el.classList.add('selected');
      myPlayerInfo.avatar = el.getAttribute('data-val');
      persistPlayer();
    };
  });

  // 2. 登入加入遊戲
  document.getElementById('btn-join').onclick = () => {
    const nick = document.getElementById('input-nickname').value.trim();
    if (!nick) {
      document.getElementById('login-error').innerText = '⚠️ 請輸入您的稱呼！';
      return;
    }
    myPlayerInfo.nickname = nick;
    myPlayerInfo.isJoined = false;
    persistPlayer();
    registrationPending = false;
    document.getElementById('login-error').innerText = '';
    emitJoin(true);
  };

  // 3. 動態產生選隊卡片與邏輯
  function renderTeamChoices() {
    const container = document.getElementById('dynamic-teams-container');
    if (!container) return;
    container.innerHTML = '';
    
    if (window.GameConfig && window.GameConfig.TEAMS) {
      window.GameConfig.TEAMS.forEach(team => {
        const maxMembers = Number(window.GameConfig.maxPlayersPerTeam || 50);
        const card = document.createElement('div');
        card.className = `team-choice-card ${team.color}-choice`;
        card.setAttribute('data-team', team.id);
        
        card.innerHTML = `
            <div class="choice-card-header">
                <img src="${team.imgPath}" alt="${team.name}" class="choice-dog-img">
                <div class="choice-title-wrap">
                    <h3>${team.name}</h3>
                    <div class="choice-slogan">${team.slogan}</div>
                </div>
            </div>
            <div class="choice-card-footer">
                <span id="choice-${team.id}-count" class="member-count-tag">👥 0 / ${maxMembers}</span>
                <button class="btn-select bg-${team.color}" style="background-color: ${team.hex}">加入</button>
            </div>
        `;
        
        card.onclick = () => {
          if (card.classList.contains('is-full') && myPlayerInfo.teamId !== team.id) {
            showTeamSelectMessage(`${team.name} 已達 ${maxMembers} 人上限，請選擇其他隊伍。`);
            return;
          }
          showTeamSelectMessage('');
          socket.emit(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, { teamId: team.id });
        };
        container.appendChild(card);
      });
    }
  }

  function syncGameConfig(config) {
    if (!config || !Array.isArray(config.TEAMS)) return;
    window.GameConfig = {
      ...(window.GameConfig || {}),
      ...config,
      TEAMS: config.TEAMS
    };
    renderTeamChoices();
  }
  
  // 進入頁面時渲染
  renderTeamChoices();

  // --- WebSocket 事件聽取 ---
  socket.on('connect', () => {
    console.log('連線成功:', socket.id);
    // 斷線重連機制 (Auto-Healing)
    if (myPlayerInfo.isJoined) {
      console.log('🔄 偵測到斷線重連，正在還原連線會話...');
      registrationPending = false;
      emitJoin();
    }
  });

  socket.on(SERVER_TO_CLIENT.GUEST_JOIN_ACK, (data) => {
    registrationPending = false;
    setJoinPending(false);
    if (data && data.success) {
      myPlayerInfo.isJoined = true;
      if (data.teamId) myPlayerInfo.teamId = data.teamId;
      persistPlayer();
      updateHeader();
      document.getElementById('login-error').innerText = '';
      if (currentGameState === 'LOBBY' || currentGameState === 'MAP_SELECT' || currentGameState === 'ROUND_LOBBY') {
        showScreen('screen-team-select');
      }
      return;
    }

    myPlayerInfo.isJoined = false;
    if (data && data.reason === 'DUPLICATE_NICKNAME') {
      myPlayerInfo.teamId = null;
      persistPlayer();
      showScreen('screen-login');
      const nicknameInput = document.getElementById('input-nickname');
      const rejectedName = (data.nickname || myPlayerInfo.nickname || '').trim();
      document.getElementById('login-error').innerText = `「${rejectedName}」已有人使用，請換一個更好認的稱呼。`;
      if (nicknameInput) {
        nicknameInput.focus();
        nicknameInput.select();
      }
    } else if (data && data.reason !== 'RACE_IN_PROGRESS') {
      document.getElementById('login-error').innerText = '目前無法完成報到，請稍後再試。';
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, (state) => {
    currentGameState = state.state;
    syncGameConfig(state.config);
    quizUI.paused = !!state.paused;
    stageDisplay?.sync(state, myPlayerInfo.teamId);
    if (state.quizStage?.phase === 'summary') quizUI.disableAll();
    if (state.quizStage?.phase === 'reveal') {
      quizUI.disableAll();
      quizUI.showTeamResult(state.quizStage.reveal?.teamResults[myPlayerInfo.teamId]);
    }
    showPauseOverlay(!!state.paused);
    if (state.finalSprint && state.finalSprint.active) {
      const banner = document.getElementById('final-sprint-mobile');
      if (!banner || !banner.classList.contains('active')) showFinalSprint(state.finalSprint, false);
    } else if (currentGameState !== 'RACING' && currentGameState !== 'QUIZ') {
      hideFinalSprint();
    }
    updateHeader();

    // 確保如果系統被強制中斷或離開答題，能清空背景計時器與介面
    if (currentGameState !== 'QUIZ' && typeof quizUI !== 'undefined') {
      quizUI.hide();
    }

    if (currentGameState === 'LOBBY' || currentGameState === 'MAP_SELECT' || currentGameState === 'ROUND_LOBBY') {
      const registeredOnServer = Array.isArray(state.players)
        ? state.players.some(player => player && player.socketId === socket.id)
        : true;
      if (myPlayerInfo.isJoined && !registeredOnServer && !registrationPending) {
        emitJoin();
      }
      if (myPlayerInfo.isJoined) {
        showScreen('screen-team-select');
      } else {
        showScreen('screen-login');
      }
    } else if (currentGameState === 'COUNTDOWN' || currentGameState === 'RACING' || currentGameState === 'QUIZ') {
      if (myPlayerInfo.teamId) {
        if (currentGameState === 'QUIZ') {
          showScreen('screen-quiz'); // 若在答題中重連，強制切換至答題畫面
        } else {
          showScreen('screen-racing');
        }
      } else {
        // 尚未選隊則顯示鎖定等候
        showScreen('screen-waiting');
        document.getElementById('wait-title').innerText = '⏳ 比賽正火爆進行中！';
        document.getElementById('wait-desc').innerText = '本場遊戲已開始，請觀看大螢幕等待最終結果。';
      }
    } else if (currentGameState === 'ROUND_FINISHED' || currentGameState === 'MATCH_FINISHED') {
      showScreen('screen-waiting');
      document.getElementById('wait-title').innerText = '🏆 本局賽事結算中！';
      document.getElementById('wait-desc').innerText = '請觀看大螢幕，精彩戰績與最終頒獎即將揭曉！';
    }

    if (state.teams) updateTeamsCount(state.teams);
  });

  socket.on(SERVER_TO_CLIENT.GAME_JOIN_LOCKED, (data) => {
    registrationPending = false;
    setJoinPending(false);
    showScreen('screen-waiting');
    document.getElementById('wait-title').innerText = '🔒 抱歉，比賽已開始！';
    document.getElementById('wait-desc').innerText = '本場遊戲已開始，請觀看大螢幕等待最終結果。';
  });

  socket.on(SERVER_TO_CLIENT.GAME_TEAM_FULL, (data) => {
    registrationPending = false;
    const team = (window.GameConfig && window.GameConfig.TEAMS || [])
      .find(item => item.id === data.teamId);
    const teamName = team ? team.name : '這個隊伍';
    const maxMembers = Number(data.maxPlayersPerTeam || 50);
    showScreen('screen-team-select');
    showTeamSelectMessage(`${teamName} 已達 ${maxMembers} 人上限，請選擇其他隊伍。`);
    const card = document.querySelector(`.team-choice-card[data-team="${data.teamId}"]`);
    if (card && myPlayerInfo.teamId !== data.teamId) card.classList.add('is-full');
  });

  socket.on('guest:team_chosen', (data) => {
    myPlayerInfo.teamId = data.teamId;
    persistPlayer();
    updateHeader();
    showTeamSelectMessage('');
    
    // 更新應援橫幅
    const banner = document.getElementById('my-team-banner');
    const nameEl = document.getElementById('my-team-name');
    
    let teamConf = null;
    if (window.GameConfig && window.GameConfig.TEAMS) {
      teamConf = window.GameConfig.TEAMS.find(t => t.id === data.teamId);
    }
    
    if (teamConf) {
      nameEl.innerText = teamConf.name;
      banner.style.borderColor = teamConf.hex;
      // create a transparent version of the hex color for the background
      banner.style.background = teamConf.hex + '26'; // approx 15% opacity
    }

    const teamNameStr = teamConf ? teamConf.name : data.teamId;

    // 更新選隊按鈕文字顯示當前狀態
    document.querySelectorAll('.team-choice-card button').forEach(btn => {
      btn.innerText = '加入';
      btn.style.opacity = '0.7';
    });
    const chosenBtn = document.querySelector(`.team-choice-card[data-team="${data.teamId}"] button`);
    if (chosenBtn) {
      chosenBtn.innerText = '✓ 已加入';
      chosenBtn.style.opacity = '1';
    }

    if (currentGameState === 'RACING' || currentGameState === 'COUNTDOWN') {
      showScreen('screen-racing');
    } else {
      showTeamSelectMessage(`已加入 ${teamNameStr}，準備開跑！`);
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_TEAM_ASSIGNED, (data) => {
    if (!data || !data.teamId) return;
    myPlayerInfo.teamId = data.teamId;
    persistPlayer();
    updateHeader();
    const teamConf = ((window.GameConfig && window.GameConfig.TEAMS) || []).find(team => team.id === data.teamId);
    const banner = document.getElementById('my-team-banner');
    const nameEl = document.getElementById('my-team-name');
    if (teamConf && banner && nameEl) {
      nameEl.innerText = teamConf.name;
      banner.style.borderColor = teamConf.hex;
      banner.style.background = `${teamConf.hex}26`;
    }
    showTeamSelectMessage(`系統已自動分配至 ${teamConf ? teamConf.name : data.teamId}`);
    if (currentGameState === 'COUNTDOWN' || currentGameState === 'RACING') showScreen('screen-racing');
  });

  socket.on(SERVER_TO_CLIENT.GAME_TAP_ACK, (result) => {
    tapHandler.showAckFeedback(result);
    if (result && result.status) updatePlayerStatus(result.status);
  });

  socket.on(SERVER_TO_CLIENT.GAME_PLAYER_STATUS, updatePlayerStatus);
  socket.on(SERVER_TO_CLIENT.GAME_PAUSED, () => showPauseOverlay(true));
  socket.on(SERVER_TO_CLIENT.GAME_RESUMED, () => showPauseOverlay(false));

  socket.on(SERVER_TO_CLIENT.SYSTEM_ERROR, (err) => {
    registrationPending = false;
    setJoinPending(false);
    alert('⚠️ 系統提示：' + (err.message || '操作發生錯誤'));
  });

  socket.on(SERVER_TO_CLIENT.GAME_TEAM_UPDATED, (data) => {
    if (data.teams) updateTeamsCount(data.teams);
  });
  socket.on(SERVER_TO_CLIENT.GAME_PLAYER_JOINED, (data) => {
    if (data.teams) updateTeamsCount(data.teams);
  });

  socket.on(SERVER_TO_CLIENT.GAME_FINAL_SPRINT, (data) => {
    showFinalSprint(data, true);
  });

  function updateTeamsCount(teams) {
    for (const t of teams) {
      const maxMembers = Number(t.maxMembers || (window.GameConfig && window.GameConfig.maxPlayersPerTeam) || 50);
      const isCurrentTeam = myPlayerInfo.teamId === t.id;
      const isFull = !!t.isFull || Number(t.memberCount || 0) >= maxMembers;
      const el = document.getElementById(`choice-${t.id}-count`);
      if (el) el.innerText = `👥 ${t.memberCount} / ${maxMembers}${isFull ? '・已滿' : ''}`;
      const card = document.querySelector(`.team-choice-card[data-team="${t.id}"]`);
      const button = card ? card.querySelector('.btn-select') : null;
      if (card) {
        card.classList.toggle('is-full', isFull && !isCurrentTeam);
        card.classList.toggle('is-current-team', isCurrentTeam);
      }
      if (button) {
        button.disabled = isFull && !isCurrentTeam;
        if (isCurrentTeam) button.innerText = '✓ 已加入';
        else if (isFull) button.innerText = '已額滿';
        else button.innerText = '加入';
      }
    }
  }

  // 高頻位置更新中檢查自己隊伍是否暈眩
  socket.on(SERVER_TO_CLIENT.GAME_POSITION_UPDATE, (data) => {
    if (!myPlayerInfo.teamId || !data.teams) return;
    const myTeamData = data.teams[myPlayerInfo.teamId];
    if (myTeamData) {
      tapHandler.setStunned(myTeamData.isStunned);
      if (window.ShuttleRace?.enabled(window.GameConfig)) {
        const distance = window.ShuttleRace.measure(myTeamData.position, window.GameConfig);
        document.getElementById('my-team-progress').textContent = `${distance.laps} 圈 · ${Math.floor(distance.progress)}%`;
        document.getElementById('my-team-rank').textContent = `第 ${window.ShuttleRace.rank(data.teams)[myPlayerInfo.teamId]}`;
      }
    }
  });

  // --- 分屏答題控制 ---
  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_PREPARE, (data) => {
    if (myPlayerInfo.isJoined) {
      showScreen('screen-quiz');
    }
    // 在手機端顯示等待提示與倒數
    quizUI.showPrepare(data.seconds);
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_OPTIONS, (data) => {
    window.currentQuizId = data.quizId;
    if (myPlayerInfo.isJoined) {
      showScreen('screen-quiz');
    }
    quizUI.showOptions(data.options, data.timeLimit);
    if (data.alreadyAnswered) {
      quizUI.isAnswered = true;
      quizUI.disableAll();
      const message = document.getElementById('quiz-lock-msg');
      message.style.display = 'block';
      message.innerText = '本題已作答，答案已保留';
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK, (result) => {
    quizUI.showAnswerAck(result);
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_RESULT, (data) => {
    quizUI.stopTimer();
    const teamResult = data && data.teamResults ? data.teamResults[myPlayerInfo.teamId] : null;
    quizUI.showTeamResult(teamResult);
  });

  socket.on(SERVER_TO_CLIENT.GAME_ROUND_FINISHED, () => {
    hideFinalSprint();
    quizUI.stopTimer();
    if (myPlayerInfo.isJoined) {
      showScreen('screen-waiting');
      document.getElementById('wait-title').innerText = '🏆 本局賽事結算中！';
      document.getElementById('wait-desc').innerText = '請觀看大螢幕，精彩戰績與最終頒獎即將揭曉！';
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_ROUND_LOBBY, () => {
    showScreen('screen-team-select');
  });

  function updateHeader() {
    document.getElementById('header-avatar').innerText = myPlayerInfo.avatar || '🙂';
    document.getElementById('header-nickname').innerText = myPlayerInfo.nickname || '訪客';
    
    const teamBadge = document.getElementById('header-team');
    const teams = (window.GameConfig && window.GameConfig.TEAMS) || [];
    const myTeam = teams.find(t => t.id === myPlayerInfo.teamId);
    if (myTeam) {
      teamBadge.innerText = myTeam.name;
      teamBadge.className = 'team-badge ' + myTeam.color;
      teamBadge.style.backgroundColor = myTeam.hex;
      teamBadge.style.color = '#fff';
    } else {
      teamBadge.innerText = '尚未選隊';
      teamBadge.className = 'team-badge';
      teamBadge.style.backgroundColor = '';
      teamBadge.style.color = '';
    }
  }
});
