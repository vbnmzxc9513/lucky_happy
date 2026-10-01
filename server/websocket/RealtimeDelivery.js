const { SERVER_TO_CLIENT: S } = require('../../shared/events');

const STAFF = ['host', 'control', 'admin'];
class RealtimeDelivery {
  constructor(io, game) {
    this.io = io;
    this.game = game;
    this.lastPosition = {};
    this.sequence = 0;
    this.operations = new Map();
    this.tapReceiptLedger = process.env.ENABLE_TEST_DIAGNOSTICS === '1' && process.env.NODE_ENV !== 'production'
      ? new Map() : null;
    this.progress = new Map();
    this.metrics = {};
    if (process.env.NETWORK_METRICS === '1') this.instrument();
    this.heartbeat = setInterval(() => {
      this.io.to('protocol:2').volatile.emit(S.GAME_HEARTBEAT, this.envelope());
    }, 1000);
    this.heartbeat.unref?.();
  }

  envelope() {
    const g = this.game;
    return { runId: g.runId, stateVersion: g.stateVersion, serverNow: Date.now(),
      state: g.state, paused: g.isPaused, endsAt: g.quizStage?.endsAt || null };
  }

  instrument() {
    const count = (role, args) => {
      if (!Array.isArray(args) || typeof args[0] !== 'string') return;
      const key = `${role}:${args[0]}`;
      const entry = this.metrics[key] ||= { messages: 0, bytes: 0 };
      entry.messages++;
      entry.bytes += Buffer.byteLength(JSON.stringify(args));
    };
    this.instrumentSocket = socket => {
      const emit = socket.emit.bind(socket);
      socket.emit = (...args) => { count(socket.data.role, args); return emit(...args); };
    };
    const adapter = this.io.of('/').adapter;
    const broadcast = adapter.broadcast.bind(adapter);
    adapter.broadcast = (packet, options) => {
      const matches = (rooms, socket) => [...rooms].some(room => socket.rooms.has(room));
      for (const socket of this.io.sockets.sockets.values()) {
        if ((!options.rooms.size || matches(options.rooms, socket)) && !matches(options.except, socket)) {
          count(socket.data.role, packet.data);
        }
      }
      return broadcast(packet, options);
    };
  }

  sendState(socket, base = this.game.getGameState()) {
    let state = base;
    if (socket.data.role === 'guest') {
      const teamId = this.game.teamManager.getPlayer(socket.id)?.teamId || null;
      if (socket.data.deliveryTeam !== teamId) {
        if (socket.data.deliveryTeam) socket.leave?.(`team:${socket.data.deliveryTeam}`);
        if (teamId) socket.join?.(`team:${teamId}`);
        socket.data.deliveryTeam = teamId;
      }
      const { players, activeItems, config, finalAwards, finalWinner, racePacing, currentMap, quizProgress, ...rest } = base;
      const minimalConfig = { TEAMS: config.TEAMS, maxPlayersPerTeam: config.maxPlayersPerTeam,
        quizStages: config.quizStages, shuttleRace: config.shuttleRace, finalSprint: config.finalSprint };
      const key = JSON.stringify(minimalConfig);
      state = { ...rest, currentMap: currentMap ? { id: currentMap.id, trackLength: currentMap.trackLength } : null,
        self: this.game.buildTapStatus(socket.id) };
      if (state.quizStage) {
        const { results, reveal, summary, ...currentStage } = state.quizStage;
        state.quizStage = { ...currentStage,
          reveal: reveal ? this.guestQuizResult(reveal, teamId) : null,
          summary: summary ? { stageNumber: summary.stageNumber,
            teamResults: teamId && summary.teamResults[teamId] ? { [teamId]: summary.teamResults[teamId] } : {} } : null };
        if (reveal) {
          const receipt = this.answerReceipts(socket.id).find(entry => entry.quizId === reveal.quizId);
          state.quizStage.reveal.alreadyAnswered = !!receipt;
          state.quizStage.reveal.answer = receipt?.answer || null;
        }
      }
      if (socket.data.configKey !== key) {
        state.config = minimalConfig;
        socket.data.configKey = key;
      }
    }
    socket.emit(S.GAME_STATE_SYNC, state);
  }

