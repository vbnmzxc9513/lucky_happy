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
    this.config = DEFAULT_CONFIG;
    
    this.teamManager = new TeamManager();
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
    this.flowToken = 0;
  }

  setState(newState) {
    this.state = newState;
    // 當進入 RACING 或 QUIZ 或 COUNTDOWN 時鎖定加入與選隊
    const lock = (newState === 'COUNTDOWN' || newState === 'RACING' || newState === 'QUIZ');
    this.teamManager.setJoinLock(lock);
    this.broadcastStateSync();
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
      players: Array.from(this.teamManager.players.values()),
      totalPlayers: this.teamManager.players.size,
      config: this.config
    };
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
    
    // 自動將未選隊的賓客均衡分配
    this.teamManager.autoAssignUnselectedPlayers();

    const map = this.mapManager.getCurrentMap();
    console.log(`[GameManager] startRound. Map: ${map.name}, checkpoints: ${map.checkpoints ? map.checkpoints.length : 0}`);
    this.teamManager.resetRoundPositions();
    this.itemManager.generateTrackItems(map);
    this.checkpointEngine.initCheckpoints(map.checkpoints);

    this.setState('COUNTDOWN');

    setTimeout(() => {
      if (this.flowToken === flowToken && this.state === 'COUNTDOWN') {
        this.setState('RACING');
        this.startLoop();
      }
    }, this.config.countdownSeconds * 1000);

    return true;
  }

  startLoop() {
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
    if (this.state !== 'RACING') return;

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
      this.triggerQuiz(cp.quizId || null);
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
    if (this.state !== 'RACING') return false;
    
    // 檢查冷卻 (防刷)
    const now = Date.now();
    const lastTap = this.lastTapTimes.get(socketId) || 0;
    if (now - lastTap < this.config.tapCooldown) return false;
    this.lastTapTimes.set(socketId, now);

    const player = this.teamManager.getPlayer(socketId);
    if (!player || !player.teamId) return false;

    const team = this.teamManager.getTeam(player.teamId);
    if (!team) return false;

    if (team.isStunned) return false;

    const boost = this.physicsEngine.calculateBoost(team.members.size);
    team.speed += boost;
    this.checkpointEngine.recordTap();
    this.recordPlayerTap(socketId);
    return true;
  }

  // 觸發答題 (由關卡設計)
  triggerQuiz(quizId) {
    if (this.state !== 'RACING') return false;
    const flowToken = this.flowToken;
    console.log(`[GameManager] triggerQuiz called for quizId: ${quizId}`);
    this.stopLoop();
    this.setState('QUIZ');

    // 廣播 3 秒準備倒數
    this.io.emit(SERVER_TO_CLIENT.GAME_QUIZ_PREPARE, { seconds: 3 });

    setTimeout(() => {
      // 若狀態已經改變（例如管理員強制重置），則中斷
      if (this.flowToken !== flowToken || this.state !== 'QUIZ') return;

      const teams = this.teamManager.teams;
      const teamSizes = {};
      for (const tid of Object.keys(teams)) {
        teamSizes[tid] = teams[tid].members.size;
      }
      const qData = this.quizManager.startQuiz(quizId, teamSizes, (results) => {
        this.handleQuizResults(results, flowToken);
      });

      if (!qData) {
        // 找不到題目則直接恢復比賽
        if (this.flowToken !== flowToken) return;
        this.setState('RACING');
        this.startLoop();
        return;
      }

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
    }, 3000);
    return true;
  }

  handleQuizAnswer(socketId, quizId, answerStr) {
    if (this.state !== 'QUIZ') return { success: false, reason: 'NOT_IN_QUIZ' };
    const player = this.teamManager.getPlayer(socketId);
    const teamId = player ? player.teamId : null;
    const result = this.quizManager.handleAnswer(socketId, teamId, quizId, answerStr);
    if (result && result.success) {
      this.recordPlayerQuizResult(socketId, result.isCorrect, result.answerTimeMs);
    }
    return result;
  }

  handleQuizResults(results, flowToken = this.flowToken) {
    // 狀態防護：若已經被重置為 LOBBY，則忽略此結果
    if (this.state !== 'QUIZ') return;

    if (this.flowToken !== flowToken || this.state !== 'QUIZ') return;

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
    setTimeout(() => {
      if (this.flowToken === flowToken && this.state === 'QUIZ') {
        this.setState('RACING');
        this.startLoop();
      }
    }, 3000);
  }

  finishRound(winnerTeamId) {
    const flowToken = this.flowToken;
    this.stopLoop();
    this.setState('ROUND_FINISHED');

    const roundInfo = this.roundManager.recordRoundWinner(winnerTeamId);
    this.io.emit(SERVER_TO_CLIENT.GAME_ROUND_FINISHED, {
      roundInfo,
      matchStatus: this.roundManager.getMatchStatus()
    });

    // 檢查三局是否結束
    if (this.roundManager.isMatchFinished()) {
      setTimeout(() => {
        if (this.flowToken !== flowToken || this.state !== 'ROUND_FINISHED') return;
        this.setState('MATCH_FINISHED');
        this.io.emit(SERVER_TO_CLIENT.GAME_MATCH_FINISHED, {
          finalWinner: this.roundManager.getFinalWinner(),
          matchStatus: this.roundManager.getMatchStatus(),
          finalAwards: this.buildFinalAwardsPayload()
        });
      }, 5000);
    } else {
      // 5 秒後自動進入下局的大廳 (ROUND_LOBBY)
      setTimeout(() => {
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
    this.quizManager.cancelQuiz(); // 確保中斷進行中的答題計時
    this.roundManager.reset();
    this.lastTapTimes.clear();
    this.playerStats.clear();
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
    if (newConfig.totalRounds) {
      this.config.totalRounds = Number(newConfig.totalRounds);
      this.roundManager.totalRounds = this.config.totalRounds;
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

  forceTriggerQuiz(quizId) {
    if (this.state !== 'RACING') return false;
    this.triggerQuiz(quizId || null);
    return true;
  }

  forceTriggerItem(teamId, itemType = 'large_boost') {
    if (this.state !== 'RACING') return false;
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

  stopGameLoop() {
    this.stopLoop();
    this.stopBotSimulation();
  }

  // 清理斷線玩家的防抖記錄（防止記憶體洩漏）
  cleanupDisconnectedPlayer(socketId) {
    this.lastTapTimes.delete(socketId);
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
    if (stat) stat.tapCount++;
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
        value: this.roundManager.scores[team.id] || 0
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
          imgPath: '/host/assets/finish_flag.png',
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
          description: '三局累計分數最高，獲得新人親頒幸福榮耀盃',
          metricKey: 'score',
          metricLabel: '總積分',
          unit: '分',
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
          title: '答錯最多獎',
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
