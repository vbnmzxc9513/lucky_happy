const assert = require('assert');
const RoundManager = require('../server/game/RoundManager');

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

test('Should initialize scores for all 5 teams', () => {
  const rm = new RoundManager();
  assert.strictEqual(Object.keys(rm.scores).length, 5);
  ['red', 'blue', 'yellow', 'pink', 'purple'].forEach(id => {
    assert.strictEqual(rm.scores[id], 0);
  });
});

test('recordRoundWinner() should increment score for any team', () => {
  const rm = new RoundManager();
  rm.recordRoundWinner('red');
  assert.strictEqual(rm.scores['red'], 1);
  rm.recordRoundWinner('blue');
  assert.strictEqual(rm.scores['blue'], 1);
});

test('getFinalWinner() should find the team with highest score among 5', () => {
  const rm = new RoundManager();
  rm.recordRoundWinner('red');
  rm.recordRoundWinner('red');
  rm.recordRoundWinner('blue');
  assert.strictEqual(rm.getFinalWinner(), 'red');
});

test('getFinalWinner() should return \'tie\' when top teams are tied', () => {
  const rm = new RoundManager();
  rm.recordRoundWinner('red');
  rm.recordRoundWinner('blue');
  assert.strictEqual(rm.getFinalWinner(), 'tie');
});

test('reset() should clear all scores', () => {
  const rm = new RoundManager();
  rm.recordRoundWinner('red');
  rm.reset();
  Object.values(rm.scores).forEach(score => {
    assert.strictEqual(score, 0);
  });
});

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
