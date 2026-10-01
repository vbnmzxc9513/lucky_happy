const { SERVER_TO_CLIENT } = require('../../shared/events');
const Validators = require('../../shared/validators');

class GuestHandler {
  constructor(io, gameManager) {
    this.io = io;
    this.gameManager = gameManager;
  }

  handleJoin(socket, data) {
    if (data?.rename === true) return this.handleRename(socket, data);
    const val = Validators.validateJoin(data);
    if (!val.valid) {
      socket.emit(SERVER_TO_CLIENT.SYSTEM_ERROR, { message: val.error });
      return;
    }

    const manager = this.gameManager.teamManager;
    const existing = manager.getPlayer(socket.id) || manager.getPlayer(manager.sessionToSocket.get(val.sessionId));
    const res = manager.addPlayer(
      socket.id,
      existing?.nickname || val.nickname,
      existing?.avatar || val.avatar,
      val.sessionId
    );
    if (!res.success) {
      socket.emit(SERVER_TO_CLIENT.GUEST_JOIN_ACK, {
        success: false,
        reason: res.reason,
        nickname: val.nickname
      });
      if (res.reason === 'RACE_IN_PROGRESS') {
        socket.emit(SERVER_TO_CLIENT.GAME_JOIN_LOCKED, { reason: 'RACE_IN_PROGRESS' });
      }
      return;
    }

    if (res.previousSocketId) {
      this.gameManager.migratePlayerConnection(res.previousSocketId, socket.id);
    }

    if (data.teamId && !res.player.teamId) {
      const teamValidation = Validators.validateChooseTeam({ teamId: data.teamId });
      if (teamValidation.valid) {
        const teamResult = this.gameManager.teamManager.chooseTeam(socket.id, teamValidation.teamId, true);
        if (!teamResult.success && teamResult.reason === 'TEAM_FULL') {
          socket.emit(SERVER_TO_CLIENT.GAME_TEAM_FULL, {
            teamId: teamResult.teamId,
            maxPlayersPerTeam: teamResult.maxPlayersPerTeam
          });
        }
      }
    }
    this.gameManager.upsertPlayerStats(this.gameManager.teamManager.getPlayer(socket.id));

    const player = this.gameManager.teamManager.getPlayer(socket.id);
    socket.emit(SERVER_TO_CLIENT.GUEST_JOIN_ACK, {
      success: true,
      reconnected: !!res.reconnected,
      nickname: player.nickname,
      avatar: player.avatar,
      teamId: player ? player.teamId : null
    });
    if (this.gameManager.delivery) this.gameManager.delivery.sendState(socket);
    else socket.emit(SERVER_TO_CLIENT.GAME_STATE_SYNC, this.gameManager.getGameState());
    this.gameManager.emitPlayerStatus(socket.id);
    this.gameManager.emitActiveQuizRecovery(socket, 'guest');
    if (this.gameManager.delivery) this.gameManager.delivery.scheduleRoster();
    else this.io.emit(SERVER_TO_CLIENT.GAME_PLAYER_JOINED, {
      player: this.gameManager.getPublicPlayer(res.player),
      teams: this.gameManager.teamManager.getAllTeamsInfo(),
      totalPlayers: this.gameManager.teamManager.players.size
    });
  }

  handleRename(socket, data) {
    const manager = this.gameManager.teamManager;
    const player = manager.getPlayer(socket.id);
    const reply = payload => socket.emit(SERVER_TO_CLIENT.GUEST_JOIN_ACK, { rename: true, ...payload });
    if (!player) return reply({ success: false, reason: 'NOT_JOINED' });
    if (manager.isJoinLocked || !['LOBBY', 'MAP_SELECT', 'ROUND_LOBBY'].includes(this.gameManager.state)) {
      return reply({ success: false, reason: 'NAME_LOCKED' });
    }
    const val = Validators.validateJoin(data);
    if (!val.valid) return reply({ success: false, reason: 'INVALID_NICKNAME' });
    const result = manager.addPlayer(socket.id, val.nickname, player.avatar, manager.socketToSession.get(socket.id));
    if (!result.success) return reply({ success: false, reason: result.reason });
    this.gameManager.upsertPlayerStats(result.player);
    reply({ success: true, nickname: result.player.nickname, teamId: result.player.teamId });
    if (this.gameManager.delivery) {
      this.gameManager.delivery.sendState(socket);
      this.gameManager.delivery.scheduleRoster();
    } else this.io.emit(SERVER_TO_CLIENT.GAME_PLAYER_JOINED, {
      player: this.gameManager.getPublicPlayer(result.player),
      teams: manager.getAllTeamsInfo(), totalPlayers: manager.players.size
    });
  }

