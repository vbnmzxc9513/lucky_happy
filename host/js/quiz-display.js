/**
 * 大螢幕答題全屏顯示器 — 手繪塗鴉草地風格
 * 配合新的 quiz-fullscreen 結構
 */
class QuizDisplay {
  constructor() {
    this.timerInterval = null;
  }

  normalizeOptions(optionsData) {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    if (Array.isArray(optionsData)) {
      return optionsData.map((text, index) => ({
        label: labels[index] || String(index + 1),
        text
      }));
    }
    if (optionsData && typeof optionsData === 'object') {
      return labels
        .filter(label => optionsData[label] !== undefined && optionsData[label] !== '')
        .map(label => ({ label, text: optionsData[label] }));
    }
    return [];
  }

  showPrepare(seconds = 3) {
    this.statistics?.remove();
    const overlay = document.getElementById('quiz-overlay');
    overlay.classList.remove('stage-result-view');
    const qBox = document.getElementById('quiz-question-box');
    const resBox = document.getElementById('quiz-result-section');
    const optionsContainer = document.getElementById('quiz-options-display');
    const timerBadge = document.getElementById('quiz-countdown-circle');
    const splash = document.getElementById('quiz-prepare-splash');
    const splashNum = document.getElementById('quiz-prepare-num');

    // 徹底清除舊狀態 (解決殘影 Bug)
    optionsContainer.innerHTML = '';
    resBox.style.display = 'none';
    timerBadge.style.display = 'none'; // 隱藏原本的計時器圈圈
    qBox.style.display = 'none'; // 隱藏題目
    document.getElementById('quiz-team-bar').style.display = 'none';
    
    // 顯示 overlay 與全屏倒數彈窗
    overlay.style.display = 'flex';
    splash.style.display = 'flex';
    splashNum.innerText = seconds;

    // 本地倒數更新
    let left = seconds;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.paused) return;
      left--;
      if (left > 0) {
        splashNum.innerText = left;
      } else {
        clearInterval(this.timerInterval);
      }
    }, 1000);
  }

  showQuiz(questionText, options, timeLimit, payload = {}) {
    this.resultKey = null;
    this.quizId = payload.quizId;
    this.statistics?.remove();
    const overlay = document.getElementById('quiz-overlay');
    overlay.classList.remove('stage-result-view');
    const qBox = document.getElementById('quiz-question-box');
    const resBox = document.getElementById('quiz-result-section');
    const timerNum = document.getElementById('quiz-timer-num');
    const timerBadge = document.getElementById('quiz-countdown-circle');
    const splash = document.getElementById('quiz-prepare-splash');

    // 關閉倒數準備彈窗，顯示正常答題元素
    splash.style.display = 'none';
    qBox.style.display = 'block';
    document.getElementById('quiz-team-bar').style.display = 'flex';

    // 恢復題目框預設樣式並顯示題目
    qBox.style.fontSize = '';
    qBox.style.color = '';
    qBox.classList.toggle('is-long', (questionText || '').length > 65);
    qBox.innerText = questionText || '題目載入中...';
    
    resBox.style.display = 'none';
    overlay.style.display = 'flex';
    timerBadge.style.display = 'flex'; // 顯示計時器圈圈

    // 重設計時器樣式
    timerBadge.classList.remove('timer-warning');

    // 渲染頂部五隊答題進度
    this._renderTeamBar();

    // 渲染選項到 2x2 大格
    const optionsContainer = document.getElementById('quiz-options-display');
    optionsContainer.innerHTML = '';
    const normalizedOptions = this.normalizeOptions(options);
    if (normalizedOptions.length > 0) {
      normalizedOptions.forEach((opt) => {
        const card = document.createElement('div');
        card.className = 'quiz-option-card-v2';
        card.classList.toggle('is-long', opt.text.length > 30);
        const label = document.createElement('b');
        label.className = 'opt-label'; label.textContent = opt.label;
        const text = document.createElement('span');
        text.className = 'opt-text'; text.textContent = opt.text;
        card.append(label, text);
        optionsContainer.appendChild(card);
      });
    }

    this.endsAt = payload.endsAt || this.stageEndsAt;
    this.syncClock(payload);
    if (payload.progress) this.updateProgressSnapshot(payload.progress);
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this.tickClock(), 100);
    this.tickClock();
  }

  syncClock(state) {
    if (Number.isFinite(state.serverNow)) {
      this.serverNow = state.paused ? state.pausedAt || state.serverNow : state.serverNow;
      this.receivedAt = performance.now();
    }
    if ('paused' in state) this.paused = !!state.paused;
    if (['reading', 'answer'].includes(state.quizStage?.phase)) {
      this.stageEndsAt = state.quizStage.endsAt;
      this.endsAt = state.quizStage.endsAt;
    }
    this.phase = state.quizStage?.phase || state.phase || this.phase;
    const badge = document.getElementById('quiz-countdown-circle');
    badge?.setAttribute('data-phase', this.phase === 'reading' ? '閱讀' : '作答');
    this.tickClock();
  }

  tickClock() {
    if (!Number.isFinite(this.endsAt) || !Number.isFinite(this.serverNow)) return;
    const now = this.serverNow + (this.paused ? 0 : performance.now() - this.receivedAt);
    const seconds = Math.max(0, Math.ceil((this.endsAt - now) / 1000));
    document.getElementById('quiz-timer-num').textContent = seconds;
    document.getElementById('quiz-countdown-circle').classList.toggle('timer-warning', seconds <= 3);
  }

  _renderTeamBar() {
    const bar = document.getElementById('quiz-team-bar');
    bar.replaceChildren();
    for (const team of window.GameConfig.TEAMS) {
      const cell = document.createElement('article'); cell.className = 'quiz-team-cell';
      cell.style.setProperty('--team-color', team.hex);
      const name = document.createElement('strong'); name.className = 'qt-name'; name.textContent = team.name;
      const count = document.createElement('span'); count.className = 'qt-progress'; count.id = `quiz-${team.id}-answered`; count.textContent = '0 / 0 · 0.0%';
      const track = document.createElement('div'); track.className = 'qt-bar-wrap';
      const fill = document.createElement('i'); fill.className = 'qt-bar-fill'; fill.id = `quiz-${team.id}-bar`; fill.style.width = '0%';
      track.append(fill); cell.append(name, count, track); bar.append(cell);
    }
  }

  updateTeamProgress(data) {
    if (data?.progressSnapshot) this.updateProgressSnapshot(data.progressSnapshot);
  }

  updateProgressSnapshot(progress) {
    if (!progress || (this.quizId && progress.quizId !== this.quizId)) return;
    for (const team of progress.teams) {
      const count = document.getElementById(`quiz-${team.teamId}-answered`);
      const fill = document.getElementById(`quiz-${team.teamId}-bar`);
      if (count) count.textContent = `${team.answeredCount} / ${team.totalCount} · ${(team.progress * 100).toFixed(1)}%`;
      if (fill) fill.style.width = `${team.progress * 100}%`;
    }
    document.getElementById('quiz-global-count').textContent = `已作答 ${progress.answeredCount} / ${progress.totalCount} 人`;
    document.getElementById('quiz-global-rate').textContent = `作答率 ${(progress.responseRate * 100).toFixed(1)}% · 尚有 ${progress.unansweredCount} 人未作答`;
    document.getElementById('quiz-global-fill').style.width = `${progress.responseRate * 100}%`;
  }

  showResult(resultData, recovered = false) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (resultData?.distribution) return this.showStatistics(resultData, recovered);
    const resBox = document.getElementById('quiz-result-section');
    const ansText = document.getElementById('correct-answer-text');
    const dynamicResults = document.getElementById('dynamic-quiz-results');

    if (!resultData || !window.GameConfig || !window.GameConfig.TEAMS) return;
    document.getElementById('quiz-overlay').style.display = 'flex';
    document.getElementById('quiz-prepare-splash').style.display = 'none';
    const stageResult = Object.values(resultData.teamResults).some(result => result.effect === 'stage_pending');
    document.getElementById('quiz-overlay').classList.toggle('stage-result-view', stageResult);
    if (stageResult) {
      document.getElementById('quiz-question-box').style.display = 'none';
      document.getElementById('quiz-options-display').innerHTML = '';
      document.getElementById('quiz-countdown-circle').style.display = 'none';
      document.getElementById('quiz-team-bar').style.display = 'none';
    }
    const teams = window.GameConfig.TEAMS;

    ansText.innerText = resultData.correctAnswerText
      ? `${resultData.correctAnswer}. ${resultData.correctAnswerText}`
      : resultData.correctAnswer;
    dynamicResults.innerHTML = '';
    
    const getEffectText = (eff, val) => {
      if (eff === 'stage_pending') return '四題結束後一起結算';
      if (eff === 'large_boost') return `🔥 衝刺加速 +${val}px`;
      if (eff === 'small_boost') return `⚡ 小幅加速 +${val}px`;
      return `💫 停滯暈眩 ${val/1000} 秒`;
    };

    teams.forEach(t => {
      const res = resultData.teamResults[t.id];
      if (!res) return;
      const votes = res.voteCounts || {};
      const topVotes = res.teamAnswer ? Number(votes[res.teamAnswer] || 0) : 0;
      const correct = Number(res.correctCount ?? votes[resultData.correctAnswer] ?? 0);
      const unanswered = Number(res.unansweredCount ?? Math.max(0, (res.totalCount || 0) - (res.answeredCount || 0)));
      const wrong = Number(res.teamWrongCount ?? (Number(res.wrongCount ?? Math.max(0, (res.answeredCount || 0) - correct)) + unanswered));
      const decision = res.noAnswer
        ? '未作答'
        : res.hasTie
          ? '票數平手'
          : `多數選 ${res.teamAnswer} · ${topVotes} 票`;
      const html = `
        <div class="quiz-res-card" style="border-top: 4px solid ${t.hex};">
            <h4 style="color: ${t.hex};">${t.name}</h4>
            <div class="team-verdict ${res.isCorrect ? 'is-correct' : 'is-wrong'}">${res.isCorrect ? '隊伍答對' : '隊伍未答對'}</div>
            <div class="rate-val">${decision}</div>
            <dl class="answer-counts">
              <div class="count-correct"><dt>答對</dt><dd>${correct}<small>人</small></dd></div>
              <div class="count-wrong"><dt>答錯</dt><dd>${wrong}<small>人</small></dd></div>
              <div class="count-unanswered"><dt>其中未作答</dt><dd>${unanswered}<small>人</small></dd></div>
            </dl>
            <div class="effect-badge">${getEffectText(res.effect, res.val)}</div>
        </div>
      `;
      dynamicResults.insertAdjacentHTML('beforeend', html);
    });

    resBox.style.display = 'block';
  }

  hide() {
    this.resultKey = null;
    this.quizId = null;
    this.statistics?.remove();
    if (this.timerInterval) clearInterval(this.timerInterval);
    document.getElementById('quiz-overlay').classList.remove('stage-result-view');
    document.getElementById('quiz-overlay').style.display = 'none';
    // 確保所有子元素恢復預設狀態，避免下次開啟殘留
    const splash = document.getElementById('quiz-prepare-splash');
    if (splash) splash.style.display = 'none';
    const qBox = document.getElementById('quiz-question-box');
    if (qBox) qBox.style.display = 'block';
    const teamBar = document.getElementById('quiz-team-bar');
    if (teamBar) teamBar.style.display = 'flex';
  }

  showStatistics(result, recovered = false) {
    const key = result.quizId || 'legacy';
    if (this.resultKey === key && this.statistics?.isConnected) return;
    this.resultKey = key;
    const overlay = document.getElementById('quiz-overlay');
    overlay.style.display = 'flex';
    overlay.classList.add('stage-result-view');
    this.statistics?.remove();
    const panel = this.statistics = document.createElement('section');
    panel.className = `quiz-statistics ${recovered ? '' : 'animate-reveal'}`;
    const add = (parent, tag, className, text) => {
      const element = document.createElement(tag);
      element.className = className;
      if (text !== undefined) element.textContent = text;
      parent.append(element);
      return element;
    };
    const heading = add(panel, 'header', 'statistics-heading');
    add(heading, 'p', '', '本題答題統計');
    add(heading, 'h2', '', `✓ 正確答案：${result.correctAnswer} · ${result.correctAnswerText}`);
    const dist = result.distribution;
    add(heading, 'p', '', `已作答 ${dist.answeredCount} 人 ／ 未作答 ${dist.unansweredCount} 人 ／ 全場 ${dist.totalPlayers} 人 · 回覆率 ${(dist.responseRate * 100).toFixed(1)}%`);
    const options = add(panel, 'div', 'statistics-options');
    for (const [label, text] of Object.entries(result.options)) {
      const option = dist.options[label];
      const row = add(options, 'article', `statistics-option ${label === result.correctAnswer ? 'is-correct' : ''}`);
      add(row, 'span', 'statistics-option-text', `${label}. ${text}${label === result.correctAnswer ? " ✓ 正確答案" : ""}`);
      add(row, 'strong', '', `${option.count} 人 · ${(option.answeredPercent * 100).toFixed(1)}%`);
      const track = add(row, 'div', 'statistics-bar');
      const fill = add(track, 'i', '');
      fill.style.width = `${option.answeredPercent * 100}%`;
    }
    const teams = add(panel, 'div', 'statistics-teams');
    for (const team of window.GameConfig.TEAMS) {
      const resultTeam = result.teamResults[team.id];
      if (!resultTeam) continue;
      const card = add(teams, 'article', `statistics-team ${resultTeam.isCorrect ? 'is-correct' : ''}`);
      card.style.setProperty('--team-color', team.hex);
      add(card, 'h3', '', team.name);
      add(card, 'strong', '', `${resultTeam.correctCount} / ${resultTeam.totalCount} 人答對`);
      add(card, 'p', 'team-correct-rate', `答對率 ${(resultTeam.correctRate * 100).toFixed(1)}%`);
      add(card, 'b', '', resultTeam.isCorrect ? '✓ 整隊答對' : '✕ 未超過 50%');
      const threshold = add(card, 'div', 'team-threshold');
      const rate = add(threshold, 'i', ''); rate.style.width = `${resultTeam.correctRate * 100}%`;
      add(card, 'small', 'threshold-label', '50% 門檻');
      const stack = add(card, 'div', 'team-answer-stack');
      for (const [kind, count] of [['correct', resultTeam.correctCount], ['wrong', resultTeam.wrongCount], ['unanswered', resultTeam.unansweredCount]]) {
        const segment = add(stack, 'i', kind);
        segment.style.width = `${resultTeam.totalCount ? count / resultTeam.totalCount * 100 : 0}%`;
      }
      add(card, 'small', 'team-counts', `答對 ${resultTeam.correctCount} · 答錯 ${resultTeam.wrongCount} · 未作答 ${resultTeam.unansweredCount}`);
    }
    add(panel, 'footer', '', '選項比例以全場已作答人數為分母 · 隊伍答對率包含未作答者 · 等待主持人繼續');
    overlay.append(panel);
  }
}
window.QuizDisplay = QuizDisplay;
