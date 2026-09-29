const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = require('../../shared/events');
const GuestHandler = require('./GuestHandler');
const HostHandler = require('./HostHandler');
const AdminHandler = require('./AdminHandler');
const RealtimeDelivery = require('./RealtimeDelivery');

class SocketRouter {
  constructor(io, gameManager) {
    this.io = io;
    this.gameManager = gameManager;
    this.delivery = gameManager.delivery = new RealtimeDelivery(io, gameManager);
    this.guestHandler = new GuestHandler(io, gameManager);
    this.hostHandler = new HostHandler(io, gameManager);
    this.adminHandler = new AdminHandler(io, gameManager);
  }

  hasRole(socket, allowedRoles) {
    const role = socket.data && socket.data.role ? socket.data.role : 'guest';
    if (allowedRoles.includes(role)) return true;
    socket.emit(SERVER_TO_CLIENT.SYSTEM_ERROR, {
      code: 'FORBIDDEN',
      message: '權限不足，請重新開啟主持端或後台控制台。'
    });
    return false;
  }

  sendControlResult(socket, action, result) {
    const success = !!result;
    socket.emit(SERVER_TO_CLIENT.CONTROL_ACTION_RESULT, {
      action,
      success,
      ...(!success && action === 'START_ROUND' && !this.gameManager.mapManager.getCurrentMap()
        ? { reason: 'NO_MAP_AVAILABLE' } : {}),
      result: success && typeof result === 'object' ? result : null,
      state: this.gameManager.getGameState()
    });
  }

  registerControlEvents(socket) {
    const allowed = () => this.hasRole(socket, ['control', 'admin']);

    socket.on(CLIENT_TO_SERVER.CONTROL_SET_PRESENTATION, (data = {}) => {
      if (!allowed()) return;
      this.sendControlResult(socket, 'SET_PRESENTATION', this.gameManager.setPresentationStage(data.stage));
    });
    socket.on(CLIENT_TO_SERVER.CONTROL_SELECT_MAP, (data = {}) => {
      if (!allowed()) return;
      this.sendControlResult(socket, 'SELECT_MAP', this.gameManager.selectMap(data.mapId));
    });
    socket.on(CLIENT_TO_SERVER.CONTROL_START_ROUND, () => {
      if (!allowed()) return;
      this.sendControlResult(socket, 'START_ROUND', this.gameManager.startRound());
    });
    socket.on(CLIENT_TO_SERVER.CONTROL_PAUSE_GAME, () => {
      if (!allowed()) return;
      this.sendControlResult(socket, 'PAUSE_GAME', this.gameManager.pauseGame());
    });
    socket.on(CLIENT_TO_SERVER.CONTROL_RESUME_GAME, () => {
      if (!allowed()) return;
      this.sendControlResult(socket, 'RESUME_GAME', this.gameManager.resumeGame());
    });
    socket.on(CLIENT_TO_SERVER.CONTROL_RESET_GAME, () => {
      if (!allowed()) return;
      this.sendControlResult(socket, 'RESET_GAME', this.gameManager.resetGame());
    });
    socket.on(CLIENT_TO_SERVER.CONTROL_AWARD_ACTION, (data = {}) => {
      if (!allowed()) return;
      this.sendControlResult(socket, 'AWARD_ACTION', this.gameManager.handleAwardAction(data.action));
    });
    socket.on(CLIENT_TO_SERVER.CONTROL_FORCE_QUIZ, (data = {}) => {
      if (!allowed()) return;
      this.sendControlResult(socket, 'FORCE_QUIZ', this.gameManager.forceTriggerQuiz(data.quizId, data.timeLimit));
    });
    socket.on(CLIENT_TO_SERVER.CONTROL_FORCE_ITEM, (data = {}) => {
      if (!allowed()) return;
      this.sendControlResult(socket, 'FORCE_ITEM', this.gameManager.forceTriggerItem(data.teamId, data.itemType));
    });
  }

