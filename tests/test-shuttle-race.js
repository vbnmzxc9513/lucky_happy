const assert = require('node:assert/strict');
const { test } = require('node:test');
const Shuttle = require('../shared/shuttle-race');
const config = require('../shared/game-config');
const GameManager = require('../server/game/GameManager');

test('Endpoints, direction and whole laps are derived from distance', () => {
  for (const [distance, laps, direction, x] of [[0,0,1,0], [750,0,1,.5], [1500,0,-1,1],
    [2250,0,-1,.5], [3000,1,1,0], [9750,3,1,.5]]) {
    const m = Shuttle.measure(distance, config);
    assert.deepEqual([m.laps, m.direction, m.x], [laps, direction, x]);
  }
  assert.equal(Shuttle.measure(-10, config).distance, 0);
  assert.equal(Shuttle.measure(3000, { shuttleRace: { legLength: 750 } }).laps, 2);
  assert.equal(Shuttle.enabled({ quizStages: { enabled: false } }), false);
});
test('Multi-lap reward preserves remainder; ranking is not screen position', () => {
  const a = Shuttle.measure(1700, config), b = Shuttle.measure(7700, config);
  assert.equal(b.laps - a.laps, 2);
  assert.equal(a.x, b.x);
  assert.deepEqual(Shuttle.rank({ red: { position: 2900 }, blue: { position: 2000 }, pink: { position: 2900 } }),
    { red: 1, pink: 1, blue: 3 });
});
test('Guest authoritative status survives reconnect and reset without lap scoring state', () => {
  const gm = new GameManager({ emit() {} });
  try {
    gm.teamManager.addPlayer('one', 'QA');
    gm.teamManager.chooseTeam('one', 'red');
    gm.teamManager.teams.red.position = 7700;
    const status = gm.buildPlayerStatus('one');
    assert.equal(status.teamShuttle.laps, 2);
    assert.equal(status.teamShuttle.distance, 7700);
    gm.migratePlayerConnection('one', 'two');
    assert.equal(gm.teamManager.teams.red.position, 7700);
    gm.resetGame();
    assert.equal(gm.buildPlayerStatus('two').teamShuttle, null);
  } finally { gm.stopGameLoop(); }
});
