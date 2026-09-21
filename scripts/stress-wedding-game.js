const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
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
const isEnabled = value => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
const CONFIG = {
  url: cli.url || process.env.SERVER_URL || 'http://localhost:3000',
  clients: Number(cli.clients || process.env.CLIENTS || 150),
  tapRate: Number(cli.tapRate || process.env.TAP_RATE || 5),
  answerRate: Number(cli.answerRate || process.env.ANSWER_RATE || 0.98),
  answerStrategy: cli.answerStrategy || process.env.ANSWER_STRATEGY || 'random',
  reconnectClients: Number(cli.reconnectClients || process.env.RECONNECT_CLIENTS || 0),
  reconnectAtQuiz: Number(cli.reconnectAtQuiz || process.env.RECONNECT_AT_QUIZ || 5),
  maxSeconds: Number(cli.maxSeconds || process.env.MAX_SECONDS || 540),
  connectTimeoutMs: Number(cli.connectTimeoutMs || process.env.CONNECT_TIMEOUT_MS || 30000),
  settleMs: Number(cli.settleMs || process.env.SETTLE_MS || 1200),
  transport: cli.transport || process.env.TRANSPORT || 'websocket',
  staffAccessCode: cli.staffAccessCode || process.env.STAFF_ACCESS_CODE || '1009',
  manualHost: isEnabled(cli.manualHost || process.env.MANUAL_HOST),
  readyOnly: isEnabled(cli.readyOnly || process.env.READY_ONLY),
  manualStartTimeoutSeconds: Number(cli.manualStartTimeoutSeconds || process.env.MANUAL_START_TIMEOUT_SECONDS || 1800),
  expectedTotalPlayers: Number(cli.expectedTotalPlayers || process.env.EXPECTED_TOTAL_PLAYERS || cli.clients || process.env.CLIENTS || 150),
  enforceDuration: isEnabled(cli.enforceDuration || process.env.ENFORCE_DURATION),
  minDurationSeconds: Number(cli.minDurationSeconds || process.env.MIN_DURATION_SECONDS || 415),
  maxDurationSeconds: Number(cli.maxDurationSeconds || process.env.MAX_DURATION_SECONDS || 370),
  reportPath: cli.report || process.env.STRESS_REPORT_PATH || ''
};

const metrics = {
  connected: 0,
  joinAccepted: 0,
  connectErrors: 0,
  disconnects: 0,
  intentionalDisconnects: 0,
  recoveredConnections: 0,
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
  healthLatencies: [],
  healthSamples: [],
  quizRuns: [],
  latestRacePacing: null,
  finalAwards: null,
  peakTotalPlayers: 0,
  finalSprintEvents: 0,
  stageSummaries: [],
  tapWindows: []
};

let hostSocket = null;
let clients = [];
let currentState = 'UNKNOWN';
let raceStartedAt = null;
let lastHostPositionAt = null;
let httpProbeTimer = null;
let reconnectWaveStarted = false;
const quizAnswerLabels = loadQuizAnswerLabels();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function monotonicNow() {
  return performance.now();
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

function normalizeQuizOptions(options) {
  if (Array.isArray(options)) return options;
  if (options && typeof options === 'object') {
    return ['A', 'B', 'C', 'D'].map(label => options[label] || '');
  }
  return ['', '', '', ''];
}

function normalizeCorrectAnswer(correctAnswer, options) {
  const labels = ['A', 'B', 'C', 'D'];
  if (typeof correctAnswer === 'number') return labels[correctAnswer] || 'A';
  if (typeof correctAnswer === 'string') {
    const raw = correctAnswer.trim();
    const upper = raw.toUpperCase();
    if (labels.includes(upper)) return upper;
    const optionIndex = normalizeQuizOptions(options).findIndex(option => option === raw);
    if (optionIndex >= 0) return labels[optionIndex];
  }
  return 'A';
}

function loadQuizAnswerLabels() {
  const answers = new Map();
  const quizDir = path.join(__dirname, '../data/quizzes');
  if (!fs.existsSync(quizDir)) return answers;
  for (const file of fs.readdirSync(quizDir)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(quizDir, file), 'utf8'));
    for (const quiz of data.quizzes || []) {
      answers.set(quiz.id, normalizeCorrectAnswer(quiz.correctAnswer, quiz.options));
    }
  }
  return answers;
}

