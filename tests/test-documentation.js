const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../shared/game-config');
const map = require('../data/maps/wedding-final-showdown.json');
const StagePlan = require('../shared/stage-plan');

const root = path.join(__dirname, '..');
const activeDocs = [
  'README.md',
  'GAME_DESIGN.md',
  'docs/PROJECT_ARCHITECTURE.md',
  'docs/FORMAL_GAME_RULES.md',
  'docs/RACE_PACING.md',
  'docs/WEDDING_RUNBOOK.md',
  'docs/REALTIME_DEFENSIVE_GUIDE.md',
  'docs/QA_TEST_PLAN.md',
  'docs/WEDDING_OPERATION_TEST_PLAN.md',
  'deploy/README.md',
  'docs/PLAYER_ACCOUNTING_TESTS.md',
  'docs/STRESS_TEST.md',
  'docs/DIGITALOCEAN_STEP_BY_STEP.md'
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('active documentation matches the formal game configuration', () => {
  const architecture = read('docs/PROJECT_ARCHITECTURE.md');
  const formalRules = read('docs/FORMAL_GAME_RULES.md');
  const plan = StagePlan.estimate(map.checkpoints || [], config);

  assert.equal(config.TEAMS.length, 5);
  assert.equal(config.totalRounds, 1);
  assert.equal(map.checkpoints.length, 15);
  assert.equal(new Set(map.checkpoints.map(checkpoint => checkpoint.quizId)).size, 15);
  assert.equal(plan.stageCount, 5);
  assert.equal(plan.totalSeconds, null);

  for (const expected of [
    `${config.TEAMS.length}隊`,
    `${map.checkpoints.length} 題`,
    `${plan.stageCount}關`,
    `${plan.timedSeconds} 秒`
  ]) {
    const normalizedExpected = expected.replace('5隊', '五隊').replace('5關', '五關');
    assert.ok(
      architecture.includes(expected) || architecture.includes(normalizedExpected),
      `architecture should document ${expected}`
    );
  }
  assert.match(formalRules, /每題作答 10 秒/);
  assert.match(formalRules, /最後衝刺 10 秒/);
});

test('active documentation contains no retired formal-rules claims', () => {
  const joined = activeDocs.map(file => `${file}\n${read(file)}`).join('\n');
  const retiredClaims = [
    /18\s*題|六關|6\s*關|415\s*秒/,
    /18 answers\/reveals|six tap stages|six settlements/,
    /固定三局/,
    /完成三局對抗/,
    /正式賽道固定觸發 10/,
    /預設到完賽 343 秒/,
    /第 9 分鐘解除暈眩/,
    /紅\/藍兩隊顯示名稱/
  ];
  for (const pattern of retiredClaims) {
    assert.doesNotMatch(joined, pattern);
  }
});

test('relative links in active Markdown documents resolve', () => {
  const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const file of activeDocs) {
    const sourcePath = path.join(root, file);
    const source = read(file);
    for (const match of source.matchAll(markdownLink)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:https?:|mailto:|[A-Za-z]:\/)/.test(target)) continue;
      const resolved = path.resolve(path.dirname(sourcePath), target);
      assert.ok(fs.existsSync(resolved), `${file} links to missing ${target}`);
    }
  }
});
