const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = require('../../shared/events');

class AdminHandler {
  constructor(io, gameManager) {
    this.io = io;
    this.gameManager = gameManager;
  }

  register(socket) {
    // 當後台連線時，傳送當前設定、地圖清單與題庫清單
    socket.emit(SERVER_TO_CLIENT.ADMIN_CONFIG_UPDATED, this.gameManager.config);
    socket.emit('admin:map_list', this.gameManager.mapManager.getMapList());
    socket.emit('admin:quiz_list', this.gameManager.quizLoader.getAllQuizzes());
    socket.emit('admin:simulation_stats', {
      activeBots: this.gameManager.simBots ? this.gameManager.simBots.length : 0,
      isRunning: !!this.gameManager.botInterval
    });

    socket.on(CLIENT_TO_SERVER.ADMIN_UPDATE_CONFIG, (data) => {
      const res = this.gameManager.updateConfig(data);
      socket.emit('admin:response', { action: 'UPDATE_CONFIG', success: res });
    });

    socket.on(CLIENT_TO_SERVER.ADMIN_SAVE_MAP, (data) => {
      const res = this.gameManager.mapManager.saveMap(data);
      if (res) {
        this.io.emit('admin:map_list', this.gameManager.mapManager.getMapList());
        this.io.emit(SERVER_TO_CLIENT.GAME_MAP_LIST, this.gameManager.mapManager.getMapList());
      }
      socket.emit('admin:response', { action: 'SAVE_MAP', success: res });
    });

    socket.on('admin:delete_map', (data) => {
      const res = this.gameManager.mapManager.deleteMap(data.mapId);
      if (res) {
        this.io.emit('admin:map_list', this.gameManager.mapManager.getMapList());
        this.io.emit(SERVER_TO_CLIENT.GAME_MAP_LIST, this.gameManager.mapManager.getMapList());
      }
      socket.emit('admin:response', { action: 'DELETE_MAP', success: res });
    });

    socket.on(CLIENT_TO_SERVER.ADMIN_SAVE_QUIZ, (data) => {
      const res = this.gameManager.quizLoader.saveQuiz(data);
      if (res) {
        this.io.emit('admin:quiz_list', this.gameManager.quizLoader.getAllQuizzes());
      }
      socket.emit('admin:response', { action: 'SAVE_QUIZ', success: res });
    });

    socket.on('admin:delete_quiz', (data) => {
      const res = this.gameManager.quizLoader.deleteQuiz(data.quizId);
      if (res) {
        this.io.emit('admin:quiz_list', this.gameManager.quizLoader.getAllQuizzes());
      }
      socket.emit('admin:response', { action: 'DELETE_QUIZ', success: res });
    });

    socket.on(CLIENT_TO_SERVER.ADMIN_SPAWN_BOTS, (data) => {
      const count = (data && data.count) ? Number(data.count) : 50;
      const res = this.gameManager.startBotSimulation(count);
      this.io.emit('admin:simulation_stats', { activeBots: res.count, isRunning: true });
      socket.emit('admin:response', { action: 'SPAWN_BOTS', success: res.success, count: res.count });
    });

    socket.on(CLIENT_TO_SERVER.ADMIN_CLEAR_BOTS, () => {
      const res = this.gameManager.stopBotSimulation();
      this.io.emit('admin:simulation_stats', { activeBots: 0, isRunning: false });
      socket.emit('admin:response', { action: 'CLEAR_BOTS', success: res.success });
    });

    socket.on(CLIENT_TO_SERVER.ADMIN_FORCE_TRIGGER, (data) => {
      let res = false;
      if (data && data.type === 'QUIZ') {
        res = this.gameManager.forceTriggerQuiz(data.targetId);
      } else if (data && data.type === 'ITEM') {
        res = this.gameManager.forceTriggerItem(data.teamId || 'red', data.itemType || 'large_boost');
      }
      socket.emit('admin:response', { action: 'FORCE_TRIGGER', success: res });
    });
  }
}

module.exports = AdminHandler;
