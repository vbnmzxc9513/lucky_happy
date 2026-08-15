const GameManager = require('../server/game/GameManager');

class MockIo {
  emit() {}
}

function formatDuration(seconds) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function addPlayersEvenly(gameManager, totalPlayers) {
  const teamIds = Object.keys(gameManager.teamManager.teams);
  for (let i = 0; i < totalPlayers; i++) {
    const socketId = `estimate_${totalPlayers}_${i}`;
    gameManager.teamManager.addPlayer(socketId, `Player ${i + 1}`, 'P');
    gameManager.teamManager.chooseTeam(socketId, teamIds[i % teamIds.length]);
  }
}

function estimateFixedDuration(gameManager, map, fixedTrackLength) {
  const recommendation = gameManager.calculateRecommendedTrackLength(map);
  const pacing = gameManager.getRacePacingConfig();
  const quizBoost = recommendation.quizCount * Number(pacing.expectedQuizBoostPx || 0);
  const racingSeconds = Math.max(0, (fixedTrackLength - quizBoost) / recommendation.estimatedSpeedPxPerSecond);
  return {
    ...recommendation,
    trackLength: fixedTrackLength,
    targetRacingSeconds: racingSeconds,
    targetGameSeconds: racingSeconds + recommendation.overheadSeconds
  };
}

function estimate(totalPlayers, fixedTrackLength = 104000) {
  const dynamicGame = new GameManager(new MockIo());
  addPlayersEvenly(dynamicGame, totalPlayers);
  const dynamicMap = dynamicGame.mapManager.getCurrentMap();
  const dynamic = dynamicGame.calculateRecommendedTrackLength(dynamicMap);

  const fixedGame = new GameManager(new MockIo());
  addPlayersEvenly(fixedGame, totalPlayers);
  const fixedMap = fixedGame.mapManager.getCurrentMap();
  const fixed = estimateFixedDuration(fixedGame, fixedMap, fixedTrackLength);

  return { totalPlayers, dynamic, fixed };
}

function main() {
  const totals = process.argv.slice(2).map(Number).filter(Number.isFinite);
  const playerCounts = totals.length ? totals : [30, 50, 80, 100, 150, 200];
  const rows = playerCounts.map(count => estimate(count));

  console.log('Assumptions: 5 teams, about 5 taps/sec/player, 3 questions, 10 sec/question, 3 sec prepare, 3 sec result.');
  console.log('');
  console.log('| Players | Per team | Auto track | Auto total | Fixed 104000 total | Questions |');
  console.log('|---:|---:|---:|---:|---:|---:|');
  for (const row of rows) {
    console.log([
      `| ${row.totalPlayers}`,
      row.dynamic.fastestTeamSize,
      row.dynamic.trackLength.toLocaleString('en-US'),
      formatDuration(row.dynamic.targetGameSeconds),
      formatDuration(row.fixed.targetGameSeconds),
      `${row.dynamic.quizCount} |`
    ].join(' | '));
  }
}

if (require.main === module) {
  main();
}

module.exports = { estimate, formatDuration };
