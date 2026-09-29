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

  showQuiz(questionText, options, timeLimit) {
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
        card.innerHTML = `<span class="opt-text">${opt.label}. ${opt.text}</span>`;
        optionsContainer.appendChild(card);
      });
    }

    // 倒數計時
    let left = timeLimit || 10;
    timerNum.innerText = left;

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.paused) return;
      left--;
      if (left < 0) left = 0;
      timerNum.innerText = left;
      if (left <= 3) {
        timerBadge.classList.add('timer-warning');
      }
      if (left <= 0) {
        clearInterval(this.timerInterval);
      }
    }, 1000);
  }

  _renderTeamBar() {
    if (!window.GameConfig || !window.GameConfig.TEAMS) return;
    const teams = window.GameConfig.TEAMS;
    const bar = document.getElementById('quiz-team-bar');
    if (!bar) return;
    bar.innerHTML = '';
    teams.forEach(t => {
      const cell = document.createElement('div');
      cell.className = 'quiz-team-cell';
      cell.innerHTML = `
        <span class="qt-name">${t.name}</span>
        <span class="qt-progress" id="quiz-${t.id}-answered">0 / 0</span>
        <div class="qt-bar-wrap">
          <div class="qt-bar-fill" id="quiz-${t.id}-bar" style="width: 0%; background-color: ${t.hex};"></div>
        </div>
      `;
      bar.appendChild(cell);
    });
  }

  updateAnsweredCount(stats) {
    if (!window.GameConfig || !window.GameConfig.TEAMS) return;
    const teams = window.GameConfig.TEAMS;
    teams.forEach(t => {
      const el = document.getElementById(`quiz-${t.id}-answered`);
      const barEl = document.getElementById(`quiz-${t.id}-bar`);
      if (el && stats && stats[t.id]) {
        const { ans, total } = stats[t.id];
        el.innerText = `${ans} / ${total}`;
        if (barEl && total > 0) {
          barEl.style.width = `${Math.round((ans / total) * 100)}%`;
        }
      }
    });
  }

  updateTeamProgress(progress) {
    if (!progress || !progress.teamId) return;
    const answered = Number(progress.answeredCount || 0);
    const total = Number(progress.totalCount || 0);
    const el = document.getElementById(`quiz-${progress.teamId}-answered`);
    const barEl = document.getElementById(`quiz-${progress.teamId}-bar`);
    if (el) el.innerText = `${answered} / ${total}`;
    if (barEl) barEl.style.width = `${total > 0 ? Math.round(answered / total * 100) : 0}%`;
  }

  showResult(resultData) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (resultData?.distribution) return this.showStatistics(resultData);
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
      if (eff === 'stage_pending') return '三題結束後一起結算';
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

  showStatistics(result) {
    const overlay = document.getElementById('quiz-overlay');
    overlay.style.display = 'flex';
    overlay.classList.add('stage-result-view');
    this.statistics?.remove();
    const panel = this.statistics = document.createElement('section');
    panel.className = 'quiz-statistics';
    const add = (parent, tag, className, text) => {
      const element = document.createElement(tag);
      element.className = className;
      if (text !== undefined) element.textContent = text;
      parent.append(element);
      return element;
    };
    const heading = add(panel, 'header', 'statistics-heading');
    add(heading, 'p', '', '本題答題統計');
    add(heading, 'h2', '', `正確答案：${result.correctAnswer} · ${result.correctAnswerText}`);
    const dist = result.distribution;
    add(heading, 'p', '', `已作答 ${dist.answeredCount} 人 ／ 未作答 ${dist.unansweredCount} 人 ／ 全場 ${dist.totalPlayers} 人 · 回覆率 ${(dist.responseRate * 100).toFixed(1)}%`);
    const options = add(panel, 'div', 'statistics-options');
    for (const [label, text] of Object.entries(result.options)) {
      const option = dist.options[label];
      const row = add(options, 'article', `statistics-option ${label === result.correctAnswer ? 'is-correct' : ''}`);
      add(row, 'span', 'statistics-option-text', `${label}. ${text}`);
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
      add(card, 'h3', '', team.name);
      add(card, 'strong', '', `${resultTeam.correctCount} / ${resultTeam.totalCount} 人答對`);
      add(card, 'p', '', `答對率 ${(resultTeam.correctRate * 100).toFixed(1)}%`);
      add(card, 'b', '', resultTeam.isCorrect ? '本題答對' : '未達 50%');
      add(card, 'small', '', resultTeam.isCorrect ? '已超過 50%' : '須嚴格大於 50%');
    }
    add(panel, 'footer', '', '選項比例以全場已作答人數為分母 · 隊伍答對率包含未作答者 · 等待主持人繼續');
    overlay.append(panel);
  }
}
window.QuizDisplay = QuizDisplay;
