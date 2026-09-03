const TeamManager = require('./TeamManager');
const PhysicsEngine = require('./PhysicsEngine');
const ItemManager = require('./ItemManager');
const CheckpointTriggerEngine = require('./CheckpointTriggerEngine');
const MapManager = require('./MapManager');
const RoundManager = require('./RoundManager');
const QuizLoader = require('../quiz/QuizLoader');
const QuizManager = require('../quiz/QuizManager');
const { SERVER_TO_CLIENT } = require('../../shared/events');
const DEFAULT_CONFIG = require('../../shared/game-config');

class GameManager {
  constructor(io) {
    this.io = io;
    this.state = 'LOBBY'; // LOBBY -> MAP_SELECT -> ROUND_LOBBY -> COUNTDOWN -> RACING -> QUIZ -> ROUND_FINISHED -> MATCH_FINISHED
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    
    this.teamManager = new TeamManager(this.config);
    this.physicsEngine = new PhysicsEngine(this.config);
    this.itemManager = new ItemManager();
    this.checkpointEngine = new CheckpointTriggerEngine();
    this.mapManager = new MapManager();
    this.roundManager = new RoundManager(this.config.totalRounds);
    this.quizLoader = new QuizLoader();
    this.quizManager = new QuizManager(this.quizLoader, this.config);

    this.loopInterval = null;
    this.lastTapTimes = new Map(); // socketId -> last timestamp (防抖)
    this.playerStats = new Map(); // socketId -> personal award statistics
    this.lastRacePacing = null;
    this.flowToken = 0;
    this.pendingQuiz = null;
    this.raceGuardInterval = null;
    this.raceStartedAt = null;
    this.finalSprintActive = false;
    this.finalSprintStartedAt = null;
    this.hardFinishAt = null;
    this.hardFinishRequested = false;
    this.isPaused = false;
    this.pausedAt = null;
    this.managedTimeouts = new Map();
    this.presentation = {
      stage: 'lobby',
      awardIndex: 0,
      revealedAwardIndexes: []
    };
  }

  setState(newState) {
    this.state = newState;
    // 當進入 RACING 或 QUIZ 或 COUNTDOWN 時鎖定加入與選隊
    const lock = (newState === 'COUNTDOWN' || newState === 'RACING' || newState === 'QUIZ');
    this.teamManager.setJoinLock(lock);
    this.broadcastStateSync();
  }

  getPresentationState() {
    return {
      stage: this.presentation.stage,
      awardIndex: this.presentation.awardIndex,
      revealedAwardIndexes: [...this.presentation.revealedAwardIndexes]
    };
  }

  setPresentationStage(stage = 'lobby') {
    const allowedStages = new Set(['lobby', 'rules', 'team-select', 'race', 'scoreboard', 'awards']);
    const nextStage = allowedStages.has(stage) ? stage : 'lobby';
    if (nextStage === 'awards' && this.state !== 'MATCH_FINISHED') return false;
    this.presentation.stage = nextStage;
    this.emitPresentationUpdate();
    return true;
  }

  emitPresentationUpdate() {
    const payload = this.getPresentationState();
    this.io.emit(SERVER_TO_CLIENT.GAME_PRESENTATION_UPDATED, payload);
    this.broadcastStateSync();
    return payload;
  }

  handleAwardAction(action = 'next') {
    if (this.state !== 'MATCH_FINISHED') return false;
    const awardsPayload = this.buildFinalAwardsPayload();
    const awardsCount = awardsPayload && Array.isArray(awardsPayload.awards)
      ? awardsPayload.awards.length
      : 0;
    if (awardsCount <= 0) return false;

    if (action === 'prev') {
      this.presentation.awardIndex = Math.max(0, this.presentation.awardIndex - 1);
    } else if (action === 'next') {
      this.presentation.awardIndex = Math.min(awardsCount - 1, this.presentation.awardIndex + 1);
    } else if (action === 'reveal') {
      const revealed = new Set(this.presentation.revealedAwardIndexes);
      revealed.add(this.presentation.awardIndex);
      this.presentation.revealedAwardIndexes = [...revealed].sort((a, b) => a - b);
    } else if (action === 'hide') {
      this.presentation.revealedAwardIndexes = this.presentation.revealedAwardIndexes
        .filter(index => index !== this.presentation.awardIndex);
    } else {
      return false;
    }

    this.presentation.stage = 'awards';
    this.emitPresentationUpdate();
    return true;
  }

  broadcastStateSync() {
    this.io.emit(SERVER_TO_CLIENT.GAME_STATE_SYNC, this.getGameState());
  }

  getGameState() {
    const map = this.mapManager.getCurrentMap();
    const matchStatus = this.roundManager.getMatchStatus();
    return {
      state: this.state,
      roundStatus: matchStatus,
      finalWinner: this.state === 'MATCH_FINISHED' ? this.roundManager.getFinalWinner() : null,
      finalAwards: this.state === 'MATCH_FINISHED' ? this.buildFinalAwardsPayload() : null,
      currentMap: {
        id: map.id,
        name: map.name,
        trackLength: map.track ? map.track.length : 1000,
        checkpoints: map.checkpoints || []
      },
      teams: this.teamManager.getAllTeamsInfo(),
      activeItems: this.itemManager.getActiveItems(),
      players: Array.from(this.teamManager.players.values()).map(player => this.getPublicPlayer(player)),
      totalPlayers: this.teamManager.players.size,
      racePacing: this.lastRacePacing,
      finalSprint: this.getFinalSprintState(),
      paused: this.isPaused,
      pausedAt: this.pausedAt,
      presentation: this.getPresentationState(),
      config: this.config
    };
  }

  getPublicPlayer(player) {
    if (!player) return null;
    return {
      socketId: player.socketId,
      nickname: player.nickname,
      avatar: player.avatar,
      teamId: player.teamId,
      joinedAt: player.joinedAt,
      connected: player.connected !== false
    };
  }

  getRacePacingConfig() {
    return {
      enabled: true,
      targetGameSeconds: 390,
      targetQuizCount: 10,
      expectedPlayers: 150,
      triggerFrequencyPercent: 9,
      expectedTapRatePerPlayer: 5,
      expectedQuizBoostPx: this.config.quizThresholds.LARGE_BOOST,
      quizPrepareSeconds: 3,
      quizResultSeconds: 3,
      finalTransitionSeconds: 5,
      minTrackLength: 30000,
      maxTrackLength: 220000,
      ...(this.config.racePacing || {})
    };
  }

  getFinalSprintConfig() {
    return {
      enabled: true,
      startAfterSeconds: 540,
      hardFinishAfterSeconds: 600,
      tapBoostMultiplier: 2,
      initialTeamSpeed: 10,
      checkpointCatchupBufferSeconds: 3,
      ...(this.config.finalSprint || {})
    };
  }