  broadcastState() {
    const state = this.game.getGameState();
    for (const socket of this.io.sockets.sockets.values()) {
      if (socket.data.protocolVersion === 2) this.sendState(socket, state);
    }
  }

  positions(teams, now = Date.now()) {
    const payload = { ...this.envelope(), seq: ++this.sequence, teams };
    for (const [role, interval] of Object.entries({ host: 0, guest: 200, control: 500, admin: 500 })) {
      if (now - (this.lastPosition[role] ?? -Infinity) < interval) continue;
      this.lastPosition[role] = now;
      if (role === 'guest') {
        const ranking = this.game.getTeamRanking();
        for (const team of ranking) {
          this.io.to(`team:${team.id}`).volatile.emit(S.GAME_POSITION_UPDATE, {
            runId: payload.runId, stateVersion: payload.stateVersion, serverNow: payload.serverNow, seq: payload.seq,
            self: { teamId: team.id, teamRank: team.rank, position: team.position, isStunned: team.isStunned }
          });
        }
      } else this.io.to(`role:${role}`).volatile.emit(S.GAME_POSITION_UPDATE, payload);
    }
  }

  staff(event, payload) {
    this.io.to(STAFF.map(role => `role:${role}`)).emit(event, payload);
  }

  guestQuizResult(result, teamId) {
    const team = result.teamResults[teamId];
    return { ...this.envelope(), quizId: result.quizId, correctAnswer: result.correctAnswer,
      correctAnswerText: result.correctAnswerText,
      teamResult: team ? { totalCount: team.totalCount, correctCount: team.correctCount,
        correctRate: team.correctRate, isCorrect: team.isCorrect } : null };
  }

  quizResult(result) {
    this.staff(S.GAME_QUIZ_RESULT, { ...result, ...this.envelope() });
    for (const team of this.game.config.TEAMS) {
      this.io.to(`team:${team.id}`).emit(S.GAME_QUIZ_RESULT, this.guestQuizResult(result, team.id));
    }
  }

  matchFinished(payload) {
    this.staff(S.GAME_MATCH_FINISHED, payload);
    this.io.to('role:guest').emit(S.GAME_MATCH_FINISHED, this.envelope());
  }

  answerReceipts(socketId) {
    const identity = this.game.teamManager.socketToSession.get(socketId) || socketId;
    const ledger = this.operations.get(identity);
    if (!ledger) return [];
    return [...ledger.values()]
      .filter(entry => entry.kind === 'answer' && entry.result.success)
      .map(entry => ({ runId: entry.result.runId, requestId: entry.result.requestId,
        quizId: entry.quizId, answer: entry.result.answer, isCorrect: entry.result.isCorrect,
        answerTimeMs: entry.result.answerTimeMs, receivedAt: entry.receivedAt }));
  }

  tapReceipts(socketId) {
    const identity = this.game.teamManager.socketToSession.get(socketId) || socketId;
    return this.tapReceiptLedger?.get(identity) || [];
  }

  scheduleRoster() {
    if (this.rosterTimer) return;
    this.rosterTimer = setTimeout(() => {
      this.rosterTimer = null;
      const payload = { ...this.envelope(), teams: this.game.teamManager.getAllTeamsInfo(),
        totalPlayers: this.game.teamManager.players.size };
      this.io.to('role:guest').emit(S.GAME_TEAM_UPDATED, payload);
      this.staff(S.GAME_TEAM_UPDATED, { ...payload,
        players: [...this.game.teamManager.players.values()].map(p => this.game.getPublicPlayer(p)) });
      // The lobby host maintains its roster from state snapshots.
      const state = this.game.getGameState();
      for (const socket of this.io.sockets.sockets.values()) {
        if (STAFF.includes(socket.data.role)) this.sendState(socket, state);
      }
    }, 250);
    this.rosterTimer.unref?.();
  }

