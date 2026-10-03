/** Authoritative distances share one linear camera; rewards reuse the main horses. */
class RaceRenderer {
  constructor() {
    this.itemsMap = new Map();
    this.samples = [];
    this.nodes = new Map();
    this.active = false;
    this.needsSnap = true;
    this.lastNoticeAt = -Infinity;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.resize = (paint = true) => {
      const screen = document.getElementById('screen-racing');
      screen?.style.setProperty('--race-scale', Math.min(innerWidth / 1920, innerHeight / 1080));
      const track = document.getElementById('track-container');
      this.startX = this.shuttle ? 300 : 0;
      this.span = Math.max(1, (track?.clientWidth || 1200) - this.startX - (this.shuttle ? 290 : 180));
      if (paint && this.summary) { cancelAnimationFrame(this.frame); this.frame = null; this.animateReward(); }
      else if (paint && this.presented) this.paint(this.presented);
    };
    window.addEventListener('resize', this.resize);
  }

  initTrack(trackLength, items) {
    this.trackLen = Math.max(1, Number(trackLength) || 1000);
    this.shuttle = window.ShuttleRace?.enabled(window.GameConfig);
    document.body.classList.toggle('shuttle-race', !!this.shuttle);
    this.items = items || {};
    for (const el of this.itemsMap.values()) el.remove();
    this.itemsMap.clear();
    this.nodes.clear();
    for (const team of window.GameConfig.TEAMS) {
      const id = team.id;
      this.nodes.set(id, { horse: document.getElementById(`horse-${id}`),
        fill: document.getElementById(`${id}-progress-fill`), text: document.getElementById(`${id}-progress-text`),
        rank: document.getElementById(`${id}-race-rank`), laps: document.getElementById(`${id}-lane-laps`),
        stun: document.getElementById(`${id}-stun-tag`) });
    }
    this.resize(false);
  }

  setState(state) {
    const wasActive = this.active;
    cancelAnimationFrame(this.frame); this.frame = null;
    this.summary = state.quizStage?.phase === 'summary' ? state.quizStage.summary : null;
    this.paused = !!state.paused;
    if (this.cameraTransition && (!wasActive || this.paused)) this.cameraTransition.lastAt = performance.now();
    this.serverNow = (state.paused ? state.pausedAt : state.serverNow) || Date.now();
    this.receivedAt = performance.now();
    if (this.summary) {
      const results = Object.values(this.summary.teamResults);
      this.camera = window.ShuttleRace.camera(results.map(r => r.beforePosition), results.map(r => r.position));
      this.cameraTransition = null;
    }
    this.active = state.state === 'RACING' && !state.paused;
    document.body.classList.toggle('shuttle-paused', !this.active && !(this.summary && !this.paused));
    if (!['COUNTDOWN', 'RACING', 'QUIZ'].includes(state.state)) {
      this.reset();
      return;
    }
    const teams = Object.fromEntries((state.teams || []).map(t => [t.id, t]));
    if (Object.keys(teams).length && (this.needsSnap || !this.active || !wasActive)) {
      this.latest = teams;
      this.samples = [{ at: performance.now(), teams }];
      this.paint(teams);
      this.ranks = window.ShuttleRace.rank(teams);
      this.candidate = null;
      this.needsSnap = false;
    }
    if (this.active && wasActive && !this.needsSnap) {
      this.updatePositions(teams);
      // A roster snapshot must repaint items at the same delayed presentation time.
      this.paintInterpolated(performance.now());
    }
    if (this.summary) { cancelAnimationFrame(this.frame); this.frame = null; this.animateReward(); }
    else if (this.active) this.start();
    else { cancelAnimationFrame(this.frame); this.frame = null; this.clearNotice(); }
  }

  disconnect() {
    this.active = false;
    this.needsSnap = true;
    cancelAnimationFrame(this.frame);
    this.frame = null;
    document.body.classList.add('shuttle-paused');
    this.clearNotice();
  }

  reset() {
    this.disconnect();
    this.samples = [];
    this.latest = null;
    this.summary = null;
    this.camera = null;
    this.cameraTransition = null;
    this.presented = null;
    this.ranks = null;
    this.candidate = null;
    this.lastNoticeAt = -Infinity;
    for (const el of this.itemsMap.values()) el.remove();
    this.itemsMap.clear();
    this.items = {};
  }

