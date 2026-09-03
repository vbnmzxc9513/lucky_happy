const { SERVER_TO_CLIENT } = require('../../shared/events');
const Validators = require('../../shared/validators');

class GuestHandler {
  constructor(io, gameManager) {
    this.io = io;
    this.gameManager = gameManager;
  }

  handleJoin(socket, data) {
    const val = Validators.validateJoin(data);
    if (!val.valid) {
      socket.emit(SERVER_TO_CLIENT.SYSTEM_ERROR, { message: val.error });
      return;
    }

    const res = this.gameManager.teamManager.addPlayer(
      socket.id,
      val.nickname,
      val.avatar,
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
      teamId: player ? player.teamId : null
    });
    socket.emit(SERVER_TO_CLIENT.GAME_STATE_SYNC, this.gameManager.getGameState());
    this.gameManager.emitPlayerStatus(socket.id);
    this.gameManager.emitActiveQuizRecovery(socket, 'guest');
    this.io.emit(SERVER_TO_CLIENT.GAME_PLAYER_JOINED, { 
      player: this.gameManager.getPublicPlayer(res.player),
      teams: this.gameManager.teamManager.getAllTeamsInfo(),
      totalPlayers: this.gameManager.teamManager.players.size
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
    this.io.emit(SERVER_TO_CLIENT.GAME_TEAM_UPDATED, { 
      teams: this.gameManager.teamManager.getAllTeamsInfo(),
      totalPlayers: this.gameManager.teamManager.players.size
    });
    this.gameManager.emitPlayerStatus(socket.id);
  }

  handleTap(socket, data) {
    const val = Validators.validateTap(data);
    if (!val.valid) return;
    const result = this.gameManager.handleTap(socket.id, val.timestamp);
    socket.emit(SERVER_TO_CLIENT.GAME_TAP_ACK, result);
  }

  handleQuizAnswer(socket, data) {
    const val = Validators.validateQuizAnswer(data);
    if (!val.valid) return;

    const res = this.gameManager.handleQuizAnswer(socket.id, val.quizId, val.answer);
    socket.emit(SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK, res);
  }

  handleDisconnect(socket) {
    const retainForReconnect = ['COUNTDOWN', 'RACING', 'QUIZ', 'ROUND_FINISHED', 'MATCH_FINISHED']
      .includes(this.gameManager.state);
    this.gameManager.cleanupDisconnectedPlayer(socket.id, !retainForReconnect);
    this.gameManager.teamManager.disconnectPlayer(socket.id, retainForReconnect);
    this.io.emit(SERVER_TO_CLIENT.GAME_TEAM_UPDATED, { 
      teams: this.gameManager.teamManager.getAllTeamsInfo(),
      totalPlayers: this.gameManager.teamManager.players.size
    });
  }
}

module.exports = GuestHandler;