function chooseAnswer(quizId) {
  const labels = ['A', 'B', 'C', 'D'];
  const correct = quizAnswerLabels.get(quizId) || labels[Math.floor(Math.random() * labels.length)];
  if (CONFIG.answerStrategy === 'correct') return correct;
  if (CONFIG.answerStrategy === 'wrong') {
    const wrongLabels = labels.filter(label => label !== correct);
    return wrongLabels[Math.floor(Math.random() * wrongLabels.length)];
  }
  return labels[Math.floor(Math.random() * labels.length)];
}

function log(message) {
  const ts = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  console.log(`[${ts}] ${message}`);
}

async function waitUntil(predicate, timeoutMs, label) {
  const start = monotonicNow();
  while (monotonicNow() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function getStaffCookie() {
  const response = await fetch(`${CONFIG.url}/staff-login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: CONFIG.staffAccessCode, next: '/control/' })
  });
  if (response.status !== 302) {
    throw new Error(`Unable to create staff session: HTTP ${response.status}`);
  }
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('Staff login did not return a cookie');
  return setCookie.split(';')[0];
}

function createSocket(auth, cookie = undefined) {
  return io(CONFIG.url, {
    auth,
    ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
    transports: [CONFIG.transport],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 500,
    timeout: 10000
  });
}

async function connectHost() {
  const cookie = await getStaffCookie();
  hostSocket = createSocket({ role: 'control' }, cookie);

  hostSocket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, state => {
    currentState = state.state;
    metrics.peakTotalPlayers = Math.max(metrics.peakTotalPlayers, Number(state.totalPlayers) || 0);
    if (!raceStartedAt && CONFIG.manualHost && ['COUNTDOWN', 'RACING', 'QUIZ'].includes(state.state)) {
      raceStartedAt = monotonicNow();
      log(`Human host started the match (${state.state})`);
    }
    if (state.racePacing) metrics.latestRacePacing = state.racePacing;
    const stage = state.quizStage;
    if (stage?.phase === 'summary' && !metrics.stageSummaries.some(s => s.stageNumber === stage.stageNumber)) {
      metrics.stageSummaries.push(stage.summary);
    }
    if (stage?.phase === 'tap' && !metrics.tapWindows.some(s => s.stageNumber === stage.stageNumber)) {
      metrics.tapWindows.push({ stageNumber: stage.stageNumber, seconds: (stage.endsAt - state.serverNow) / 1000 });
    }
  });

  const observePlayerCount = data => {
    metrics.peakTotalPlayers = Math.max(metrics.peakTotalPlayers, Number(data && data.totalPlayers) || 0);
  };
  hostSocket.on(SERVER_TO_CLIENT.GAME_PLAYER_JOINED, observePlayerCount);
  hostSocket.on(SERVER_TO_CLIENT.GAME_TEAM_UPDATED, observePlayerCount);

  hostSocket.on(SERVER_TO_CLIENT.GAME_POSITION_UPDATE, () => {
    const now = monotonicNow();
    metrics.hostPositionUpdates++;
    if (lastHostPositionAt) {
      metrics.hostPositionIntervals.push(now - lastHostPositionAt);
    }
    lastHostPositionAt = now;
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_QUIZ_START, data => {
    metrics.quizStarts++;
    metrics.quizRuns.push({
      quizId: data && data.quizId ? data.quizId : `quiz_${metrics.quizStarts}`,
      startedAt: monotonicNow(),
      resultAt: null,
      timeLimit: data && data.timeLimit ? Number(data.timeLimit) : 0,
      totalAnswers: 0,
      correctTeams: 0
    });
    if (!reconnectWaveStarted && CONFIG.reconnectClients > 0 && metrics.quizStarts === CONFIG.reconnectAtQuiz) {
      reconnectWaveStarted = true;
      const reconnectCount = Math.min(CONFIG.reconnectClients, clients.length);
      log(`Forcing ${reconnectCount} guest network drops during quiz ${metrics.quizStarts}`);
      clients.slice(0, reconnectCount).forEach(client => {
        client.expectingDisconnect = true;
        if (client.socket.io && client.socket.io.engine) client.socket.io.engine.close();
      });
    }
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_QUIZ_RESULT, data => {
    metrics.quizResults++;
    const quizId = data && data.quizId;
    const quizRun = [...metrics.quizRuns].reverse().find(run => !run.resultAt && (!quizId || run.quizId === quizId))
      || metrics.quizRuns[metrics.quizRuns.length - 1];
    if (quizRun) {
      quizRun.resultAt = monotonicNow();
      const teamResults = data && data.teamResults ? Object.values(data.teamResults) : [];
      quizRun.totalAnswers = teamResults.reduce((sum, result) => sum + (Number(result.answeredCount) || 0), 0);
      quizRun.correctTeams = teamResults.reduce((sum, result) => sum + (result.isCorrect ? 1 : 0), 0);
    }
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_ROUND_FINISHED, () => {
    metrics.roundFinished++;
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_MATCH_FINISHED, data => {
    metrics.matchFinishedAt = monotonicNow();
    metrics.finalAwards = data && data.finalAwards ? data.finalAwards : null;
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_FINAL_SPRINT, () => {
    metrics.finalSprintEvents++;
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
    sessionId: `stress-session-${String(index + 1).padStart(6, '0')}`,
    connected: false,
    tapTimer: null,
    answeredQuizIds: new Set(),
    joined: false,
    teamChosen: false,
    everConnected: false,
    expectingDisconnect: false
  };

  socket.on('connect', () => {
    if (!client.everConnected) {
      metrics.connected++;
      client.everConnected = true;
    } else {
      socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
        nickname: client.nickname,
        avatar: client.avatar,
        sessionId: client.sessionId,
        teamId: client.teamId
      });
    }
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
    if (client.connected) {
      if (client.expectingDisconnect) {
        metrics.intentionalDisconnects++;
        client.expectingDisconnect = false;
      } else {
        metrics.disconnects++;
      }
    }
    client.connected = false;
  });

  socket.on(SERVER_TO_CLIENT.GUEST_JOIN_ACK, ack => {
    if (ack && ack.success && !client.joined) {
      client.joined = true;
      metrics.joinAccepted++;
    }
    if (ack && ack.success && !client.teamChosen) {
      socket.emit(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, { teamId: client.teamId });
    }
    if (ack && ack.reconnected) metrics.recoveredConnections++;
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
    if (client.teamChosen) return;
    client.teamChosen = true;
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
        answer: chooseAnswer(data.quizId)
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
        avatar: client.avatar,
        sessionId: client.sessionId
      });
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
    const guestStarted = monotonicNow();
    try {
      const response = await fetch(`${CONFIG.url}/guest/`, { cache: 'no-store' });
      if (response.ok) metrics.httpLatencies.push(monotonicNow() - guestStarted);
    } catch {
      metrics.httpLatencies.push(10000);
    }

    const healthStarted = monotonicNow();
    try {
      const response = await fetch(`${CONFIG.url}/healthz`, { cache: 'no-store' });
      metrics.healthLatencies.push(monotonicNow() - healthStarted);
      if (response.ok) metrics.healthSamples.push(await response.json());
    } catch {
      metrics.healthLatencies.push(10000);
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
    : raceStartedAt ? monotonicNow() - raceStartedAt : 0;
  const hostAvgGap = average(metrics.hostPositionIntervals);
  const hostP95Gap = percentile(metrics.hostPositionIntervals, 95);
  const httpAvg = average(metrics.httpLatencies);
  const httpP95 = percentile(metrics.httpLatencies, 95);
  const healthP95 = percentile(metrics.healthLatencies, 95);
  const eventLoopLags = metrics.healthSamples.map(sample => Number(sample.eventLoopLagMs) || 0);
  const rssSamples = metrics.healthSamples.map(sample => Number(sample.memory && sample.memory.rssMb) || 0);
  const heapSamples = metrics.healthSamples.map(sample => Number(sample.memory && sample.memory.heapUsedMb) || 0);

  console.log('');
  console.log('=== Stress Test Summary ===');
  console.log(`URL: ${CONFIG.url}`);
  console.log(`Clients: ${CONFIG.clients}`);
  console.log(`Mode: ${CONFIG.manualHost ? 'manual host rehearsal' : 'automatic host'}`);
  console.log(`Expected total players: ${CONFIG.expectedTotalPlayers}`);
  console.log(`Tap rate: ${CONFIG.tapRate}/sec/client`);
  console.log(`Answer strategy/rate: ${CONFIG.answerStrategy} / ${CONFIG.answerRate}`);
  console.log(`Forced reconnects: ${CONFIG.reconnectClients} at quiz ${CONFIG.reconnectAtQuiz}`);
  console.log(`Transport: ${CONFIG.transport}`);
  console.log(`Completed: ${metrics.matchFinishedAt ? 'yes' : 'no'}`);
  console.log(`Observed round time: ${formatDuration(runMs)}`);
  console.log(`Connected guests: ${metrics.connected}/${CONFIG.clients}`);
  console.log(`Accepted joins: ${metrics.joinAccepted}/${CONFIG.clients}`);
  console.log(`Team chosen: ${metrics.teamChosen}/${CONFIG.clients}`);
  console.log(`Peak total players observed: ${metrics.peakTotalPlayers}`);
  console.log(`Unexpected disconnects: ${metrics.disconnects}`);
  console.log(`Intentional disconnects/recovered: ${metrics.intentionalDisconnects}/${metrics.recoveredConnections}`);
  console.log(`Connect errors: ${metrics.connectErrors}`);
  console.log(`Join locked events: ${metrics.joinLocked}`);
  console.log(`System errors: ${metrics.systemErrors}`);
  console.log(`Taps sent: ${metrics.tapsSent.toLocaleString('en-US')}`);
  console.log(`Quiz starts/results: ${metrics.quizStarts}/${metrics.quizResults}`);
  console.log(`Three-question settlements: ${metrics.stageSummaries.length}/6`);
  console.log(`Tap windows (seconds): ${metrics.tapWindows.map(stage => stage.seconds.toFixed(2)).join(', ')}`);
  console.log(`Final sprint announcements: ${metrics.finalSprintEvents}`);
  console.log(`Quiz answers accepted: ${metrics.quizAnswerAccepted}/${metrics.quizAnswersSent}`);
  if (metrics.quizRuns.length > 0) {
    const quizDurations = metrics.quizRuns
      .filter(run => run.startedAt && run.resultAt)
      .map(run => run.resultAt - run.startedAt);
    const quizTotalAnswers = metrics.quizRuns.reduce((sum, run) => sum + run.totalAnswers, 0);
    const correctTeamVotes = metrics.quizRuns.reduce((sum, run) => sum + run.correctTeams, 0);
    const totalTeamVotes = metrics.quizRuns.length * TEAM_IDS.length;
    const correctRate = totalTeamVotes > 0 ? (correctTeamVotes / totalTeamVotes) * 100 : 0;
    console.log(`Quiz answer totals: ${quizTotalAnswers} individual answers`);
    console.log(`Team plurality outcomes: ${correctTeamVotes}/${totalTeamVotes} correct (${correctRate.toFixed(1)}%)`);
    console.log(`Quiz active duration avg/p95: ${formatDuration(average(quizDurations))} / ${formatDuration(percentile(quizDurations, 95))}`);
    console.log('Per quiz answers:');
    metrics.quizRuns.forEach((run, index) => {
      const duration = run.startedAt && run.resultAt ? formatDuration(run.resultAt - run.startedAt) : '--';
      console.log(`  ${index + 1}. ${run.quizId}: ${duration}, ${run.totalAnswers} answered, ${run.correctTeams}/${TEAM_IDS.length} teams correct`);
    });
  }
  console.log(`Host position updates: ${metrics.hostPositionUpdates.toLocaleString('en-US')}`);
  console.log(`Host position update gap avg/p95: ${hostAvgGap.toFixed(1)}ms / ${hostP95Gap.toFixed(1)}ms`);
  console.log(`HTTP /guest latency avg/p95: ${httpAvg.toFixed(1)}ms / ${httpP95.toFixed(1)}ms`);
  console.log(`HTTP /healthz latency p95: ${healthP95.toFixed(1)}ms`);
  console.log(`Event loop lag p95: ${percentile(eventLoopLags, 95).toFixed(1)}ms`);
  console.log(`Memory RSS/heap peak: ${Math.max(0, ...rssSamples).toFixed(0)}MB / ${Math.max(0, ...heapSamples).toFixed(0)}MB`);
  if (metrics.latestRacePacing) {
    console.log(`Applied track length: ${metrics.latestRacePacing.trackLength.toLocaleString('en-US')} px`);
    console.log(`Pacing fastest team size: ${metrics.latestRacePacing.fastestTeamSize}`);
  }
  if (metrics.finalAwards && Array.isArray(metrics.finalAwards.awards)) {
    console.log(`Final awards: ${metrics.finalAwards.awards.length}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    url: CONFIG.url,
    mode: CONFIG.manualHost ? 'manualHost' : 'automaticHost',
    configuredClients: CONFIG.clients,
    expectedTotalPlayers: CONFIG.expectedTotalPlayers,
    completed: !!metrics.matchFinishedAt,
    observedRoundSeconds: Math.round(runMs / 1000),
    connectedGuests: metrics.connected,
    acceptedJoins: metrics.joinAccepted,
    teamChosen: metrics.teamChosen,
    peakTotalPlayers: metrics.peakTotalPlayers,
    unexpectedDisconnects: metrics.disconnects,
    intentionalDisconnects: metrics.intentionalDisconnects,
    recoveredConnections: metrics.recoveredConnections,
    connectErrors: metrics.connectErrors,
    systemErrors: metrics.systemErrors,
    tapsSent: metrics.tapsSent,
    quizStarts: metrics.quizStarts,
    quizResults: metrics.quizResults,
    stageSummaries: metrics.stageSummaries,
    tapWindows: metrics.tapWindows,
    quizAnswersSent: metrics.quizAnswersSent,
    quizAnswersAccepted: metrics.quizAnswerAccepted,
    finalSprintEvents: metrics.finalSprintEvents,
    finalAwards: metrics.finalAwards && Array.isArray(metrics.finalAwards.awards)
      ? metrics.finalAwards.awards.length
      : 0,
    performance: {
      hostUpdateP95Ms: hostP95Gap,
      guestHttpP95Ms: httpP95,
      healthHttpP95Ms: healthP95,
      eventLoopLagP95Ms: percentile(eventLoopLags, 95),
      peakRssMb: Math.max(0, ...rssSamples),
      peakHeapMb: Math.max(0, ...heapSamples)
    },
    quizzes: metrics.quizRuns.map(run => ({
      quizId: run.quizId,
      durationMs: run.startedAt && run.resultAt ? run.resultAt - run.startedAt : null,
      answered: run.totalAnswers,
      correctTeams: run.correctTeams
    }))
  };
}

async function cleanup() {
  stopHttpProbe();
  clients.forEach(stopTapping);
  if (!CONFIG.manualHost && hostSocket && hostSocket.connected) {
    hostSocket.emit(CLIENT_TO_SERVER.CONTROL_RESET_GAME);
    await sleep(500);
  }
  clients.forEach(client => client.socket.disconnect());
  if (hostSocket) hostSocket.disconnect();
}

async function main() {
  log(`Connecting host to ${CONFIG.url}`);
  await connectHost();
  await waitUntil(() => currentState !== 'UNKNOWN', 10000, 'initial game state');
  if (CONFIG.manualHost) {
    if (!['LOBBY', 'MAP_SELECT', 'ROUND_LOBBY'].includes(currentState)) {
      throw new Error(`Manual host rehearsal requires a lobby state; current state is ${currentState}`);
    }
  } else {
    log('Resetting game to lobby');
    hostSocket.emit(CLIENT_TO_SERVER.CONTROL_RESET_GAME);
    await waitUntil(() => currentState === 'LOBBY', 10000, 'LOBBY state');
  }

  log(`Connecting ${CONFIG.clients} guest sockets`);
  await connectGuests();
  log('Joining guests and choosing teams');
  await joinAndChooseTeams();
  await sleep(CONFIG.settleMs);

  if (CONFIG.readyOnly) {
    if (!CONFIG.manualHost) {
      throw new Error('--readyOnly can only be used together with --manualHost');
    }
    await waitUntil(() => metrics.joinAccepted >= CONFIG.clients, 10000, 'accepted guest joins');
    await waitUntil(
      () => metrics.peakTotalPlayers >= CONFIG.expectedTotalPlayers,
      10000,
      `${CONFIG.expectedTotalPlayers} total players`
    );
    const failed =
      currentState !== 'LOBBY' ||
      metrics.connected < CONFIG.clients ||
      metrics.joinAccepted < CONFIG.clients ||
      metrics.teamChosen < CONFIG.clients ||
      metrics.peakTotalPlayers < CONFIG.expectedTotalPlayers ||
      metrics.connectErrors > 0 ||
      metrics.systemErrors > 0;
    const report = printSummary();
    report.readinessOnly = true;
    report.passed = !failed;
    if (CONFIG.reportPath) {
      const reportPath = path.resolve(CONFIG.reportPath);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      log(`Wrote JSON report to ${reportPath}`);
    }
    log(`READY-ONLY validation ${failed ? 'failed' : 'passed'}; the server remained in LOBBY.`);
    await cleanup();
    process.exit(failed ? 1 : 0);
  }

  startHttpProbe();
  if (CONFIG.manualHost) {
    log(`READY: ${CONFIG.clients} simulated guests are waiting. Start the match from /control/ when the 3 real phones have joined.`);
    await waitUntil(
      () => Boolean(raceStartedAt),
      CONFIG.manualStartTimeoutSeconds * 1000,
      'human host to start the match'
    );
  } else {
    log('Starting one-round showdown');
    raceStartedAt = monotonicNow();
    hostSocket.emit(CLIENT_TO_SERVER.CONTROL_START_ROUND);
  }

  await waitUntil(
    () => Boolean(metrics.matchFinishedAt),
    CONFIG.maxSeconds * 1000,
    'match finish'
  );
  await sleep(1000);
  const report = printSummary();
  const totalAnswers = metrics.quizRuns.reduce((sum, run) => sum + run.totalAnswers, 0);
  const minimumExpectedAnswers = CONFIG.clients * Math.max(0, Math.min(1, CONFIG.answerRate)) * 18 * 0.9;
  const runSeconds = report.observedRoundSeconds;

  const failed =
    metrics.connected < CONFIG.clients ||
    metrics.joinAccepted < CONFIG.clients ||
    metrics.teamChosen < CONFIG.clients ||
    metrics.peakTotalPlayers < CONFIG.expectedTotalPlayers ||
    !metrics.matchFinishedAt ||
    metrics.disconnects > 0 ||
    metrics.intentionalDisconnects !== Math.min(CONFIG.reconnectClients, CONFIG.clients) ||
    metrics.recoveredConnections !== Math.min(CONFIG.reconnectClients, CONFIG.clients) ||
    metrics.systemErrors > 0 ||
    metrics.quizStarts !== 18 ||
    metrics.quizResults !== 18 ||
    metrics.stageSummaries.length !== 6 ||
    metrics.tapWindows.length !== 6 ||
    metrics.tapWindows.some(stage => Math.abs(stage.seconds - DEFAULT_CONFIG.quizStages.tapSeconds) > 0.5) ||
    totalAnswers < minimumExpectedAnswers ||
    metrics.roundFinished !== 1 ||
    metrics.quizAnswerAccepted < metrics.quizAnswersSent * 0.95 ||
    !metrics.finalAwards ||
    !Array.isArray(metrics.finalAwards.awards) ||
    metrics.finalAwards.awards.length !== 4 ||
    metrics.healthSamples.length === 0 ||
    percentile(metrics.hostPositionIntervals, 95) > 100 ||
    percentile(metrics.httpLatencies, 95) > 250 ||
    percentile(metrics.healthLatencies, 95) > 500 ||
    percentile(metrics.healthSamples.map(sample => Number(sample.eventLoopLagMs) || 0), 95) > 50 ||
    (CONFIG.enforceDuration && (runSeconds < CONFIG.minDurationSeconds || runSeconds > CONFIG.maxDurationSeconds)) ||
    Math.max(0, ...metrics.healthSamples.map(sample => Number(sample.memory && sample.memory.rssMb) || 0)) > 512;

  report.passed = !failed;
  report.thresholds = {
    enforceDuration: CONFIG.enforceDuration,
    minDurationSeconds: CONFIG.minDurationSeconds,
    maxDurationSeconds: CONFIG.maxDurationSeconds,
    hostUpdateP95Ms: 100,
    guestHttpP95Ms: 250,
    eventLoopLagP95Ms: 50,
    peakRssMb: 512
  };
  if (CONFIG.reportPath) {
    const reportPath = path.resolve(CONFIG.reportPath);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    log(`Wrote JSON report to ${reportPath}`);
  }

  await cleanup();
  process.exit(failed ? 1 : 0);
}

main().catch(async error => {
  console.error('');
  console.error('Stress test failed:', error.message);
  const report = { ...printSummary(), passed: false, error: error.message };
  if (CONFIG.reportPath) {
    const reportPath = path.resolve(CONFIG.reportPath);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  await cleanup();
  process.exit(1);
});
