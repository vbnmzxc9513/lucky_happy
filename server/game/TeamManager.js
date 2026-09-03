const DEFAULT_CONFIG = require('../../shared/game-config');

class TeamManager {
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
    this.players = new Map(); // socketId -> PlayerInfo
    this.sessionToSocket = new Map(); // stable guest session -> current socketId
    this.socketToSession = new Map();
    this.teams = {};
    
    if (DEFAULT_CONFIG.TEAMS) {
      DEFAULT_CONFIG.TEAMS.forEach(teamConf => {
        this.teams[teamConf.id] = {
          id: teamConf.id,
          name: teamConf.name,
          color: teamConf.color,
          hex: teamConf.hex,
          imgPath: teamConf.imgPath,
          members: new Set(),
          position: 10,
          speed: 0,
          score: 0,
          isStunned: false,
          stunUntil: 0,
          shieldCount: 0
        };
      });
    }
    this.isJoinLocked = false; // 新規：比賽中鎖定加入與選隊
  }

  updateTeamNames(names) {
    if (!names) return;
    Object.keys(this.teams).forEach(id => {
      if (names[id]) {
        this.teams[id].name = names[id];
      }
    });
  }

  setJoinLock(locked) {
    this.isJoinLocked = locked;
  }

  getMaxPlayersPerTeam() {
    const configured = Number(this.config.maxPlayersPerTeam);
    return Math.max(1, Number.isFinite(configured) ? Math.floor(configured) : 50);
  }

  normalizeNickname(nickname) {
    return String(nickname || '')
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase('zh-TW');
  }

  isNicknameTaken(nickname, excludedSocketIds = new Set()) {
    const normalized = this.normalizeNickname(nickname);
    if (!normalized) return false;
    for (const [playerSocketId, player] of this.players) {
      if (excludedSocketIds.has(playerSocketId)) continue;
      if (this.normalizeNickname(player.nickname) === normalized) return true;
    }
    return false;
  }

  addPlayer(socketId, nickname, avatar = '🙂', sessionId = null) {
    const previousSocketId = sessionId ? this.sessionToSocket.get(sessionId) : null;
    const reconnectingPlayer = previousSocketId ? this.players.get(previousSocketId) : null;
    const ownSocketIds = new Set([socketId]);
    if (previousSocketId) ownSocketIds.add(previousSocketId);
    if (this.isNicknameTaken(nickname, ownSocketIds)) {
      return { success: false, reason: 'DUPLICATE_NICKNAME' };
    }
    if (this.isJoinLocked && !reconnectingPlayer) {
      return { success: false, reason: 'RACE_IN_PROGRESS' };
    }

    if (reconnectingPlayer && previousSocketId !== socketId) {
      this.players.delete(previousSocketId);
      this.socketToSession.delete(previousSocketId);
      if (reconnectingPlayer.teamId && this.teams[reconnectingPlayer.teamId]) {
        this.teams[reconnectingPlayer.teamId].members.delete(previousSocketId);
        this.teams[reconnectingPlayer.teamId].members.add(socketId);
      }
      reconnectingPlayer.socketId = socketId;
      reconnectingPlayer.nickname = nickname;
      reconnectingPlayer.avatar = avatar;
      reconnectingPlayer.connected = true;
      this.players.set(socketId, reconnectingPlayer);
      this.sessionToSocket.set(sessionId, socketId);
      this.socketToSession.set(socketId, sessionId);
      return { success: true, player: reconnectingPlayer, reconnected: true, previousSocketId };
    }

    const existing = this.players.get(socketId);
    if (existing) {
      existing.nickname = nickname;
      existing.avatar = avatar;
      existing.connected = true;
      if (sessionId && !this.socketToSession.has(socketId)) {
        this.sessionToSocket.set(sessionId, socketId);
        this.socketToSession.set(socketId, sessionId);
      }
      return { success: true, player: existing };
    }
    const player = { socketId, nickname, avatar, teamId: null, joinedAt: Date.now(), connected: true };
    this.players.set(socketId, player);
    if (sessionId) {
      this.sessionToSocket.set(sessionId, socketId);
      this.socketToSession.set(socketId, sessionId);
    }
    return { success: true, player };
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player) {
      if (player.teamId && this.teams[player.teamId]) {
        this.teams[player.teamId].members.delete(socketId);
      }
      this.players.delete(socketId);
      const sessionId = this.socketToSession.get(socketId);
      if (sessionId && this.sessionToSocket.get(sessionId) === socketId) {
        this.sessionToSocket.delete(sessionId);
      }
      this.socketToSession.delete(socketId);
    }
  }

  disconnectPlayer(socketId, retainForReconnect = false) {
    const player = this.players.get(socketId);
    if (!player) return false;
    if (retainForReconnect && this.socketToSession.has(socketId)) {
      player.connected = false;
      return true;
    }
    this.removePlayer(socketId);
    return true;
  }

  chooseTeam(socketId, teamId, allowExistingPlayer = false) {
    if (this.isJoinLocked && !allowExistingPlayer) {
      return { success: false, reason: 'RACE_IN_PROGRESS' };
    }
    let player = this.players.get(socketId);
    if (!player) {
      const addRes = this.addPlayer(socketId, `熱情賓客-${String(socketId).slice(-4)}`, '🥳');
      if (!addRes.success) return addRes;
      player = addRes.player;
    }
    if (!this.teams[teamId]) return { success: false, reason: 'INVALID_TEAM' };

    const targetTeam = this.teams[teamId];
    if (player.teamId === teamId) {
      return { success: true, player, team: targetTeam, unchanged: true };
    }
    if (targetTeam.members.size >= this.getMaxPlayersPerTeam()) {
      return {
        success: false,
        reason: 'TEAM_FULL',
        teamId,
        maxPlayersPerTeam: this.getMaxPlayersPerTeam()
      };
    }

    // 離開舊隊伍
    if (player.teamId && this.teams[player.teamId]) {
      this.teams[player.teamId].members.delete(socketId);
    }

    player.teamId = teamId;
    targetTeam.members.add(socketId);
    return { success: true, player, team: targetTeam };
  }

  autoAssignUnselectedPlayers() {
    const unassigned = [];
    const assignments = [];
    for (const [socketId, player] of this.players) {
      if (!player.teamId) unassigned.push(player);
    }
    for (const player of unassigned) {
      // Find team with fewest members
      let minTeam = null;
      let minCount = Infinity;
      for (const [teamId, team] of Object.entries(this.teams)) {
        if (team.members.size < this.getMaxPlayersPerTeam() && team.members.size < minCount) {
          minCount = team.members.size;
          minTeam = teamId;
        }
      }
      if (minTeam) {
        player.teamId = minTeam;
        this.teams[minTeam].members.add(player.socketId);
        assignments.push({
          socketId: player.socketId,
          teamId: minTeam,
          player
        });
      }
    }
    return {
      count: assignments.length,
      unassignedCount: unassigned.length,
      assignments
    };
  }

  getPlayer(socketId) {
    return this.players.get(socketId);
  }

  getTeam(teamId) {
    return this.teams[teamId];
  }

  getSessionId(socketId) {
    return this.socketToSession.get(socketId) || null;
  }

  getAllTeamsInfo() {
    return Object.values(this.teams).map(t => ({
      id: t.id,
      name: t.name,
      memberCount: t.members.size,
      connectedCount: Array.from(t.members).reduce((count, socketId) => {
        const player = this.players.get(socketId);
        return count + (player && player.connected !== false ? 1 : 0);
      }, 0),
      maxMembers: this.getMaxPlayersPerTeam(),
      isFull: t.members.size >= this.getMaxPlayersPerTeam(),
      position: Math.round(t.position),
      speed: Math.round(t.speed * 10) / 10,
      score: t.score,
      isStunned: t.isStunned
    }));
  }

  resetRoundPositions() {
    for (const team of Object.values(this.teams)) {
      team.position = 10;
      team.speed = 0;
      team.isStunned = false;
      team.stunUntil = 0;
      team.shieldCount = 0;
    }
  }

  resetAllScores() {
    for (const team of Object.values(this.teams)) {
      team.score = 0;
    }
  }

  resetAllPlayersAndTeams() {
    for (const team of Object.values(this.teams)) {
      team.members.clear();
      team.score = 0;
      team.position = 10;
      team.speed = 0;
      team.isStunned = false;
      team.stunUntil = 0;
      team.shieldCount = 0;
    }
    this.players.clear();
    this.sessionToSocket.clear();
    this.socketToSession.clear();
  }
}

module.exports = TeamManager;