  getFinalSprintState() {
    const referenceNow = this.isPaused && this.pausedAt ? this.pausedAt : Date.now();
    const remainingSeconds = this.hardFinishAt
      ? Math.max(0, Math.ceil((this.hardFinishAt - referenceNow) / 1000))
      : null;
    return {
      active: this.finalSprintActive,
      raceStartedAt: this.raceStartedAt,
      startedAt: this.finalSprintStartedAt,
      hardFinishAt: this.hardFinishAt,
      remainingSeconds,
      hardFinishRequested: this.hardFinishRequested
    };
  }

  clearRaceGuard(resetState = true) {
    if (this.raceGuardInterval) {
      clearInterval(this.raceGuardInterval);
      this.raceGuardInterval = null;
    }
    if (resetState) {
      this.raceStartedAt = null;
      this.finalSprintActive = false;
      this.finalSprintStartedAt = null;
      this.hardFinishAt = null;
      this.hardFinishRequested = false;
    }
  }

  startRaceGuardInterval(flowToken = this.flowToken) {
    if (this.raceGuardInterval) clearInterval(this.raceGuardInterval);
    this.raceGuardInterval = setInterval(() => {
      this.evaluateRaceGuard(flowToken);
    }, 500);
  }

  clearManagedTimeout(key) {
    const entry = this.managedTimeouts.get(key);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this.managedTimeouts.delete(key);
    return true;
  }

