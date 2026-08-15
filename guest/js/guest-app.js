/**
 * 手機賓客端主程式：管理登入、選隊、點擊與分屏答題
 */
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = window.GameEvents;
  
  let myPlayerInfo = { nickname: '', avatar: '🥳', teamId: null, isJoined: false };
  let currentGameState = 'LOBBY';

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
    if (target) target.classList.add('active');
  };

  // 1. 頭像選擇邏輯
  document.querySelectorAll('.avatar-opt').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('.avatar-opt').forEach(opt => opt.classList.remove('selected'));
      el.classList.add('selected');
      myPlayerInfo.avatar = el.getAttribute('data-val');
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
    myPlayerInfo.isJoined = true;
    socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, { nickname: nick, avatar: myPlayerInfo.avatar });
    showScreen('screen-team-select');
  };

  // 3. 動態產生選隊卡片與邏輯
  function renderTeamChoices() {
    const container = document.getElementById('dynamic-teams-container');
    if (!container) return;
    container.innerHTML = '';
    
    if (window.GameConfig && window.GameConfig.TEAMS) {
      window.GameConfig.TEAMS.forEach(team => {
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
                <span id="choice-${team.id}-count" class="member-count-tag">👥 已就位：0 人</span>
                <button class="btn-select bg-${team.color}" style="background-color: ${team.hex}">✨ 加入 ${team.name}</button>
            </div>
        `;
        
        card.onclick = () => {
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
      socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, { 
        nickname: myPlayerInfo.nickname, 
        avatar: myPlayerInfo.avatar,
        isReconnect: true,
        teamId: myPlayerInfo.teamId 
      });
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, (state) => {
    currentGameState = state.state;
    syncGameConfig(state.config);
    updateHeader();

    // 確保如果系統被強制中斷或離開答題，能清空背景計時器與介面
    if (currentGameState !== 'QUIZ' && typeof quizUI !== 'undefined') {
      quizUI.hide();
    }

    if (currentGameState === 'LOBBY' || currentGameState === 'MAP_SELECT' || currentGameState === 'ROUND_LOBBY') {
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
        document.getElementById('wait-desc').innerText = '開始遊戲後還沒加入的玩家不能再加入，\n請觀看大螢幕，等待下局開放加入與選隊！';
      }
    } else if (currentGameState === 'ROUND_FINISHED' || currentGameState === 'MATCH_FINISHED') {
      showScreen('screen-waiting');
      document.getElementById('wait-title').innerText = '🏆 本局賽事結算中！';
      document.getElementById('wait-desc').innerText = '請觀看大螢幕精彩戰績結算！\n即將為您開放下局換隊與加入！';
    }

    if (state.teams) updateTeamsCount(state.teams);
  });

  socket.on(SERVER_TO_CLIENT.GAME_JOIN_LOCKED, (data) => {
    showScreen('screen-waiting');
    document.getElementById('wait-title').innerText = '🔒 抱歉，比賽已開始！';
    document.getElementById('wait-desc').innerText = '根據遊戲規則：開始遊戲後還沒加入的玩家不能再加入！\n請觀看大螢幕投影，等待下局開放重新加入！';
  });

  socket.on('guest:team_chosen', (data) => {
    myPlayerInfo.teamId = data.teamId;
    updateHeader();
    
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
      const card = btn.closest('.team-choice-card');
      const tId = card ? card.getAttribute('data-team') : '';
      let tName = tId;
      if (window.GameConfig && window.GameConfig.TEAMS) {
        const tConf = window.GameConfig.TEAMS.find(t => t.id === tId);
        if (tConf) tName = tConf.name;
      }
      btn.innerText = `👉 加入 ${tName}`;
      btn.style.opacity = '0.7';
    });
    const chosenBtn = document.querySelector(`.team-choice-card[data-team="${data.teamId}"] button`);
    if (chosenBtn) {
      chosenBtn.innerText = `✅ 已成功加入 ${teamNameStr}！(可重新選隊)`;
      chosenBtn.style.opacity = '1';
    }

    if (currentGameState === 'RACING' || currentGameState === 'COUNTDOWN') {
      showScreen('screen-racing');
    } else {
      alert(`🎉 成功加入 ${teamNameStr}！準備開跑！`);
    }
  });

  socket.on(SERVER_TO_CLIENT.SYSTEM_ERROR, (err) => {
    alert('⚠️ 系統提示：' + (err.message || '操作發生錯誤'));
  });

  socket.on(SERVER_TO_CLIENT.GAME_TEAM_UPDATED, (data) => {
    if (data.teams) updateTeamsCount(data.teams);
  });
  socket.on(SERVER_TO_CLIENT.GAME_PLAYER_JOINED, (data) => {
    if (data.teams) updateTeamsCount(data.teams);
  });

  function updateTeamsCount(teams) {
    for (const t of teams) {
      const el = document.getElementById(`choice-${t.id}-count`);
      if (el) el.innerText = `已就位：${t.memberCount} 人`;
    }
  }

  // 高頻位置更新中檢查自己隊伍是否暈眩
  socket.on(SERVER_TO_CLIENT.GAME_POSITION_UPDATE, (data) => {
    if (!myPlayerInfo.teamId || !data.teams) return;
    const myTeamData = data.teams[myPlayerInfo.teamId];
    if (myTeamData) {
      tapHandler.setStunned(myTeamData.isStunned);
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
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_RESULT, () => {
    quizUI.stopTimer();
    if (myPlayerInfo.isJoined) {
      showScreen('screen-racing');
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_ROUND_FINISHED, () => {
    quizUI.stopTimer();
    if (myPlayerInfo.isJoined) {
      showScreen('screen-waiting');
      document.getElementById('wait-title').innerText = '🏆 本局賽事結算中！';
      document.getElementById('wait-desc').innerText = '請觀看大螢幕精彩戰績結算！\n即將為您開放下局換隊與加入！';
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
