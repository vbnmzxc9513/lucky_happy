/**
 * 三局積分板與最終神秘頒獎流程渲染
 */
class ScoreboardUI {
  constructor() {
    this.awards = [];
    this.currentAwardIndex = 0;
    this.matchStatus = null;
    this.finalWinner = null;
    this.bindAwardControls();
    this.setupPresentationViewport();
  }

  render(matchStatus, latestWinner, finalAwards = null) {
    if (!matchStatus) return;
    this.matchStatus = matchStatus;
    this.finalWinner = latestWinner;

    const isDone = matchStatus.currentRound >= matchStatus.totalRounds
      && matchStatus.history.length >= matchStatus.totalRounds;

    if (isDone && finalAwards) {
      this.showFinalAwards(finalAwards);
      return;
    }

    this.showRoundScoreboard(matchStatus, latestWinner);
  }

  bindAwardControls() {
    const prev = document.getElementById('btn-award-prev');
    const next = document.getElementById('btn-award-next');

    if (prev) {
      prev.onclick = () => {
        if (this.currentAwardIndex > 0) {
          this.currentAwardIndex--;
          this.renderCurrentAward();
        }
      };
    }

    if (next) {
      next.onclick = () => {
        if (this.currentAwardIndex < this.awards.length - 1) {
          this.currentAwardIndex++;
          this.renderCurrentAward();
        }
      };
    }
  }

  setupPresentationViewport() {
    this.updatePresentationScale();
    window.addEventListener('resize', () => this.updatePresentationScale());
  }

  updatePresentationScale() {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    const stage = document.getElementById('final-awards-panel');
    if (stage) stage.style.setProperty('--final-awards-scale', String(scale));
  }

  setBackButtonVisible(visible) {
    const backBtn = document.getElementById('btn-back-to-lobby');
    if (backBtn) backBtn.style.display = visible ? 'flex' : 'none';
  }

  showRoundScoreboard(matchStatus, latestWinner) {
    const roundPanel = document.getElementById('round-scoreboard-panel');
    const awardPanel = document.getElementById('final-awards-panel');
    if (roundPanel) roundPanel.style.display = 'block';
    if (awardPanel) awardPanel.style.display = 'none';
    this.setBackButtonVisible(true);

    const title = document.getElementById('scoreboard-title');
    const banner = document.getElementById('winner-banner');
    const winnerName = document.getElementById('winner-team-name');
    const tbody = document.getElementById('scoreboard-tbody');
    const btnNext = document.getElementById('btn-next-round');
    const btnReset = document.getElementById('btn-reset-match');

    const teams = this.getTeams();
    if (title) title.innerText = `🏆 第 ${matchStatus.currentRound} / ${matchStatus.totalRounds} 局 結算報告 🏆`;

    if (title && matchStatus.totalRounds === 1) {
      title.innerText = '🏆 一戰決勝負 結算報告 🏆';
    }

    const winnerTeam = teams.find(t => t.id === latestWinner);
    if (winnerTeam) {
      winnerName.innerText = `${winnerTeam.name}`;
      banner.style.borderColor = winnerTeam.hex;
      banner.style.background = `${winnerTeam.hex}33`;
    } else {
      winnerName.innerText = '🤝 多隊平手';
      banner.style.borderColor = '#999';
      banner.style.background = 'rgba(150,150,150,0.2)';
    }

    if (tbody) {
      tbody.innerHTML = '';
      for (const team of teams) {
        const row = document.createElement('tr');
        let cells = `<td style="color:${team.hex};font-weight:bold">${this.escapeHtml(team.name)}</td>`;
        for (let r = 1; r <= matchStatus.totalRounds; r++) {
          const h = matchStatus.history.find(item => item.round === r);
          cells += h ? `<td>${h.winner === team.id ? '🏆 獲勝 (+1)' : '❌'}</td>` : '<td>-</td>';
        }
        const score = matchStatus.scores[team.id] !== undefined ? matchStatus.scores[team.id] : 0;
        cells += `<td><strong>${score} 分</strong></td>`;
        row.innerHTML = cells;
        tbody.appendChild(row);
      }
    }

    const isFinalRound = matchStatus.currentRound >= matchStatus.totalRounds
      && matchStatus.history.length >= matchStatus.totalRounds;
    if (btnNext) btnNext.style.display = isFinalRound ? 'none' : 'inline-block';
    if (btnReset) {
      btnReset.style.display = isFinalRound ? 'inline-block' : 'none';
      if (isFinalRound) btnReset.innerText = '準備最終頒獎中...';
      btnReset.disabled = isFinalRound;
    }
  }

