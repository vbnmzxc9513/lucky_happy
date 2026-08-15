const assert = require('assert');
const CheckpointTriggerEngine = require('../server/game/CheckpointTriggerEngine');

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

test('checkTriggers() should use max progress from all 5 teams', () => {
  const engine = new CheckpointTriggerEngine();
  engine.initCheckpoints([{ id: 'cp1', trigger: { type: 'team_progress', percent: 50 } }]);
  const teams = {
    red: { position: 100 },
    blue: { position: 200 },
    yellow: { position: 500 },
    pink: { position: 300 },
    purple: { position: 400 }
  };
  const cp = engine.checkTriggers(teams, 1000);
  assert.ok(cp);
  assert.strictEqual(cp.id, 'cp1');
});

test('checkTriggers() should trigger when any team reaches checkpoint', () => {
  const engine = new CheckpointTriggerEngine();
  engine.initCheckpoints([{ id: 'cp1', trigger: { type: 'team_progress', percent: 80 } }]);
  const teams = {
    red: { position: 0 },
    blue: { position: 0 },
    yellow: { position: 0 },
    pink: { position: 800 },
    purple: { position: 0 }
  };
  const cp = engine.checkTriggers(teams, 1000);
  assert.ok(cp);
});

test('Should not re-trigger already triggered checkpoints', () => {
  const engine = new CheckpointTriggerEngine();
  engine.initCheckpoints([{ id: 'cp1', trigger: { type: 'team_progress', percent: 50 } }]);
  const teams = {
    red: { position: 600 }
  };
  const cp1 = engine.checkTriggers(teams, 1000);
  assert.ok(cp1);
  const cp2 = engine.checkTriggers(teams, 1000);
  assert.strictEqual(cp2, null);
});

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