  clearAllManagedTimeouts() {
    for (const entry of this.managedTimeouts.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.managedTimeouts.clear();
  }

  armManagedTimeout(entry) {
    if (!entry || this.isPaused) return;
    entry.dueAt = Date.now() + entry.remainingMs;
    entry.timer = setTimeout(() => {
      this.managedTimeouts.delete(entry.key);
      entry.timer = null;
      entry.callback();
    }, entry.remainingMs);
  }

  scheduleManagedTimeout(key, callback, delayMs) {
    this.clearManagedTimeout(key);
    const entry = {
      key,
      callback,
      timer: null,
      dueAt: null,
      remainingMs: Math.max(0, Number(delayMs) || 0)
    };
    this.managedTimeouts.set(key, entry);
    this.armManagedTimeout(entry);
    return entry;
  }

  pauseManagedTimeouts(now = Date.now()) {
    for (const entry of this.managedTimeouts.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      if (entry.dueAt) entry.remainingMs = Math.max(0, entry.dueAt - now);
      entry.dueAt = null;
    }
  }

  resumeManagedTimeouts() {
    for (const entry of this.managedTimeouts.values()) this.armManagedTimeout(entry);
  }

  pauseGame() {
    const pausableStates = new Set(['COUNTDOWN', 'RACING', 'QUIZ', 'ROUND_FINISHED']);
    if (this.isPaused || !pausableStates.has(this.state)) return false;

    const now = Date.now();
    this.isPaused = true;
    this.pausedAt = now;
    this.stopLoop();
    this.clearRaceGuard(false);
    this.pauseManagedTimeouts(now);
    this.quizManager.pauseTimer(now);
    const payload = { pausedAt: now, state: this.state };
    this.io.emit(SERVER_TO_CLIENT.GAME_PAUSED, payload);
    this.broadcastStateSync();
    return payload;
  }

  resumeGame(now = Date.now()) {
    if (!this.isPaused || !this.pausedAt) return false;

    const pausedDuration = Math.max(0, now - this.pausedAt);
    if (this.raceStartedAt) this.raceStartedAt += pausedDuration;
    if (this.finalSprintStartedAt) this.finalSprintStartedAt += pausedDuration;
    if (this.hardFinishAt) this.hardFinishAt += pausedDuration;
    if (this.pendingQuiz && this.pendingQuiz.prepareEndsAt) {
      this.pendingQuiz.prepareEndsAt += pausedDuration;
    }
    for (const team of Object.values(this.teamManager.teams)) {
      if (team.stunUntil) team.stunUntil += pausedDuration;
    }
    this.checkpointEngine.shiftTimeline(pausedDuration);

    this.isPaused = false;
    this.pausedAt = null;
    this.quizManager.resumeTimer(now);
    this.resumeManagedTimeouts();
    if (this.raceStartedAt && this.getFinalSprintConfig().enabled) {
      this.startRaceGuardInterval(this.flowToken);
    }
    if (this.state === 'RACING') this.startLoop();

    const payload = { resumedAt: now, pausedDuration, state: this.state };
    this.io.emit(SERVER_TO_CLIENT.GAME_RESUMED, payload);
    this.broadcastStateSync();
    return payload;
  }

  beginRaceGuard(flowToken = this.flowToken) {
    this.clearRaceGuard();
    const config = this.getFinalSprintConfig();
    if (!config.enabled) return;

    const startAfterSeconds = Math.max(1, Number(config.startAfterSeconds) || 540);
    const hardFinishAfterSeconds = Math.max(startAfterSeconds + 1, Number(config.hardFinishAfterSeconds) || 600);
    this.raceStartedAt = Date.now();
    this.hardFinishAt = this.raceStartedAt + hardFinishAfterSeconds * 1000;
    this.startRaceGuardInterval(flowToken);
  }

  getCheckpointFlowSeconds(checkpoint) {
    const quiz = checkpoint && checkpoint.quizId
      ? this.quizLoader.getQuizById(checkpoint.quizId)
      : null;
    const requested = Number(
      (checkpoint && checkpoint.timeLimit) ||
      (quiz && quiz.timeLimit) ||
      this.config.quizTimeLimit ||
      10
    );
    const answerSeconds = Math.max(1, Number.isFinite(requested) ? requested : 10);
    return this.getQuizPrepareSeconds() + answerSeconds + this.getQuizResultSeconds();
  }

  getRemainingCheckpointFlowSeconds() {
    return this.checkpointEngine.getUntriggeredCheckpoints()
      .reduce((total, checkpoint) => total + this.getCheckpointFlowSeconds(checkpoint), 0);
  }

  shouldForceCheckpointCatchup(now = Date.now()) {
    if (this.state !== 'RACING' || !this.hardFinishAt) return false;
    const remaining = this.getRemainingCheckpointFlowSeconds();
    if (remaining <= 0) return false;
    const buffer = Math.max(0, Number(this.getFinalSprintConfig().checkpointCatchupBufferSeconds) || 0);
    const secondsUntilHardFinish = Math.max(0, (this.hardFinishAt - now) / 1000);
    return this.finalSprintActive || secondsUntilHardFinish <= remaining + buffer;
  }

  activateFinalSprint(flowToken = this.flowToken, now = Date.now()) {
    if (this.flowToken !== flowToken || this.finalSprintActive) return false;
    if (this.state !== 'RACING' && this.state !== 'QUIZ') return false;

    const config = this.getFinalSprintConfig();
    this.finalSprintActive = true;
    this.finalSprintStartedAt = now;
    const minimumSpeed = Math.max(0, Number(config.initialTeamSpeed) || 0);
    for (const team of Object.values(this.teamManager.teams)) {
      team.isStunned = false;
      team.stunUntil = 0;
      team.speed = Math.max(team.speed, minimumSpeed);
    }

    const payload = {
      startedAt: this.finalSprintStartedAt,
      hardFinishAt: this.hardFinishAt,
      durationSeconds: Math.max(0, Math.ceil((this.hardFinishAt - now) / 1000)),
      tapBoostMultiplier: Math.max(1, Number(config.tapBoostMultiplier) || 1)
    };
    this.broadcastStateSync();
    this.io.emit(SERVER_TO_CLIENT.GAME_FINAL_SPRINT, payload);
    return true;
  }

  forceNextScheduledCheckpoint() {
    if (this.state !== 'RACING') return false;
    const checkpoint = this.checkpointEngine.takeNextUntriggeredCheckpoint();
    if (!checkpoint) return false;
    return this.triggerQuiz(checkpoint.quizId || null, checkpoint.timeLimit);
  }

  getDeadlineLeader() {
    const ranked = Object.values(this.teamManager.teams)
      .map(team => ({ id: team.id, position: Number(team.position) || 0 }))
      .sort((a, b) => b.position - a.position);
    if (ranked.length === 0) return 'tie';
    if (ranked.length > 1 && Math.abs(ranked[0].position - ranked[1].position) < 0.5) return 'tie';
    return ranked[0].id;
  }

  finishAtRaceDeadline() {
    if (this.state !== 'RACING' || !this.checkpointEngine.hasTriggeredAll()) return false;
    this.finishRound(this.getDeadlineLeader(), 'time_limit');
    return true;
  }

  evaluateRaceGuard(flowToken = this.flowToken, now = Date.now()) {
    if (this.flowToken !== flowToken) return false;
    if (this.isPaused) return false;
    if (this.state !== 'RACING' && this.state !== 'QUIZ') return false;

    const config = this.getFinalSprintConfig();
    const sprintAt = this.raceStartedAt + Math.max(1, Number(config.startAfterSeconds) || 540) * 1000;
    if (!this.finalSprintActive && this.raceStartedAt && now >= sprintAt) {
      this.activateFinalSprint(flowToken, now);
    }

    if (this.hardFinishAt && now >= this.hardFinishAt) {
      this.hardFinishRequested = true;
    }

    if (this.state === 'RACING' && this.shouldForceCheckpointCatchup(now)) {
      return this.forceNextScheduledCheckpoint();
    }

    if (this.hardFinishRequested && this.state === 'RACING') {
      if (!this.checkpointEngine.hasTriggeredAll()) {
        return this.forceNextScheduledCheckpoint();
      }
      return this.finishAtRaceDeadline();
    }
    return false;
  }

  getQuizPrepareSeconds() {
    const seconds = Number(this.getRacePacingConfig().quizPrepareSeconds);
    return Math.max(0, Number.isFinite(seconds) ? seconds : 3);
  }

  getQuizResultSeconds() {
    const seconds = Number(this.getRacePacingConfig().quizResultSeconds);
    return Math.max(0, Number.isFinite(seconds) ? seconds : 3);
  }

  getFinalTransitionSeconds() {
    const seconds = Number(this.getRacePacingConfig().finalTransitionSeconds);
    return Math.max(0, Number.isFinite(seconds) ? seconds : 5);
  }

  estimateTeamSpeedPxPerSecond(teamSize) {
    const frameSeconds = Math.max(0.001, Number(this.config.positionUpdateRate || 33) / 1000);
    const friction = Math.max(0, Math.min(0.99, Number(this.config.friction || 0.95)));
    const baseBoost = Math.max(0.01, Number(this.config.baseBoost || 0.5));
    const maxSpeed = Math.max(1, Number(this.config.maxSpeed || 20));
    const pacing = this.getRacePacingConfig();
    const tapRate = Math.max(0.5, Number(pacing.expectedTapRatePerPlayer || 5));
    const size = Math.max(1, Number(teamSize || 1));
    const tapsPerFrame = tapRate * size * frameSeconds;
    const boostPerTap = baseBoost / Math.sqrt(size);
    const steadySpeedPerFrame = Math.min(maxSpeed, (tapsPerFrame * boostPerTap) / (1 - friction));
    return steadySpeedPerFrame / frameSeconds;
  }

  getCurrentFastestTeamSize() {
    const sizes = Object.values(this.teamManager.teams).map(team => team.members.size || 0);
    const maxSize = Math.max(...sizes, 0);
    if (maxSize > 0) return maxSize;
    const teamCount = Math.max(1, Object.keys(this.teamManager.teams).length || this.config.teamsCount || 5);
    return Math.max(1, Math.ceil((this.teamManager.players.size || 0) / teamCount));
  }

  calculateRecommendedTrackLength(map) {
    const pacing = this.getRacePacingConfig();
    const quizCount = Array.isArray(map && map.checkpoints)
      ? map.checkpoints.length
      : Number(pacing.targetQuizCount || 10);
    const targetGameSeconds = Math.max(60, Number(pacing.targetGameSeconds || 390));
    const checkpoints = Array.isArray(map && map.checkpoints) ? map.checkpoints : [];
    const quizSeconds = checkpoints.reduce((total, checkpoint) => {
      const quiz = checkpoint && checkpoint.quizId
        ? this.quizLoader.getQuizById(checkpoint.quizId)
        : null;
      const seconds = Number(
        (checkpoint && checkpoint.timeLimit) ||
        (quiz && quiz.timeLimit) ||
        this.config.quizTimeLimit ||
        10
      );
      return total + Math.max(1, Number.isFinite(seconds) ? seconds : 10);
    }, 0);
    const overheadSeconds =
      Math.max(0, Number(this.config.countdownSeconds || 0)) +
      this.getFinalTransitionSeconds() +
      quizCount * (this.getQuizPrepareSeconds() + this.getQuizResultSeconds()) +
      (checkpoints.length > 0 ? quizSeconds : quizCount * Math.max(1, Number(this.config.quizTimeLimit || 10)));
    const targetRacingSeconds = Math.max(60, targetGameSeconds - overheadSeconds);
    const fastestTeamSize = this.getCurrentFastestTeamSize();
    const speedPxPerSecond = this.estimateTeamSpeedPxPerSecond(fastestTeamSize);
    const expectedQuizBoost = quizCount * Math.max(0, Number(pacing.expectedQuizBoostPx || 0));
    const rawLength = Math.round(targetRacingSeconds * speedPxPerSecond + expectedQuizBoost);
    const minLength = Math.max(1000, Number(pacing.minTrackLength || 30000));
    const maxLength = Math.max(minLength, Number(pacing.maxTrackLength || 220000));

    return {
      trackLength: Math.max(minLength, Math.min(maxLength, rawLength)),
      targetGameSeconds,
      targetRacingSeconds,
      estimatedSpeedPxPerSecond: Math.round(speedPxPerSecond),
      fastestTeamSize,
      totalPlayers: this.teamManager.players.size,
      quizCount,
      overheadSeconds
    };
  }

  applyRacePacing(map) {
    const pacing = this.getRacePacingConfig();
    if (!pacing.enabled || !map || !map.track) {
      this.lastRacePacing = null;
      return null;
    }

    const recommendation = this.calculateRecommendedTrackLength(map);
    map.track.length = recommendation.trackLength;
    this.config.trackLength = recommendation.trackLength;
    this.lastRacePacing = {
      ...recommendation,
      expectedTapRatePerPlayer: Number(pacing.expectedTapRatePerPlayer || 5)
    };
    return this.lastRacePacing;
  }

  // 主持人選擇地圖
  selectMap(mapId) {
    if (this.state !== 'LOBBY' && this.state !== 'MAP_SELECT' && this.state !== 'ROUND_LOBBY') return false;
    const success = this.mapManager.selectMap(mapId);
    if (success) {
      this.io.emit(SERVER_TO_CLIENT.GAME_MAP_SELECTED, this.mapManager.getCurrentMap());
      this.broadcastStateSync();
    }
    return success;
  }

  // 主持人開始局
  startRound() {
    if (this.state !== 'LOBBY' && this.state !== 'ROUND_LOBBY' && this.state !== 'MAP_SELECT') return false;
    const flowToken = ++this.flowToken;
    this.clearAllManagedTimeouts();
    this.clearRaceGuard();
    this.isPaused = false;
    this.pausedAt = null;
    this.presentation.stage = 'race';
    this.presentation.awardIndex = 0;
    this.presentation.revealedAwardIndexes = [];
    
    // 自動將未選隊的賓客均衡分配
    const assignmentResult = this.teamManager.autoAssignUnselectedPlayers() || {};
    const assignments = Array.isArray(assignmentResult.assignments) ? assignmentResult.assignments : [];
    for (const assignment of assignments) {
      this.upsertPlayerStats(assignment.player);
      this.emitToSocket(assignment.socketId, SERVER_TO_CLIENT.GAME_TEAM_ASSIGNED, {
        teamId: assignment.teamId,
        player: this.getPublicPlayer(assignment.player)
      });
      this.emitPlayerStatus(assignment.socketId);
    }
    if (Number(assignmentResult.count || assignments.length) > 0) {
      this.io.emit(SERVER_TO_CLIENT.GAME_TEAM_UPDATED, {
        teams: this.teamManager.getAllTeamsInfo(),
        totalPlayers: this.teamManager.players.size
      });
    }

    const map = this.mapManager.getCurrentMap();
    this.applyRacePacing(map);
    console.log(`[GameManager] startRound. Map: ${map.name}, checkpoints: ${map.checkpoints ? map.checkpoints.length : 0}`);
    this.teamManager.resetRoundPositions();
    this.itemManager.generateTrackItems(map);
    this.checkpointEngine.initCheckpoints(map.checkpoints);

    this.setState('COUNTDOWN');

    this.scheduleManagedTimeout('countdown', () => {
      if (this.flowToken === flowToken && this.state === 'COUNTDOWN') {
        this.beginRaceGuard(flowToken);
        this.setState('RACING');
        this.startLoop();
      }
    }, this.config.countdownSeconds * 1000);

    return true;
  }

  startLoop() {
    if (this.isPaused) return;
    if (this.loopInterval) clearInterval(this.loopInterval);
    this.loopInterval = setInterval(() => {
      this.update();
    }, this.config.positionUpdateRate);
  }

  stopLoop() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }

