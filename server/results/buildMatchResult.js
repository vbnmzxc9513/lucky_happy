const number = v => Number.isFinite(v) ? Math.max(0, v) : 0;
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && o[k] !== undefined).map(k => [k, o[k]]));
const awardPerson = o => pick(o, ['id', 'name', 'avatar', 'teamId', 'teamName', 'value', 'tapCount', 'correctCount', 'wrongCount', 'answeredCount', 'averageAnswerMs', 'fastestAnswerMs']);
module.exports = function buildMatchResult(game) {
  const map = game.mapManager.getCurrentMap();
  const questionCount = game.stageQuestions.length || (map?.checkpoints || []).length;
  const teams = game.getTeamRanking().map(t => pick(t, ['id', 'name', 'rank', 'position', 'memberCount']));
  const finalWinner = game.roundManager.getFinalWinner();
  const scores = Object.entries(game.roundManager.getMatchStatus().scores);
  const highestScore = Math.max(...scores.map(([, score]) => score));
  // Match winners come from round wins; distance and rank remain display data.
  const teamIds = scores.filter(([, score]) => score === highestScore).map(([id]) => id);
  const players = [...game.teamManager.players.entries()].filter(([, p]) => p.teamId).map(([id, p]) => {
    const stat = game.playerStats.get(id) || {};
    const answeredCount = number(stat.answeredCount);
    return { nickname: p.nickname, avatar: p.avatar, teamId: p.teamId,
      teamName: game.teamManager.getTeam(p.teamId)?.name || p.teamId,
      tapCount: number(stat.tapCount), answeredCount, correctCount: number(stat.correctCount), wrongCount: number(stat.wrongCount),
      unansweredCount: Math.max(0, questionCount - answeredCount),
      accuracy: answeredCount ? number(stat.correctCount) / answeredCount : 0,
      averageAnswerMs: number(game.getAverageAnswerMs(stat)), fastestAnswerMs: number(stat.fastestAnswerMs),
      joinedAt: new Date(p.joinedAt).toISOString() };
  });
  teams.forEach(t => { t.memberCount = players.filter(p => p.teamId === t.id).length; });
  const awards = game.buildFinalAwardsPayload().awards.map(a => ({
    ...pick(a, ['id', 'scope', 'title', 'metricKey', 'metricLabel', 'unit']),
    winner: { ...awardPerson(a.winner), ...(a.winner?.tiedTeams ? { tiedTeams: a.winner.tiedTeams.map(awardPerson) } : {}) },
    ranking: a.ranking.map(awardPerson)
  }));
  const teamAward = awards.find(a => a.id === 'team-winner');
  if (teamAward) {
    const winningTeams = teamIds.map(id => teamAward.ranking.find(t => t.id === id));
    teamAward.winner = finalWinner === 'tie'
      ? { id: 'tie', name: winningTeams.map(t => t.name).join('、'),
          value: Math.max(0, ...winningTeams.map(t => t.value)), tiedTeams: winningTeams }
      : winningTeams[0];
  }
  return JSON.parse(JSON.stringify({ id: game.runId, finishedAt: new Date().toISOString(),
    map: pick(map, ['id', 'name']), questionCount,
    stageCount: game.usesQuizStages() ? Math.ceil(questionCount / game.config.quizStages.questionsPerStage) : 0,
    winner: { type: finalWinner === 'tie' ? 'tie' : 'team', teamIds }, teams, players, awards }));
};
