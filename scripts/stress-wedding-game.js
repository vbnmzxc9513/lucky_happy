const { randomUUID } = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const { io } = require('socket.io-client');
const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = require('../shared/events');
const DEFAULT_CONFIG = require('../shared/game-config');
const reconcilePlayerAccounting = require('./lib/reconcile-player-accounting');

const FORMAL_PLAN = require('../shared/stage-plan').estimate(require('../data/maps/wedding-final-showdown.json').checkpoints, DEFAULT_CONFIG);
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
  clients: Number(cli.clients || process.env.CLIENTS || 190),
  tapRate: Number(cli.tapRate || process.env.TAP_RATE || 5),
  answerRate: Number(cli.answerRate || process.env.ANSWER_RATE || 0.98),
  answerStrategy: cli.answerStrategy || process.env.ANSWER_STRATEGY || 'random',
  reconnectClients: Number(cli.reconnectClients || process.env.RECONNECT_CLIENTS || 0),
  reconnectAtQuiz: Number(cli.reconnectAtQuiz || process.env.RECONNECT_AT_QUIZ || 5),
  maxSeconds: Number(cli.maxSeconds || process.env.MAX_SECONDS || 540),
  connectTimeoutMs: Number(cli.connectTimeoutMs || process.env.CONNECT_TIMEOUT_MS || 30000),
  joinIntervalMs: Number(cli.joinIntervalMs ?? process.env.JOIN_INTERVAL_MS ?? 8),
  joinTimeoutMs: Number(cli.joinTimeoutMs || process.env.JOIN_TIMEOUT_MS || Math.max(20000, Number(cli.clients || process.env.CLIENTS || 190) * 120)),
  settleMs: Number(cli.settleMs || process.env.SETTLE_MS || 1200),
  transport: cli.transport || process.env.TRANSPORT || 'websocket',
  staffAccessCode: cli.staffAccessCode || process.env.STAFF_ACCESS_CODE || '1009',
  manualHost: isEnabled(cli.manualHost || process.env.MANUAL_HOST),
  readyOnly: isEnabled(cli.readyOnly || process.env.READY_ONLY),
  manualStartTimeoutSeconds: Number(cli.manualStartTimeoutSeconds || process.env.MANUAL_START_TIMEOUT_SECONDS || 1800),
  expectedTotalPlayers: Number(cli.expectedTotalPlayers || process.env.EXPECTED_TOTAL_PLAYERS || cli.clients || process.env.CLIENTS || 190),
  enforceDuration: isEnabled(cli.enforceDuration || process.env.ENFORCE_DURATION),
  requireAccounting: isEnabled(cli.requireAccounting || process.env.REQUIRE_ACCOUNTING),
  accountingMode: cli.accountingMode || 'receipts',
  minDurationSeconds: Number(cli.minDurationSeconds || process.env.MIN_DURATION_SECONDS || FORMAL_PLAN.timedSeconds),
  maxDurationSeconds: Number(cli.maxDurationSeconds || process.env.MAX_DURATION_SECONDS || 445),
  reportPath: cli.report || process.env.STRESS_REPORT_PATH || '',
  progressMs: Number(cli.progressMs || process.env.PROGRESS_MS || 10000),
  ackTimeoutMs: Number(cli.ackTimeoutMs || process.env.ACK_TIMEOUT_MS || 5000),
  stateMaxAgeMs: Number(cli.stateMaxAgeMs || process.env.STATE_MAX_AGE_MS || 3000)
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
  tapAcks: 0,
  tapAccepted: 0,
  tapRejections: {},
  tapAckLatencies: [],
  quizAckLatencies: [],
  quizRejections: {},
  affectedClients: new Set(),
  intentionalAffectedClients: new Set(),
  unexpectedAffectedClients: new Set(),
  recoveredClients: new Set(),
  hostDisconnects: 0,
  hostConnectErrors: 0,
  quizOptions: 0,
  quizAnswersSent: 0,
  quizAnswerAck: 0,
  quizAnswerAccepted: 0,
  quizRetries: 0,
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
let staffCookie = null;
let clients = [];
let currentState = 'UNKNOWN';
let raceStartedAt = null;
let lastHostPositionAt = null;
let httpProbeTimer = null;
let reconnectWaveStarted = false;
let stopping = false;
let progressTimer = null;
let probeRunning = false;
const scheduledTimers = new Set();
const probeControllers = new Set();
const startedAt = new Date().toISOString();
const sessionPrefix = `stress-${Date.now()}-${process.pid}`;
const generatorLoop = monitorEventLoopDelay({ resolution: 10 });
const quizAnswerLabels = loadQuizAnswerLabels();

