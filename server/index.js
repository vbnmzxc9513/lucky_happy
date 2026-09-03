const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('./config');
const GameManager = require('./game/GameManager');
const SocketRouter = require('./websocket/SocketRouter');
const { getPreferredLanAddress, resolvePublicBaseUrl } = require('./network/JoinUrlResolver');

const app = express();
app.set('trust proxy', 1);
app.use(cors(config.corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const STAFF_COOKIE_NAME = 'lucky_horse_staff';
const STAFF_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const STAFF_SOCKET_ROLES = new Set(['host', 'admin', 'control']);

function parseCookies(cookieHeader = '') {
  const cookies = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function signStaffPayload(payload) {
  return crypto
    .createHmac('sha256', config.staffSessionSecret)
    .update(payload)
    .digest('hex');
}

function createStaffSessionCookie(req) {
  const payload = Buffer.from(JSON.stringify({
    ok: true,
    expiresAt: Date.now() + STAFF_SESSION_TTL_MS
  })).toString('base64url');
  const signature = signStaffPayload(payload);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${STAFF_COOKIE_NAME}=${encodeURIComponent(`${payload}.${signature}`)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(STAFF_SESSION_TTL_MS / 1000)}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearStaffSessionCookie() {
  return `${STAFF_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function verifyStaffSession(rawCookie) {
  if (!rawCookie || typeof rawCookie !== 'string') return false;
  const [payload, signature] = rawCookie.split('.');
  if (!payload || !signature) return false;

  const expected = signStaffPayload(payload);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data && data.ok === true && Number(data.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function hasStaffAccessFromHeader(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  return verifyStaffSession(cookies[STAFF_COOKIE_NAME]);
}

function safeNextPath(nextPath) {
  const raw = typeof nextPath === 'string' ? nextPath : '/manage';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/manage';
  return raw;
}

function getRequestOrigin(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  const protocol = forwardedProto || req.protocol || 'http';
  return host ? `${protocol}://${host}` : '';
}

function renderStaffLogin({ next = '/manage', error = '' } = {}) {
  const escapedNext = String(safeNextPath(next))
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  const errorHtml = error ? `<p class="error">${error}</p>` : '';
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lucky Horse 工作人員驗證</title>
  <style>
    :root { --mint:#9EDBD0; --deep:#315E58; --ink:#20383B; --gold:#F5D06B; --line:rgba(255,255,255,.72); }
    * { box-sizing:border-box; }
    body { min-height:100vh; margin:0; display:grid; place-items:center; padding:24px; color:var(--ink); background:radial-gradient(circle at 50% 14%, rgba(255,255,255,.34), transparent 42%), var(--mint); font-family:"Microsoft JhengHei","Noto Sans TC",Arial,sans-serif; }
    body::before { content:""; position:fixed; inset:0; background-image:radial-gradient(rgba(32,56,59,.14) 1px, transparent 1px); background-size:18px 18px; pointer-events:none; }
    main { position:relative; z-index:1; width:min(420px,100%); padding:34px 30px; border:3px solid var(--line); border-radius:24px; background:rgba(159,213,204,.86); box-shadow:0 18px 45px rgba(55,88,86,.2); backdrop-filter:blur(14px); }
    .tag { display:inline-flex; padding:8px 14px; border-radius:999px; border:2px solid #D6A742; background:var(--gold); font-size:12px; font-weight:900; }
    h1 { margin:20px 0 8px; font-size:32px; line-height:1.1; }
    p { margin:0 0 22px; color:var(--deep); font-weight:800; line-height:1.5; }
    label { display:block; margin-bottom:8px; color:var(--deep); font-weight:900; }
    input { width:100%; height:54px; padding:0 16px; border:2px solid rgba(255,255,255,.68); border-radius:16px; background:rgba(255,255,255,.34); color:var(--ink); font-size:24px; font-weight:900; text-align:center; letter-spacing:8px; outline:none; }
    input:focus { border-color:var(--gold); box-shadow:0 0 0 4px rgba(245,208,107,.18); }
    button { width:100%; height:54px; margin-top:18px; border:2px solid #D6A742; border-radius:18px; background:var(--deep); color:#FDFBF2; font-size:18px; font-weight:900; cursor:pointer; }
    button:active { transform:scale(.98); }
    .error { margin:14px 0 0; color:#C23830; }
  </style>
</head>
<body>
  <main>
    <span class="tag">LUCKY HORSE STAFF</span>
    <h1>工作人員驗證</h1>
    <p>請輸入活動驗證碼進入投影、主持控制台與後台。</p>
    <form method="post" action="/staff-login">
      <input type="hidden" name="next" value="${escapedNext}">
      <label for="code">驗證碼</label>
      <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" autofocus>
      <button type="submit">進入工作人員頁面</button>
      ${errorHtml}
    </form>
  </main>
</body>
</html>`;
}

function requireStaffAccess(req, res, next) {
  if (hasStaffAccessFromHeader(req.headers.cookie)) return next();
  if (req.method === 'GET') {
    res.redirect(`/staff-login?next=${encodeURIComponent(req.originalUrl || '/manage')}`);
    return;
  }
  res.status(401).json({ error: 'STAFF_CODE_REQUIRED' });
}

app.get('/staff-login', (req, res) => {
  if (hasStaffAccessFromHeader(req.headers.cookie)) {
    res.redirect(safeNextPath(req.query.next));
    return;
  }
  res.send(renderStaffLogin({ next: req.query.next }));
});

app.post('/staff-login', (req, res) => {
  const code = String((req.body && req.body.code) || '').trim();
  const nextPath = safeNextPath(req.body && req.body.next);
  if (code === config.staffAccessCode) {
    res.setHeader('Set-Cookie', createStaffSessionCookie(req));
    res.redirect(nextPath);
    return;
  }
  res.status(401).send(renderStaffLogin({ next: nextPath, error: '驗證碼不正確，請再輸入一次。' }));
});

app.post('/staff-logout', (req, res) => {
  res.setHeader('Set-Cookie', clearStaffSessionCookie());
  res.redirect('/guest/');
});

app.get('/api/join-info', async (req, res) => {
  try {
    const resolved = resolvePublicBaseUrl({
      configuredBaseUrl: config.publicBaseUrl,
      requestOrigin: getRequestOrigin(req)
    });
    const joinUrl = `${resolved.baseUrl}/guest/`;
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 320,
      color: { dark: '#172f2c', light: '#ffffff' }
    });

    res.json({
      joinUrl,
      qrDataUrl,
      source: resolved.source,
      warning: resolved.warning || ''
    });
  } catch (error) {
    console.error('QR code generation failed:', error);
    res.status(500).json({ error: 'JOIN_QR_GENERATION_FAILED' });
  }
});

// 靜態檔案託管
app.use('/docs', express.static(config.paths.docs));
app.use('/assets', express.static(config.paths.hostAssets));
app.use('/host', requireStaffAccess, express.static(config.paths.host));
app.use('/guest', express.static(config.paths.guest));
app.use('/control', requireStaffAccess, express.static(config.paths.control));
app.use('/admin', requireStaffAccess, express.static(config.paths.admin));
app.use('/shared', express.static(config.paths.shared));

app.get('/manage', requireStaffAccess, (req, res) => {
  res.sendFile(path.join(config.paths.home, 'index.html'));
});

// 來賓掃碼入口
app.get('/', (req, res) => {
  res.redirect('/guest/');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: config.corsOptions,
  pingInterval: 25000,
  pingTimeout: 20000,
  perMessageDeflate: false
});

io.use((socket, next) => {
  const auth = socket.handshake.auth || {};
  const requestedRole = auth.role;

  if (!requestedRole) {
    socket.data.role = 'guest';
    return next();
  }

  if (STAFF_SOCKET_ROLES.has(requestedRole) && hasStaffAccessFromHeader(socket.handshake.headers.cookie)) {
    socket.data.role = requestedRole;
    return next();
  }

  return next(new Error('UNAUTHORIZED_STAFF_SOCKET'));
});

// 初始化遊戲主控器與路由
const gameManager = new GameManager(io);
const socketRouter = new SocketRouter(io, gameManager);
socketRouter.init();

let eventLoopLagMs = 0;
let expectedEventLoopTick = Date.now() + 1000;
const eventLoopMonitor = setInterval(() => {
  const now = Date.now();
  eventLoopLagMs = Math.max(0, now - expectedEventLoopTick);
  expectedEventLoopTick = now + 1000;
}, 1000);
eventLoopMonitor.unref();

app.get('/healthz', (req, res) => {
  const memory = process.memoryUsage();
  res.json({
    status: 'ok',
    state: gameManager.state,
    uptimeSeconds: Math.round(process.uptime()),
    connectedSockets: io.engine.clientsCount,
    eventLoopLagMs,
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024)
    }
  });
});

// 捕捉重複啟動與連接埠衝突 (EADDRINUSE)，給予人性化無腦提示
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('====================================================================');
    console.log(`⚠️  【連接埠 ${config.port} 已被佔用】`);
    console.log(`💡 系統偵測到您已經有一個 Lucky Horse 遊戲伺服器在其他視窗或背景運作中！`);
    console.log(`👉 您不需要重複執行 npm run dev！請直接打開瀏覽器前往：`);
    console.log(`   🏠 主頁選單: http://localhost:${config.port}/`);
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
  const lanAddress = getPreferredLanAddress();
  const configuredGuestUrl = config.publicBaseUrl ? `${config.publicBaseUrl.replace(/\/$/, '')}/guest/` : '';
  const lanGuestUrl = lanAddress ? `http://${lanAddress}:${config.port}/guest/` : '';
  console.log('==================================================');
  console.log(`🏇 Lucky Horse v1.1 遊戲伺服器已啟動！(支援 --watch 熱重載)`);
  console.log(`📱 賓客掃碼入口:   http://localhost:${config.port}/guest`);
  console.log(`🧭 工作人員選單:   http://localhost:${config.port}/manage`);
  console.log(`🖥️  大螢幕主持端: http://localhost:${config.port}/host`);
  console.log(`🎛️  主持控制台:   http://localhost:${config.port}/control`);
  console.log(`⚙️  後台彩排控制台: http://localhost:${config.port}/admin`);
  if (configuredGuestUrl) console.log(`🌐 對外掃碼網址:   ${configuredGuestUrl}`);
  else if (lanGuestUrl) console.log(`📶 區網掃碼網址:   ${lanGuestUrl}`);
  else console.log('⚠️  尚未偵測到手機可連線網址，請設定 PUBLIC_BASE_URL。');
  console.log('==================================================');
});

// 優雅關閉 (Graceful Shutdown) - 確保重新啟動或結束時不發生 EADDRINUSE 埠號佔用
const gracefulShutdown = (signal) => {
  console.log(`\n⚠️ 收到 ${signal} 信號，正在優雅關閉伺服器與 Socket 連線...`);
  if (gameManager) gameManager.stopGameLoop();
  clearInterval(eventLoopMonitor);
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