  update() {
    if (this.state !== 'RACING' || this.isPaused) return;

    const teams = this.teamManager.teams;

    // 動態對所有隊伍執行物理計算
    for (const team of Object.values(teams)) {
      this.physicsEngine.updateTeamPhysics(team);
    }

    const map = this.mapManager.getCurrentMap();
    const trackLen = map.track ? map.track.length : 1000;

    // 檢查道具碰撞（所有隊伍）
    const onCollision = (teamId, itemType, effect, itemDef) => {
      this.io.emit(SERVER_TO_CLIENT.GAME_ITEM_TRIGGERED, { teamId, itemType, effect, itemDef });
    };
    for (const [teamId, team] of Object.entries(teams)) {
      this.itemManager.checkCollisions(teamId, team.position, team, onCollision);
    }

    // 檢查關卡自動觸發
    const cp = this.checkpointEngine.checkTriggers(teams, trackLen);
    if (cp) {
      this.triggerQuiz(cp.quizId || null, cp.timeLimit);
      return;
    }

    // 檢查終點衝線（動態找出最先到達的隊伍）
    let finisher = null;
    let maxPos = 0;
    for (const [teamId, team] of Object.entries(teams)) {
      if (team.position >= trackLen && team.position > maxPos) {
        maxPos = team.position;
        finisher = teamId;
      }
    }
    if (finisher) {
      this.finishRound(finisher);
      return;
    }

    // 廣播高頻位置更新（動態包含所有隊伍）
    const teamsUpdate = {};
    for (const [teamId, team] of Object.entries(teams)) {
      teamsUpdate[teamId] = {
        position: Math.round(team.position),
        speed: Math.round(team.speed * 10) / 10,
        isStunned: team.isStunned
      };
    }
    this.io.emit(SERVER_TO_CLIENT.GAME_POSITION_UPDATE, { teams: teamsUpdate });
  }

  handleTap(socketId, timestamp) {
    const reject = (reason) => ({
      success: false,
      reason,
      status: this.buildPlayerStatus(socketId)
    });
    if (this.isPaused) return reject('GAME_PAUSED');
    if (this.state !== 'RACING') return reject('NOT_RACING');
    
    // 檢查冷卻 (防刷)
    const now = Date.now();
    const lastTap = this.lastTapTimes.get(socketId) || 0;
    if (now - lastTap < this.config.tapCooldown) return reject('TAP_COOLDOWN');
    this.lastTapTimes.set(socketId, now);

    const player = this.teamManager.getPlayer(socketId);
    if (!player || !player.teamId) return reject('NOT_JOINED');

    const team = this.teamManager.getTeam(player.teamId);
    if (!team) return reject('INVALID_TEAM');

    if (team.isStunned) return reject('TEAM_STUNNED');

    const sprintMultiplier = this.finalSprintActive
      ? Math.max(1, Number(this.getFinalSprintConfig().tapBoostMultiplier) || 1)
      : 1;
    const stat = this.getOrCreatePlayerStats(socketId);
    const nextTapCount = (stat ? stat.tapCount : 0) + 1;
    const critical = nextTapCount % 20 === 0;
    const criticalMultiplier = critical ? 2 : 1;
    const boost = this.physicsEngine.calculateBoost(
      team.members.size,
      Number(this.config.baseBoost || 0.5) * sprintMultiplier * criticalMultiplier
    );
    team.speed += boost;
    this.checkpointEngine.recordTap();
    this.recordPlayerTap(socketId);
    const status = this.buildPlayerStatus(socketId);
    return {
      success: true,
      critical,
      multiplier: sprintMultiplier * criticalMultiplier,
      boost,
      timestamp: Number(timestamp) || now,
      status
    };
  }

