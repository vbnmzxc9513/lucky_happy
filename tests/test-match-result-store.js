const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Store = require('../server/results/MatchResultStore');
const Game = require('../server/game/GameManager');
function fixture(t, io) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horse-results-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'results.json');
  return { file, dir, store: new Store(file, io) };
}
function game(store) { return new Game({ emit() {}, to() { return { emit() {} }; } }, store); }
function finish(g, winner = 'red') { g.roundManager.recordRoundWinner(winner); g.setState('MATCH_FINISHED'); }
test('authoritative roster, migration, zeros, disconnected players, immutable snapshot, reset and restart', t => {
  const { store, file } = fixture(t); const g = game(store);
  g.stageQuestions = Array.from({ length: 16 }, () => ({}));
  g.teamManager.addPlayer('old', '<img src=x onerror=alert(1)>', '🥳', 'private-session');
  g.teamManager.chooseTeam('old', 'red'); g.recordPlayerTap('old');
  g.recordPlayerQuizResult('old', true, 900); g.recordPlayerQuizResult('old', false, 3900);
  const reconnect = g.teamManager.addPlayer('new', '<img src=x onerror=alert(1)>', '🥳', 'private-session');
  g.migratePlayerConnection(reconnect.previousSocketId, 'new');
  g.teamManager.addPlayer('idle', '零操作', '🙂', 'idle-session'); g.teamManager.chooseTeam('idle', 'red');
  g.teamManager.disconnectPlayer('idle', true);
  g.teamManager.addPlayer('no-session', '無 session', '🙂'); g.teamManager.chooseTeam('no-session', 'blue'); g.teamManager.disconnectPlayer('no-session', true);
  g.teamManager.teams.red.position = 12345;
  g.setState('ROUND_FINISHED'); assert.equal(store.read().matches.length, 0);
  finish(g); finish(g);
  assert.equal(store.read().matches.length, 1);
  const m = store.read().matches[0]; assert.equal(m.players.length, 3);
  assert.equal(m.questionCount, 16); assert.equal(m.stageCount, 4); assert.equal(m.awards.length, 4);
  assert.deepEqual(m.winner, { type: 'team', teamIds: ['red'] });
  assert.equal(m.awards.find(a => a.id === 'team-winner').winner.id, m.winner.teamIds[0]);
  const p = m.players[0]; assert.equal(p.nickname, '<img src=x onerror=alert(1)>'); assert.equal(p.teamId, 'red');
  assert.equal(p.teamName, g.teamManager.teams.red.name); assert.equal(p.tapCount, 1);
  assert.equal(p.answeredCount, 2); assert.equal(p.correctCount, 1); assert.equal(p.wrongCount, 1);
  assert.equal(p.averageAnswerMs, 2400); assert.equal(p.fastestAnswerMs, 900); assert.equal(p.unansweredCount, 14); assert.equal(p.accuracy, .5);
  const idle = m.players[1]; for (const key of ['tapCount', 'answeredCount', 'correctCount', 'wrongCount', 'averageAnswerMs', 'fastestAnswerMs', 'accuracy']) assert.equal(idle[key], 0);
  assert.equal(idle.unansweredCount, 16);
  g.playerStats.get('new').tapCount = 9000; g.teamManager.teams.red.name = 'Changed';
  assert.deepEqual(store.read().matches[0], m);
  const exposed = store.read(); exposed.matches[0].players.length = 0; assert.equal(store.read().matches[0].players.length, 3);
  g.resetGame(); assert.deepEqual(store.read().matches[0], m); assert.equal(g.teamManager.players.size, 0);
  assert.deepEqual(new Store(file).read().matches[0], m);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /socketId|sessionId|requestId|receipts|private-session/);
});
test('11 matches retain newest ten, duplicate IDs including evicted runs, load trims and sorts', t => {
  const { store, file } = fixture(t); const g = game(store); finish(g);
  const base = store.read().matches[0];
  const other = new Store(path.join(path.dirname(file), 'other.json'));
  for (let i = 10; i >= 0; i--) other.add({ ...base, id: String(i), finishedAt: new Date(1000 + i * 1000).toISOString() });
  assert.deepEqual(other.read().matches.map(m => m.id), ['10','9','8','7','6','5','4','3','2','1']);
  other.add({ ...base, id: '0' }); assert.equal(other.read().matches.length, 10);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, matches: Array.from({length: 11}, (_,i) => ({ ...base, id: String(i), finishedAt: new Date(i * 1000).toISOString() })) }));
  assert.deepEqual(new Store(file).read().matches.map(m => m.id), ['10','9','8','7','6','5','4','3','2','1']);
});
test('zero round wins tie includes all teams regardless of distance; unanswered cannot go negative', t => {
  const { store } = fixture(t); const g = game(store); g.teamManager.teams.red.position = 100; g.teamManager.teams.blue.position = 100;
  g.teamManager.addPlayer('p', '玩家'); g.teamManager.chooseTeam('p', 'red'); g.upsertPlayerStats(g.teamManager.getPlayer('p')).answeredCount = 999;
  finish(g, 'tie'); const m = store.read().matches[0];
  const teamIds = Object.keys(g.roundManager.getMatchStatus().scores);
  assert.equal(teamIds.length, 5);
  assert.deepEqual(m.winner, { type: 'tie', teamIds }); assert.equal(m.players[0].unansweredCount, 0);
  assert.deepEqual(m.awards.find(a => a.id === 'team-winner').winner.tiedTeams.map(t => t.id), teamIds);
});
test('tied round winners with different distances agree with award and preserve display ranks', t => {
  const { store } = fixture(t); const g = game(store);
  g.teamManager.teams.red.position = 100; g.teamManager.teams.blue.position = 50;
  g.roundManager.recordRoundWinner('red');
  finish(g, 'blue');
  assert.deepEqual(Object.entries(g.roundManager.getMatchStatus().scores).filter(([, score]) => score > 0), [['red', 1], ['blue', 1]]);
  const m = store.read().matches[0];
  assert.deepEqual(m.winner, { type: 'tie', teamIds: ['red', 'blue'] });
  assert.deepEqual(m.teams.map(({ id, position, rank }) => ({ id, position, rank })),
    g.getTeamRanking().map(({ id, position, rank }) => ({ id, position, rank })));
  assert.equal(m.teams.find(t => t.id === 'blue').rank, 2);
  const award = m.awards.find(a => a.id === 'team-winner');
  assert.equal(award.winner.id, 'tie');
  assert.equal(award.winner.name, m.winner.teamIds.map(id => g.teamManager.getTeam(id).name).join('、'));
  assert.deepEqual(award.winner.tiedTeams.map(t => t.id), m.winner.teamIds);
  assert.deepEqual(award.winner.tiedTeams.map(t => t.value), [100, 50]);
  assert.equal(award.winner.value, 100);
  assert.equal(award.metricKey, 'position');
  assert.deepEqual(award.ranking.map(({ id, value }) => ({ id, value })),
    g.getAwardTeams().sort((a, b) => b.value - a.value).map(({ id, value }) => ({ id, value })));
});
test('corrupt JSON is preserved; write failure preserves previous valid file and does not interrupt awards', t => {
  const { file, dir } = fixture(t); fs.writeFileSync(file, '{broken'); const store = new Store(file);
  assert.equal(store.read().storage.errorCode, 'RESULT_FILE_CORRUPT'); const backup = fs.readdirSync(dir).find(n => n.includes('.corrupt-'));
  assert.equal(fs.readFileSync(path.join(dir, backup), 'utf8'), '{broken');
  const g = game(store); finish(g); const previous = fs.readFileSync(file, 'utf8');
  const failed = new Store(file, { ...fs, writeFileSync() { throw new Error('simulated write failure'); } });
  const next = game(failed); assert.doesNotThrow(() => finish(next)); assert.equal(next.state, 'MATCH_FINISHED'); assert.equal(next.buildFinalAwardsPayload().awards.length, 4);
  assert.equal(failed.read().storage.errorCode, 'RESULT_SNAPSHOT_FAILED'); assert.equal(fs.readFileSync(file, 'utf8'), previous);
  assert.equal(fs.readdirSync(dir).some(n => n.endsWith('.tmp')), false);
});
test('real finish callback writes only after transition and once per run', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000000 });
  const { store } = fixture(t); const g = game(store);
  g.finishRound('red'); assert.equal(store.read().matches.length, 0);
  t.mock.timers.tick(g.getFinalTransitionSeconds() * 1000);
  assert.equal(g.state, 'MATCH_FINISHED'); assert.equal(store.read().matches.length, 1);
  g.setState('MATCH_FINISHED'); g.broadcastStateSync(); assert.equal(store.read().matches.length, 1);
  g.resetGame(); assert.equal(store.read().matches.length, 1);
});
test('rename failure preserves valid file; failed corrupt backup blocks destructive replacement', t => {
  const { file, store } = fixture(t); finish(game(store)); const previous = fs.readFileSync(file, 'utf8');
  const io = { ...fs, renameSync() { throw new Error('simulated rename failure'); } };
  const failed = new Store(file, io); finish(game(failed)); assert.equal(fs.readFileSync(file, 'utf8'), previous);
  fs.writeFileSync(file, '{bad'); const blocked = new Store(file, io); finish(game(blocked)); assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
  assert.equal(blocked.read().storage.ok, false);
});