class RequestTracker {
  constructor(prefix, now = monotonicNow) {
    this.prefix = prefix;
    this.now = now;
    this.sequence = 0;
    this.pending = new Map();
    this.counts = Object.fromEntries(['tap', 'quiz'].map(kind => [kind, {
      sent: 0, acknowledged: 0, accepted: 0, rejected: 0,
      missing: 0, abandonedOnDisconnect: 0, abandonedOnStateChange: 0, unmatchedAcks: 0
    }]));
  }

  begin(kind, state) {
    const requestId = `${this.prefix}-${++this.sequence}`;
    this.pending.set(requestId, { kind, runId: state.runId, sentAt: this.now() });
    this.counts[kind].sent++;
    return { requestId, runId: state.runId, stateVersion: state.stateVersion };
  }

  acknowledge(kind, ack) {
    const request = this.pending.get(ack?.requestId);
    if (!request || request.kind !== kind || request.runId !== ack?.runId) {
      this.counts[kind].unmatchedAcks++;
      return null;
    }
    this.pending.delete(ack.requestId);
    this.counts[kind].acknowledged++;
    this.counts[kind][ack.success ? 'accepted' : 'rejected']++;
    return this.now() - request.sentAt;
  }

  expire(timeoutMs) {
    for (const [id, request] of this.pending) {
      if (this.now() - request.sentAt >= timeoutMs) {
        this.counts[request.kind].missing++;
        this.pending.delete(id);
      }
    }
  }

  abandon(reason = 'abandonedOnDisconnect') {
    for (const request of this.pending.values()) this.counts[request.kind][reason]++;
    this.pending.clear();
  }

  summary(kind) {
    return { ...this.counts[kind], pending: [...this.pending.values()].filter(r => r.kind === kind).length };
  }
}

function applyState(client, data, now = monotonicNow()) {
  if (!data || data.runId == null || !Number.isInteger(data.stateVersion) || !Number.isFinite(data.serverNow)) return false;
  const previous = client.state;
  if (previous && (previous.runId !== data.runId
    ? data.serverNow < previous.serverNow
    : data.stateVersion < previous.stateVersion || data.serverNow < previous.serverNow)) return false;
  const changed = previous && (previous.runId !== data.runId || previous.stateVersion !== data.stateVersion);
  if (changed) {
    cancelQuizAnswer(client);
  }
  if (previous && previous.runId !== data.runId) {
    client.requests.abandon('abandonedOnStateChange');
    client.answeredQuizIds.clear();
  }
  client.state = { ...data, receivedAt: now };
  client.serverOffset = Math.max(client.serverOffset ?? -Infinity, data.serverNow - now);
  if (data.self) {
    client.joined = data.self.joined === true;
    client.confirmedTeamId = data.self.teamId || null;
  }
  return true;
}

function canSend(client, phase, now = monotonicNow()) {
  const state = client.state;
  if (stopping || !client.connected || !client.socket.connected || !client.joined || !client.confirmedTeamId || !state) return false;
  const age = Math.max(now - state.receivedAt, now + client.serverOffset - state.serverNow);
  return age >= 0 && age <= CONFIG.stateMaxAgeMs && state.state === phase && state.paused === false
    && Number.isFinite(state.endsAt) && state.endsAt > state.serverNow + age;
}

function schedule(callback, delay) {
  const timer = setTimeout(() => {
    scheduledTimers.delete(timer);
    if (!stopping) callback();
  }, delay);
  scheduledTimers.add(timer);
  return timer;
}

function cancelQuizAnswer(client) {
  if (client.answerTimer) {
    clearTimeout(client.answerTimer);
    scheduledTimers.delete(client.answerTimer);
    client.answerTimer = null;
  }
}