  scheduleProgress(payload) {
    this.progress.set(payload.teamId, payload);
    if (this.progressTimer) return;
    this.progressTimer = setTimeout(() => this.flushProgress(), 250);
    this.progressTimer.unref?.();
  }

  flushProgress() {
    clearTimeout(this.progressTimer);
    this.progressTimer = null;
    for (const payload of this.progress.values()) this.staff(S.GAME_QUIZ_PROGRESS,
      { ...payload, ...this.envelope(), progressSnapshot: this.game.quizManager.getProgressSnapshot() });
    this.progress.clear();
  }

  operation(socket, kind, data, execute) {
    const envelope = { runId: this.game.runId };
    const reject = reason => ({ success: false, reason, requestId: data?.requestId, ...envelope });
    if (!data || typeof data.requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(data.requestId)) return reject('INVALID_REQUEST_ID');
    if (data.runId !== this.game.runId) return reject('STALE_RUN');
    const player = this.game.teamManager.getPlayer(socket.id);
    if (!player || player.connected === false) return reject('NOT_JOINED');
    const identity = this.game.teamManager.socketToSession.get(socket.id) || socket.id;
    let ledger = this.operations.get(identity);
    if (!ledger) { ledger = new Map(); this.operations.set(identity, ledger); }
    const fingerprint = JSON.stringify([kind, data.quizId, data.answer, data.timestamp, data.stateVersion]);
    const cached = ledger.get(data.requestId);
    if (cached) return cached.fingerprint === fingerprint ? cached.result : reject('REQUEST_ID_CONFLICT');
    // An answer is scoped to this run and question's server deadline. Display,
    // roster and pause/resume snapshots must not invalidate an in-flight answer.
    // handleQuizAnswer still rejects paused, closed and wrong-question requests.
    if (kind !== 'answer' && data.stateVersion !== this.game.stateVersion) return reject('STALE_STATE');
    if (kind === 'tap' && this.game.quizStage?.endsAt && Date.now() >= this.game.quizStage.endsAt) return reject('WINDOW_CLOSED');
    if (ledger.size >= 256) {
      for (const [id, entry] of ledger) {
        if (entry.kind === 'tap' && entry.stateVersion !== this.game.stateVersion) ledger.delete(id);
      }
      if (ledger.size >= 256) return reject('RATE_LIMITED');
    }
    const outcome = execute();
    const result = kind === 'tap'
      ? { success: outcome.success, reason: outcome.reason, critical: outcome.critical,
        multiplier: outcome.multiplier, status: outcome.status, requestId: data.requestId, ...envelope }
      : { success: outcome.success, reason: outcome.reason, isCorrect: outcome.isCorrect,
        answer: outcome.answer, answerTimeMs: outcome.answerTimeMs, requestId: data.requestId, ...envelope };
    ledger.set(data.requestId, { fingerprint, result, kind, stateVersion: data.stateVersion,
      quizId: kind === 'answer' ? data.quizId : undefined, receivedAt: Date.now() });
    if (kind === 'tap' && result.success && this.tapReceiptLedger) {
      let receipts = this.tapReceiptLedger.get(identity);
      if (!receipts) { receipts = []; this.tapReceiptLedger.set(identity, receipts); }
      receipts.push({ runId: result.runId, requestId: data.requestId });
    }
    return result;
  }

  reset() {
    clearTimeout(this.rosterTimer);
    clearTimeout(this.progressTimer);
    this.rosterTimer = this.progressTimer = null;
    this.progress.clear();
    this.operations.clear();
    this.tapReceiptLedger?.clear();
    this.lastPosition = {};
    this.sequence = 0;
  }

  close() { this.reset(); clearInterval(this.heartbeat); }
}
module.exports = RealtimeDelivery;
