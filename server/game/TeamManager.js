const DEFAULT_CONFIG = require('../../shared/game-config');

class TeamManager {
  constructor() {
    this.players = new Map(); // socketId -> PlayerInfo
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

  addPlayer(socketId, nickname, avatar = '🙂', isReconnect = false) {
    if (this.isJoinLocked && !isReconnect) {
      return { success: false, reason: 'RACE_IN_PROGRESS' };
    }
    const existing = this.players.get(socketId);
    if (existing) {
      existing.nickname = nickname;
      existing.avatar = avatar;
      return { success: true, player: existing };
    }
    const player = { socketId, nickname, avatar, teamId: null, joinedAt: Date.now() };
    this.players.set(socketId, player);
    return { success: true, player };
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player) {
      if (player.teamId && this.teams[player.teamId]) {
        this.teams[player.teamId].members.delete(socketId);
      }
      this.players.delete(socketId);
    }
  }

  chooseTeam(socketId, teamId, isReconnect = false) {
    if (this.isJoinLocked && !isReconnect) {
      return { success: false, reason: 'RACE_IN_PROGRESS' };
    }
    let player = this.players.get(socketId);
    if (!player) {
      const addRes = this.addPlayer(socketId, '熱情賓客', '🥳');
      if (!addRes.success) return addRes;
      player = addRes.player;
    }
    if (!this.teams[teamId]) return { success: false, reason: 'INVALID_TEAM' };

    // 離開舊隊伍
    if (player.teamId && this.teams[player.teamId]) {
      this.teams[player.teamId].members.delete(socketId);
    }

    player.teamId = teamId;
    this.teams[teamId].members.add(socketId);
    return { success: true, player, team: this.teams[teamId] };
  }

  autoAssignUnselectedPlayers() {
    const unassigned = [];
    for (const [socketId, player] of this.players) {
      if (!player.teamId) unassigned.push(player);
    }
    for (const player of unassigned) {
      // Find team with fewest members
      let minTeam = null;
      let minCount = Infinity;
      for (const [teamId, team] of Object.entries(this.teams)) {
        if (team.members.size < minCount) {
          minCount = team.members.size;
          minTeam = teamId;
        }
      }
      if (minTeam) {
        player.teamId = minTeam;
        this.teams[minTeam].members.add(player.socketId);
      }
    }
    return unassigned.length;
  }

  getPlayer(socketId) {
    return this.players.get(socketId);
  }

  getTeam(teamId) {
    return this.teams[teamId];
  }

  getAllTeamsInfo() {
    return Object.values(this.teams).map(t => ({
      id: t.id,
      name: t.name,
      memberCount: t.members.size,
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
    }
    this.players.clear();
  }
}

module.exports = TeamManager;