  showFinalAwards(finalAwards) {
    const roundPanel = document.getElementById('round-scoreboard-panel');
    const awardPanel = document.getElementById('final-awards-panel');
    if (roundPanel) roundPanel.style.display = 'none';
    if (awardPanel) awardPanel.style.display = 'block';
    this.setBackButtonVisible(false);
    this.updatePresentationScale();

    this.awards = finalAwards && Array.isArray(finalAwards.awards)
      ? finalAwards.awards
      : this.buildFallbackAwards();

    if (this.currentAwardIndex >= this.awards.length) this.currentAwardIndex = 0;
    this.renderCurrentAward();
  }

  renderCurrentAward() {
    if (!this.awards.length) return;
    const award = this.awards[this.currentAwardIndex];
    const winner = award.winner || {};
    const team = this.getAwardTeam(award, winner);
    const stepText = `${String(this.currentAwardIndex + 1).padStart(2, '0')} / ${String(this.awards.length).padStart(2, '0')}`;

    this.setText('award-step-label', `AWARD ${stepText}`);
    this.setText('award-tag-label', award.tag || 'MYSTERY AWARD');
    this.setText('award-title', award.title || '神秘獎');
    this.setText('award-prompt', award.prompt || '得獎者即將揭曉');
    this.setText('award-metric-label', award.metricLabel || '成績');
    this.setText('award-metric-value', this.formatMetric(winner.value || 0, award.unit));
    this.setText('award-congrats', this.getCongratsText(award, winner, team));
    this.setText('award-description', award.description || '');
    this.setText('award-ranking-title', `${award.scope === 'player' ? '個人' : ''}${award.metricLabel || '成績'}排行榜`);

    const card = document.getElementById('award-current-card');
    if (card) {
      card.style.setProperty('--award-color', team.hex || '#315E58');
      card.style.setProperty('--award-soft-color', this.hexToRgba(team.hex || '#315E58', 0.2));
    }

    this.renderProgress();
    this.renderWinnerIdentity(award, winner, team);
    this.renderRanking(award);
    this.renderButtons();
  }

  renderProgress() {
    const list = document.getElementById('award-progress-list');
    if (!list) return;
    list.innerHTML = '';

    this.awards.forEach((award, index) => {
      const item = document.createElement('div');
      const active = index === this.currentAwardIndex;
      const revealed = index < this.currentAwardIndex;
      item.className = `award-progress-item ${active ? 'active' : ''} ${revealed ? 'revealed' : ''}`;
      const label = active || revealed
        ? award.title
        : `第 ${String(index + 1).padStart(2, '0')} 個神秘獎`;
      const state = revealed ? '已公布' : active ? '目前揭曉' : '保密中';
      item.innerHTML = `
        <span class="award-progress-dot"></span>
        <span class="award-progress-copy">
          <small>${String(index + 1).padStart(2, '0')} / ${String(this.awards.length).padStart(2, '0')}</small>
          <strong>${this.escapeHtml(label)}</strong>
        </span>
        <em>${this.escapeHtml(state)}</em>
      `;
      list.appendChild(item);
    });
  }

  renderWinnerIdentity(award, winner, team) {
    const box = document.getElementById('award-winner-identity');
    if (!box) return;

    const isPlayerAward = award.scope === 'player';
    const avatar = winner.avatar || (winner.name ? winner.name.charAt(0) : '？');

    if (isPlayerAward) {
      box.innerHTML = `
        <div class="award-player-card">
          ${team.imgPath ? `<img class="award-player-team-mark" src="${this.escapeAttr(team.imgPath)}" alt="${this.escapeAttr(team.name || '')}">` : ''}
          <div class="award-avatar" style="background:${this.escapeAttr(team.hex || '#315E58')}">${this.escapeHtml(avatar)}</div>
          <strong>${this.escapeHtml(winner.name || '尚無紀錄')}</strong>
          <span style="color:${this.escapeAttr(team.hex || '#315E58')}">${this.escapeHtml(team.name || '尚無隊伍')}</span>
        </div>
      `;
      return;
    }

    box.innerHTML = `
      <div class="award-team-card">
        ${winner.imgPath ? `<img src="${this.escapeAttr(winner.imgPath)}" alt="${this.escapeAttr(winner.name || '')}">` : ''}
        <strong>${this.escapeHtml(winner.name || '多隊平手')}</strong>
      </div>
    `;
  }

