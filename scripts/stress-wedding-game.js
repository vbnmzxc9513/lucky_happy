const { io } = require('socket.io-client');
const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = require('../shared/events');
const DEFAULT_CONFIG = require('../shared/game-config');

const TEAM_IDS = DEFAULT_CONFIG.TEAMS.map(team => team.id);
const AVATARS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const withoutPrefix = raw.slice(2);
    const eqIndex = withoutPrefix.indexOf('=');
    if (eqIndex >= 0) {
      args[withoutPrefix.slice(0, eqIndex)] = withoutPrefix.slice(eqIndex + 1);
    } else {
      const next = argv[i + 1];
      args[withoutPrefix] = next && !next.startsWith('--') ? argv[++i] : 'true';
    }
  }
  return args;
}

const cli = parseArgs(process.argv.slice(2));
const CONFIG = {
  url: cli.url || process.env.SERVER_URL || 'http://localhost:3000',
  clients: Number(cli.clients || process.env.CLIENTS || 150),
  tapRate: Number(cli.tapRate || process.env.TAP_RATE || 5),
  answerRate: Number(cli.answerRate || process.env.ANSWER_RATE || 0.98),
  maxSeconds: Number(cli.maxSeconds || process.env.MAX_SECONDS || 540),
  connectTimeoutMs: Number(cli.connectTimeoutMs || process.env.CONNECT_TIMEOUT_MS || 30000),
  settleMs: Number(cli.settleMs || process.env.SETTLE_MS || 1200),
  transport: cli.transport || process.env.TRANSPORT || 'websocket',
  adminUser: cli.adminUser || process.env.ADMIN_USER || 'admin',
  adminPass: cli.adminPass || process.env.ADMIN_PASS || 'lucky2026'
};

const metrics = {
  connected: 0,
  connectErrors: 0,
  disconnects: 0,
  teamChosen: 0,
  joinLocked: 0,
  systemErrors: 0,
  tapsSent: 0,
  quizOptions: 0,
  quizAnswersSent: 0,
  quizAnswerAck: 0,
  quizAnswerAccepted: 0,
  quizStarts: 0,
  quizResults: 0,
  roundFinished: 0,
  matchFinishedAt: null,
  hostPositionUpdates: 0,
  hostPositionIntervals: [],
  sampleClientPositionUpdates: 0,
  httpLatencies: [],
  latestRacePacing: null,
  finalAwards: null
};

let hostSocket = null;
let clients = [];
let currentState = 'UNKNOWN';
let raceStartedAt = null;
let lastHostPositionAt = null;
let httpProbeTimer = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function log(message) {
  const ts = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  console.log(`[${ts}] ${message}`);
}

