/**
 * Lucky Horse — 後台配置與彩排控制台前端邏輯 (admin-app.js)
 * 嚴格遵循 AGENTS.md 防禦性準則與 50ms 即時回饋規範
 */

const socket = io({ autoConnect: false });
let allMaps = [];
let allQuizzes = [];
let currentConfig = window.GameConfig || {};

function updateAdminStageScale() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  document.documentElement.style.setProperty('--admin-stage-scale', String(scale));
}

function setupAdminPresentationViewport() {
  updateAdminStageScale();
  window.addEventListener('resize', updateAdminStageScale);
}

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
    const badge = document.getElementById('connectionStatus');
    if (badge) {
      badge.textContent = '🔴 後台權限驗證失敗，請重新整理並輸入密碼';
      badge.style.borderColor = '#B86B53';
      badge.style.color = '#B86B53';
    }
    console.error('後台權限驗證失敗:', err);
  }
}

// ==========================================
// 1. 分頁切換 (Tab Navigation)
// ==========================================
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
  
  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.classList.add('active');
  
  // 找對應的按鈕並反白
  const btns = document.querySelectorAll('.tab-btn');
  if (tabId === 'tab-config') btns[0].classList.add('active');
  else if (tabId === 'tab-map') btns[1].classList.add('active');
  else if (tabId === 'tab-quiz') btns[2].classList.add('active');
  else if (tabId === 'tab-rehearsal') btns[3].classList.add('active');
}

function getTeamsConfig() {
  return (currentConfig && Array.isArray(currentConfig.TEAMS))
    ? currentConfig.TEAMS
    : ((window.GameConfig && window.GameConfig.TEAMS) || []);
}

function syncConfig(config) {
  if (!config) return;
  currentConfig = {
    ...(currentConfig || {}),
    ...config,
    TEAMS: Array.isArray(config.TEAMS) ? config.TEAMS : getTeamsConfig()
  };
  window.GameConfig = currentConfig;
  renderTeamNameInputs();
  renderForceItemButtons();
}

function renderTeamNameInputs() {
  const container = document.getElementById('teamNamesContainer');
  if (!container) return;
  const teams = getTeamsConfig();
  container.innerHTML = '';

  teams.forEach((team) => {
    const group = document.createElement('div');
    group.className = 'form-group';
    group.style.color = team.hex || '#315E58';
    const label = document.createElement('label');
    label.textContent = `${team.name} (${team.id})`;
    label.style.color = team.hex || '#EAE0CE';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `teamName-${team.id}`;
    input.className = 'luxury-input team-name-input';
    input.dataset.teamId = team.id;
    input.value = team.name || team.id;
    input.setAttribute('aria-label', `${team.name || team.id} 隊名`);

    const img = document.createElement('img');
    img.src = team.imgPath || '';
    img.alt = team.name || team.id;

    group.appendChild(img);
    group.appendChild(label);
    group.appendChild(input);
    container.appendChild(group);
  });
  renderConfigPreviewCommands();
}

function renderForceItemButtons() {
  const grid = document.getElementById('forceItemGrid');
  if (!grid) return;
  grid.innerHTML = '';

  getTeamsConfig().forEach((team) => {
    const boostBtn = document.createElement('button');
    boostBtn.className = 'gm-btn';
    boostBtn.style.background = team.hex || '#D8C3A5';
    boostBtn.style.color = '#fff';
    boostBtn.textContent = `${team.name} 衝刺賜福 (+150px)`;
    boostBtn.onclick = () => forceTriggerItem(team.id, 'large_boost');

    const stunBtn = document.createElement('button');
    stunBtn.className = 'gm-btn red-warn';
    stunBtn.textContent = `⚠️ ${team.name} 暈眩 (3秒)`;
    stunBtn.onclick = () => forceTriggerItem(team.id, 'stun');

    grid.appendChild(boostBtn);
    grid.appendChild(stunBtn);
  });
}

function renderConfigPreviewCommands() {
  const grid = document.getElementById('configPreviewCommands');
  if (!grid) return;
  grid.innerHTML = '';

  getTeamsConfig().slice(0, 4).forEach((team, index) => {
    const item = document.createElement('div');
    item.className = 'preview-command';
    item.style.setProperty('--team-color', team.hex || '#315E58');
    item.style.backgroundColor = index === 0 ? '' : `${team.hex || '#315E58'}44`;
    item.textContent = `${team.name}  賜福`;
    if (index === 0) item.classList.add('primary');
    grid.appendChild(item);
  });
}