  // 觸發答題 (由關卡設計)
  triggerQuiz(quizId, timeLimit = null) {
    if (this.state !== 'RACING' || this.isPaused) return false;
    const flowToken = this.flowToken;
    console.log(`[GameManager] triggerQuiz called for quizId: ${quizId}`);
    this.stopLoop();
    this.setState('QUIZ');

    // 廣播 3 秒準備倒數
    const prepareSeconds = this.getQuizPrepareSeconds();
    this.pendingQuiz = {
      quizId,
      timeLimit,
      prepareEndsAt: Date.now() + prepareSeconds * 1000
    };
    this.io.emit(SERVER_TO_CLIENT.GAME_QUIZ_PREPARE, { seconds: prepareSeconds });

    this.scheduleManagedTimeout('quiz-prepare', () => {
      // 若狀態已經改變（例如管理員強制重置），則中斷
      if (this.flowToken !== flowToken || this.state !== 'QUIZ') return;

      const teams = this.teamManager.teams;
      const teamSizes = {};
      for (const tid of Object.keys(teams)) {
        teamSizes[tid] = teams[tid].members.size;
      }
      const qData = this.quizManager.startQuiz(quizId, teamSizes, (results) => {
        this.handleQuizResults(results, flowToken);
      }, timeLimit);

      if (!qData) {
        // 找不到題目則直接恢復比賽
        if (this.flowToken !== flowToken) return;
        this.pendingQuiz = null;
        this.setState('RACING');
        this.startLoop();
        return;
      }

      this.pendingQuiz = null;
      this.quizManager.markAnswerWindowOpened();

      // 分屏廣播：Host 收到題目、選項與倒數
      this.io.emit(SERVER_TO_CLIENT.GAME_QUIZ_START, {
        quizId: qData.quizId,
        question: qData.question,
        options: qData.optionList || qData.options,
        timeLimit: qData.timeLimit
      });

      // Guest 只收到選項 A/B/C/D 與倒數 (無題目文字)
      this.io.emit(SERVER_TO_CLIENT.GAME_QUIZ_OPTIONS, {
        quizId: qData.quizId,
        options: qData.optionMap || qData.options,
        timeLimit: qData.timeLimit
      });
    }, prepareSeconds * 1000);
    return true;
  }

  handleQuizAnswer(socketId, quizId, answerStr) {
    if (this.isPaused) return { success: false, reason: 'GAME_PAUSED' };
    if (this.state !== 'QUIZ') return { success: false, reason: 'NOT_IN_QUIZ' };
    const player = this.teamManager.getPlayer(socketId);
    if (!player || !player.teamId) return { success: false, reason: 'NOT_JOINED' };
    const teamId = player.teamId;
    const result = this.quizManager.handleAnswer(socketId, teamId, quizId, answerStr);
    if (result && result.success) {
      this.recordPlayerQuizResult(socketId, result.isCorrect, result.answerTimeMs);
      if (result.teamProgress) {
        this.io.emit(SERVER_TO_CLIENT.GAME_QUIZ_PROGRESS, result.teamProgress);
      }
    }
    return result;
  }

  handleQuizResults(results, flowToken = this.flowToken) {
    // 狀態防護：若已經被重置為 LOBBY，則忽略此結果
    if (this.state !== 'QUIZ') return;

    if (this.flowToken !== flowToken || this.state !== 'QUIZ') return;

    this.pendingQuiz = null;
    if (!results) {
      this.setState('RACING');
      this.startLoop();
      return;
    }

    this.io.emit(SERVER_TO_CLIENT.GAME_QUIZ_RESULT, results);

    // 套用答題獎懲
    const teams = this.teamManager.teams;
    for (const teamId of Object.keys(teams)) {
      const res = results.teamResults[teamId];
      if (!res) continue;
      
      if (res.effect === 'large_boost' || res.effect === 'small_boost') {
        teams[teamId].position += res.val;
      } else if (res.effect === 'stun') {
        teams[teamId].isStunned = true;
        teams[teamId].stunUntil = Date.now() + res.val;
      }
    }

    // 3 秒展示結果後繼續跑
    this.scheduleManagedTimeout('quiz-result', () => {
      if (this.flowToken === flowToken && this.state === 'QUIZ') {
        this.setState('RACING');
        this.evaluateRaceGuard(flowToken);
        if (this.state === 'RACING') this.startLoop();
      }
    }, this.getQuizResultSeconds() * 1000);
  }

  finishRound(winnerTeamId, finishReason = 'finish_line') {
    const flowToken = this.flowToken;
    this.stopLoop();
    this.clearRaceGuard();
    this.presentation.stage = 'scoreboard';
    this.setState('ROUND_FINISHED');

    const roundInfo = this.roundManager.recordRoundWinner(winnerTeamId);
    this.io.emit(SERVER_TO_CLIENT.GAME_ROUND_FINISHED, {
      roundInfo,
      finishReason,
      matchStatus: this.roundManager.getMatchStatus()
    });

    // 檢查目前設定的賽制是否完成
    if (this.roundManager.isMatchFinished()) {
      this.scheduleManagedTimeout('match-transition', () => {
        if (this.flowToken !== flowToken || this.state !== 'ROUND_FINISHED') return;
        this.presentation.stage = 'awards';
        this.presentation.awardIndex = 0;
        this.presentation.revealedAwardIndexes = [];
        this.setState('MATCH_FINISHED');
        this.io.emit(SERVER_TO_CLIENT.GAME_MATCH_FINISHED, {
          finalWinner: this.roundManager.getFinalWinner(),
          matchStatus: this.roundManager.getMatchStatus(),
          finalAwards: this.buildFinalAwardsPayload()
        });
      }, this.getFinalTransitionSeconds() * 1000);
    } else {
      // 5 秒後自動進入下局的大廳 (ROUND_LOBBY)
      this.scheduleManagedTimeout('round-transition', () => {
        if (this.flowToken !== flowToken || this.state !== 'ROUND_FINISHED') return;
        this.setState('ROUND_LOBBY');
        this.io.emit(SERVER_TO_CLIENT.GAME_ROUND_LOBBY, {
          nextRound: this.roundManager.currentRound + 1,
          canJoin: true // 解鎖加入
        });
      }, 5000);
    }
  }

