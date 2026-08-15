const DEFAULT_CONFIG = require('../../shared/game-config');

class RoundManager {
  constructor(totalRounds = DEFAULT_CONFIG.totalRounds || 1, config = DEFAULT_CONFIG) {
    this.totalRounds = totalRounds;
    this.config = config;
    this.currentRound = 1;
    this.scores = {};
    this._initScores();
    this.history = [];
  }

  _initScores() {
    this.scores = {};
    const teams = this.config.TEAMS || [];
    for (const t of teams) {
      this.scores[t.id] = 0;
    }
  }

  reset() {
    this.currentRound = 1;
    this._initScores();
    this.history = [];
  }

  recordRoundWinner(winnerTeamId) {
    const roundInfo = {
      round: this.currentRound,
      winner: winnerTeamId,
      timestamp: Date.now()
    };
    this.history.push(roundInfo);

    if (winnerTeamId && this.scores[winnerTeamId] !== undefined) {
      this.scores[winnerTeamId]++;
    }
    return roundInfo;
  }

  nextRound() {
    if (this.currentRound < this.totalRounds) {
      this.currentRound++;
      return true;
    }
    return false;
  }

  isMatchFinished() {
    return this.currentRound >= this.totalRounds && this.history.length >= this.totalRounds;
  }

  getMatchStatus() {
    return {
      currentRound: this.currentRound,
      totalRounds: this.totalRounds,
      scores: { ...this.scores },
      history: [...this.history]
    };
  }

  getFinalWinner() {
    const sorted = Object.entries(this.scores).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return 'tie';
    if (sorted.length === 1) return sorted[0][0];
    if (sorted[0][1] === sorted[1][1]) return 'tie';
    return sorted[0][0];
  }
}

module.exports = RoundManager;
