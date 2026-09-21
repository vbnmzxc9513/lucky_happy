(function (root) {
  class StageDisplay {
    constructor(mode) {
      this.mode = mode;
      this.lastKey = null;
      this.summary = document.createElement('section');
      this.summary.className = `stage-summary stage-${mode}`;
      this.summary.hidden = true;
      this.label = document.createElement('div');
      this.label.className = `stage-clock stage-clock-${mode}`;
      this.label.hidden = true;
      const container = document.getElementById(mode === 'host' ? 'app-container' : 'mobile-app');
      container.append(this.summary, this.label);
      const resize = () => this.summary.style.setProperty('--stage-scale', Math.min(innerWidth / 1920, innerHeight / 1080));
      resize();
      root.addEventListener('resize', resize);
      this.timer = setInterval(() => this.tick(), 200);
    }

    sync(state, teamId) {
      this.config = state.config;
      this.stage = state.quizStage;
      this.paused = !!state.paused;
      this.receivedAt = Date.now();
      this.serverNow = state.serverNow || Date.now();
      const stage = this.stage;
      const key = stage ? `${stage.stageNumber}:${stage.phase}:${stage.questionNumber}` : null;
      this.summary.hidden = !stage || stage.phase !== 'summary';
      if (this.mode === 'host') document.body.classList.toggle('stage-summary-active', !this.summary.hidden);
      this.summary.classList.toggle('is-paused', this.paused);
      this.label.hidden = !stage || stage.phase === 'summary';
      if (stage?.phase === 'summary' && key !== this.lastKey) {
        this.renderSummary(state.config.TEAMS, teamId);
      }
      this.lastKey = key;
      this.tick();
    }

    tick() {
      const stage = this.stage;
      if (!stage) return;
      const now = this.serverNow + (this.paused ? 0 : Date.now() - this.receivedAt);
      const seconds = Math.max(0, Math.ceil((stage.endsAt - now) / 1000));
      const prefix = `第 ${stage.stageNumber} / ${stage.stageCount} 關`;
      const suffix = stage.phase === 'tap' ? `${seconds} 秒後連答三題`
        : stage.phase === 'sprint' ? `最後衝刺 ${seconds} 秒`
          : stage.phase === 'reveal' ? `第 ${stage.questionNumber} / 3 題 · 成績公布 ${seconds} 秒`
          : `第 ${stage.questionNumber} / 3 題`;
      this.label.textContent = `${prefix} · ${suffix}`;
      this.label.classList.toggle('is-urgent', stage.phase === 'tap' && seconds <= 3);
      if (stage.phase === 'tap' && seconds > 0 && seconds <= 3 && this.lastBeep !== `${prefix}:${seconds}` && !this.paused) {
        this.lastBeep = `${prefix}:${seconds}`;
        if (this.mode === 'host') root.GameSound?.play('countdown');
      }
      const next = this.summary.querySelector('.stage-next');
      if (next && stage.phase === 'summary') {
        next.querySelector('.stage-next-seconds').textContent = seconds;
        const elapsed = Math.max(0, this.summaryDuration - (stage.endsAt - now) / 1000);
        this.summary.dataset.beat = elapsed < 2.65 ? 'reveal' : elapsed < 4.8 ? 'celebrate' : 'reward';
        this.summary.querySelector('h2').textContent = elapsed < 2.65 ? this.revealTitle : this.celebrationTitle;
        if (!this.paused && this.summarySoundEnabled) {
          for (const cue of this.summaryCues) {
            if (elapsed >= cue.at && !cue.played) {
              cue.played = true;
              if (elapsed - cue.at < 0.65) root.GameSound?.play(cue.name);
            }
          }
        }
      }
    }

    renderSummary(teams, myTeamId) {
      this.summary.replaceChildren();
      this.summaryDuration = 8;
      const elapsed = Math.max(0, this.summaryDuration - (this.stage.endsAt - this.serverNow) / 1000);
      this.summary.style.setProperty('--stage-elapsed', `${elapsed}s`);
      const visibleTeams = teams.filter(t => this.mode === 'host' || t.id === myTeamId);
      const results = this.stage.summary.teamResults;
      const perfectCount = visibleTeams.filter(t => results[t.id]?.correctCount === 3).length;
      const highest = Math.max(0, ...visibleTeams.map(t => results[t.id]?.correctCount || 0));
      const lastStage = this.stage.stageNumber === this.stage.stageCount;
      this.revealTitle = this.mode === 'host' ? '這一關，掌聲給誰？' : '本關成績揭曉';
      this.celebrationTitle = perfectCount
        ? this.mode === 'host' ? `${perfectCount} 隊全對，掌聲催下去！` : '三題全對，太神啦！'
        : highest ? this.mode === 'host' ? `本關最高 ${highest} 題，繼續追！` : '漂亮！繼續向前！'
          : this.mode === 'guest' ? (lastStage ? '最後衝刺，追回來！' : '下一關，逆轉吧！')
            : lastStage ? '最後衝刺，逆轉就現在！' : '先暖身，下一關逆轉！';
      this.summarySoundEnabled = this.mode === 'host' && this.lastKey !== null;
      this.summaryCues = [
        { at: 0.35, name: 'stage-star-1' }, { at: 1.1, name: 'stage-star-2' },
        { at: 1.85, name: 'stage-star-3' }, { at: 2.65, name: perfectCount ? 'award' : 'ready' },
        { at: 4.8, name: highest ? 'boost' : 'ready' }
      ].map(cue => ({ ...cue, played: cue.at < elapsed }));
      this.summary.classList.toggle('has-perfect', perfectCount > 0);
      const heading = document.createElement('header');
      heading.className = 'stage-heading';
      const kicker = document.createElement('p');
      kicker.className = 'stage-kicker';
      kicker.textContent = `THE TSAI NIEH WEDDING CLUB  /  ROUND ${String(this.stage.stageNumber).padStart(2, '0')}`;
      const title = document.createElement('h2');
      title.textContent = this.revealTitle;
      heading.append(kicker, title);
      const grid = document.createElement('div');
      grid.className = 'stage-team-grid';
      for (const team of visibleTeams) {
        const result = this.stage.summary.teamResults[team.id];
        const column = document.createElement('article');
        column.className = `stage-team ${result.correctCount === 3 ? 'stage-perfect' : ''}`;
        column.style.setProperty('--team-color', team.hex);
        column.style.setProperty('--reward-travel', `${result.steps * 10}px`);
        const name = document.createElement('h3');
        name.textContent = team.name;
        const stars = document.createElement('div');
        stars.className = 'stage-stars';
        result.answers.forEach((correct, index) => {
          const star = document.createElement('span');
          star.className = correct ? 'star-hit' : 'star-miss';
          star.textContent = correct ? '★' : '☆';
          star.setAttribute('aria-label', `第 ${index + 1} 題${correct ? '答對' : '未答對'}`);
          star.style.animationDelay = `calc(${0.35 + index * 0.75}s - var(--stage-elapsed))`;
          stars.append(star);
        });
        const score = document.createElement('strong');
        score.className = 'stage-score';
        const scoreNumber = document.createElement('b');
        scoreNumber.textContent = result.correctCount;
        const scoreTotal = document.createElement('span');
        scoreTotal.textContent = '/ 3 題';
        score.append(scoreNumber, scoreTotal);
        const reward = document.createElement('p');
        reward.className = 'stage-reward';
        reward.textContent = result.steps ? `前進 ${result.steps} 格`
          : this.stage.stageNumber === this.stage.stageCount ? '衝刺追回來！' : '下一關追回來！';
        const track = document.createElement('div');
        track.className = 'stage-reward-track';
        const horse = document.createElement('img');
        horse.src = team.runImgPath || team.imgPath;
        horse.alt = team.name;
        const runner = document.createElement('div');
        runner.className = 'stage-runner';
        runner.append(horse);
        track.append(runner);
        if (result.correctCount === 3) {
          const seal = document.createElement('div');
          seal.className = 'stage-perfect-seal';
          seal.textContent = '全對';
          const sparkles = document.createElement('div');
          sparkles.className = 'stage-confetti';
          sparkles.setAttribute('aria-hidden', 'true');
          for (let index = 0; index < 12; index++) {
            const piece = document.createElement('i');
            piece.style.setProperty('--piece-x', `${8 + (index * 29) % 85}%`);
            piece.style.setProperty('--piece-drift', `${(index % 2 ? 1 : -1) * (14 + index * 3)}px`);
            piece.style.setProperty('--piece-rotation', `${index * 67}deg`);
            piece.style.setProperty('--piece-delay', `${2.65 + (index % 4) * 0.1}s`);
            sparkles.append(piece);
          }
          track.append(sparkles, seal);
        }
        const note = document.createElement('p');
        note.className = 'stage-cheer';
        note.textContent = result.correctCount === 3 ? '全對！額外加 1 格' : result.correctCount ? '漂亮！繼續向前' : '一起加油';
        if (root.ShuttleRace && Number.isFinite(result.beforePosition) && Number.isFinite(result.position)) {
          const before = root.ShuttleRace.measure(result.beforePosition, this.config);
          const after = root.ShuttleRace.measure(result.position, this.config);
          note.textContent = `${before.laps} → ${after.laps} 圈${result.correctCount === 3 ? ' · 全對多 1 格' : ''}`;
        }
        column.append(name, track, stars, score, reward, note);
        grid.append(column);
      }
      const next = document.createElement('footer');
      next.className = 'stage-next';
      const progress = document.createElement('div');
      progress.className = 'stage-progress';
      progress.setAttribute('aria-label', `第 ${this.stage.stageNumber} 關，共 ${this.stage.stageCount} 關`);
      for (let index = 1; index <= this.stage.stageCount; index++) {
        const step = document.createElement('span');
        step.textContent = String(index).padStart(2, '0');
        step.className = index <= this.stage.stageNumber ? 'is-complete' : '';
        if (index === this.stage.stageNumber) step.classList.add('is-current');
        progress.append(step);
      }
      const nextLabel = document.createElement('span');
      nextLabel.className = 'stage-next-label';
      nextLabel.textContent = lastStage ? '最後 10 秒衝刺，準備逆轉！' : '下一關，繼續加油！';
      const countdown = document.createElement('span');
      countdown.className = 'stage-next-countdown';
      const count = document.createElement('b');
      count.className = 'stage-next-seconds';
      countdown.append(count, document.createTextNode(' 秒後出發'));
      next.append(progress, nextLabel, countdown);
      this.summary.append(heading, grid, next);
    }
  }
  root.StageDisplay = StageDisplay;
})(window);