  handleChooseTeam(socket, data) {
    const val = Validators.validateChooseTeam(data);
    if (!val.valid) {
      socket.emit(SERVER_TO_CLIENT.SYSTEM_ERROR, { message: val.error });
      return;
    }

    const res = this.gameManager.teamManager.chooseTeam(socket.id, val.teamId);
    if (!res.success) {
      if (res.reason === 'RACE_IN_PROGRESS') {
        socket.emit(SERVER_TO_CLIENT.GAME_JOIN_LOCKED, { reason: 'RACE_IN_PROGRESS' });
      } else if (res.reason === 'TEAM_FULL') {
        socket.emit(SERVER_TO_CLIENT.GAME_TEAM_FULL, {
          teamId: res.teamId,
          maxPlayersPerTeam: res.maxPlayersPerTeam
        });
      } else {
        socket.emit(SERVER_TO_CLIENT.SYSTEM_ERROR, { message: `選隊失敗：${res.reason}` });
      }
      return;
    }

    socket.emit('guest:team_chosen', { teamId: val.teamId });
    this.gameManager.upsertPlayerStats(res.player);
    if (this.gameManager.delivery) {
      this.gameManager.delivery.scheduleRoster();
      this.gameManager.delivery.sendState(socket);
    } else this.io.emit(SERVER_TO_CLIENT.GAME_TEAM_UPDATED, {
      teams: this.gameManager.teamManager.getAllTeamsInfo(),
      totalPlayers: this.gameManager.teamManager.players.size
    });
    this.gameManager.emitPlayerStatus(socket.id);
  }

  handleTap(socket, data) {
    const val = Validators.validateTap(data);
    if (!val.valid) return;
    const apply = () => this.gameManager.handleTap(socket.id, val.timestamp);
    const result = this.gameManager.delivery
      ? this.gameManager.delivery.operation(socket, 'tap', data, apply) : apply();
    socket.emit(SERVER_TO_CLIENT.GAME_TAP_ACK, result);
  }

  handleQuizAnswer(socket, data) {
    const val = Validators.validateQuizAnswer(data);
    if (!val.valid) return;

    const apply = () => this.gameManager.handleQuizAnswer(socket.id, val.quizId, val.answer);
    const res = this.gameManager.delivery
      ? this.gameManager.delivery.operation(socket, 'answer', data, apply) : apply();
    socket.emit(SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK, res);
  }

  handleDisconnect(socket) {
    if (!this.gameManager.teamManager.getPlayer(socket.id)) return;
    const retainForReconnect = ['COUNTDOWN', 'RACING', 'QUIZ', 'ROUND_FINISHED', 'MATCH_FINISHED']
      .includes(this.gameManager.state);
    if (!retainForReconnect && this.gameManager.delivery) {
      const identity = this.gameManager.teamManager.socketToSession.get(socket.id) || socket.id;
      this.gameManager.delivery.operations.delete(identity);
    }
    this.gameManager.cleanupDisconnectedPlayer(socket.id, !retainForReconnect);
    this.gameManager.teamManager.disconnectPlayer(socket.id, retainForReconnect);
    if (this.gameManager.delivery) this.gameManager.delivery.scheduleRoster();
    else this.io.emit(SERVER_TO_CLIENT.GAME_TEAM_UPDATED, {
      teams: this.gameManager.teamManager.getAllTeamsInfo(),
      totalPlayers: this.gameManager.teamManager.players.size
    });
  }
}

module.exports = GuestHandler;