  nextRound() {
    if (this.state !== 'ROUND_FINISHED' && this.state !== 'ROUND_LOBBY') return false;
    if (this.roundManager.nextRound()) {
      this.setState('ROUND_LOBBY');
      return true;
    }
    return false;
  }

  resetGame() {
    this.flowToken++;
    this.stopLoop();
    this.clearAllManagedTimeouts();
    this.clearRaceGuard();
    this.quizManager.cancelQuiz(); // 確保中斷進行中的答題計時
    this.roundManager.reset();
    this.lastTapTimes.clear();
    this.playerStats.clear();
    this.lastRacePacing = null;
    this.pendingQuiz = null;
    this.isPaused = false;
    this.pausedAt = null;
    this.presentation = {
      stage: 'lobby',
      awardIndex: 0,
      revealedAwardIndexes: []
    };
    this.teamManager.resetAllPlayersAndTeams();
    this.setState('LOBBY');
    return true;
  }

  updateConfig(newConfig) {
    if (!newConfig) return false;
    if (newConfig.trackLength) {
      this.config.trackLength = Number(newConfig.trackLength);
      const map = this.mapManager.getCurrentMap();
      if (map && map.track) {
        map.track.length = this.config.trackLength;
      }
    }
    if (newConfig.teamNames) {
      this.config.teamNames = { ...(this.config.teamNames || {}), ...newConfig.teamNames };
      if (Array.isArray(this.config.TEAMS)) {
        this.config.TEAMS.forEach((team) => {
          if (this.config.teamNames[team.id]) {
            team.name = this.config.teamNames[team.id];
          }
        });
      }
      this.teamManager.updateTeamNames(newConfig.teamNames);
    }
    if (newConfig.quizTimeLimit) this.config.quizTimeLimit = Number(newConfig.quizTimeLimit);
    if (newConfig.baseBoost) this.config.baseBoost = Number(newConfig.baseBoost);
    if (newConfig.maxSpeed) this.config.maxSpeed = Number(newConfig.maxSpeed);
    if (newConfig.tapCooldown) this.config.tapCooldown = Number(newConfig.tapCooldown);
    if (newConfig.maxPlayersPerTeam) {
      this.config.maxPlayersPerTeam = Math.max(1, Math.floor(Number(newConfig.maxPlayersPerTeam)));
    }
    if (newConfig.totalRounds) {
      this.config.totalRounds = Number(newConfig.totalRounds);
      this.roundManager.totalRounds = this.config.totalRounds;
    }
    if (newConfig.racePacing && typeof newConfig.racePacing === 'object') {
      this.config.racePacing = {
        ...(this.config.racePacing || {}),
        ...newConfig.racePacing
      };
    }
    if (newConfig.finalSprint && typeof newConfig.finalSprint === 'object') {
      this.config.finalSprint = {
        ...(this.config.finalSprint || {}),
        ...newConfig.finalSprint
      };
    }
    this.broadcastStateSync();
    this.io.emit(SERVER_TO_CLIENT.ADMIN_CONFIG_UPDATED, this.config);
    return true;
  }

  startBotSimulation(count = 50) {
    this.stopBotSimulation();
    this.simBots = [];
    this.botAnswered = new Set();

    const avatars = ['🥳', '😎', '😻', '👑', '🚀', '🍻', '💖', '🔥'];
    const teamIds = Object.keys(this.teamManager.teams);
    for (let i = 0; i < count; i++) {
      const socketId = `bot_${Date.now()}_${i}`;
      const nickname = `熱情賓客_${i + 1}`;
      const avatar = avatars[i % avatars.length];
      const teamId = teamIds[i % teamIds.length];

      const oldLock = this.teamManager.isJoinLocked;
      this.teamManager.setJoinLock(false);
      this.teamManager.addPlayer(socketId, nickname, avatar);
      this.teamManager.chooseTeam(socketId, teamId);
      this.upsertPlayerStats(this.teamManager.getPlayer(socketId));
      this.teamManager.setJoinLock(oldLock);

      this.simBots.push({ socketId, nickname, teamId });
    }

    this.broadcastStateSync();

    this.botInterval = setInterval(() => {
      if (this.state === 'RACING') {
        this.botAnswered.clear();
        for (const bot of this.simBots) {
          if (Math.random() > 0.2) {
            this.handleTap(bot.socketId, Date.now());
          }
        }
      } else if (this.state === 'QUIZ') {
        const currentQuizId = this.quizManager.currentQuiz ? this.quizManager.currentQuiz.id : null;
        if (currentQuizId && this.botAnswered.size < this.simBots.length) {
          for (const bot of this.simBots) {
            if (!this.botAnswered.has(bot.socketId) && Math.random() > 0.7) {
              this.botAnswered.add(bot.socketId);
              const opts = ['A', 'B', 'C', 'D'];
              const randomOpt = opts[Math.floor(Math.random() * opts.length)];
              this.handleQuizAnswer(bot.socketId, currentQuizId, randomOpt);
            }
          }
        }
      }
    }, 150);

    return { success: true, count: this.simBots.length };
  }

  stopBotSimulation() {
    if (this.botInterval) {
      clearInterval(this.botInterval);
      this.botInterval = null;
    }
    if (this.simBots && this.simBots.length > 0) {
      for (const bot of this.simBots) {
        this.teamManager.removePlayer(bot.socketId);
        this.playerStats.delete(bot.socketId);
      }
      this.simBots = [];
    }
    this.broadcastStateSync();
    return { success: true };
  }

  forceTriggerQuiz(quizId, timeLimit = null) {
    if (this.state !== 'RACING' || this.isPaused) return false;
    return this.triggerQuiz(quizId || null, timeLimit);
  }

  forceTriggerItem(teamId, itemType = 'large_boost') {
    if (this.state !== 'RACING' || this.isPaused) return false;
    const teams = this.teamManager.teams;
    if (!teams[teamId]) return false;

    let effect = 'small_boost';
    if (itemType === 'large_boost') {
      effect = 'large_boost';
      teams[teamId].position += this.config.quizThresholds.LARGE_BOOST;
    } else if (itemType === 'stun') {
      effect = 'stun';
      teams[teamId].isStunned = true;
      teams[teamId].stunUntil = Date.now() + this.config.stunDuration;
    } else {
      teams[teamId].position += this.config.quizThresholds.SMALL_BOOST;
    }

    this.io.emit(SERVER_TO_CLIENT.GAME_ITEM_TRIGGERED, {
      teamId,
      itemType,
      effect,
      itemDef: { name: '後台上帝指令', icon: '⚡' }
    });
    return true;
  }

