const assert = require('assert');
const ItemManager = require('../server/game/ItemManager');

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

test('Should initialize activeItems for all 5 teams', () => {
  const im = new ItemManager();
  assert.strictEqual(Object.keys(im.activeItems).length, 5);
  ['red', 'blue', 'yellow', 'pink', 'purple'].forEach(id => {
    assert.ok(im.activeItems[id]);
  });
});

test('generateTrackItems() should create items for all 5 teams', () => {
  const im = new ItemManager();
  im.generateTrackItems({ items: { density: 2, types: ['accelerator'] }, track: { length: 1000 } });
  ['red', 'blue', 'yellow', 'pink', 'purple'].forEach(id => {
    assert.strictEqual(im.activeItems[id].length, 2);
  });
});

test('checkCollisions() should work for any team ID', () => {
  const im = new ItemManager();
  im.activeItems = {
    purple: [{ id: 'i1', type: 'accelerator', x: 100, triggered: false }]
  };
  let triggered = false;
  const teamObj = { speed: 0 };
  im.checkCollisions('purple', 61, teamObj, () => {
    triggered = true;
  });
  assert.strictEqual(triggered, true);
  assert.strictEqual(im.activeItems['purple'][0].triggered, true);
});

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
