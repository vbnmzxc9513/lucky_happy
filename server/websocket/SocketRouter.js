const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = require('../../shared/events');
const GuestHandler = require('./GuestHandler');
const HostHandler = require('./HostHandler');
const AdminHandler = require('./AdminHandler');

class SocketRouter {
  constructor(io, gameManager) {
    this.io = io;
    this.gameManager = gameManager;
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

  init() {
    this.io.on('connection', (socket) => {
      const role = socket.data && socket.data.role ? socket.data.role : 'guest';
      console.log(`新連線建立: ${socket.id} (${role})`);

      // 送出初始化狀態同步與地圖表
      socket.emit(SERVER_TO_CLIENT.GAME_STATE_SYNC, this.gameManager.getGameState());
      socket.emit(SERVER_TO_CLIENT.GAME_MAP_LIST, this.gameManager.mapManager.getMapList());

      if (role === 'admin') {
        this.adminHandler.register(socket);
      }

      // 路由事件
      socket.on(CLIENT_TO_SERVER.GUEST_JOIN, (data) => this.guestHandler.handleJoin(socket, data));
      socket.on(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, (data) => this.guestHandler.handleChooseTeam(socket, data));
      socket.on(CLIENT_TO_SERVER.GUEST_TAP, (data) => this.guestHandler.handleTap(socket, data));
      socket.on(CLIENT_TO_SERVER.GUEST_QUIZ_ANSWER, (data) => this.guestHandler.handleQuizAnswer(socket, data));

      socket.on(CLIENT_TO_SERVER.HOST_SELECT_MAP, (data) => {
        if (this.hasRole(socket, ['host', 'admin'])) this.hostHandler.handleSelectMap(socket, data);
      });
      socket.on(CLIENT_TO_SERVER.HOST_START_ROUND, () => {
        if (this.hasRole(socket, ['host', 'admin'])) this.hostHandler.handleStartRound(socket);
      });
      socket.on(CLIENT_TO_SERVER.HOST_NEXT_ROUND, () => {
        if (this.hasRole(socket, ['host', 'admin'])) this.hostHandler.handleNextRound(socket);
      });
      socket.on(CLIENT_TO_SERVER.HOST_RESET_GAME, () => {
        if (this.hasRole(socket, ['host', 'admin'])) this.hostHandler.handleResetGame(socket);
      });

      socket.on('disconnect', () => {
        this.guestHandler.handleDisconnect(socket);
      });
    });
  }
}

module.exports = SocketRouter;