  emitToSocket(socketId, eventName, payload) {
    if (this.io && typeof this.io.to === 'function') {
      this.io.to(socketId).emit(eventName, payload);
      return true;
    }
    return false;
  }

  getTeamRanking() {
    const map = this.mapManager.getCurrentMap();
    const trackLength = Math.max(1, Number(map && map.track && map.track.length) || 1000);
    return Object.values(this.teamManager.teams)
      .map(team => ({
        id: team.id,
        name: team.name,
        hex: team.hex,
        memberCount: team.members.size,
        position: Math.round(Number(team.position) || 0),
        progressPercent: Math.min(100, Math.max(0, (Number(team.position) || 0) / trackLength * 100)),
        isStunned: !!team.isStunned
      }))
      .sort((a, b) => b.position - a.position)
      .map((team, index) => ({ ...team, rank: index + 1 }));
  }

  buildPlayerStatus(socketId) {
    const player = this.teamManager.getPlayer(socketId);
    const stat = this.getOrCreatePlayerStats(socketId);
    const ranking = this.getTeamRanking();
    const team = player && player.teamId
      ? ranking.find(item => item.id === player.teamId)
      : null;
    const tapCount = stat ? stat.tapCount || 0 : 0;
    const remainder = tapCount % 20;
    return {
      joined: !!player,
      teamId: player ? player.teamId : null,
      tapCount,
      nextCriticalIn: remainder === 0 ? 20 : 20 - remainder,
      teamRank: team ? team.rank : null,
      teamProgressPercent: team ? team.progressPercent : 0,
      teams: ranking,
      paused: this.isPaused,
      finalSprint: this.getFinalSprintState()
    };
  }

  emitPlayerStatus(socketId) {
    return this.emitToSocket(
      socketId,
      SERVER_TO_CLIENT.GAME_PLAYER_STATUS,
      this.buildPlayerStatus(socketId)
    );
  }

  stopGameLoop() {
    this.stopLoop();
    this.stopBotSimulation();
  }

  // 清理斷線玩家的防抖記錄（防止記憶體洩漏）
  cleanupDisconnectedPlayer(socketId, removeStats = false) {
    this.lastTapTimes.delete(socketId);
    if (removeStats) this.playerStats.delete(socketId);
  }

  migratePlayerConnection(previousSocketId, socketId) {
    if (!previousSocketId || !socketId || previousSocketId === socketId) return false;
    if (this.lastTapTimes.has(previousSocketId)) {
      this.lastTapTimes.set(socketId, this.lastTapTimes.get(previousSocketId));
      this.lastTapTimes.delete(previousSocketId);
    }
    if (this.playerStats.has(previousSocketId)) {
      const stat = this.playerStats.get(previousSocketId);
      this.playerStats.delete(previousSocketId);
      stat.socketId = socketId;
      this.playerStats.set(socketId, stat);
    }
    this.quizManager.migrateAnswerIdentity(previousSocketId, socketId);
    return true;
  }

  emitActiveQuizRecovery(socket, role = 'guest') {
    if (!socket || this.state !== 'QUIZ') return false;
    const activeQuiz = this.quizManager.getRecoveryPayload();
    if (activeQuiz) {
      if (role === 'host' || role === 'admin' || role === 'control') {
        socket.emit(SERVER_TO_CLIENT.GAME_QUIZ_START, {
          quizId: activeQuiz.quizId,
          question: activeQuiz.question,
          options: activeQuiz.optionList,
          timeLimit: activeQuiz.timeLimit,
          recovered: true
        });
      } else {
        socket.emit(SERVER_TO_CLIENT.GAME_QUIZ_OPTIONS, {
          quizId: activeQuiz.quizId,
          options: activeQuiz.optionMap,
          timeLimit: activeQuiz.timeLimit,
          recovered: true
        });
      }
      return true;
    }

    if (this.pendingQuiz) {
      const referenceNow = this.isPaused && this.pausedAt ? this.pausedAt : Date.now();
      const seconds = Math.max(0, Math.ceil((this.pendingQuiz.prepareEndsAt - referenceNow) / 1000));
      socket.emit(SERVER_TO_CLIENT.GAME_QUIZ_PREPARE, { seconds, recovered: true });
      return true;
    }
    return false;
  }

  upsertPlayerStats(player) {
    if (!player || !player.socketId) return null;
    let stat = this.playerStats.get(player.socketId);
    if (!stat) {
      stat = {
        socketId: player.socketId,
        nickname: player.nickname || '神秘賓客',
        avatar: player.avatar || '賓',
        teamId: player.teamId || null,
        teamName: '',
        teamHex: '#315E58',
        teamImgPath: '',
        tapCount: 0,
        correctCount: 0,
        wrongCount: 0,
        answeredCount: 0,
        answerTimedCount: 0,
        answerTimeTotalMs: 0,
        fastestAnswerMs: null,
        joinedAt: player.joinedAt || Date.now()
      };
      this.playerStats.set(player.socketId, stat);
    }

    stat.nickname = player.nickname || stat.nickname || '神秘賓客';
    stat.avatar = player.avatar || stat.avatar || '賓';
    stat.teamId = player.teamId || stat.teamId || null;
    this.hydrateStatTeam(stat);
    return stat;
  }

  hydrateStatTeam(stat) {
    if (!stat || !stat.teamId) return stat;
    const team = this.teamManager.getTeam(stat.teamId);
    const configTeam = (this.config.TEAMS || []).find(t => t.id === stat.teamId) || {};
    stat.teamName = (team && team.name) || configTeam.name || stat.teamId;
    stat.teamHex = (team && team.hex) || configTeam.hex || stat.teamHex || '#315E58';
    stat.teamImgPath = (team && team.imgPath) || configTeam.imgPath || stat.teamImgPath || '';
    return stat;
  }

  getOrCreatePlayerStats(socketId) {
    const player = this.teamManager.getPlayer(socketId);
    if (player) return this.upsertPlayerStats(player);
    return this.playerStats.get(socketId) || null;
  }

  recordPlayerTap(socketId) {
    const stat = this.getOrCreatePlayerStats(socketId);
    if (stat) {
      stat.tapCount++;
      return stat;
    }
    return null;
  }

