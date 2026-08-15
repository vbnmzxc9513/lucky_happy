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

    const isReconnect = data.isReconnect === true;
    const res = this.gameManager.teamManager.addPlayer(socket.id, val.nickname, data.avatar || '🙂', isReconnect);
    if (!res.success) {
      if (res.reason === 'RACE_IN_PROGRESS') {
        socket.emit(SERVER_TO_CLIENT.GAME_JOIN_LOCKED, { reason: 'RACE_IN_PROGRESS' });
      }
      return;
    }

    if (isReconnect && data.teamId) {
      this.gameManager.teamManager.chooseTeam(socket.id, data.teamId, true);
    }
    this.gameManager.upsertPlayerStats(this.gameManager.teamManager.getPlayer(socket.id));

    socket.emit(SERVER_TO_CLIENT.GAME_STATE_SYNC, this.gameManager.getGameState());
    this.io.emit(SERVER_TO_CLIENT.GAME_PLAYER_JOINED, { 
      player: res.player, 
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
  }

  handleTap(socket, data) {
    const val = Validators.validateTap(data);
    if (!val.valid) return;
    this.gameManager.handleTap(socket.id, val.timestamp);
  }

  handleQuizAnswer(socket, data) {
    const val = Validators.validateQuizAnswer(data);
    if (!val.valid) return;

    const res = this.gameManager.handleQuizAnswer(socket.id, val.quizId, val.answer);
    socket.emit(SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK, res);
  }

  handleDisconnect(socket) {
    this.gameManager.cleanupDisconnectedPlayer(socket.id);
    this.gameManager.teamManager.removePlayer(socket.id);
    this.io.emit(SERVER_TO_CLIENT.GAME_TEAM_UPDATED, { 
      teams: this.gameManager.teamManager.getAllTeamsInfo(),
      totalPlayers: this.gameManager.teamManager.players.size
    });
  }
}

module.exports = GuestHandler;