  updatePositions(teams) {
    if (!teams || !this.active) return;
    const now = performance.now();
    const stale = !this.samples.length || now - this.samples.at(-1).at > 500;
    this.latest = teams;
    if (stale) { this.samples = []; this.ranks = window.ShuttleRace.rank(teams); this.candidate = null; }
    this.samples.push({ at: now, teams });
    while (this.samples.length > 2 && this.samples[1].at < now - 200) this.samples.shift();
    this.detectOvertake(teams, now);
    this.start();
  }

  detectOvertake(teams, now) {
    const ranks = window.ShuttleRace.rank(teams);
    const improved = Object.keys(ranks).find(id => this.ranks && ranks[id] < this.ranks[id]
      && Object.keys(ranks).some(other => this.ranks[other] < this.ranks[id] && ranks[other] > ranks[id]));
    if (improved) this.candidate = { id: improved, rank: ranks[improved], at: now };
    if (this.candidate && ranks[this.candidate.id] !== this.candidate.rank) this.candidate = null;
    if (this.candidate && now - this.candidate.at >= 350 && now - this.lastNoticeAt >= 2000) {
      const team = window.GameConfig.TEAMS.find(t => t.id === this.candidate.id);
      const notice = document.getElementById('race-overtake');
      if (notice && team) {
        notice.textContent = `${team.name} 追上了！第 ${this.candidate.rank} 名`;
        notice.hidden = false;
        clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => { notice.hidden = true; }, 1600);
      }
      this.lastNoticeAt = now;
      this.candidate = null;
    }
    this.ranks = ranks;
  }

  clearNotice() {
    clearTimeout(this.noticeTimer);
    const notice = document.getElementById('race-overtake');
    if (notice) notice.hidden = true;
  }

  start() {
    if (this.frame != null || !this.active) return;
    const step = now => {
      this.frame = null;
      if (!this.active) return;
      this.paintInterpolated(now);
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  paintInterpolated(now) {
    const at = now - 100;
    let a = this.samples[0], b = a;
    for (const sample of this.samples) {
      if (sample.at <= at) a = sample;
      b = sample;
      if (sample.at >= at) break;
    }
    if (a && b) {
      const fraction = a === b ? 1 : Math.max(0, Math.min(1, (at - a.at) / (b.at - a.at)));
      const teams = Object.fromEntries(Object.entries(b.teams).map(([id, data]) => [id, { ...data,
        position: (a.teams[id]?.position || 0) + (data.position - (a.teams[id]?.position || 0)) * fraction
      }]));
      this.paint(teams);
    }
  }

  advanceCamera(teams, now) {
    if (!this.camera) this.camera = window.ShuttleRace.camera(Object.values(teams).map(t => t.position));
    const transition = this.cameraTransition;
    if (transition && !this.paused) {
      transition.elapsed += Math.max(0, Math.min(50, now - transition.lastAt));
      transition.lastAt = now;
      const t = Math.min(1, transition.elapsed / transition.duration);
      const ease = t * t * (3 - 2 * t);
      // Interpolate the affine projection, so pixel motion stays continuous.
      const fromScale = 1 / (transition.from.high - transition.from.low);
      const toScale = 1 / (transition.to.high - transition.to.low);
      const scale = fromScale + (toScale - fromScale) * ease;
      const offset = -transition.from.low * fromScale
        + (-transition.to.low * toScale + transition.from.low * fromScale) * ease;
      this.camera = { low: -offset / scale, high: (1 - offset) / scale };
      if (t === 1) this.cameraTransition = null;
    }
    const furthest = Math.max(...Object.values(teams).map(t => t.position));
    const target = this.cameraTransition?.to || this.camera;
    if (furthest <= target.high - 750 || this.paused) return;
    const to = { low: this.camera.low, high: furthest + 12000 };
    const positions = Object.values(this.presented || teams).map(t => t.position);
    const shift = Math.max(...positions.map(position => Math.abs(
      window.ShuttleRace.project(position, this.camera) - window.ShuttleRace.project(position, to)) * this.span));
    this.cameraTransition = { from: { ...this.camera }, to, lastAt: now, elapsed: 0,
      duration: Math.max(600, Math.min(6000, shift * 6)) };
  }

  animateReward() {
    if (!this.summary) return;
    const now = this.serverNow + (this.paused ? 0 : performance.now() - this.receivedAt);
    const teams = Object.fromEntries(Object.entries(this.summary.teamResults).map(([id, r]) => {
      const t = window.SummaryMotion.progress(this.summary, r.steps, now, window.GameConfig);
      const progress = this.reducedMotion.matches && now >= this.summary.movementStartedAt ? 1 : window.SummaryMotion.ease(t);
      return [id, { position: r.beforePosition + (r.position - r.beforePosition) * progress,
        speed: t > 0 && t < 1 && !this.paused ? 10 : 0, isStunned: false }];
    }));
    this.paint(teams);
    if (!this.paused && now < this.summary.readyAt) this.frame = requestAnimationFrame(() => { this.frame = null; this.animateReward(); });
  }

  paint(teams) {
    if (this.shuttle && !this.summary) {
      this.advanceCamera(teams, performance.now());
    }
    this.presented = teams;
    const ranks = window.ShuttleRace.rank(teams);
    for (const [id, data] of Object.entries(teams)) {
      const node = this.nodes.get(id);
      if (!node?.horse) continue;
      const x = this.shuttle ? window.ShuttleRace.project(data.position, this.camera) : Math.min(1, data.position / this.trackLen);
      node.horse.style.transform = `translate3d(${this.startX + x * this.span}px,0,0)`;
      node.horse.style.setProperty('--facing', 1);
      node.horse.style.setProperty('--stride', `${Math.max(.25, .55 - (data.speed || 0) / 80)}s`);
      node.horse.classList.toggle('is-running', (this.active || !!this.summary) && !data.isStunned && data.speed > .3);
      node.horse.classList.toggle('is-stunned', !!data.isStunned);
      const pct = this.shuttle ? x * 100 : Math.min(100, data.position / this.trackLen * 100);
      const setText = (el, value) => { if (el && el.textContent !== value) el.textContent = value; };
      if (node.fill) node.fill.style.width = `${pct}%`;
      setText(node.text, window.DistanceDisplay.position(data.position, window.GameConfig));
      setText(node.rank, `第 ${ranks[id]} 名`);
      setText(node.laps, window.DistanceDisplay.position(data.position, window.GameConfig));
      if (node.stun) node.stun.style.display = data.isStunned ? 'inline-block' : 'none';
      this.paintItems(id);
    }
  }

  paintItems(id) {
    const layer = document.getElementById('items-layer');
    if (!layer) return;
    const assets = { accelerator: 'item_speedboost', obstacle: 'obstacle_rock', shield: 'obstacle_fence', magnet: 'obstacle_puddle', mystery: 'item_mystery_box' };
    const lane = window.GameConfig.TEAMS.findIndex(t => t.id === id);
    for (const item of this.items?.[id] || []) {
      const fraction = this.shuttle ? window.ShuttleRace.project(item.x, this.camera) : item.x / this.trackLen;
      const visible = !item.triggered && fraction >= 0 && fraction <= 1;
      let el = this.itemsMap.get(item.id);
      if (!visible) { if (el) { el.remove(); this.itemsMap.delete(item.id); } continue; }
      if (!el) {
        el = document.createElement('img');
        el.className = 'item-dom';
        el.src = `/host/assets/${assets[item.type] || assets.mystery}.png`;
        el.alt = '';
        layer.append(el);
        this.itemsMap.set(item.id, el);
      }
      el.style.left = `${this.startX + fraction * this.span + (this.shuttle ? 110 : 90)}px`;
      el.style.top = this.shuttle ? `calc(${lane * 20 + 10}% + 38px)` : `${lane * 20 + 10}%`;
    }
  }

  removeItemDom(itemId) {
    for (const items of Object.values(this.items || {})) {
      const item = items.find(value => value.id === itemId);
      if (item) item.triggered = true;
    }
    this.itemsMap.get(itemId)?.remove();
    this.itemsMap.delete(itemId);
  }
}
window.RaceRenderer = RaceRenderer;