  recordPlayerQuizResult(socketId, isCorrect, answerTimeMs = null) {
    const stat = this.getOrCreatePlayerStats(socketId);
    if (!stat) return;
    stat.answeredCount++;
    if (isCorrect) stat.correctCount++;
    else stat.wrongCount++;

    const numericAnswerTime = Number(answerTimeMs);
    if (Number.isFinite(numericAnswerTime) && numericAnswerTime >= 0) {
      stat.answerTimedCount = (stat.answerTimedCount || 0) + 1;
      stat.answerTimeTotalMs = (stat.answerTimeTotalMs || 0) + numericAnswerTime;
      stat.fastestAnswerMs = stat.fastestAnswerMs === null || stat.fastestAnswerMs === undefined
        ? numericAnswerTime
        : Math.min(stat.fastestAnswerMs, numericAnswerTime);
    }
  }

  getAverageAnswerMs(stat) {
    const timedCount = stat && stat.answerTimedCount ? stat.answerTimedCount : 0;
    if (timedCount <= 0) return Number.POSITIVE_INFINITY;
    return (stat.answerTimeTotalMs || 0) / timedCount;
  }

  getAwardTeams() {
    return Object.values(this.teamManager.teams).map((team) => {
      const configTeam = (this.config.TEAMS || []).find(t => t.id === team.id) || {};
      return {
        id: team.id,
        name: team.name || configTeam.name || team.id,
        color: team.color || configTeam.color || team.id,
        hex: team.hex || configTeam.hex || '#315E58',
        imgPath: team.imgPath || configTeam.imgPath || '',
        value: Math.round(Number(team.position) || 0)
      };
    });
  }

  getAwardPlayers(metricKey, options = {}) {
    const {
      requireAnswered = false,
      requirePositiveValue = false,
      tieBreakByAverageSpeed = false
    } = options;

    const players = Array.from(this.playerStats.values())
      .map(stat => this.hydrateStatTeam({ ...stat }))
      .filter(stat => stat.teamId && stat.nickname)
      .filter(stat => !requireAnswered || (stat.answeredCount || 0) > 0)
      .filter(stat => !requirePositiveValue || (stat[metricKey] || 0) > 0);

    const sorted = players.sort((a, b) => {
      const diff = (b[metricKey] || 0) - (a[metricKey] || 0);
      if (diff !== 0) return diff;
      if (tieBreakByAverageSpeed) {
        const aSpeed = this.getAverageAnswerMs(a);
        const bSpeed = this.getAverageAnswerMs(b);
        if (aSpeed !== bSpeed) return aSpeed - bSpeed;
      }
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });

    return sorted.map(stat => {
      const averageAnswerMs = this.getAverageAnswerMs(stat);
      return {
        socketId: stat.socketId,
        name: stat.nickname,
        avatar: stat.avatar || (stat.nickname ? stat.nickname[0] : '賓'),
        teamId: stat.teamId,
        teamName: stat.teamName,
        teamHex: stat.teamHex,
        teamImgPath: stat.teamImgPath,
        value: stat[metricKey] || 0,
        tapCount: stat.tapCount || 0,
        correctCount: stat.correctCount || 0,
        wrongCount: stat.wrongCount || 0,
        answeredCount: stat.answeredCount || 0,
        averageAnswerMs: Number.isFinite(averageAnswerMs) ? averageAnswerMs : null,
        fastestAnswerMs: Number.isFinite(stat.fastestAnswerMs) ? stat.fastestAnswerMs : null
      };
    });
  }

  buildPlayerAward({
    id,
    tag,
    title,
    prompt,
    description,
    metricKey,
    metricLabel,
    unit,
    requireAnswered = false,
    requirePositiveValue = false,
    tieBreakByAverageSpeed = false
  }) {
    const ranking = this.getAwardPlayers(metricKey, {
      requireAnswered,
      requirePositiveValue,
      tieBreakByAverageSpeed
    });
    const winner = ranking[0] || {
      socketId: null,
      name: '尚無紀錄',
      avatar: '？',
      teamId: null,
      teamName: '尚無隊伍',
      teamHex: '#315E58',
      teamImgPath: '',
      value: 0,
      averageAnswerMs: null,
      fastestAnswerMs: null
    };

    return {
      id,
      scope: 'player',
      tag,
      title,
      prompt,
      description,
      metricKey,
      metricLabel,
      unit,
      tieBreaker: tieBreakByAverageSpeed ? 'averageAnswerMs' : null,
      tieBreakerLabel: tieBreakByAverageSpeed ? '平均答題速度' : '',
      winner,
      ranking
    };
  }

  buildFinalAwardsPayload() {
    const teamRanking = this.getAwardTeams().sort((a, b) => b.value - a.value);
    const topScore = teamRanking.length > 0 ? teamRanking[0].value : 0;
    const topTeams = teamRanking.filter(team => team.value === topScore);
    const finalWinner = this.roundManager.getFinalWinner();
    const teamWinner = finalWinner === 'tie'
      ? {
          id: 'tie',
          name: topTeams.length > 1 ? topTeams.map(team => team.name).join('、') : '多隊平手',
          color: 'tie',
          hex: '#315E58',
          imgPath: '/assets/finish_flag.png',
          value: topScore,
          tiedTeams: topTeams
        }
      : (teamRanking.find(team => team.id === finalWinner) || teamRanking[0]);

    return {
      generatedAt: Date.now(),
      awards: [
        {
          id: 'team-winner',
          scope: 'team',
          tag: 'TEAM WINNER',
          title: '幸福總冠軍',
          prompt: '哪個隊伍贏得最終勝利',
          description: '單局一戰決勝，最快衝過終點的隊伍獲得幸福榮耀',
          metricKey: 'position',
          metricLabel: '賽道距離',
          unit: 'm',
          winner: teamWinner,
          ranking: teamRanking
        },
        this.buildPlayerAward({
          id: 'most-correct',
          tag: 'QUIZ MASTER',
          title: '答題王',
          prompt: '哪位賓客答對的題目數量最多',
          description: '個人累計答對題數最高；若同分，以平均答題速度最快者勝出',
          metricKey: 'correctCount',
          metricLabel: '答對題數',
          unit: '題',
          requirePositiveValue: true,
          tieBreakByAverageSpeed: true
        }),
        this.buildPlayerAward({
          id: 'highest-clicks',
          tag: 'TAP KING',
          title: '手速王',
          prompt: '哪位賓客點擊數最高',
          description: '個人累計點擊最多，靠熱情把馬兒一路推進終點',
          metricKey: 'tapCount',
          metricLabel: '點擊數',
          unit: '次'
        }),
        this.buildPlayerAward({
          id: 'most-wrong',
          tag: 'BRAVE TRY',
          title: '越挫越勇獎',
          prompt: '哪位賓客答錯最多',
          description: '只統計有實際作答的賓客；若同分，以平均答題速度最快者勝出',
          metricKey: 'wrongCount',
          metricLabel: '答錯題數',
          unit: '題',
          requireAnswered: true,
          requirePositiveValue: true,
          tieBreakByAverageSpeed: true
        })
      ]
    };
  }
}

module.exports = GameManager;
