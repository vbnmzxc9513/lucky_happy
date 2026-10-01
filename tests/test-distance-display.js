const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../shared/distance-display');
const config=require('../shared/game-config');
test('Shared distance conversion floors monotonically, formats thousands and never mutates raw position',()=>{
  assert.equal(D.internalUnitsPerMeter(config),15);
  for(const [raw,m] of [[0,0],[1500,100],[3000,200],[6000,400],[9000,600],[27840,1856]]) assert.equal(D.positionMeters(raw),m);
  let last=-Infinity;
  for(let raw=0;raw<3000;raw+=.17){ const m=D.positionMeters(raw); assert(m>=last); assert.equal(m,Math.floor(raw/D.internalUnitsPerMeter()));last=m; }
  assert.equal(D.position(27840),'1,856 m');
  assert.deepEqual(config.quizStages.rewardSteps.map(n=>D.reward(n)),['0 m','100 m','200 m','400 m','600 m']);
  const team=Object.freeze({position:27840.9}); assert.equal(D.position(team.position),'1,856 m');assert.equal(team.position,27840.9);
});