  renderRanking(award) {
    const list = document.getElementById('award-ranking-list');
    if (!list) return;

    const ranking = Array.isArray(award.ranking) ? award.ranking : [];
    const max = Math.max(...ranking.map(item => Number(item.value || 0)), 1);
    list.innerHTML = '';

    if (ranking.length === 0) {
      list.innerHTML = '<div class="award-empty-ranking">尚無可統計資料</div>';
      return;
    }

    ranking.slice(0, 5).forEach((item, index) => {
      const team = this.getAwardTeam(award, item);
      const row = document.createElement('div');
      row.className = `award-ranking-row ${award.scope === 'player' ? 'player-award' : 'team-award'}`;
      row.innerHTML = `
        <span class="award-rank-num" style="color:${this.escapeAttr(team.hex || '#315E58')}">${index + 1}</span>
        <span class="award-rank-name">${this.escapeHtml(item.name || '神秘賓客')}</span>
        ${award.scope === 'player' ? `<span class="award-rank-team">${this.escapeHtml(team.name || '')}</span>` : ''}
        <span class="award-rank-bar"><i style="width:${Math.round((Number(item.value || 0) / max) * 100)}%;background:${this.escapeAttr(team.hex || '#315E58')}"></i></span>
        <strong style="color:${this.escapeAttr(team.hex || '#315E58')}">${this.formatMetric(item.value || 0, award.unit)}</strong>
      `;
      list.appendChild(row);
    });
  }

  renderButtons() {
    const prev = document.getElementById('btn-award-prev');
    const next = document.getElementById('btn-award-next');
    const reset = document.getElementById('btn-final-reset-match');
    const isLast = this.currentAwardIndex >= this.awards.length - 1;

    if (prev) {
      prev.disabled = this.currentAwardIndex === 0;
    }
    if (next) {
      next.style.display = isLast ? 'none' : 'inline-flex';
      next.innerText = '揭曉下一個神秘獎';
    }
    if (reset) {
      reset.style.display = isLast ? 'inline-flex' : 'none';
    }
  }

  getAwardTeam(award, item) {
    if (award.scope === 'player') {
      return {
        id: item.teamId,
        name: item.teamName,
        hex: item.teamHex || '#315E58',
        imgPath: item.teamImgPath || ''
      };
    }
    return {
      id: item.id,
      name: item.name,
      hex: item.hex || '#315E58',
      imgPath: item.imgPath || ''
    };
  }

  getCongratsText(award, winner, team) {
    if (award.scope === 'player') {
      const hasAverageSpeed = winner.averageAnswerMs !== null
        && winner.averageAnswerMs !== undefined
        && Number.isFinite(Number(winner.averageAnswerMs));
      const speedText = award.tieBreaker === 'averageAnswerMs' && hasAverageSpeed
        ? `，平均 ${this.formatAnswerSeconds(winner.averageAnswerMs)}`
        : '';
      return `恭喜 ${winner.name || '尚無紀錄'} 代表 ${team.name || '尚無隊伍'}${speedText}`;
    }
    return `恭喜 ${winner.name || '多隊平手'}`;
  }

  buildFallbackAwards() {
    const teams = this.getTeams();
    const scores = this.matchStatus && this.matchStatus.scores ? this.matchStatus.scores : {};
    const ranking = teams
      .map(team => ({ ...team, value: scores[team.id] || 0 }))
      .sort((a, b) => b.value - a.value);
    const winner = ranking.find(team => team.id === this.finalWinner) || ranking[0] || {};

    return [{
      id: 'team-winner',
      scope: 'team',
      tag: 'TEAM WINNER',
      title: '幸福總冠軍',
      prompt: '哪個隊伍贏得最終勝利',
      description: '三局累計分數最高，獲得新人親頒幸福榮耀盃',
      metricLabel: '總積分',
      unit: '分',
      winner,
      ranking
    }];
  }

  getTeams() {
    return (window.GameConfig && window.GameConfig.TEAMS) || [];
  }

  setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  }

  formatMetric(value, unit = '') {
    return `${Number(value || 0).toLocaleString('zh-TW')} ${unit}`.trim();
  }

  formatAnswerSeconds(value) {
    if (value === null || value === undefined) return '-- 秒';
    const ms = Number(value);
    if (!Number.isFinite(ms)) return '-- 秒';
    const seconds = ms / 1000;
    return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} 秒`;
  }

  hexToRgba(hex, alpha) {
    const clean = String(hex || '').replace('#', '');
    if (clean.length !== 6) return `rgba(49, 94, 88, ${alpha})`;
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  escapeAttr(value) {
    return this.escapeHtml(value).replace(/`/g, '&#096;');
  }
}

window.ScoreboardUI = ScoreboardUI;
