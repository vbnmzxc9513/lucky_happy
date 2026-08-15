const Validators = require('../../shared/validators');

class HostHandler {
  constructor(io, gameManager) {
    this.io = io;
    this.gameManager = gameManager;
  }

  handleSelectMap(socket, data) {
    const val = Validators.validateSelectMap(data);
    if (!val.valid) return;
    this.gameManager.selectMap(val.mapId);
  }

  handleStartRound(socket) {
    this.gameManager.startRound();
  }

  handleNextRound(socket) {
    this.gameManager.nextRound();
  }

  handleResetGame(socket) {
    this.gameManager.resetGame();
  }
}

module.exports = HostHandler;