function setConfigControlValue(id, value) {
  const el = document.getElementById(id);
  if (!el || value === undefined || value === null) return;
  const normalized = String(value);
  if (el.tagName === 'SELECT') {
    const hasOption = Array.from(el.options).some(option => option.value === normalized);
    if (!hasOption) {
      const option = document.createElement('option');
      option.value = normalized;
      option.textContent = id === 'trackLength' ? `${normalized} px` : normalized;
      el.appendChild(option);
    }
  }
  el.value = normalized;
}

function normalizeQuizOptions(options) {
  if (Array.isArray(options)) return options;
  if (options && typeof options === 'object') {
    return ['A', 'B', 'C', 'D'].map(label => options[label] || '');
  }
  return ['', '', '', ''];
}

function getCorrectAnswerLabel(quiz) {
  const labels = ['A', 'B', 'C', 'D'];
  const options = normalizeQuizOptions(quiz.options);
  const raw = quiz.correctAnswer;

  if (typeof raw === 'number') return labels[raw] || 'A';
  if (typeof raw === 'string') {
    const upper = raw.trim().toUpperCase();
    if (labels.includes(upper)) return upper;
    const idx = options.findIndex(opt => opt === raw.trim());
    if (idx >= 0) return labels[idx];
  }

  return 'A';
}

function getCheckpointTriggerValue(cp) {
  if (cp && cp.progress !== undefined) return cp.progress;
  const trigger = cp && cp.trigger ? cp.trigger : {};
  if (trigger.type === 'time_elapsed') return trigger.seconds || 10;
  if (trigger.type === 'combined_taps') return trigger.count || 300;
  if (trigger.type === 'leading_gap') return trigger.percent || 20;
  return trigger.percent || 30;
}

function buildCheckpointTrigger(type, value) {
  const triggerType = type || 'team_progress';
  const num = Number(value);
  if (triggerType === 'time_elapsed') return { type: triggerType, seconds: Math.max(1, num || 10) };
  if (triggerType === 'combined_taps') return { type: triggerType, count: Math.max(1, num || 300) };
  if (triggerType === 'leading_gap') return { type: triggerType, percent: Math.max(1, Math.min(95, num || 20)) };
  return { type: 'team_progress', percent: Math.max(1, Math.min(95, num || 30)) };
}

// ==========================================
// 2. Socket.IO 事件監聽與同步
// ==========================================
socket.on('connect', () => {
  const badge = document.getElementById('connectionStatus');
  badge.textContent = '🟢 皇家控制台連線正常';
  badge.style.borderColor = '#7AB8B1';
  badge.style.color = '#7AB8B1';
});

socket.on('disconnect', () => {
  const badge = document.getElementById('connectionStatus');
  badge.textContent = '🔴 與伺服器連線中斷，正在重連...';
  badge.style.borderColor = '#B86B53';
  badge.style.color = '#B86B53';
});

socket.on('connect_error', (err) => {
  const badge = document.getElementById('connectionStatus');
  badge.textContent = '🔴 後台連線驗證失敗，請重新整理並輸入密碼';
  badge.style.borderColor = '#B86B53';
  badge.style.color = '#B86B53';
  console.error('後台連線驗證失敗:', err.message);
});

socket.on('admin:config_updated', (config) => {
  if (!config) return;
  syncConfig(config);
  setConfigControlValue('trackLength', config.trackLength);
  setConfigControlValue('totalRounds', config.totalRounds);
  setConfigControlValue('baseBoost', config.baseBoost);
  setConfigControlValue('quizTimeLimit', config.quizTimeLimit);
});

socket.on('admin:map_list', (mapList) => {
  allMaps = mapList || [];
  renderMapList();
});

socket.on('game:map_list', (mapList) => {
  allMaps = mapList || [];
  renderMapList();
});

socket.on('admin:quiz_list', (quizList) => {
  allQuizzes = quizList || [];
  renderQuizList();
  updateForceQuizDropdown();
});

