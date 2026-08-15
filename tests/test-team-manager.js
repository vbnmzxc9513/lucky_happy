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

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
