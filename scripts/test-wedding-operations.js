const assert = require('assert');
const { io } = require('socket.io-client');
const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = require('../shared/events');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const STAFF_ACCESS_CODE = process.env.STAFF_ACCESS_CODE || '1009';
const sockets = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForEvent(socket, event, predicate = () => true, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = data => {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    socket.on(event, handler);
  });
}

async function getStaffCookie() {
  const response = await fetch(`${SERVER_URL}/staff-login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: STAFF_ACCESS_CODE, next: '/control/' })
  });
  assert.strictEqual(response.status, 302);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  return setCookie.split(';')[0];
}

function createSocket(auth, cookie) {
  const socket = io(SERVER_URL, {
    auth,
    ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
    autoConnect: false
  });
  sockets.push(socket);
  return socket;
}

async function connectRole(role, cookie) {
  const socket = createSocket({ role }, cookie);
  const connected = waitForEvent(socket, 'connect');
  const initialState = waitForEvent(socket, SERVER_TO_CLIENT.GAME_STATE_SYNC);
  socket.connect();
  await connected;
  await initialState;
  return socket;
}

async function connectGuest(name, sessionSuffix) {
  const socket = createSocket();
  const connected = waitForEvent(socket, 'connect');
  socket.connect();
  await connected;
  const joinAck = waitForEvent(socket, SERVER_TO_CLIENT.GUEST_JOIN_ACK);
  socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
    nickname: name,
    avatar: name.slice(0, 1),
    sessionId: `operation-session-${sessionSuffix}-123456`
  });
  assert.strictEqual((await joinAck).success, true);
  return socket;
}

function sendControl(socket, event, action, data) {
  const result = waitForEvent(
    socket,
    SERVER_TO_CLIENT.CONTROL_ACTION_RESULT,
    payload => payload && payload.action === action
  );
  socket.emit(event, data);
  return result;
}

function waitForTeamOutcome(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Timed out waiting for team outcome')), 5000);
    const chosen = data => finish(null, { type: 'chosen', data });
    const full = data => finish(null, { type: 'full', data });
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.off('guest:team_chosen', chosen);
      socket.off(SERVER_TO_CLIENT.GAME_TEAM_FULL, full);
      if (error) reject(error);
      else resolve(value);
    };
    socket.on('guest:team_chosen', chosen);
    socket.on(SERVER_TO_CLIENT.GAME_TEAM_FULL, full);
  });
}

async function chooseTeam(socket, teamId) {
  const outcome = waitForTeamOutcome(socket);
  socket.emit(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, { teamId });
  const result = await outcome;
  assert.strictEqual(result.type, 'chosen');
  assert.strictEqual(result.data.teamId, teamId);
}

async function main() {
  console.log(`Wedding operation regression: ${SERVER_URL}`);
  const cookie = await getStaffCookie();
  const controlA = await connectRole('control', cookie);
  const controlB = await connectRole('control', cookie);
  const admin = await connectRole('admin', cookie);

  try {
    const resetResult = await sendControl(
      controlA,
      CLIENT_TO_SERVER.CONTROL_RESET_GAME,
      'RESET_GAME'
    );
    assert.strictEqual(resetResult.success, true);
    assert.strictEqual(resetResult.state.state, 'LOBBY');

    const earlyAward = await sendControl(
      controlA,
      CLIENT_TO_SERVER.CONTROL_AWARD_ACTION,
      'AWARD_ACTION',
      { action: 'reveal' }
    );
    assert.strictEqual(earlyAward.success, false);
    assert.deepStrictEqual(earlyAward.state.presentation.revealedAwardIndexes, []);
    console.log('PASS awards remain locked before MATCH_FINISHED');

    const presentationA = waitForEvent(
      controlA,
      SERVER_TO_CLIENT.GAME_PRESENTATION_UPDATED,
      data => data.stage === 'rules'
    );
    const presentationB = waitForEvent(
      controlB,
      SERVER_TO_CLIENT.GAME_PRESENTATION_UPDATED,
      data => data.stage === 'rules'
    );
    const syncStartedAt = Date.now();
    const stageResultPromise = sendControl(
      controlA,
      CLIENT_TO_SERVER.CONTROL_SET_PRESENTATION,
      'SET_PRESENTATION',
      { stage: 'rules' }
    );
    await Promise.all([presentationA, presentationB]);
    assert.ok(Date.now() - syncStartedAt < 1000, 'two controls should synchronize within one second');
    assert.strictEqual((await stageResultPromise).success, true);
    await sendControl(
      controlB,
      CLIENT_TO_SERVER.CONTROL_SET_PRESENTATION,
      'SET_PRESENTATION',
      { stage: 'lobby' }
    );
    console.log('PASS two control consoles synchronize presentation state within one second');

    const capacityApplied = waitForEvent(
      admin,
      SERVER_TO_CLIENT.ADMIN_CONFIG_UPDATED,
      data => Number(data && data.maxPlayersPerTeam) === 1
    );
    admin.emit(CLIENT_TO_SERVER.ADMIN_UPDATE_CONFIG, { maxPlayersPerTeam: 1 });
    await capacityApplied;

    const firstGuest = await connectGuest('操作測試甲', 'alpha');
    const secondGuest = await connectGuest('操作測試乙', 'beta');
    const unselectedGuest = await connectGuest('操作測試未選隊', 'unselected');
    const firstOutcome = waitForTeamOutcome(firstGuest);
    const secondOutcome = waitForTeamOutcome(secondGuest);
    firstGuest.emit(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, { teamId: 'red' });
    secondGuest.emit(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, { teamId: 'red' });
    const finalSeatResults = await Promise.all([firstOutcome, secondOutcome]);
    assert.strictEqual(finalSeatResults.filter(result => result.type === 'chosen').length, 1);
    assert.strictEqual(finalSeatResults.filter(result => result.type === 'full').length, 1);
    console.log('PASS simultaneous final-seat requests produce one winner and one full-team response');

    const winnerGuest = finalSeatResults[0].type === 'chosen' ? firstGuest : secondGuest;
    const otherGuest = winnerGuest === firstGuest ? secondGuest : firstGuest;
    const capacityRestored = waitForEvent(
      admin,
      SERVER_TO_CLIENT.ADMIN_CONFIG_UPDATED,
      data => Number(data && data.maxPlayersPerTeam) === 50
    );
    admin.emit(CLIENT_TO_SERVER.ADMIN_UPDATE_CONFIG, { maxPlayersPerTeam: 50 });
    await capacityRestored;
    await chooseTeam(otherGuest, 'blue');

    const assigned = waitForEvent(unselectedGuest, SERVER_TO_CLIENT.GAME_TEAM_ASSIGNED);
    const countdownState = waitForEvent(
      controlA,
      SERVER_TO_CLIENT.GAME_STATE_SYNC,
      data => data.state === 'COUNTDOWN'
    );
    const startA = sendControl(controlA, CLIENT_TO_SERVER.CONTROL_START_ROUND, 'START_ROUND');
    const startB = sendControl(controlB, CLIENT_TO_SERVER.CONTROL_START_ROUND, 'START_ROUND');
    const [startResultA, startResultB] = await Promise.all([startA, startB]);
    await Promise.all([assigned, countdownState]);
    assert.strictEqual([startResultA.success, startResultB.success].filter(Boolean).length, 1);
    console.log('PASS simultaneous start commands create one countdown and auto-assign unselected guests');

    const pauseCountdown = await sendControl(
      controlA,
      CLIENT_TO_SERVER.CONTROL_PAUSE_GAME,
      'PAUSE_GAME'
    );
    assert.strictEqual(pauseCountdown.success, true);
    assert.strictEqual(pauseCountdown.state.state, 'COUNTDOWN');
    assert.strictEqual(pauseCountdown.state.paused, true);
    const duplicatePause = await sendControl(
      controlB,
      CLIENT_TO_SERVER.CONTROL_PAUSE_GAME,
      'PAUSE_GAME'
    );
    assert.strictEqual(duplicatePause.success, false);
    const resumeCountdown = await sendControl(
      controlB,
      CLIENT_TO_SERVER.CONTROL_RESUME_GAME,
      'RESUME_GAME'
    );
    assert.strictEqual(resumeCountdown.success, true);
    const duplicateResume = await sendControl(
      controlA,
      CLIENT_TO_SERVER.CONTROL_RESUME_GAME,
      'RESUME_GAME'
    );
    assert.strictEqual(duplicateResume.success, false);
    console.log('PASS countdown pause/resume is idempotent across two control consoles');

    await waitForEvent(controlA, SERVER_TO_CLIENT.GAME_STATE_SYNC, data => data.state === 'RACING', 7000);
    let lastTapResult = null;
    for (let index = 0; index < 20; index++) {
      const tapAck = waitForEvent(winnerGuest, SERVER_TO_CLIENT.GAME_TAP_ACK);
      winnerGuest.emit(CLIENT_TO_SERVER.GUEST_TAP, { timestamp: Date.now() });
      lastTapResult = await tapAck;
      await sleep(55);
    }
    assert.strictEqual(lastTapResult.success, true);
    assert.strictEqual(lastTapResult.critical, true);
    assert.strictEqual(lastTapResult.status.tapCount, 20);
    console.log('PASS normal taps and the twentieth critical hit remain observable');

    const itemResult = await sendControl(
      controlA,
      CLIENT_TO_SERVER.CONTROL_FORCE_ITEM,
      'FORCE_ITEM',
      { teamId: 'red', itemType: 'large_boost' }
    );
    assert.strictEqual(itemResult.success, true);
    assert.strictEqual((await sendControl(
      controlA,
      CLIENT_TO_SERVER.CONTROL_PAUSE_GAME,
      'PAUSE_GAME'
    )).success, true);
    const pausedItem = await sendControl(
      controlB,
      CLIENT_TO_SERVER.CONTROL_FORCE_ITEM,
      'FORCE_ITEM',
      { teamId: 'red', itemType: 'stun' }
    );
    assert.strictEqual(pausedItem.success, false);
    assert.strictEqual((await sendControl(
      controlB,
      CLIENT_TO_SERVER.CONTROL_RESUME_GAME,
      'RESUME_GAME'
    )).success, true);
    console.log('PASS forced items work during racing and are rejected while paused');

    const quizOptions = waitForEvent(
      winnerGuest,
      SERVER_TO_CLIENT.GAME_QUIZ_OPTIONS,
      data => data && data.quizId === 'wc_001',
      10000
    );
    const quizResult = await sendControl(
      controlA,
      CLIENT_TO_SERVER.CONTROL_FORCE_QUIZ,
      'FORCE_QUIZ',
      { quizId: 'wc_001', timeLimit: 2 }
    );
    assert.strictEqual(quizResult.success, true);
    assert.strictEqual(quizResult.state.state, 'QUIZ');
    const overlappingQuiz = await sendControl(
      controlB,
      CLIENT_TO_SERVER.CONTROL_FORCE_QUIZ,
      'FORCE_QUIZ',
      { quizId: 'wc_002', timeLimit: 2 }
    );
    assert.strictEqual(overlappingQuiz.success, false);
    const pausedQuiz = await sendControl(
      controlA,
      CLIENT_TO_SERVER.CONTROL_PAUSE_GAME,
      'PAUSE_GAME'
    );
    assert.strictEqual(pausedQuiz.success, true);
    assert.strictEqual(pausedQuiz.state.state, 'QUIZ');
    await sleep(250);
    assert.strictEqual((await sendControl(
      controlB,
      CLIENT_TO_SERVER.CONTROL_RESUME_GAME,
      'RESUME_GAME'
    )).success, true);

    const wrongStage = await sendControl(
      controlA,
      CLIENT_TO_SERVER.CONTROL_SET_PRESENTATION,
      'SET_PRESENTATION',
      { stage: 'rules' }
    );
    assert.strictEqual(wrongStage.success, true);
    assert.strictEqual(wrongStage.state.state, 'QUIZ');
    await quizOptions;

    const answerAck = waitForEvent(winnerGuest, SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK);
    winnerGuest.emit(CLIENT_TO_SERVER.GUEST_QUIZ_ANSWER, { quizId: 'wc_001', answer: 'A' });
    assert.strictEqual((await answerAck).success, true);
    const duplicateAnswerAck = waitForEvent(winnerGuest, SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK);
    winnerGuest.emit(CLIENT_TO_SERVER.GUEST_QUIZ_ANSWER, { quizId: 'wc_001', answer: 'A' });
    const duplicateAnswer = await duplicateAnswerAck;
    assert.strictEqual(duplicateAnswer.success, false);
    assert.strictEqual(duplicateAnswer.reason, 'ALREADY_ANSWERED');
    console.log('PASS overlapping quizzes are rejected and answers remain single-submit');

    let ghostQuizResults = 0;
    const ghostCounter = () => { ghostQuizResults++; };
    controlA.on(SERVER_TO_CLIENT.GAME_QUIZ_RESULT, ghostCounter);
    const finalReset = await sendControl(
      controlB,
      CLIENT_TO_SERVER.CONTROL_RESET_GAME,
      'RESET_GAME'
    );
    assert.strictEqual(finalReset.success, true);
    assert.strictEqual(finalReset.state.state, 'LOBBY');
    assert.strictEqual(finalReset.state.totalPlayers, 0);
    await sleep(6500);
    controlA.off(SERVER_TO_CLIENT.GAME_QUIZ_RESULT, ghostCounter);
    assert.strictEqual(ghostQuizResults, 0);
    const healthResponse = await fetch(`${SERVER_URL}/healthz`, { cache: 'no-store' });
    const health = await healthResponse.json();
    assert.strictEqual(health.status, 'ok');
    assert.strictEqual(health.state, 'LOBBY');
    console.log('PASS reset clears players and prevents stale quiz results or ghost timers');

    console.log('Wedding operation regression passed');
  } finally {
    const restore = waitForEvent(
      admin,
      SERVER_TO_CLIENT.ADMIN_CONFIG_UPDATED,
      data => Number(data && data.maxPlayersPerTeam) === 50,
      2000
    ).catch(() => null);
    admin.emit(CLIENT_TO_SERVER.ADMIN_UPDATE_CONFIG, { maxPlayersPerTeam: 50 });
    await restore;
    controlA.emit(CLIENT_TO_SERVER.CONTROL_RESET_GAME);
    await sleep(250);
  }
}

main()
  .catch(error => {
    console.error(`Wedding operation regression failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const socket of sockets) socket.disconnect();
  });
