const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const GameManager = require('./game/GameManager');
const SocketRouter = require('./websocket/SocketRouter');

const app = express();
app.use(cors(config.corsOptions));
app.use(express.json());

// 簡單的密碼鎖 (Basic Auth) 保護主控台與後台
function basicAuth(req, res, next) {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login === config.adminUser && password === config.adminPass) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="LuckyHorse Admin"');
  res.status(401).send('Authentication required.');
}

const SOCKET_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const PRIVILEGED_SOCKET_ROLES = new Set(['host', 'admin']);

function signSocketToken(role, expiresAt) {
  return crypto
    .createHmac('sha256', `${config.adminUser}:${config.adminPass}`)
    .update(`${role}:${expiresAt}`)
    .digest('hex');
}

function createSocketToken(role) {
  const expiresAt = Date.now() + SOCKET_TOKEN_TTL_MS;
  return `${role}:${expiresAt}:${signSocketToken(role, expiresAt)}`;
}

function verifySocketToken(role, token) {
  if (!PRIVILEGED_SOCKET_ROLES.has(role) || typeof token !== 'string') return false;
  const [tokenRole, expiresAtRaw, signature] = token.split(':');
  const expiresAt = Number(expiresAtRaw);
  if (tokenRole !== role || !Number.isFinite(expiresAt) || Date.now() > expiresAt || !signature) {
    return false;
  }

  const expected = signSocketToken(role, expiresAt);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

app.get('/socket-token/:role', basicAuth, (req, res) => {
  const role = req.params.role;
  if (!PRIVILEGED_SOCKET_ROLES.has(role)) {
    res.status(400).json({ error: 'INVALID_SOCKET_ROLE' });
    return;
  }
  res.json({ role, token: createSocketToken(role) });
});

// 靜態檔案託管
app.use('/host', basicAuth, express.static(config.paths.host));
app.use('/guest', express.static(config.paths.guest));
app.use('/admin', basicAuth, express.static(config.paths.admin));
app.use('/shared', express.static(config.paths.shared));

// 首頁自動導向 Host
app.get('/', (req, res) => {
  res.redirect('/host');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: config.corsOptions
});

io.use((socket, next) => {
  const auth = socket.handshake.auth || {};
  const requestedRole = auth.role;

  if (!requestedRole) {
    socket.data.role = 'guest';
    return next();
  }

  if (verifySocketToken(requestedRole, auth.token)) {
    socket.data.role = requestedRole;
    return next();
  }

  return next(new Error('UNAUTHORIZED_PRIVILEGED_SOCKET'));
});

// 初始化遊戲主控器與路由
const gameManager = new GameManager(io);
const socketRouter = new SocketRouter(io, gameManager);
socketRouter.init();

// 捕捉重複啟動與連接埠衝突 (EADDRINUSE)，給予人性化無腦提示
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('====================================================================');
    console.log(`⚠️  【連接埠 ${config.port} 已被佔用】`);
    console.log(`💡 系統偵測到您已經有一個 Lucky Horse 遊戲伺服器在其他視窗或背景運作中！`);
    console.log(`👉 您不需要重複執行 npm run dev！請直接打開瀏覽器前往：`);
    console.log(`   http://localhost:${config.port}/host  或  http://localhost:${config.port}/guest`);
    console.log(`   ⚙️ 後台彩排控制台: http://localhost:${config.port}/admin`);
    console.log(`💡 (若您想強制重啟，請至原運行視窗按 Ctrl+C 結束舊進程後再試)`);
    console.log('====================================================================\n');
    process.exit(0);
  } else {
    console.error('❌ 伺服器啟動發生未知錯誤:', err);
    process.exit(1);
  }
});

server.listen(config.port, () => {
  console.log('==================================================');
  console.log(`🏇 Lucky Horse v1.1 遊戲伺服器已啟動！(支援 --watch 熱重載)`);
  console.log(`🖥️  大螢幕主持端: http://localhost:${config.port}/host`);
  console.log(`📱 手機賓客端:   http://localhost:${config.port}/guest`);
  console.log(`⚙️  後台彩排控制台: http://localhost:${config.port}/admin`);
  console.log('==================================================');
});

// 優雅關閉 (Graceful Shutdown) - 確保重新啟動或結束時不發生 EADDRINUSE 埠號佔用
const gracefulShutdown = (signal) => {
  console.log(`\n⚠️ 收到 ${signal} 信號，正在優雅關閉伺服器與 Socket 連線...`);
  if (gameManager) gameManager.stopGameLoop();
  io.close(() => {
    console.log('✅ 所有 WebSocket 連線已安全中斷。');
    server.close(() => {
      console.log('✅ HTTP 伺服器已關閉，連接埠已釋放。');
      process.exit(0);
    });
  });
  // 3 秒後強制關閉防護
  setTimeout(() => {
    console.error('❌ 強制釋放進程與連接埠！');
    process.exit(1);
  }, 3000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = { app, server, io, gameManager };
