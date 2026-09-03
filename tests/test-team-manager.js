const assert = require('assert');
const TeamManager = require('../server/game/TeamManager');
const DEFAULT_CONFIG = require('../shared/game-config');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

test('Should create 5 teams from config', () => {
  const tm = new TeamManager();
  assert.strictEqual(Object.keys(tm.teams).length, 5);
  ['red', 'blue', 'yellow', 'pink', 'purple'].forEach(id => {
    assert.ok(tm.teams[id], `Missing team ${id}`);
  });
});

test('getAllTeamsInfo() should return all 5 teams', () => {
  const tm = new TeamManager();
  const info = tm.getAllTeamsInfo();
  assert.strictEqual(info.length, 5);
});

test('resetRoundPositions() should reset all 5 teams', () => {
  const tm = new TeamManager();
  tm.teams['red'].position = 100;
  tm.resetRoundPositions();
  Object.values(tm.teams).forEach(team => {
    assert.strictEqual(team.position, 10);
    assert.strictEqual(team.speed, 0);
  });
});

test('resetAllScores() should reset all 5 teams', () => {
  const tm = new TeamManager();
  tm.teams['red'].score = 5;
  tm.resetAllScores();
  Object.values(tm.teams).forEach(team => {
    assert.strictEqual(team.score, 0);
  });
});

test('autoAssignUnselectedPlayers() should assign unassigned players to smallest team', () => {
  const tm = new TeamManager();
  tm.addPlayer('player1', 'P1');
  tm.addPlayer('player2', 'P2');
  tm.autoAssignUnselectedPlayers();
  
  const p1 = tm.getPlayer('player1');
  const p2 = tm.getPlayer('player2');
  assert.ok(p1.teamId);
  assert.ok(p2.teamId);
  
  // ensure members count adds up
  let totalMembers = 0;
  Object.values(tm.teams).forEach(t => totalMembers += t.members.size);
  assert.strictEqual(totalMembers, 2);
});

test('chooseTeam() should work for all 5 team IDs (red, blue, yellow, pink, purple)', () => {
  const tm = new TeamManager();
  ['red', 'blue', 'yellow', 'pink', 'purple'].forEach((teamId, idx) => {
    const socketId = `player${idx}`;
    tm.addPlayer(socketId, `P${idx}`);
    const res = tm.chooseTeam(socketId, teamId);
    assert.strictEqual(res.success, true);
    assert.strictEqual(tm.getPlayer(socketId).teamId, teamId);
    assert.ok(tm.getTeam(teamId).members.has(socketId));
  });
});

test('chooseTeam() should reject invalid teamId', () => {
  const tm = new TeamManager();
  tm.addPlayer('player1', 'P1');
  const res = tm.chooseTeam('player1', 'invalid_team');
  assert.strictEqual(res.success, false);
});

test('addPlayer() should reject when join is locked', () => {
  const tm = new TeamManager();
  tm.setJoinLock(true);
  const res = tm.addPlayer('player1', 'P1');
  assert.strictEqual(res.success, false);
});

test('Only a known stable session should reconnect while join is locked', () => {
  const tm = new TeamManager();
  const sessionId = 'known-session-1234567890';
  tm.addPlayer('old-socket', 'Reconnect Guest', 'R', sessionId);
  tm.chooseTeam('old-socket', 'pink');
  tm.setJoinLock(true);
  tm.disconnectPlayer('old-socket', true);

  const fakeReconnect = tm.addPlayer('intruder', 'Intruder', 'I', 'unknown-session-123456');
  assert.strictEqual(fakeReconnect.success, false);
  assert.strictEqual(fakeReconnect.reason, 'RACE_IN_PROGRESS');

  const recovered = tm.addPlayer('new-socket', 'Reconnect Guest', 'R', sessionId);
  assert.strictEqual(recovered.success, true);
  assert.strictEqual(recovered.reconnected, true);
  assert.strictEqual(recovered.previousSocketId, 'old-socket');
  assert.strictEqual(tm.getPlayer('new-socket').teamId, 'pink');
  assert.ok(tm.getTeam('pink').members.has('new-socket'));
  assert.ok(!tm.getTeam('pink').members.has('old-socket'));
  assert.strictEqual(tm.players.size, 1);
});

test('Duplicate nicknames should be rejected after Unicode, whitespace and case normalization', () => {
  const tm = new TeamManager();
  const first = tm.addPlayer('first-socket', '  ＡPing  ', 'A', 'first-session-123456');
  const duplicate = tm.addPlayer('second-socket', 'aping', 'B', 'second-session-123456');

  assert.strictEqual(first.success, true);
  assert.strictEqual(duplicate.success, false);
  assert.strictEqual(duplicate.reason, 'DUPLICATE_NICKNAME');
  assert.strictEqual(tm.players.size, 1);
});

test('The same stable session may reclaim its nickname after reconnecting', () => {
  const tm = new TeamManager();
  const sessionId = 'same-guest-session-123456';
  tm.addPlayer('old-socket', '小聶同學', 'N', sessionId);
  tm.disconnectPlayer('old-socket', true);

  const recovered = tm.addPlayer('new-socket', '小聶同學', 'N', sessionId);
  assert.strictEqual(recovered.success, true);
  assert.strictEqual(recovered.reconnected, true);
  assert.strictEqual(tm.players.size, 1);
});

test('A nickname becomes available after a lobby player is removed', () => {
  const tm = new TeamManager();
  tm.addPlayer('leaving-socket', '婚禮賓客');
  tm.removePlayer('leaving-socket');

  const replacement = tm.addPlayer('new-socket', '婚禮賓客');
  assert.strictEqual(replacement.success, true);
});

test('A team should reject its 51st member without removing the player from the original team', () => {
  const config = { ...DEFAULT_CONFIG, maxPlayersPerTeam: 50 };
  const tm = new TeamManager(config);
  for (let index = 0; index < 50; index++) {
    const socketId = `blue-${index}`;
    tm.addPlayer(socketId, `Blue ${index}`);
    assert.strictEqual(tm.chooseTeam(socketId, 'blue').success, true);
  }
  tm.addPlayer('moving-player', 'Moving Player');
  tm.chooseTeam('moving-player', 'red');

  const rejected = tm.chooseTeam('moving-player', 'blue');
  assert.strictEqual(rejected.success, false);
  assert.strictEqual(rejected.reason, 'TEAM_FULL');
  assert.strictEqual(rejected.maxPlayersPerTeam, 50);
  assert.strictEqual(tm.getPlayer('moving-player').teamId, 'red');
  assert.ok(tm.getTeam('red').members.has('moving-player'));
  assert.strictEqual(tm.getTeam('blue').members.size, 50);
  assert.strictEqual(tm.getAllTeamsInfo().find(team => team.id === 'blue').isFull, true);
});

test('Auto assignment should respect the configured team capacity', () => {
  const config = { ...DEFAULT_CONFIG, maxPlayersPerTeam: 1 };
  const tm = new TeamManager(config);
  for (let index = 0; index < 6; index++) tm.addPlayer(`player-${index}`, `P${index}`);
  tm.autoAssignUnselectedPlayers();

  const assigned = Array.from(tm.players.values()).filter(player => player.teamId);
  assert.strictEqual(assigned.length, 5);
  Object.values(tm.teams).forEach(team => assert.ok(team.members.size <= 1));
});

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
