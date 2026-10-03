(function (root) {
  class StageDisplay {
    constructor(mode) {
      this.mode = mode;
      this.lastKey = null;
      this.retiredRuns = new Set();
      this.reducedMotion = root.matchMedia?.('(prefers-reduced-motion: reduce)');
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
      if (this.retiredRuns.has(state.runId)) return;
      if (this.runId === state.runId && this.version > state.stateVersion) return;
      if (this.runId === state.runId && this.stage?.stageNumber === state.quizStage?.stageNumber
        && this.stage?.flowRevision > state.quizStage?.flowRevision) return;
      if (this.runId && this.runId !== state.runId) this.retiredRuns.add(this.runId);
      this.runId = state.runId;
      this.version = state.stateVersion;
      this.config = state.config || this.config || root.GameConfig;
      this.stage = state.quizStage;
      this.paused = !!state.paused;
      this.receivedAt = performance.now();
      this.serverNow = (state.paused ? state.pausedAt : state.serverNow) || Date.now();
      const stage = this.stage;
      const key = stage ? `${state.runId || ''}:${teamId || ''}:${stage.stageNumber}:${stage.phase}:${stage.questionNumber}:${stage.flowRevision}` : null;
      this.summary.hidden = !stage || stage.phase !== 'summary';
      if (this.mode === 'host' && this.summary.hidden) document.body.classList.remove('stage-summary-active');

      this.summary.classList.toggle('is-paused', this.paused);
      this.label.hidden = !stage || stage.phase === 'summary';
      if (stage?.phase === 'summary' && key !== this.lastKey) {
        this.renderSummary(this.config.TEAMS, teamId);
      }
      this.lastKey = key;
      cancelAnimationFrame(this.frame);
      this.frame = null;
      this.animateSummary();
      this.tick();
    }

    tick() {
      const stage = this.stage;
      if (!stage) return;
      const now = this.serverNow + (this.paused ? 0 : performance.now() - this.receivedAt);
      if (this.mode === 'host' && stage.phase === 'summary') {
        this.summary.hidden = now >= stage.summary.movementStartedAt;
        this.label.hidden = !this.summary.hidden;
        document.body.classList.toggle('stage-summary-active', !this.summary.hidden);
      } else if (this.mode === 'host') document.body.classList.remove('stage-summary-active');
      const seconds = Math.max(0, Math.ceil((stage.endsAt - now) / 1000));
      const prefix = `第 ${stage.stageNumber} / ${stage.stageCount} 關`;
      const suffix = stage.phase === 'tap' ? `距離答題關卡還有 ${seconds} 秒`
        : stage.phase === 'sprint' ? `最後衝刺 ${seconds} 秒`
          : stage.phase === 'reveal' ? `第 ${stage.questionNumber} / ${stage.questionsPerStage || this.config.quizStages.questionsPerStage} 題 · 統計結果 · 等待主持人`
          : stage.phase === 'summary' ? (now < stage.summary.movementEndsAt ? '本關獎勵推進' : '等待主持人繼續')
          : `第 ${stage.questionNumber} / ${stage.questionsPerStage || this.config.quizStages.questionsPerStage} 題 · ${stage.phase === 'answer' ? '作答中' : stage.phase === 'reading' ? '閱讀中 · ' + seconds + ' 秒' : '準備中'}`;
      this.label.classList.toggle('is-tap', stage.phase === 'tap');
      this.label.classList.toggle('is-paused', this.paused);
      const text = stage.phase === 'tap' ? String(seconds) : `${prefix} · ${suffix}`;
      if (this.label.textContent !== text) {
        this.label.textContent = text;
        this.label.setAttribute('aria-label', `${prefix} · ${suffix}`);
      }
      this.label.classList.toggle('is-urgent', stage.phase === 'tap' && seconds <= 3);
      if (stage.phase === 'tap' && seconds > 0 && seconds <= 3 && this.lastBeep !== `${prefix}:${seconds}` && !this.paused) {
        this.lastBeep = `${prefix}:${seconds}`;
        if (this.mode === 'host') root.GameSound?.play('countdown');
      }
      if (stage.phase === 'summary') {
        const status = this.paused ? '已暫停' : now < stage.summary.readyAt ? '結算動畫播放中' : '等待主持人繼續';
        if (this.next.textContent !== status) this.next.textContent = status;
      }
    }

    animateSummary() {
      if (this.mode === 'host') {
        this.tick();
        const now = this.serverNow + (this.paused ? 0 : performance.now() - this.receivedAt);
        if (this.stage?.phase === 'summary' && !this.paused && now < this.stage.summary.movementStartedAt) {
          this.frame = requestAnimationFrame(() => { this.frame = null; this.animateSummary(); });
        }
        return;
      }
      if (this.stage?.phase !== 'summary' || this.summary.hidden) return;
      const now = this.serverNow + (this.paused ? 0 : performance.now() - this.receivedAt);
      const summary = this.stage.summary;
      for (const row of this.runners || []) {
        const progress = this.reducedMotion?.matches ? 1 : root.SummaryMotion.progress(summary, row.steps, now, this.config);
        const fraction = root.SummaryMotion.ease(progress) * row.steps / Math.max(...this.config.quizStages.rewardSteps);
        // The moving wrapper is exactly the effective lane width; percentage transforms need no layout reads.
        row.runner.style.transform = 'translate3d(' + (fraction * 100) + '%,0,0)';
        const distance = row.beforePosition + (row.position - row.beforePosition) * root.SummaryMotion.ease(progress);
        row.total.textContent = '總距離 ' + root.DistanceDisplay.position(distance, this.config);
        row.runner.classList.toggle('is-moving', !this.paused && progress > 0 && progress < 1 && row.steps > 0);
      }
      if (!this.paused && now < summary.movementEndsAt && !this.reducedMotion?.matches) {
        this.frame = requestAnimationFrame(() => { this.frame = null; this.animateSummary(); });
      }
    }

    renderSummary(teams, myTeamId) {
      this.summary.replaceChildren();
      this.runners = [];
      const heading = document.createElement('header');
      heading.className = 'stage-heading';
      const title = document.createElement('h2');
      title.textContent = '本關結算';
      heading.append(title);
      const grid = document.createElement('div');
      grid.className = 'stage-team-grid';
      for (const team of teams.filter(t => this.mode === 'host' || t.id === myTeamId)) {
        const result = this.stage.summary.teamResults[team.id];
        if (!result) continue;
        const row = document.createElement('article');
        row.className = 'stage-team';
        row.style.setProperty('--team-color', team.hex);
        const name = document.createElement('h3');
        name.textContent = team.name;
        const stars = document.createElement('div');
        stars.className = 'stage-stars';
        result.answers.forEach((correct, index) => {
          const item = document.createElement('span');
          item.className = correct ? 'star-hit' : 'star-miss';
          item.textContent = 'Q' + (index + 1) + ' ' + (correct ? '✓' : '✕');
          stars.append(item);
        });
        const track = document.createElement('div');
        track.className = 'stage-reward-track';
        const lane = document.createElement('div');
        lane.className = 'stage-lane';
        const ticks = document.createElement('div');
        ticks.className = 'stage-reward-steps';
        for (let i = 0; i < 6; i++) ticks.append(document.createElement('i'));
        const runner = document.createElement('div');
        runner.className = 'stage-runner';
        const horse = document.createElement('img');
        horse.src = team.summaryImgPath || team.runImgPath || team.imgPath;
        horse.alt = '';
        runner.append(horse);
        lane.append(ticks, runner);
        track.append(lane);
        const reward = document.createElement('p');
        reward.className = 'stage-reward';
        reward.textContent = '前進 ' + root.DistanceDisplay.reward(result.steps, this.config);
        const total = document.createElement('p');
        total.className = 'stage-distance';
        total.textContent = '總距離 ' + root.DistanceDisplay.position(result.position, this.config);
        if (this.mode === 'host') row.append(name, stars, reward);
        else row.append(name, stars, track, reward, total);
        grid.append(row);
        this.runners.push({ runner, steps: result.steps, total, position: result.position,
          beforePosition: result.beforePosition ?? result.position - result.steps * this.config.quizStages.rewardUnitPx });
      }
      this.next = document.createElement('footer');
      this.next.className = 'stage-next';
      this.summary.append(heading, grid, this.next);
    }
  }
  root.StageDisplay = StageDisplay;
})(window);