socket.on('admin:simulation_stats', (stats) => {
  document.getElementById('activeBotsCount').textContent = `${stats.activeBots || 0} 人`;
  const statusElem = document.getElementById('botLoopStatus');
  if (stats.isRunning && stats.activeBots > 0) {
    statusElem.textContent = '🟢 高頻點擊與作答應援中';
    statusElem.style.color = '#7AB8B1';
  } else {
    statusElem.textContent = '⚪ 待命/未啟動';
    statusElem.style.color = '#D8C3A5';
  }
});

socket.on('admin:response', (res) => {
  if (res && res.success) {
    showToast(`✨ 操作成功：${res.action}`);
  } else {
    showToast(`⚠️ 操作失敗：${res ? res.action : '未知錯誤'}`, true);
  }
});

// ==========================================
// 3. 賽事配置儲存 (Save Config)
// ==========================================
function saveConfig() {
  const trackLength = Number(document.getElementById('trackLength').value) || 104000;
  const totalRounds = Number(document.getElementById('totalRounds').value) || 1;
  const baseBoost = Number(document.getElementById('baseBoost').value) || 0.5;
  const quizTimeLimit = Number(document.getElementById('quizTimeLimit').value) || 10;
  const teamNames = {};

  document.querySelectorAll('.team-name-input').forEach((input) => {
    const teamId = input.dataset.teamId;
    if (teamId) teamNames[teamId] = input.value.trim() || teamId;
  });

  const newConfig = {
    teamNames,
    trackLength,
    totalRounds,
    baseBoost,
    quizTimeLimit
  };

  socket.emit('admin:update_config', newConfig);
  showToast('🔄 正在同步全場大螢幕與手機端...');
}

