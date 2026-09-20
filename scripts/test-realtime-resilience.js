const assert = require('assert');
const { io } = require('socket.io-client');
const { CLIENT_TO_SERVER, SERVER_TO_CLIENT } = require('../shared/events');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const STAFF_ACCESS_CODE = process.env.STAFF_ACCESS_CODE || '1009';
const GUEST_COUNT = Number(process.env.RESILIENCE_GUESTS || 30);
const sockets = [];

function waitForEvent(socket, event, predicate = () => true, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (data) => {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    socket.on(event, handler);
  });
}

function waitForConnect(socket, timeoutMs = 10000) {
  if (socket.connected) return Promise.resolve();
  return waitForEvent(socket, 'connect', () => true, timeoutMs);
}

async function getStaffCookie() {
  const response = await fetch(`${SERVER_URL}/staff-login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: STAFF_ACCESS_CODE, next: '/manage' })
  });
  assert.strictEqual(response.status, 302, 'staff login HTTP status');
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'staff login should set a session cookie');
  return setCookie.split(';')[0];
}

function createSocket(auth = undefined, cookie = undefined) {
  const socket = io(SERVER_URL, {
    auth,
    ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 100,
    timeout: 5000
  });
  sockets.push(socket);
  return socket;
}

async function connectRole(role) {
  const cookie = await getStaffCookie();
  const socket = createSocket({ role }, cookie);
  await waitForConnect(socket);
  return socket;
}

async function createGuest(index) {
  const socket = createSocket();
  await waitForConnect(socket);
  const guest = {
    socket,
    nickname: `Recovery_${String(index + 1).padStart(2, '0')}`,
    avatar: String.fromCharCode(65 + (index % 26)),
    teamId: ['red', 'blue', 'yellow', 'pink', 'purple'][index % 5],
    sessionId: `resilience-session-${String(index + 1).padStart(4, '0')}`
  };
  const joinAck = waitForEvent(socket, SERVER_TO_CLIENT.GUEST_JOIN_ACK);
  socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
    nickname: guest.nickname,
    avatar: guest.avatar,
    sessionId: guest.sessionId,
    teamId: guest.teamId
  });
  assert.strictEqual((await joinAck).success, true);
  const chosen = waitForEvent(socket, 'guest:team_chosen');
  socket.emit(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, { teamId: guest.teamId });
  assert.strictEqual((await chosen).teamId, guest.teamId);
  return guest;
}

async function assertUnauthorizedHostIsRejected() {
  const socket = io(SERVER_URL, {
    auth: { role: 'host' },
    transports: ['websocket'],
    reconnection: false,
    timeout: 3000
  });
  const error = await waitForEvent(socket, 'connect_error', () => true, 5000);
  assert.match(error.message, /UNAUTHORIZED_STAFF_SOCKET/);
  socket.disconnect();
}

async function main() {
  console.log(`Realtime resilience test: ${SERVER_URL}, ${GUEST_COUNT} guests`);
  await assertUnauthorizedHostIsRejected();
  console.log('PASS staff socket rejects requests without a verified session');

  let host = await connectRole('host');
  const control = await connectRole('control');
  const admin = await connectRole('admin');
  let state = null;
  host.on(SERVER_TO_CLIENT.GAME_STATE_SYNC, data => { state = data.state; });
  const initialLobby = waitForEvent(host, SERVER_TO_CLIENT.GAME_STATE_SYNC, data => data.state === 'LOBBY');
  control.emit(CLIENT_TO_SERVER.CONTROL_RESET_GAME);
  await initialLobby;

  const nicknameOwner = createSocket();
  const nicknameCollision = createSocket();
  await Promise.all([waitForConnect(nicknameOwner), waitForConnect(nicknameCollision)]);
  const ownerAck = waitForEvent(nicknameOwner, SERVER_TO_CLIENT.GUEST_JOIN_ACK);
  nicknameOwner.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
    nickname: '  ＱＡ Guest  ',
    avatar: 'Q',
    sessionId: 'nickname-owner-session-123456'
  });
  assert.strictEqual((await ownerAck).success, true);
  const collisionAck = waitForEvent(nicknameCollision, SERVER_TO_CLIENT.GUEST_JOIN_ACK);
  nicknameCollision.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
    nickname: 'qa guest',
    avatar: 'X',
    sessionId: 'nickname-collision-session-123456'
  });
  const collisionResult = await collisionAck;
  assert.strictEqual(collisionResult.success, false);
  assert.strictEqual(collisionResult.reason, 'DUPLICATE_NICKNAME');
  nicknameOwner.disconnect();
  nicknameCollision.disconnect();
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log('PASS duplicate nickname is rejected after normalized comparison');

  const guests = await Promise.all(Array.from({ length: GUEST_COUNT }, (_, index) => createGuest(index)));
  console.log(`PASS ${GUEST_COUNT} guests joined and selected five teams`);

  if (GUEST_COUNT >= 5 && GUEST_COUNT % 5 === 0) {
    const testCapacity = GUEST_COUNT / 5;
    const capacityApplied = waitForEvent(
      admin,
      SERVER_TO_CLIENT.ADMIN_CONFIG_UPDATED,
      data => Number(data && data.maxPlayersPerTeam) === testCapacity
    );
    admin.emit(CLIENT_TO_SERVER.ADMIN_UPDATE_CONFIG, { maxPlayersPerTeam: testCapacity });
    await capacityApplied;

    const fullNotice = waitForEvent(guests[0].socket, SERVER_TO_CLIENT.GAME_TEAM_FULL);
    guests[0].socket.emit(CLIENT_TO_SERVER.GUEST_CHOOSE_TEAM, { teamId: 'blue' });
    const fullPayload = await fullNotice;
    assert.strictEqual(fullPayload.teamId, 'blue');
    assert.strictEqual(fullPayload.maxPlayersPerTeam, testCapacity);

    const retainedTeamAck = waitForEvent(guests[0].socket, SERVER_TO_CLIENT.GUEST_JOIN_ACK);
    guests[0].socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
      nickname: guests[0].nickname,
      avatar: guests[0].avatar,
      sessionId: guests[0].sessionId,
      teamId: guests[0].teamId
    });
    assert.strictEqual((await retainedTeamAck).teamId, 'red');

    const capacityRestored = waitForEvent(
      admin,
      SERVER_TO_CLIENT.ADMIN_CONFIG_UPDATED,
      data => Number(data && data.maxPlayersPerTeam) === 50
    );
    admin.emit(CLIENT_TO_SERVER.ADMIN_UPDATE_CONFIG, { maxPlayersPerTeam: 50 });
    await capacityRestored;
    console.log(`PASS full team rejects member ${testCapacity + 1} without losing the original team`);
  }

  const racingState = waitForEvent(host, SERVER_TO_CLIENT.GAME_STATE_SYNC, data => data.state === 'RACING', 10000);
  control.emit(CLIENT_TO_SERVER.CONTROL_START_ROUND);
  await racingState;

  const fakeGuest = createSocket();
  await waitForConnect(fakeGuest);
  const joinLocked = waitForEvent(fakeGuest, SERVER_TO_CLIENT.GAME_JOIN_LOCKED);
  fakeGuest.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
    nickname: 'FakeGuest',
    avatar: 'F',
    isReconnect: true,
    sessionId: 'unknown-session-99999999',
    teamId: 'red'
  });
  await joinLocked;
  console.log('PASS unknown session cannot bypass in-race join lock');

  const firstGuest = guests[0];
  const firstQuizOptions = waitForEvent(firstGuest.socket, SERVER_TO_CLIENT.GAME_QUIZ_OPTIONS, data => data.quizId === 'wc_001');
  const hostQuiz = waitForEvent(host, SERVER_TO_CLIENT.GAME_QUIZ_START, data => data.quizId === 'wc_001');
  admin.emit(CLIENT_TO_SERVER.ADMIN_FORCE_TRIGGER, {
    type: 'QUIZ',
    targetId: 'wc_001',
    timeLimit: 8
  });
  await Promise.all([firstQuizOptions, hostQuiz]);

  const answerAck = waitForEvent(firstGuest.socket, SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK);
  firstGuest.socket.emit(CLIENT_TO_SERVER.GUEST_QUIZ_ANSWER, { quizId: 'wc_001', answer: 'A' });
  assert.strictEqual((await answerAck).success, true);

  const oldSocketId = firstGuest.socket.id;
  const reconnected = waitForEvent(firstGuest.socket, 'connect', () => firstGuest.socket.id !== oldSocketId, 10000);
  const recoveredJoin = waitForEvent(
    firstGuest.socket,
    SERVER_TO_CLIENT.GUEST_JOIN_ACK,
    data => data && data.reconnected === true,
    10000
  );
  const recoveredOptions = waitForEvent(
    firstGuest.socket,
    SERVER_TO_CLIENT.GAME_QUIZ_OPTIONS,
    data => data && data.quizId === 'wc_001' && data.recovered === true,
    10000
  );
  firstGuest.socket.once('connect', () => {
    firstGuest.socket.emit(CLIENT_TO_SERVER.GUEST_JOIN, {
      nickname: firstGuest.nickname,
      avatar: firstGuest.avatar,
      sessionId: firstGuest.sessionId,
      teamId: firstGuest.teamId
    });
  });
  firstGuest.socket.io.engine.close();
  await reconnected;
  await Promise.all([recoveredJoin, recoveredOptions]);

  const duplicateAck = waitForEvent(firstGuest.socket, SERVER_TO_CLIENT.GAME_QUIZ_ANSWER_ACK);
  firstGuest.socket.emit(CLIENT_TO_SERVER.GUEST_QUIZ_ANSWER, { quizId: 'wc_001', answer: 'A' });
  const duplicate = await duplicateAck;
  assert.strictEqual(duplicate.success, false);
  assert.strictEqual(duplicate.reason, 'ALREADY_ANSWERED');
  console.log('PASS guest reconnect restores quiz and preserves answer lock');

  host.disconnect();
  const replacementHostCookie = await getStaffCookie();
  host = createSocket({ role: 'host' }, replacementHostCookie);
  const recoveredHostQuizPromise = waitForEvent(
    host,
    SERVER_TO_CLIENT.GAME_QUIZ_START,
    data => data && data.quizId === 'wc_001' && data.recovered === true,
    5000
  );
  await waitForConnect(host);
  const recoveredHostQuiz = await recoveredHostQuizPromise;
  assert.ok(recoveredHostQuiz.question);
  assert.ok(recoveredHostQuiz.timeLimit > 0 && recoveredHostQuiz.timeLimit <= 10);
  console.log('PASS host refresh restores current question and remaining time');

  const lobbyState = waitForEvent(host, SERVER_TO_CLIENT.GAME_STATE_SYNC, data => data.state === 'LOBBY');
  control.emit(CLIENT_TO_SERVER.CONTROL_RESET_GAME);
  await lobbyState;
  await new Promise(resolve => setTimeout(resolve, 8500));

  const healthResponse = await fetch(`${SERVER_URL}/healthz`, { cache: 'no-store' });
  assert.strictEqual(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.strictEqual(health.status, 'ok');
  assert.strictEqual(health.state, 'LOBBY');
  assert.ok(health.connectedSockets >= GUEST_COUNT);
  assert.ok(health.memory.rssMb > 0);
  console.log('PASS reset cancels quiz timeout and health endpoint stays responsive');

  console.log('Realtime resilience test passed');
}

main()
  .catch(error => {
    console.error(`Realtime resilience test failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const socket of sockets) socket.disconnect();
  });