  registerQuizFlowEvent(socket) {
    socket.on(CLIENT_TO_SERVER.CONTROL_ADVANCE_QUIZ_FLOW, (data = {}) => {
      const allowed = ['control', 'admin'].includes(socket.data?.role)
        && socket.data?.hasStaffAccess?.() === true;
      const result = allowed ? this.gameManager.advanceQuizFlow(data) : { success: false, reason: 'FORBIDDEN' };
      socket.emit(SERVER_TO_CLIENT.CONTROL_ACTION_RESULT, {
        action: 'ADVANCE_QUIZ_FLOW', requestId: data?.requestId,
        ...result,
        ...(allowed ? { state: this.gameManager.getGameState() } : {})
      });
    });
  }

  init() {
    this.io.on('connection', (socket) => {
      if (socket.handshake.auth?.protocolVersion !== 2) {
        socket.emit(SERVER_TO_CLIENT.SYSTEM_ERROR, { code: 'PROTOCOL_MISMATCH', message: '遊戲已更新，請重新整理頁面。' });
        socket.disconnect(true);
        return;
      }
      socket.data.protocolVersion = 2;
      this.registerQuizFlowEvent(socket);
      this.delivery.instrumentSocket?.(socket);
      const role = socket.data && socket.data.role ? socket.data.role : 'guest';
      socket.join(['protocol:2', `role:${role}`]);
      if (process.env.QUIET_SOCKET_LOGS !== '1') {
        console.log(`新連線建立: ${socket.id} (${role})`);
      }

      // 送出初始化狀態同步與地圖表
      this.delivery.sendState(socket);
      if (role !== 'guest') socket.emit(SERVER_TO_CLIENT.GAME_MAP_LIST, this.gameManager.mapManager.getMapList());
      socket.on(CLIENT_TO_SERVER.GUEST_SYNC, () => {
        const now = Date.now();
        if (now - (socket.data.lastSync || 0) < 500) return;
        socket.data.lastSync = now;
        this.delivery.sendState(socket);
        this.gameManager.emitPlayerStatus(socket.id);
        this.gameManager.emitActiveQuizRecovery(socket, role);
      });

      if (role === 'admin') {
        this.adminHandler.register(socket);
      }
      if (role === 'control') {
        socket.emit(SERVER_TO_CLIENT.ADMIN_CONFIG_UPDATED, this.gameManager.config);
        socket.emit('admin:quiz_list', this.gameManager.quizLoader.getAllQuizzes());
      }
      if (role === 'host' || role === 'admin' || role === 'control') {
        this.gameManager.emitActiveQuizRecovery(socket, role);
      }
      if (role === 'control' || role === 'admin') this.registerControlEvents(socket);

      // 路由事件
      socket.on(CLIENT_TO_SERVER.GUEST_JOIN, (data) => this.guestHandler.handleJoin(socket, data));
      socket.on(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, (data) => this.guestHandler.handleChooseTeam(socket, data));
      socket.on(CLIENT_TO_SERVER.GUEST_TAP, (data) => this.guestHandler.handleTap(socket, data));
      socket.on(CLIENT_TO_SERVER.GUEST_QUIZ_ANSWER, (data) => this.guestHandler.handleQuizAnswer(socket, data));

      socket.on(CLIENT_TO_SERVER.HOST_SELECT_MAP, (data) => {
        if (this.hasRole(socket, ['control', 'admin'])) this.hostHandler.handleSelectMap(socket, data);
      });
      socket.on(CLIENT_TO_SERVER.HOST_START_ROUND, () => {
        if (this.hasRole(socket, ['control', 'admin'])) this.hostHandler.handleStartRound(socket);
      });
      socket.on(CLIENT_TO_SERVER.HOST_NEXT_ROUND, () => {
        if (this.hasRole(socket, ['control', 'admin'])) this.hostHandler.handleNextRound(socket);
      });
      socket.on(CLIENT_TO_SERVER.HOST_RESET_GAME, () => {
        if (this.hasRole(socket, ['control', 'admin'])) this.hostHandler.handleResetGame(socket);
      });

      socket.on('disconnect', () => {
        this.guestHandler.handleDisconnect(socket);
      });
    });
  }
}

module.exports = SocketRouter;