// ==========================================
// 4. 地圖關卡編輯與 CRUD
// ==========================================
function renderMapList() {
  const container = document.getElementById('mapListContainer');
  container.innerHTML = '';
  if (allMaps.length === 0) {
    container.innerHTML = '<p class="hint-text">尚無任何地圖資料。</p>';
    return;
  }
  allMaps.forEach(map => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <div class="list-item-title">${map.name}</div>
        <div class="list-item-sub">ID: ${map.id} | 關卡里程碑數: ${map.checkpointsCount}</div>
      </div>
      <div>
        <button class="btn-secondary" onclick="editMap('${map.id}')">✏️ 編輯</button>
        <button class="btn-danger" onclick="deleteMap('${map.id}')">🗑️</button>
      </div>
    `;
    container.appendChild(item);
  });
}

function editMap(mapId) {
  const map = allMaps.find(m => m.id === mapId);
  if (!map) return;
  
  document.getElementById('mapEditId').value = map.id;
  document.getElementById('mapIdInput').value = map.id;
  document.getElementById('mapIdInput').disabled = true; // 修改時不可改 ID
  document.getElementById('mapNameInput').value = map.name || '';
  document.getElementById('mapDescInput').value = map.description || '';

  const cpContainer = document.getElementById('checkpointsContainer');
  cpContainer.innerHTML = '';

  if (map.checkpoints && map.checkpoints.length > 0) {
    map.checkpoints.forEach((cp, index) => addCheckpointField(cp, index));
  } else {
    addCheckpointField();
  }
}

function addCheckpointField(cp = null, fallbackIndex = 0) {
  const container = document.getElementById('checkpointsContainer');
  const div = document.createElement('div');
  div.className = 'form-row cp-row mb-2';
  div.style.marginBottom = '12px';
  const rowIndex = cp ? fallbackIndex : container.querySelectorAll('.cp-row').length;
  const triggerType = (cp && cp.trigger && cp.trigger.type) || 'team_progress';
  const triggerValue = getCheckpointTriggerValue(cp);
  const quizIdVal = (cp && cp.quizId) || '';
  const cpId = (cp && cp.id) || `cp_${rowIndex + 1}`;
  
  let quizOptions = '<option value="">-- 隨機抽選題庫題目 --</option>';
  allQuizzes.forEach(q => {
    const selected = (q.id === quizIdVal) ? 'selected' : '';
    quizOptions += `<option value="${q.id}" ${selected}>[${q.id}] ${q.question.substring(0, 12)}...</option>`;
  });

  div.innerHTML = `
    <input type="hidden" class="cp-id" value="${cpId}">
    <div class="form-group half" style="margin-bottom:0">
      <label style="font-size:0.8rem">觸發類型</label>
      <select class="luxury-input cp-trigger-type">
        <option value="team_progress" ${triggerType === 'team_progress' ? 'selected' : ''}>任一隊進度 (%)</option>
        <option value="time_elapsed" ${triggerType === 'time_elapsed' ? 'selected' : ''}>比賽經過秒數</option>
        <option value="combined_taps" ${triggerType === 'combined_taps' ? 'selected' : ''}>全場累計點擊</option>
        <option value="leading_gap" ${triggerType === 'leading_gap' ? 'selected' : ''}>領先差距 (%)</option>
      </select>
    </div>
    <div class="form-group half" style="margin-bottom:0">
      <label style="font-size:0.8rem">觸發數值</label>
      <input type="number" class="luxury-input cp-trigger-value" value="${triggerValue}" min="1">
    </div>
    <div class="form-group half" style="margin-bottom:0">
      <label style="font-size:0.8rem">指定題目 ID (可留空為隨機)</label>
      <select class="luxury-input cp-quiz">${quizOptions}</select>
    </div>
    <button type="button" class="btn-danger" style="margin-top:24px; height:42px" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(div);
}

function resetMapForm() {
  document.getElementById('mapForm').reset();
  document.getElementById('mapEditId').value = '';
  document.getElementById('mapIdInput').disabled = false;
  document.getElementById('checkpointsContainer').innerHTML = '';
  addCheckpointField();
}

function saveMap() {
  const id = document.getElementById('mapIdInput').value.trim();
  const name = document.getElementById('mapNameInput').value.trim();
  const description = document.getElementById('mapDescInput').value.trim();
  
  if (!id || !name) {
    showToast('⚠️ 地圖 ID 與名稱為必填欄位！', true);
    return;
  }

  const cpRows = document.querySelectorAll('.cp-row');
  const checkpoints = [];
  cpRows.forEach((row, index) => {
    const cpId = row.querySelector('.cp-id').value || `cp_${index + 1}`;
    const triggerType = row.querySelector('.cp-trigger-type').value;
    const triggerValue = row.querySelector('.cp-trigger-value').value;
    const quizId = row.querySelector('.cp-quiz').value;
    checkpoints.push({
      id: cpId,
      trigger: buildCheckpointTrigger(triggerType, triggerValue),
      quizId: quizId || null
    });
  });

  const existingMap = allMaps.find(map => map.id === id) || {};

  const mapData = {
    ...existingMap,
    id,
    name,
    description,
    thumbnail: existingMap.thumbnail || '🗺️',
    difficulty: existingMap.difficulty || 3,
    track: existingMap.track || { length: currentConfig.trackLength || 15000, theme: 'custom' },
    items: existingMap.items || { density: 3, types: ['accelerator', 'obstacle', 'shield'] },
    checkpoints
  };

  socket.emit('admin:save_map', mapData);
  resetMapForm();
}

function deleteMap(mapId) {
  if (confirm(`確定要刪除賽道地圖 "${mapId}" 嗎？`)) {
    socket.emit('admin:delete_map', { mapId });
  }
}

// ==========================================
// 5. 互動問答題庫編輯與 CRUD
// ==========================================
function renderQuizList() {
  const container = document.getElementById('quizListContainer');
  container.innerHTML = '';
  if (allQuizzes.length === 0) {
    container.innerHTML = '<p class="hint-text">尚無任何題庫資料。</p>';
    return;
  }
  allQuizzes.forEach(q => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <div class="list-item-title">${q.question}</div>
        <div class="list-item-sub">ID: ${q.id} | 正解: 選項 ${getCorrectAnswerLabel(q)}</div>
      </div>
      <div>
        <button class="btn-secondary" onclick="editQuiz('${q.id}')">✏️ 編輯</button>
        <button class="btn-danger" onclick="deleteQuiz('${q.id}')">🗑️</button>
      </div>
    `;
    container.appendChild(item);
  });
}

function updateForceQuizDropdown() {
  const select = document.getElementById('forceQuizSelect');
  if (!select) return;
  let html = '<option value="">-- 隨機抽選一題 --</option>';
  allQuizzes.forEach(q => {
    html += `<option value="${q.id}">[${q.id}] ${q.question.substring(0, 15)}...</option>`;
  });
  select.innerHTML = html;
}

function editQuiz(quizId) {
  const q = allQuizzes.find(item => item.id === quizId);
  if (!q) return;
  document.getElementById('quizEditId').value = q.id;
  document.getElementById('quizIdInput').value = q.id;
  document.getElementById('quizIdInput').disabled = true;
  document.getElementById('quizQuestionInput').value = q.question || '';
  const options = normalizeQuizOptions(q.options);
  document.getElementById('optA').value = options[0] || '';
  document.getElementById('optB').value = options[1] || '';
  document.getElementById('optC').value = options[2] || '';
  document.getElementById('optD').value = options[3] || '';
  document.getElementById('correctAns').value = getCorrectAnswerLabel(q);
  document.getElementById('quizReward').value = q.reward || 'large_boost';
}

function resetQuizForm() {
  document.getElementById('quizForm').reset();
  document.getElementById('quizEditId').value = '';
  document.getElementById('quizIdInput').disabled = false;
}

function saveQuiz() {
  const id = document.getElementById('quizIdInput').value.trim();
  const question = document.getElementById('quizQuestionInput').value.trim();
  const optA = document.getElementById('optA').value.trim();
  const optB = document.getElementById('optB').value.trim();
  const optC = document.getElementById('optC').value.trim();
  const optD = document.getElementById('optD').value.trim();
  const correctAnswer = document.getElementById('correctAns').value;
  const reward = document.getElementById('quizReward').value;

  if (!id || !question || !optA || !optB) {
    showToast('⚠️ 題目 ID、題目文字與至少前兩選項為必填！', true);
    return;
  }

  const quizData = {
    id,
    question,
    options: [optA, optB, optC, optD],
    correctAnswer,
    reward
  };

  socket.emit('admin:save_quiz', quizData);
  resetQuizForm();
}

function deleteQuiz(quizId) {
  if (confirm(`確定要刪除題目 "${quizId}" 嗎？`)) {
    socket.emit('admin:delete_quiz', { quizId });
  }
}

// ==========================================
// 6. 模擬預演與現場控台控制 (Bot & GM)
// ==========================================
function spawnBots(count) {
  socket.emit('admin:spawn_bots', { count });
  showToast(`🤖 正在產生 ${count} 名虛擬賓客並啟動 AI 模擬迴圈...`);
}

function clearBots() {
  socket.emit('admin:clear_bots');
  showToast('🧹 已清除所有虛擬機器人');
}

function forceTriggerQuiz() {
  const targetId = document.getElementById('forceQuizSelect').value || null;
  socket.emit('admin:force_trigger', { type: 'QUIZ', targetId });
  showToast('⚡ 已發送現場強制答題突襲指令！');
}

function forceTriggerItem(teamId, itemType) {
  socket.emit('admin:force_trigger', { type: 'ITEM', teamId, itemType });
  const team = getTeamsConfig().find(t => t.id === teamId);
  const teamName = team ? team.name : teamId;
  showToast(`⚡ 已對 ${teamName} 釋放 ${itemType === 'stun' ? '暈眩暴風雨' : '衝刺神力'}！`);
}

// ==========================================
// 7. 50ms 即時回饋與提示 Toast
// ==========================================
function showToast(message, isError = false) {
  let toast = document.getElementById('adminToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adminToast';
    toast.style.cssText = `
      position: fixed; bottom: 30px; right: 30px; z-index: 9999;
      padding: 16px 28px; border-radius: 30px; font-weight: 700;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6); backdrop-filter: blur(10px);
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      font-family: 'Noto Serif TC', serif; font-size: 1rem;
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.background = isError ? 'rgba(184, 107, 83, 0.9)' : 'linear-gradient(135deg, #D8C3A5, #B89C70)';
  toast.style.color = isError ? '#FAF9F5' : '#132238';
  toast.style.border = isError ? '1px solid #FAF9F5' : '1px solid #FAF9F5';
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
  }, 3500);
}

// 頁面初次載入完成後預設載入一筆新題表單
window.addEventListener('DOMContentLoaded', () => {
  setupAdminPresentationViewport();
  syncConfig(currentConfig);
  resetMapForm();
  resetQuizForm();
  connectPrivilegedSocket('admin');
});
