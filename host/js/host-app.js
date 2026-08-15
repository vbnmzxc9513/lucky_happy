/**
 * 主持端主程式：與 WebSocket 溝通並協調 UI 模組
 */
document.addEventListener('DOMContentLoaded', () => {
  const socket = io({ autoConnect: false });
  const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = window.GameEvents;
  const raceRenderer = new window.RaceRenderer();
  const quizDisplay = new window.QuizDisplay();
  const scoreboardUI = new window.ScoreboardUI();

  async function connectPrivilegedSocket(role) {
    if (typeof socket.connect !== 'function') return;
    try {
      const tokenUrl = new URL(`/socket-token/${role}`, window.location.origin);
      const res = await fetch(tokenUrl.href, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`socket token request failed: ${res.status}`);
      const data = await res.json();
      socket.auth = { role, token: data.token };
      socket.connect();
    } catch (err) {
      console.error('主持端權限驗證失敗:', err);
      document.getElementById('game-state-label').innerText = '主持端權限驗證失敗，請重新整理並輸入密碼。';
    }
  }
  
  const mapSelectUI = new window.MapSelectUI((mapId) => {
    socket.emit(CLIENT_TO_SERVER.HOST_SELECT_MAP, { mapId });
  });

  let currentMapList = [];

  // UI 切換
  const backBtn = document.getElementById('btn-back-to-lobby');
  const cleanupTransientOverlays = () => {
    const countdownOverlay = document.getElementById('countdown-overlay');
    if (countdownOverlay) countdownOverlay.style.display = 'none';
    quizDisplay.hide();
    window._countdownActive = false;
    if (window.raceCountdownTimer) {
      clearInterval(window.raceCountdownTimer);
      window.raceCountdownTimer = null;
    }
  };
  const showScreen = (screenId) => {
    if (screenId === 'screen-lobby') cleanupTransientOverlays();
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
    // 大廳頁面隱藏「回到大廳」按鈕，其餘頁面顯示
    if (backBtn) backBtn.style.display = (screenId === 'screen-lobby') ? 'none' : 'flex';
  };

  // 0. 動態渲染主畫面元素 (Race Header, Lanes, Horses, Demo Buttons)
  function renderDynamicHostUI() {
    if (!window.GameConfig || !window.GameConfig.TEAMS) return;
    const teams = window.GameConfig.TEAMS;

    // A. 賽道頂部資訊板 (Race Header)
    const raceHeader = document.getElementById('dynamic-race-header');
    if (raceHeader) {
      raceHeader.innerHTML = '';
      teams.forEach(t => {
        const statHTML = `
          <div class="team-stat ${t.color}-stat">
              <span class="stat-title">${t.name}</span>
              <div class="progress-bar-wrap">
                  <div id="${t.id}-progress-fill" class="progress-fill bg-${t.color}" style="width: 0%; background-color: ${t.hex};"></div>
              </div>
              <!-- Hidden elements for JS compatibility -->
              <span id="race-${t.id}-count" style="display:none;">0</span>
              <span id="${t.id}-progress-text" style="display:none;">0%</span>
              <span id="${t.id}-stun-tag" class="stun-badge" style="display:none;">⚠️</span>
          </div>
        `;
        raceHeader.insertAdjacentHTML('beforeend', statHTML);
      });
      // Timer box absolute positioned
      raceHeader.insertAdjacentHTML('beforeend', `
        <div class="race-timer-box-absolute">
            <span id="race-timer-text">00:00</span>
        </div>
      `);
    }

    // B. 賽道 Lanes (五條等高草地跑道 + 紅色三角旗幟)
    const lanesContainer = document.getElementById('dynamic-lanes-container');
    if (lanesContainer) {
      lanesContainer.innerHTML = '';
      teams.forEach((t, i) => {
        const laneHTML = `
          <div class="track-lane ${t.color}-lane" style="top: ${i * 20}%;">
              <div class="lane-border-line"></div>
              <div class="lane-label" style="display: none;">${t.name}</div>
              <div class="lane-flag">
                  <div class="lane-flag-pole"></div>
                  <div class="lane-flag-triangle"></div>
                  <div class="lane-flag-base"></div>
              </div>
          </div>
        `;
        lanesContainer.insertAdjacentHTML('beforeend', laneHTML);
      });
    }

    // C. 賽馬物件 Horses (使用跑步姿態圖)
    const horsesContainer = document.getElementById('dynamic-horses-container');
    if (horsesContainer) {
      horsesContainer.innerHTML = '';
      teams.forEach((t, i) => {
        // 每條 lane 高度 20%, 馬匹放在 lane 的垂直中心
        const topPct = i * 20 + 10; // lane center: 10%, 30%, 50%, 70%, 90%
        const runSrc = t.runImgPath || t.imgPath;
        const horseHTML = `
          <div id="horse-${t.id}" class="horse-unit" style="left: 10px; top: ${topPct}%; margin-top: -50px;">
              <img class="horse-emoji" src="${runSrc}" alt="${t.name}" />
              <div id="${t.id}-effect-layer" class="horse-effect"></div>
          </div>
        `;
        horsesContainer.insertAdjacentHTML('beforeend', horseHTML);
      });
    }

    // D. Rules demo buttons
    const demoContainer = document.getElementById('dynamic-demo-buttons');
    if (demoContainer) {
      demoContainer.innerHTML = '';
      teams.forEach(t => {
        demoContainer.insertAdjacentHTML('beforeend', `<span class="demo-btn demo-${t.color}">${t.name}</span>`);
      });
    }
    
    // E. Quiz stats — 現在由 quiz-display.js 的 _renderTeamBar() 自行處理

    // F. Team Select Grid
    const teamSelectGrid = document.getElementById('dynamic-team-select-grid');
    if (teamSelectGrid) {
      teamSelectGrid.innerHTML = '';
      teams.forEach((t, i) => {
        // distribute float animation dynamically based on index
        const floatClass = `dog-float-${(i % 3) + 1}`; 
        const html = `
          <div class="team-select-card card-${t.color}-theme">
              <div class="team-card-badge ${t.color}-badge">${t.name} (${t.id.toUpperCase()})</div>
              <div class="team-card-img-wrap">
                  <img src="${t.imgPath}?v=${Date.now()}" alt="${t.name}" class="dog-showcase-img ${floatClass}">
              </div>
              <div class="team-card-info">
                  <div class="team-slogan">${t.slogan}</div>
                  <div class="team-roster-stat">
                      <span>👥 已加入：<strong id="select-${t.id}-count">0</strong> 人</span>
                      <span id="select-${t.id}-pct" class="pct-tag">0%</span>
                  </div>
                  <div class="select-bar-wrap">
                      <div id="select-${t.id}-bar" class="select-bar-fill bg-${t.color}" style="width: 0%; background-color: ${t.hex};"></div>
                  </div>
              </div>
          </div>
        `;
        teamSelectGrid.insertAdjacentHTML('beforeend', html);
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
    renderDynamicHostUI();
  }

  renderDynamicHostUI();

  // 追蹤伺服器當前狀態 (用於防止主持人在比賽中誤觸跳離)
  let currentServerState = 'LOBBY';
  window.selectCountdownTimer = null;

  // 1. 初始化連線
  socket.on('connect', () => {
    console.log('主控端已連線:', socket.id);
    
    const joinUrl = `${window.location.origin}/guest`;
    document.getElementById('join-url-text').innerText = joinUrl;
    
    // 產生動態 QR Code
    const qrContainer = document.getElementById('qr-placeholder');
    qrContainer.innerHTML = ''; // 清除舊的
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrContainer, {
        text: joinUrl,
        width: 200,
        height: 200,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
      });
    }
  });

  socket.on('connect_error', (err) => {
    console.error('主控端連線驗證失敗:', err.message);
    document.getElementById('game-state-label').innerText = '主持端連線驗證失敗，請重新整理並輸入密碼。';
  });

  socket.on('game:map_list', (list) => {
    currentMapList = list;
  });

  // 2. 接收全量狀態同步
  socket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, (state) => {
    console.log('狀態同步:', state);
    currentServerState = state.state;
    syncGameConfig(state.config);
    
    // 更新局數標籤
    if (state.roundStatus) {
      document.getElementById('round-status-badge').innerText = `第 ${state.roundStatus.currentRound} / ${state.roundStatus.totalRounds} 局`;
    }

    // 處理不同狀態畫面
    if (state.state === 'LOBBY' || state.state === 'MAP_SELECT' || state.state === 'ROUND_LOBBY') {
      const currentActive = document.querySelector('.screen.active');
      const currentId = currentActive ? currentActive.id : null;
      // 若主持端正在操作規則或選隊畫面，不強制拉回 lobby
      // 若主持端正在操作規則或選隊畫面，不強制拉回 lobby
      if (currentId !== 'screen-rules' && currentId !== 'screen-team-select') {
        showScreen('screen-lobby');
      } else if (state.state === 'LOBBY') {
        // 如果伺服器回到初始大廳，強制中斷選隊倒數
        if (window.selectCountdownTimer) {
          clearInterval(window.selectCountdownTimer);
          window.selectCountdownTimer = null;
        }
        showScreen('screen-lobby');
      }
      document.getElementById('game-state-label').innerText = state.state === 'ROUND_LOBBY' ? '🔄 局間休息（可換隊/加入）' : '等候賓客選隊中...';
      if (state.currentMap && currentMapList.length > 0) {
        mapSelectUI.render(currentMapList, state.currentMap.id);
      }
    } else if (state.state === 'COUNTDOWN' || state.state === 'RACING') {
      quizDisplay.hide(); // 確保答題結束後 overlay 關閉
      showScreen('screen-racing');
      
      if (state.currentMap) {
        raceRenderer.initTrack(state.currentMap.trackLength, state.activeItems);
      }

      const overlay = document.getElementById('countdown-overlay');
      const bigNum = document.getElementById('big-countdown-num');
      
      if (state.state === 'COUNTDOWN') {
        document.getElementById('game-state-label').innerText = '⏳ 賽事即將開始...';
        // 防止多次 state_sync 重複觸發倒數計時器
        if (!window._countdownActive) {
          window._countdownActive = true;
          overlay.style.display = 'flex';
          let left = 3;
          bigNum.innerText = left;
          
          if (window.raceCountdownTimer) clearInterval(window.raceCountdownTimer);
          window.raceCountdownTimer = setInterval(() => {
            left--;
            if (left > 0) {
              bigNum.innerText = left;
            } else if (left === 0) {
              bigNum.innerText = 'GO!';
            } else {
              clearInterval(window.raceCountdownTimer);
              window.raceCountdownTimer = null;
              overlay.style.display = 'none';
              window._countdownActive = false;
            }
          }, 1000);
        }
      } else {
        // RACING 狀態 — 確保清除倒數
        document.getElementById('game-state-label').innerText = '🏇 比賽火爆進行中！';
        overlay.style.display = 'none';
        if (window.raceCountdownTimer) {
          clearInterval(window.raceCountdownTimer);
          window.raceCountdownTimer = null;
        }
        window._countdownActive = false;
      }
    } else if (state.state === 'QUIZ') {
      showScreen('screen-racing'); // 確保背景是賽道
      if (state.currentMap) {
        raceRenderer.initTrack(state.currentMap.trackLength, state.activeItems);
      }
      // 不在此重複觸發 quizDisplay.showQuiz()，因為這需要選項與題目資料。
      // 可以顯示簡易的恢復中畫面或等待下一次 quiz broadcast
      document.getElementById('game-state-label').innerText = '🚨 突襲答題關卡進行中！';
    } else if (state.state === 'ROUND_FINISHED' || state.state === 'MATCH_FINISHED') {
      showScreen('screen-scoreboard');
      if (state.state === 'MATCH_FINISHED' && state.roundStatus) {
        scoreboardUI.render(state.roundStatus, state.finalWinner, state.finalAwards);
      }
    }

    // 將所有已入席玩家加入迎賓氣泡牆
    if (state.players) {
      state.players.forEach(p => addRosterBubble(p));
    }

    // 更新人數與隊伍人數
    updateTotalPlayersCount(state.totalPlayers);
    if (state.teams) {
      updateTeamInfo(state.teams);
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_MAP_SELECTED, (mapData) => {
    if (currentMapList.length > 0) {
      mapSelectUI.render(currentMapList, mapData.id);
    }
  });

  // 3. 接收隊伍人數更新與新賓客加入
  socket.on(SERVER_TO_CLIENT.GAME_TEAM_UPDATED, (data) => {
    if (data.totalPlayers !== undefined) updateTotalPlayersCount(data.totalPlayers);
    if (data.teams) updateTeamInfo(data.teams);
  });
  
  socket.on(SERVER_TO_CLIENT.GAME_PLAYER_JOINED, (data) => {
    if (data.totalPlayers !== undefined) updateTotalPlayersCount(data.totalPlayers);
    if (data.teams) updateTeamInfo(data.teams);
    if (data.player) addRosterBubble(data.player);
  });

  const joinedPlayersSet = new Set();
  function addRosterBubble(player) {
    const grid = document.getElementById('guest-roster-grid');
    const pId = player ? (player.socketId || player.id) : null;
    if (!grid || !player || !pId) return;
    if (joinedPlayersSet.has(pId)) return;
    joinedPlayersSet.add(pId);

    // 優先替換最前面的空位插槽 (.roster-slot)
    const firstSlot = grid.querySelector('.roster-slot');
    const bubble = document.createElement('div');
    bubble.className = 'roster-bubble';
    bubble.innerHTML = `<span>${player.avatar || '✨'}</span> ${player.nickname || '神秘賓客'}`;

    if (firstSlot) {
      grid.replaceChild(bubble, firstSlot);
    } else {
      grid.insertBefore(bubble, grid.firstChild);
    }
  }

  function updateTotalPlayersCount(total) {
    if (total === undefined) return;
    const elTotal = document.getElementById('total-players-count');
    if (elTotal) elTotal.innerText = `已入席人數：${total} 人`;
  }

  function updateTeamInfo(teams) {
    let totalInTeams = 0;
    for (const t of teams) {
      totalInTeams += (t.memberCount || 0);
    }
    const safeTotal = totalInTeams > 0 ? totalInTeams : 1;

    for (const t of teams) {
      const pct = Math.round(((t.memberCount || 0) / safeTotal) * 100);
      // 大廳與賽道數量更新
      const elLobbyCount = document.getElementById(`lobby-${t.id}-count`);
      if (elLobbyCount) elLobbyCount.innerText = `${t.memberCount || 0} 人`;
      const elRaceCount = document.getElementById(`race-${t.id}-count`);
      if (elRaceCount) elRaceCount.innerText = `${t.memberCount || 0}`;
      const elScore = document.getElementById(`lobby-${t.id}-score`);
      if (elScore) elScore.innerText = `🏆 ${t.score || 0} 分`;

      // 選隊畫面 (screen-team-select) 數量與比例更新：當有實際玩家才覆蓋展示資料
      if (totalInTeams > 0) {
        const elSelectCount = document.getElementById(`select-${t.id}-count`);
        if (elSelectCount) elSelectCount.innerText = `${t.memberCount || 0}`;
        const elSelectPct = document.getElementById(`select-${t.id}-pct`);
        if (elSelectPct) elSelectPct.innerText = `${pct}%`;
        const elSelectBar = document.getElementById(`select-${t.id}-bar`);
        if (elSelectBar) elSelectBar.style.width = `${pct}%`;
      }
    }
  }

  // 4. 接收高頻位置更新 (30fps)
  socket.on(SERVER_TO_CLIENT.GAME_POSITION_UPDATE, (data) => {
    if (currentServerState !== 'RACING') return;
    raceRenderer.updatePositions(data.teams);
    
    // 畫面糾正：若收到位置更新卻不在賽道畫面，強制拉回 (防止主持人誤觸跳離)
    const activeScreen = document.querySelector('.screen.active');
    const activeId = activeScreen ? activeScreen.id : null;
    if (activeId !== 'screen-racing') {
      console.warn('[糾正] 收到位置更新但不在賽道畫面，強制切回 screen-racing');
      showScreen('screen-racing');
    }
  });

  // 5. 接收道具與特效
  socket.on(SERVER_TO_CLIENT.GAME_ITEM_TRIGGERED, (data) => {
    if (currentServerState !== 'RACING') return;
    const teams = (window.GameConfig && window.GameConfig.TEAMS) || [];
    const trigTeam = teams.find(t => t.id === data.teamId);
    const teamLabel = trigTeam ? trigTeam.name : data.teamId;
    const text = `🎉 ${teamLabel} 觸發了 ${data.itemDef ? data.itemDef.name : data.itemType}！`;
    document.getElementById('ticker-text').innerText = text;

    if (data.effect === 'boost' || data.effect === 'large_boost') {
      window.EffectsController.triggerBoostEffect(data.teamId);
      window.EffectsController.showFloatingText(data.teamId, '⚡加速!');
    } else if (data.effect === 'stun') {
      window.EffectsController.triggerStunEffect(data.teamId);
      window.EffectsController.showFloatingText(data.teamId, '💫暈眩!', '#ef4444');
    }
  });

  // 6. 接收題目分屏與倒數準備
  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_PREPARE, (data) => {
    if (currentServerState !== 'QUIZ') return;
    document.getElementById('game-state-label').innerText = '🚨 突襲答題關卡準備中...';
    quizDisplay.showPrepare(data.seconds);
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_START, (data) => {
    if (currentServerState !== 'QUIZ') return;
    document.getElementById('game-state-label').innerText = '🚨 突襲答題關卡進行中！';
    quizDisplay.showQuiz(data.question, data.options, data.timeLimit);
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_RESULT, (data) => {
    if (currentServerState !== 'QUIZ') return;
    quizDisplay.showResult(data);
  });

  // 7. 接收局結束與總結算
  socket.on(SERVER_TO_CLIENT.GAME_ROUND_FINISHED, (data) => {
    quizDisplay.hide();
    showScreen('screen-scoreboard');
    scoreboardUI.render(data.matchStatus, data.roundInfo ? data.roundInfo.winner : null);
  });

  socket.on(SERVER_TO_CLIENT.GAME_MATCH_FINISHED, (data) => {
    showScreen('screen-scoreboard');
    scoreboardUI.render(data.matchStatus, data.finalWinner, data.finalAwards);
  });

  socket.on(SERVER_TO_CLIENT.GAME_ROUND_LOBBY, (data) => {
    showScreen('screen-lobby');
    document.getElementById('game-state-label').innerText = '🔄 局間休息（開放新賓客掃碼加入！）';
  });

  // 按鈕綁定
  document.getElementById('btn-start-round').onclick = () => {
    showScreen('screen-rules');
  };
  document.getElementById('btn-rules-proceed').onclick = () => {
    showScreen('screen-team-select');
    let timeLeft = 20;
    const elTime = document.getElementById('team-select-countdown');
    if (elTime) elTime.innerText = timeLeft;
    const notice = document.querySelector('.team-select-notice');
    if (notice) notice.innerHTML = '📱 請打開手機畫面選擇喜愛的黑皮加入！倒數結束後，未及時選擇者將由系統自動均衡分配';
    if (window.selectCountdownTimer) clearInterval(window.selectCountdownTimer);
    window.selectCountdownTimer = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) {
        timeLeft = 0;
        clearInterval(window.selectCountdownTimer);
        const notice = document.querySelector('.team-select-notice');
        if (notice) notice.innerHTML = '✨ <strong style="color:#C0392B;">選擇倒數結束！系統已自動對未選擇賓客完成隨機分配，請點擊下方按鈕起跑！</strong>';
      }
      if (elTime) elTime.innerText = timeLeft;
    }, 1000);
  };

  const btnSelectProceed = document.getElementById('btn-team-select-proceed');
  if (btnSelectProceed) {
    btnSelectProceed.onclick = () => {
      console.log(`[Host] Clicked btn-team-select-proceed. Current state: ${currentServerState}`);
      if (window.selectCountdownTimer) clearInterval(window.selectCountdownTimer);
      socket.emit(CLIENT_TO_SERVER.HOST_START_ROUND);
    };
  }

  // 診斷用工具 (在 Console 執行 window.debugHostState())
  window.debugHostState = () => {
    console.log("=== HOST STATE DEBUG ===");
    console.log("currentServerState:", currentServerState);
    console.log("Active Screen ID:", document.querySelector('.screen.active')?.id);
    console.log("window._countdownActive:", window._countdownActive);
    console.log("========================");
  };
  const btnNextRound = document.getElementById('btn-next-round');
  btnNextRound.onclick = () => {
    btnNextRound.disabled = true;
    socket.emit(CLIENT_TO_SERVER.HOST_NEXT_ROUND);
    setTimeout(() => { btnNextRound.disabled = false; }, 2000);
  };
  document.getElementById('btn-reset-match').onclick = () => {
    if (confirm('確定要重新開始全新的三局賽事嗎？')) {
      currentServerState = 'LOBBY';
      cleanupTransientOverlays();
      socket.emit(CLIENT_TO_SERVER.HOST_RESET_GAME);
    }
  };
  const btnFinalReset = document.getElementById('btn-final-reset-match');
  if (btnFinalReset) {
    btnFinalReset.onclick = () => {
      if (confirm('確定要重新開始全新的三局賽事嗎？')) {
        currentServerState = 'LOBBY';
        cleanupTransientOverlays();
        socket.emit(CLIENT_TO_SERVER.HOST_RESET_GAME);
      }
    };
  }
  // 回到大廳浮動按鈕 — 支援比賽中斷與重置
  if (backBtn) {
    backBtn.onclick = () => {
      if (currentServerState === 'RACING' || currentServerState === 'COUNTDOWN' || currentServerState === 'QUIZ') {
        if (confirm('🚨 比賽正在進行中！\n確定要強制中斷並重置整場賽事，回到大廳嗎？\n(所有隊伍分數與進度將會歸零)')) {
          currentServerState = 'LOBBY';
          cleanupTransientOverlays();
          socket.emit(CLIENT_TO_SERVER.HOST_RESET_GAME);
          // 暫時隱藏可能卡住畫面的 overlay
          const overlay = document.getElementById('countdown-overlay');
          if (overlay) overlay.style.display = 'none';
          if (window.quizDisplay) window.quizDisplay.hide();
          
          // CRITICAL BUG FIX: Ensure the countdown active flag is reset!
          window._countdownActive = false;
          if (window.raceCountdownTimer) {
            clearInterval(window.raceCountdownTimer);
            window.raceCountdownTimer = null;
          }

          showScreen('screen-lobby');
        }
        return;
      }
      showScreen('screen-lobby');
    };
  }

  // ========== Canvas 動態去背與 4x2 逐幀馬匹奔跑動畫 ==========
  initHorseAnimation();

  function initHorseAnimation() {
    const canvas = document.getElementById('horse-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.src = '/host/assets/horse-sprite.png';
    img.onload = () => {
      // 1. 建立背景記憶體 canvas 以進行像素過濾去背
      const offCanvas = document.createElement('canvas');
      offCanvas.width = img.width;
      offCanvas.height = img.height;
      const offCtx = offCanvas.getContext('2d');
      offCtx.drawImage(img, 0, 0);

      // 2. 去白底：將所有接近純白的像素透明度設為 0
      const imgData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // 如果顏色接近白色 (例如 RGB 皆大於 230)
        if (r > 230 && g > 230 && b > 230) {
          data[i + 3] = 0; // Alpha 設為 0 (全透明)
        }
      }
      offCtx.putImageData(imgData, 0, 0);

      // 3. 設定每影格的解析度與掃描 (4x2 佈局)
      const frameCols = 4;
      const frameRows = 2;
      const totalFrames = 8;
      const cellW = img.width / frameCols;  // 單影格寬度 (256px)
      const cellH = img.height / frameRows; // 單影格高度 (512px)
      const destW = canvas.width;           // 繪製目標寬度 (256px)
      const destH = canvas.height;          // 繪製目標高度 (256px)

      // 4. 嚴格掃描各影格中「非透明像素」的真實邊界框 (Bounding Box)，完全消弭第一列(Y≈330..490)與第二列(Y≈19..181)的垂直高低跳動
      const frameBoxes = [];
      for (let f = 0; f < totalFrames; f++) {
        const col = f % frameCols;
        const row = Math.floor(f / frameCols);
        const cellX = col * cellW;
        const cellY = row * cellH;

        // 讀取該單元格 (256x512) 內的所有像素
        const frameData = offCtx.getImageData(cellX, cellY, cellW, cellH);
        const pixels = frameData.data;

        let minX = cellW, maxX = 0;
        let minY = cellH, maxY = 0;
        let hasHorse = false;

        // 逐像素掃描馬匹剪影邊界
        for (let y = 0; y < cellH; y++) {
          for (let x = 0; x < cellW; x++) {
            const idx = (y * cellW + x) * 4;
            const alpha = pixels[idx + 3];
            if (alpha > 0) { // 非透明馬匹像素
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              hasHorse = true;
            }
          }
        }

        if (hasHorse) {
          const cropW = maxX - minX;
          const cropH = maxY - minY;
          // 將該幀馬匹的真實幾何中心精確對齊到 destination canvas (256x256) 的正中心 (128, 128)
          // 並且保持 1:1 原始寬高比裁切繪製，避免被縱向拉伸壓縮
          frameBoxes.push({
            srcX: cellX + minX,
            srcY: cellY + minY,
            srcW: cropW,
            srcH: cropH,
            destX: (destW - cropW) / 2,
            destY: (destH - cropH) / 2
          });
        } else {
          frameBoxes.push({ srcX: cellX, srcY: cellY, srcW: cellW, srcH: cellH, destX: 0, destY: 0 });
        }
      }

      // 5. 動畫播放控制
      let currentFrame = 0;
      const fps = 12; // 調整奔跑速度 (每秒 12 幀)
      const interval = 1000 / fps;
      let lastTime = 0;

      function animate(timestamp) {
        if (!lastTime) lastTime = timestamp;
        const elapsed = timestamp - lastTime;

        if (elapsed > interval) {
          lastTime = timestamp - (elapsed % interval);

          const box = frameBoxes[currentFrame];

          // 清除主畫布並以 1:1 精準裁切與中心對齊方式繪製影格
          ctx.clearRect(0, 0, destW, destH);
          ctx.drawImage(offCanvas, box.srcX, box.srcY, box.srcW, box.srcH, box.destX, box.destY, box.srcW, box.srcH);

          // 播放下一幀 (0~7 循環)
          currentFrame = (currentFrame + 1) % totalFrames;
        }
        requestAnimationFrame(animate);
      }

      requestAnimationFrame(animate);
    };
  }

  connectPrivilegedSocket('host');
});