function requestSummary() {
  const summary = {};
  for (const kind of ['tap', 'quiz']) {
    summary[kind] = {};
    for (const client of clients) {
      client.requests.expire(CONFIG.ackTimeoutMs);
      for (const [key, value] of Object.entries(client.requests.summary(kind))) {
        summary[kind][key] = (summary[kind][key] || 0) + value;
      }
    }
  }
  return summary;
}

function progress() {
  const requests = requestSummary();
  const status = {
    at: new Date().toISOString(), state: currentState,
    online: clients.filter(c => c.connected).length,
    joinedOnline: clients.filter(c => c.connected && c.joined && c.confirmedTeamId).length,
    affectedClients: metrics.affectedClients.size, recoveredClients: metrics.recoveredClients.size,
    disconnectEvents: metrics.disconnects + metrics.intentionalDisconnects,
    requests, tapP99Ms: percentile(metrics.tapAckLatencies, 99)
  };
  log(`Progress ${JSON.stringify(status)}`);
  return status;
}

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
    if (stopping) throw new Error('Interrupted');
    if (predicate()) return true;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function getStaffCookie() {
  const response = await fetch(`${CONFIG.url}/staff-login`, {
    signal: AbortSignal.timeout(CONFIG.connectTimeoutMs),
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

function createSocket(auth = {}, cookie = undefined) {
  return io(CONFIG.url, {
    auth: { ...auth, protocolVersion: 2 },
    retries: 0,
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
  staffCookie = cookie;
  const controlSocket = createSocket({ role: 'control' }, cookie);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { controlSocket.disconnect(); reject(new Error('Control connect timeout')); }, CONFIG.connectTimeoutMs);
    controlSocket.once('connect', () => { clearTimeout(timer); resolve(); });
    controlSocket.once('connect_error', error => { clearTimeout(timer); controlSocket.disconnect(); reject(error); });
  });
  hostSocket = createSocket({ role: 'host' }, cookie);
  const emit = hostSocket.emit.bind(hostSocket);
  hostSocket.emit = (event, ...args) => event.startsWith('control:')
    ? controlSocket.emit(event, ...args) : emit(event, ...args);
  const disconnect = hostSocket.disconnect.bind(hostSocket);
  hostSocket.disconnect = () => { controlSocket.disconnect(); return disconnect(); };
  hostSocket.on('disconnect', () => {
    if (!stopping) metrics.hostDisconnects++;
    lastHostPositionAt = null;
  });
  hostSocket.on('connect_error', () => { metrics.hostConnectErrors++; });

  hostSocket.on('game:heartbeat', state => {
    currentState = state.state;
    if (state.state !== 'RACING' || state.paused) lastHostPositionAt = null;
  });

  hostSocket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, state => {
    currentState = state.state;
    if (state.state !== 'RACING' || state.paused) lastHostPositionAt = null;
    metrics.peakTotalPlayers = Math.max(metrics.peakTotalPlayers, Number(state.totalPlayers) || 0);
    if (!raceStartedAt && CONFIG.manualHost && ['COUNTDOWN', 'RACING', 'QUIZ'].includes(state.state)) {
      raceStartedAt = monotonicNow();
      log(`Human host started the match (${state.state})`);
    }
    if (state.racePacing) metrics.latestRacePacing = state.racePacing;
    const stage = state.quizStage;
    if (!CONFIG.manualHost && !state.paused && state.state === 'QUIZ'
      && ['awaiting_question', 'reveal', 'summary'].includes(stage?.phase)) {
      const key = `${state.runId}:${stage.stageNumber}:${stage.flowRevision}`;
      if (controlSocket.lastAdvance !== key) {
        controlSocket.lastAdvance = key;
        controlSocket.emit(CLIENT_TO_SERVER.CONTROL_ADVANCE_QUIZ_FLOW, { requestId: randomUUID(),
          runId: state.runId, stageNumber: stage.stageNumber, flowRevision: stage.flowRevision });
      }
    }
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
    if (currentState !== 'RACING') return;
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

function createGuest(index, socket = createSocket()) {
  const client = {
    quizInputs: new Map(), acceptedAnswerIds: new Set(), sentTapIds: new Set(), acceptedTapIds: new Set(),
    expectedCorrect: 0, expectedWrong: 0,
    index,
    socket,
    teamId: TEAM_IDS[index % TEAM_IDS.length],
    nickname: `Stress_${String(index + 1).padStart(3, '0')}`,
    avatar: AVATARS[index % AVATARS.length],
    sessionId: `${sessionPrefix}-${String(index + 1).padStart(6, '0')}`,
    connected: false,
    tapTimer: null,
    requests: new RequestTracker(`${sessionPrefix}-${index}`),
    state: null,
    answerTimer: null,
    confirmedTeamId: null,
    needsRecovery: false,
    everJoined: false,
    joinRequested: false,
    answeredQuizIds: new Set(),
    joined: false,
    teamChosen: false,
    everConnected: false,
    expectingDisconnect: false
  };

  socket.on('connect', () => {
    client.connected = true;
    client.joined = false;
    client.confirmedTeamId = null;
    client.state = null;
    if (!client.everConnected) {
      metrics.connected++;
      client.everConnected = true;
    }
    if (client.joinRequested) joinGuest(client);
  });

  socket.on('connect_error', () => {
    metrics.connectErrors++;
  });

  socket.on('disconnect', () => {
    stopTapping(client);
    cancelQuizAnswer(client);
    client.requests.abandon();
    if (client.connected && !stopping) {
      metrics.affectedClients.add(index);
      client.needsRecovery = client.everJoined;
      if (client.expectingDisconnect) {
        metrics.intentionalAffectedClients.add(index);
        metrics.intentionalDisconnects++;
        client.expectingDisconnect = false;
      } else {
        metrics.unexpectedAffectedClients.add(index);
        metrics.disconnects++;
      }
    }
    client.connected = false;
    client.joined = false;
    client.confirmedTeamId = null;
    client.state = null;
  });

  socket.on(SERVER_TO_CLIENT.GUEST_JOIN_ACK, ack => {
    if (!client.connected || !ack?.success) return;
    client.joined = true;
    client.confirmedTeamId = ack.teamId || null;
    recordJoined(client);
    if (!client.confirmedTeamId) {
      socket.emit(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, { teamId: client.teamId });
    }
    refreshTapping(client);
  });

  const receiveState = state => {
    if (!client.connected || !applyState(client, state)) return;
    recordJoined(client);
    refreshTapping(client);
  };
  socket.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, receiveState);
  socket.on('game:heartbeat', receiveState);

  socket.on(SERVER_TO_CLIENT.GAME_POSITION_UPDATE, () => {
    if (index % 25 === 0) metrics.sampleClientPositionUpdates++;
  });

  socket.on(SERVER_TO_CLIENT.GAME_JOIN_LOCKED, () => {
    metrics.joinLocked++;
  });

  socket.on(SERVER_TO_CLIENT.SYSTEM_ERROR, () => {
    metrics.systemErrors++;
  });

  socket.on('guest:team_chosen', data => {
    if (!client.connected || !client.joined) return;
    client.confirmedTeamId = data?.teamId || null;
    recordJoined(client);
    refreshTapping(client);
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_OPTIONS, data => {
    metrics.quizOptions++;
    stopTapping(client);
    cancelQuizAnswer(client);
    if (!data || !data.quizId || data.alreadyAnswered || client.answeredQuizIds.has(data.quizId) || !canSend(client, 'QUIZ')) return;
    if (data.runId != null && data.runId !== client.state.runId) return;
    if (Math.random() > CONFIG.answerRate) return;
    const { runId, stateVersion } = client.state;
    const timeLimitMs = Math.max(1000, Number(data.timeLimit || 10) * 1000);
    const delay = Math.min(timeLimitMs - 250, 300 + Math.floor(Math.random() * 4200));
    client.answerTimer = schedule(() => {
      client.answerTimer = null;
      if (!canSend(client, 'QUIZ') || client.state.runId !== runId || client.state.stateVersion !== stateVersion) return;
      client.answeredQuizIds.add(data.quizId);
      const request = client.requests.begin('quiz', client.state);
      const answer = chooseAnswer(data.quizId);
      client.quizInputs.set(request.requestId, { runId, quizId: data.quizId, answer });
      const payload = { ...request, quizId: data.quizId, answer };
      let retries = 0;
      const send = () => {
        client.answerTimer = null;
        if (!client.requests.pending.has(request.requestId) || !canSend(client, 'QUIZ')
          || client.state.runId !== runId || client.state.stateVersion !== stateVersion) return;
        socket.emit(CLIENT_TO_SERVER.GUEST_QUIZ_ANSWER, payload);
        if (retries > 0) metrics.quizRetries++;
        if (retries++ < 2) client.answerTimer = schedule(send, 1000);
      };
      send();
      metrics.quizAnswersSent++;
    }, Math.max(100, delay));
  });

  socket.on(SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK, ack => {
    const latency = client.requests.acknowledge('quiz', ack);
    if (latency === null) return;
    metrics.quizAnswerAck++;
    metrics.quizAckLatencies.push(latency);
    if (ack && ack.success) {
      metrics.quizAnswerAccepted++;
      client.acceptedAnswerIds.add(ack.requestId);
      const input = client.quizInputs.get(ack.requestId);
      if (input?.answer === quizAnswerLabels.get(input?.quizId)) client.expectedCorrect++;
      else client.expectedWrong++;
    }
    else {
      const reason = ack?.reason || 'UNKNOWN';
      metrics.quizRejections[reason] = (metrics.quizRejections[reason] || 0) + 1;
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_TAP_ACK, ack => {
    const latency = client.requests.acknowledge('tap', ack);
    if (latency === null) return;
    metrics.tapAcks++;
    metrics.tapAckLatencies.push(latency);
    if (ack?.success) { metrics.tapAccepted++; client.acceptedTapIds.add(ack.requestId); }
    else {
      const reason = ack?.reason || 'UNKNOWN';
      metrics.tapRejections[reason] = (metrics.tapRejections[reason] || 0) + 1;
    }
  });

  socket.on(SERVER_TO_CLIENT.GAME_ROUND_FINISHED, () => {
    stopTapping(client);
    cancelQuizAnswer(client);
    client.state = null;
  });

  socket.on(SERVER_TO_CLIENT.GAME_MATCH_FINISHED, () => {
    stopTapping(client);
    cancelQuizAnswer(client);
    client.state = null;
  });

  clients.push(client);
  return client;
}

function recordJoined(client) {
  if (!client.joined) return;
  if (!client.everJoined) {
    client.everJoined = true;
    metrics.joinAccepted++;
  }
  if (!client.confirmedTeamId) return;
  client.teamId = client.confirmedTeamId;
  if (!client.teamChosen) {
    client.teamChosen = true;
    metrics.teamChosen++;
  }
  if (client.needsRecovery) {
    client.needsRecovery = false;
    metrics.recoveredConnections++;
    metrics.recoveredClients.add(client.index);
  }
}

function joinGuest(client) {
  if (stopping || !client.socket.connected) return;
  client.socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
    nickname: client.nickname, avatar: client.avatar, sessionId: client.sessionId,
    ...(client.everJoined ? { teamId: client.teamId } : {})
  });
}

function refreshTapping(client) {
  if (canSend(client, 'RACING')) startTapping(client);
  else stopTapping(client);
}

function sendTap(client) {
  if (!canSend(client, 'RACING')) {
    stopTapping(client);
    return false;
  }
  const request = client.requests.begin('tap', client.state);
  client.sentTapIds.add(request.requestId);
  // canSend checks connectivity and freshness before each individual input.
  client.socket.emit(CLIENT_TO_SERVER.GUEST_TAP, { ...request, timestamp: Date.now() });
  metrics.tapsSent++;
  return true;
}

function startTapping(client) {
  if (client.tapTimer || !canSend(client, 'RACING')) return;
  const jitter = 0.85 + Math.random() * 0.3;
  const intervalMs = Math.max(50, Math.round(1000 / CONFIG.tapRate / jitter));
  client.tapTimer = setInterval(() => {
    sendTap(client);
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
    schedule(() => {
      client.joinRequested = true;
      joinGuest(client);
    }, index * CONFIG.joinIntervalMs);
  });

  await waitUntil(
    () => metrics.teamChosen >= CONFIG.clients,
    CONFIG.joinTimeoutMs,
    `${CONFIG.clients} team selections`
  );
}

function startHttpProbe() {
  httpProbeTimer = setInterval(async () => {
    if (probeRunning || stopping) return;
    probeRunning = true;
    try {
      for (const [endpoint, samples] of [['/guest/', metrics.httpLatencies], ['/healthz', metrics.healthLatencies]]) {
        if (stopping) break;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        probeControllers.add(controller);
        const started = monotonicNow();
        try {
          const response = await fetch(`${CONFIG.url}${endpoint}`, { cache: 'no-store', signal: controller.signal });
          const body = await response.text();
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          samples.push(monotonicNow() - started);
          if (endpoint === '/healthz') metrics.healthSamples.push(JSON.parse(body));
        } catch {
          if (!stopping) samples.push(10000);
        } finally {
          clearTimeout(timeout);
          probeControllers.delete(controller);
        }
      }
    } finally { probeRunning = false; }
  }, 5000);
}

function stopHttpProbe() {
  for (const controller of probeControllers) controller.abort();
  probeControllers.clear();
  if (httpProbeTimer) {
    clearInterval(httpProbeTimer);
    httpProbeTimer = null;
  }
}

function printSummary() {
  requestSummary();
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
  console.log(`Tap acknowledgements: ${metrics.tapAcks}/${metrics.tapsSent}; accepted: ${metrics.tapAccepted}`);
  console.log(`Tap response p95/p99: ${percentile(metrics.tapAckLatencies, 95).toFixed(1)}ms / ${percentile(metrics.tapAckLatencies, 99).toFixed(1)}ms`);
  console.log(`Quiz starts/results: ${metrics.quizStarts}/${metrics.quizResults}`);
  console.log(`Four-question settlements: ${metrics.stageSummaries.length}/${FORMAL_PLAN.stageCount}`);
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
    console.log(`Team >50% outcomes: ${correctTeamVotes}/${totalTeamVotes} correct (${correctRate.toFixed(1)}%)`);
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
    startedAt,
    affectedPlayers: metrics.affectedClients.size,
    unexpectedAffectedPlayers: metrics.unexpectedAffectedClients.size,
    recoveredPlayers: metrics.recoveredClients.size,
    hostDisconnects: metrics.hostDisconnects,
    hostConnectErrors: metrics.hostConnectErrors,
    network: metrics.healthSamples.at(-1)?.network || null,
    players: clients.map(client => ({ nickname: client.nickname, teamId: client.teamId,
      tap: client.requests.summary('tap'), quiz: client.requests.summary('quiz'),
      answers: [...client.quizInputs].map(([requestId, input]) => ({ requestId, ...input,
        acknowledged: client.acceptedAnswerIds.has(requestId) })),
      expectedCorrect: client.expectedCorrect, expectedWrong: client.expectedWrong })),
    joinIntervalMs: CONFIG.joinIntervalMs,
    joinTimeoutMs: CONFIG.joinTimeoutMs,
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
    tapAcks: metrics.tapAcks,
    tapAccepted: metrics.tapAccepted,
    tapRejections: metrics.tapRejections,
    quizStarts: metrics.quizStarts,
    quizResults: metrics.quizResults,
    stageSummaries: metrics.stageSummaries,
    tapWindows: metrics.tapWindows,
    quizAnswersSent: metrics.quizAnswersSent,
    quizAnswersAccepted: metrics.quizAnswerAccepted,
    quizRetries: metrics.quizRetries,
    finalSprintEvents: metrics.finalSprintEvents,
    finalAwards: metrics.finalAwards && Array.isArray(metrics.finalAwards.awards)
      ? metrics.finalAwards.awards.length
      : 0,
    awardResults: metrics.finalAwards?.awards || [],
    performance: {
      tapAckP95Ms: percentile(metrics.tapAckLatencies, 95),
      tapAckP99Ms: percentile(metrics.tapAckLatencies, 99),
      generatorLoopP95Ms: generatorLoop.percentile(95) / 1e6,
      hostUpdateP95Ms: hostP95Gap,
      hostUpdateP99Ms: percentile(metrics.hostPositionIntervals, 99),
      hostUpdateMaxGapMs: metrics.hostPositionIntervals.reduce((max, gap) => Math.max(max, gap), 0),
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
  stopping = true;
  clearInterval(progressTimer);
  for (const timer of scheduledTimers) clearTimeout(timer);
  scheduledTimers.clear();
  generatorLoop.disable();
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
  if (!['receipts', 'ack'].includes(CONFIG.accountingMode)) throw new Error('accountingMode must be receipts or ack');
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
  progressTimer = setInterval(progress, Math.max(1000, CONFIG.progressMs));
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
  try {
    const response = await fetch(`${CONFIG.url}/api/test-accounting`, { headers: { Cookie: staffCookie }, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const audit = await response.json();
      const mismatches = [];
      const acknowledgementDifferences = [];
      for (const client of clients) {
        const actual = audit.players.find(player => player.nickname === client.nickname);
        if (CONFIG.accountingMode === 'ack') {
          const expected = { tapCount: client.requests.summary('tap').accepted,
            answeredCount: client.requests.summary('quiz').accepted,
            correctCount: client.expectedCorrect, wrongCount: client.expectedWrong };
          if (!actual || Object.entries(expected).some(([key, value]) => actual[key] !== value)) {
            mismatches.push({ nickname: client.nickname, expected, actual });
          }
          continue;
        }
        const result = reconcilePlayerAccounting(client, actual, audit.runId, quizAnswerLabels);
        if (!result.passed) mismatches.push({ nickname: client.nickname, ...result,
          actual: actual && { nickname: actual.nickname, tapCount: actual.tapCount,
            answeredCount: actual.answeredCount, correctCount: actual.correctCount,
            wrongCount: actual.wrongCount, tapReceiptCount: actual.tapReceipts?.length,
            answerReceiptCount: actual.answerReceipts?.length } });
        if (result.recoveredReceipts.length || result.recoveredTapReceipts.length) acknowledgementDifferences.push({ nickname: client.nickname,
          acknowledged: result.acknowledged, receiptBased: result.expected,
          answerRequestIds: result.recoveredReceipts, tapRequestIds: result.recoveredTapReceipts });
      }
      report.accounting = { mode: CONFIG.accountingMode, checked: clients.length, mismatches,
        acknowledgementDifferences, passed: mismatches.length === 0 };
    } else report.accounting = { checked: 0, skipped: `HTTP ${response.status}` };
  } catch (error) { report.accounting = { checked: 0, error: error.message }; }
  const totalAnswers = metrics.quizRuns.reduce((sum, run) => sum + run.totalAnswers, 0);
  const minimumExpectedAnswers = CONFIG.clients * Math.max(0, Math.min(1, CONFIG.answerRate)) * FORMAL_PLAN.questionCount * 0.9;
  const runSeconds = report.observedRoundSeconds;

  const failed =
    (report.accounting && report.accounting.passed === false) ||
    (CONFIG.requireAccounting && report.accounting?.passed !== true) ||
    metrics.hostDisconnects > 0 || metrics.hostConnectErrors > 0 || metrics.connectErrors > 0 ||
    metrics.connected < CONFIG.clients ||
    metrics.joinAccepted < CONFIG.clients ||
    metrics.teamChosen < CONFIG.clients ||
    metrics.peakTotalPlayers < CONFIG.expectedTotalPlayers ||
    !metrics.matchFinishedAt ||
    metrics.disconnects > 0 ||
    metrics.intentionalDisconnects !== Math.min(CONFIG.reconnectClients, CONFIG.clients) ||
    metrics.recoveredConnections !== Math.min(CONFIG.reconnectClients, CONFIG.clients) ||
    metrics.systemErrors > 0 ||
    metrics.quizStarts !== FORMAL_PLAN.questionCount ||
    metrics.tapAcks !== metrics.tapsSent ||
    percentile(metrics.tapAckLatencies, 95) > 250 ||
    metrics.quizResults !== FORMAL_PLAN.questionCount ||
    metrics.stageSummaries.length !== FORMAL_PLAN.stageCount ||
    metrics.tapWindows.length !== FORMAL_PLAN.stageCount ||
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

if (require.main === module) {
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
generatorLoop.enable();
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
}

module.exports = { RequestTracker, applyState, canSend };
