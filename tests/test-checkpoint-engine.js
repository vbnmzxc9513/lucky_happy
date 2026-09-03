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

test('A fast team should still receive all checkpoints in order', () => {
  const engine = new CheckpointTriggerEngine();
  const checkpoints = Array.from({ length: 10 }, (_, index) => ({
    id: `cp${index + 1}`,
    trigger: { type: 'team_progress', percent: (index + 1) * 9 }
  }));
  engine.initCheckpoints(checkpoints);
  const teams = { red: { position: 1000 } };
  const triggered = [];

  for (let i = 0; i < checkpoints.length; i++) {
    triggered.push(engine.checkTriggers(teams, 1000).id);
  }

  assert.deepStrictEqual(triggered, checkpoints.map(checkpoint => checkpoint.id));
  assert.strictEqual(engine.checkTriggers(teams, 1000), null);
});

test('Forced checkpoint catch-up should mark each checkpoint exactly once', () => {
  const engine = new CheckpointTriggerEngine();
  const checkpoints = [
    { id: 'cp1', trigger: { type: 'team_progress', percent: 10 }, quizId: 'q1' },
    { id: 'cp2', trigger: { type: 'team_progress', percent: 20 }, quizId: 'q2' }
  ];
  engine.initCheckpoints(checkpoints);

  assert.strictEqual(engine.takeNextUntriggeredCheckpoint().id, 'cp1');
  assert.strictEqual(engine.getUntriggeredCheckpoints().length, 1);
  assert.strictEqual(engine.takeNextUntriggeredCheckpoint().id, 'cp2');
  assert.strictEqual(engine.takeNextUntriggeredCheckpoint(), null);
  assert.strictEqual(engine.hasTriggeredAll(), true);
});

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