async function waitUntil(predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function getSocketToken(role) {
  const basic = Buffer.from(`${CONFIG.adminUser}:${CONFIG.adminPass}`).toString('base64');
  const response = await fetch(`${CONFIG.url}/socket-token/${role}`, {
    headers: { Authorization: `Basic ${basic}` }
  });
  if (!response.ok) {
    throw new Error(`Unable to fetch ${role} token: HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.token;
}

function createSocket(auth) {
  return io(CONFIG.url, {
    auth,
    transports: [CONFIG.transport],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 500,
    timeout: 10000
  });
}

async function connectHost() {
  const token = await getSocketToken('host');
  hostSocket = createSocket({ role: 'host', token });

  hostSocket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, state => {
    currentState = state.state;
    if (state.racePacing) metrics.latestRacePacing = state.racePacing;
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_POSITION_UPDATE, () => {
    const now = Date.now();
    metrics.hostPositionUpdates++;
    if (lastHostPositionAt) {
      metrics.hostPositionIntervals.push(now - lastHostPositionAt);
    }
    lastHostPositionAt = now;
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_QUIZ_START, () => {
    metrics.quizStarts++;
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_QUIZ_RESULT, () => {
    metrics.quizResults++;
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_ROUND_FINISHED, () => {
    metrics.roundFinished++;
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_MATCH_FINISHED, data => {
    metrics.matchFinishedAt = Date.now();
    metrics.finalAwards = data && data.finalAwards ? data.finalAwards : null;
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Host connect timeout')), CONFIG.connectTimeoutMs);
    hostSocket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    hostSocket.once('connect_error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function createGuest(index) {
  const socket = createSocket();
  const client = {
    index,
    socket,
    teamId: TEAM_IDS[index % TEAM_IDS.length],
    nickname: `Stress_${String(index + 1).padStart(3, '0')}`,
    avatar: AVATARS[index % AVATARS.length],
    connected: false,
    tapTimer: null,
    answeredQuizIds: new Set()
  };

  socket.on('connect', () => {
    if (!client.connected) metrics.connected++;
    client.connected = true;
  });

  socket.on('connect_error', () => {
    metrics.connectErrors++;
  });

  socket.on('disconnect', () => {
    if (client.tapTimer) {
      clearInterval(client.tapTimer);
      client.tapTimer = null;
    }
    if (client.connected) metrics.disconnects++;
    client.connected = false;
  });

  socket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, state => {
    if (state.state === 'RACING') {
      startTapping(client);
    } else {
      stopTapping(client);
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_POSITION_UPDATE, () => {
    if (index % 25 === 0) metrics.sampleClientPositionUpdates++;
  });

  socket.on(SERVER_TO_CLIENT.GAME_JOIN_LOCKED, () => {
    metrics.joinLocked++;
  });

  socket.on(SERVER_TO_CLIENT.SYSTEM_ERROR, () => {
    metrics.systemErrors++;
  });

  socket.on('guest:team_chosen', () => {
    metrics.teamChosen++;
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_OPTIONS, data => {
    metrics.quizOptions++;
    stopTapping(client);
    if (!data || !data.quizId || client.answeredQuizIds.has(data.quizId)) return;
    if (Math.random() > CONFIG.answerRate) return;
    client.answeredQuizIds.add(data.quizId);
    const timeLimitMs = Math.max(1000, Number(data.timeLimit || 10) * 1000);
    const delay = Math.min(timeLimitMs - 250, 300 + Math.floor(Math.random() * 4200));
    setTimeout(() => {
      if (!socket.connected) return;
      socket.emit(CLIENT_TO_SERVER.GUEST_QUIZ_ANSWER, {
        quizId: data.quizId,
        answer: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)]
      });
      metrics.quizAnswersSent++;
    }, Math.max(100, delay));
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK, ack => {
    metrics.quizAnswerAck++;
    if (ack && ack.success) metrics.quizAnswerAccepted++;
  });

  socket.on(SERVER_TO_CLIENT.GAME_ROUND_FINISHED, () => {
    stopTapping(client);
  });

  socket.on(SERVER_TO_CLIENT.GAME_MATCH_FINISHED, () => {
    stopTapping(client);
  });

  clients.push(client);
  return client;
}

function startTapping(client) {
  if (client.tapTimer || !client.socket.connected) return;
  const jitter = 0.85 + Math.random() * 0.3;
  const intervalMs = Math.max(50, Math.round(1000 / CONFIG.tapRate / jitter));
  client.tapTimer = setInterval(() => {
    if (!client.socket.connected) return;
    client.socket.emit(CLIENT_TO_SERVER.GUEST_TAP, { timestamp: Date.now() });
    metrics.tapsSent++;
  }, intervalMs);
}

function stopTapping(client) {
  if (!client.tapTimer) return;
  clearInterval(client.tapTimer);
  client.tapTimer = null;
}

async function connectGuests() {
  for (let i = 0; i < CONFIG.clients; i++) {
    createGuest(i);
  }
  await waitUntil(
    () => metrics.connected >= CONFIG.clients,
    CONFIG.connectTimeoutMs,
    `${CONFIG.clients} guest connections`
  );
}

async function joinAndChooseTeams() {
  clients.forEach((client, index) => {
    setTimeout(() => {
      client.socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
        nickname: client.nickname,
        avatar: client.avatar
      });
      setTimeout(() => {
        client.socket.emit(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, { teamId: client.teamId });
      }, 30);
    }, index * 8);
  });

  await waitUntil(
    () => metrics.teamChosen >= CONFIG.clients,
    Math.max(20000, CONFIG.clients * 120),
    `${CONFIG.clients} team selections`
  );
}

function startHttpProbe() {
  httpProbeTimer = setInterval(async () => {
    const started = Date.now();
    try {
      const response = await fetch(`${CONFIG.url}/guest/`, { cache: 'no-store' });
      if (response.ok) metrics.httpLatencies.push(Date.now() - started);
    } catch {
      metrics.httpLatencies.push(10000);
    }
  }, 5000);
}

function stopHttpProbe() {
  if (httpProbeTimer) {
    clearInterval(httpProbeTimer);
    httpProbeTimer = null;
  }
}

function printSummary() {
  const runMs = metrics.matchFinishedAt && raceStartedAt
    ? metrics.matchFinishedAt - raceStartedAt
    : Date.now() - raceStartedAt;
  const hostAvgGap = average(metrics.hostPositionIntervals);
  const hostP95Gap = percentile(metrics.hostPositionIntervals, 95);
  const httpAvg = average(metrics.httpLatencies);
  const httpP95 = percentile(metrics.httpLatencies, 95);

  console.log('');
  console.log('=== Stress Test Summary ===');
  console.log(`URL: ${CONFIG.url}`);
  console.log(`Clients: ${CONFIG.clients}`);
  console.log(`Tap rate: ${CONFIG.tapRate}/sec/client`);
  console.log(`Transport: ${CONFIG.transport}`);
  console.log(`Completed: ${metrics.matchFinishedAt ? 'yes' : 'no'}`);
  console.log(`Observed round time: ${formatDuration(runMs)}`);
  console.log(`Connected guests: ${metrics.connected}/${CONFIG.clients}`);
  console.log(`Team chosen: ${metrics.teamChosen}/${CONFIG.clients}`);
  console.log(`Unexpected disconnects: ${metrics.disconnects}`);
  console.log(`Connect errors: ${metrics.connectErrors}`);
  console.log(`Join locked events: ${metrics.joinLocked}`);
  console.log(`System errors: ${metrics.systemErrors}`);
  console.log(`Taps sent: ${metrics.tapsSent.toLocaleString('en-US')}`);
  console.log(`Quiz starts/results: ${metrics.quizStarts}/${metrics.quizResults}`);
  console.log(`Quiz answers accepted: ${metrics.quizAnswerAccepted}/${metrics.quizAnswersSent}`);
  console.log(`Host position updates: ${metrics.hostPositionUpdates.toLocaleString('en-US')}`);
  console.log(`Host position update gap avg/p95: ${hostAvgGap.toFixed(1)}ms / ${hostP95Gap.toFixed(1)}ms`);
  console.log(`HTTP /guest latency avg/p95: ${httpAvg.toFixed(1)}ms / ${httpP95.toFixed(1)}ms`);
  if (metrics.latestRacePacing) {
    console.log(`Applied track length: ${metrics.latestRacePacing.trackLength.toLocaleString('en-US')} px`);
    console.log(`Pacing fastest team size: ${metrics.latestRacePacing.fastestTeamSize}`);
  }
  if (metrics.finalAwards && Array.isArray(metrics.finalAwards.awards)) {
    console.log(`Final awards: ${metrics.finalAwards.awards.length}`);
  }
}

async function cleanup() {
  stopHttpProbe();
  clients.forEach(stopTapping);
  if (hostSocket && hostSocket.connected) {
    hostSocket.emit(CLIENT_TO_SERVER.HOST_RESET_GAME);
    await sleep(500);
  }
  clients.forEach(client => client.socket.disconnect());
  if (hostSocket) hostSocket.disconnect();
}

async function main() {
  log(`Connecting host to ${CONFIG.url}`);
  await connectHost();
  log('Resetting game to lobby');
  hostSocket.emit(CLIENT_TO_SERVER.HOST_RESET_GAME);
  await waitUntil(() => currentState === 'LOBBY', 10000, 'LOBBY state');

  log(`Connecting ${CONFIG.clients} guest sockets`);
  await connectGuests();
  log('Joining guests and choosing teams');
  await joinAndChooseTeams();
  await sleep(CONFIG.settleMs);

  log('Starting one-round showdown');
  startHttpProbe();
  raceStartedAt = Date.now();
  hostSocket.emit(CLIENT_TO_SERVER.HOST_START_ROUND);

  await waitUntil(
    () => Boolean(metrics.matchFinishedAt),
    CONFIG.maxSeconds * 1000,
    'match finish'
  );
  await sleep(1000);
  printSummary();

  const failed =
    metrics.connected < CONFIG.clients ||
    metrics.teamChosen < CONFIG.clients ||
    !metrics.matchFinishedAt ||
    metrics.disconnects > 0 ||
    metrics.systemErrors > 0 ||
    metrics.quizStarts < 3 ||
    metrics.quizResults < 3 ||
    percentile(metrics.hostPositionIntervals, 95) > 120;

  await cleanup();
  process.exit(failed ? 1 : 0);
}

main().catch(async error => {
  console.error('');
  console.error('Stress test failed:', error.message);
  if (raceStartedAt) printSummary();
  await cleanup();
  process.exit(1);
});
