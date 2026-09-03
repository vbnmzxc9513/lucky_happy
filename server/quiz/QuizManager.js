const DEFAULT_CONFIG = require('../../shared/game-config');

class QuizManager {
  constructor(quizLoader, config = DEFAULT_CONFIG) {
    this.quizLoader = quizLoader;
    this.config = config;
    this.currentQuiz = null;
    this.answeredSet = new Set(); // socketId:quizId 答案鎖定 Set
    this.answers = {};
    this.timer = null;
    this.timeoutCallback = null;
    this.answerWindowOpenedAt = null;
    this.answerDeadlineAt = null;
    this.pausedAt = null;
    this.pausedRemainingMs = null;
  }

  normalizeQuiz(quiz) {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const optionMap = {};
    const optionList = [];

    if (Array.isArray(quiz.options)) {
      quiz.options.forEach((text, index) => {
        const label = labels[index];
        if (!label) return;
        optionMap[label] = text;
        optionList.push(text);
      });
    } else if (quiz.options && typeof quiz.options === 'object') {
      labels.forEach((label) => {
        if (quiz.options[label] !== undefined && quiz.options[label] !== '') {
          optionMap[label] = quiz.options[label];
          optionList.push(quiz.options[label]);
        }
      });
    }

    const correctAnswer = this.normalizeCorrectAnswer(quiz.correctAnswer, optionMap);
    return {
      ...quiz,
      optionMap,
      optionList,
      correctAnswer,
      correctAnswerText: optionMap[correctAnswer] || ''
    };
  }

  normalizeCorrectAnswer(rawAnswer, optionMap) {
    const labels = Object.keys(optionMap);
    if (labels.length === 0) return 'A';

    if (typeof rawAnswer === 'number') {
      return labels[rawAnswer] || labels[0];
    }

    if (typeof rawAnswer === 'string') {
      const trimmed = rawAnswer.trim();
      const upper = trimmed.toUpperCase();
      if (optionMap[upper] !== undefined) return upper;

      const matchedLabel = labels.find(label => optionMap[label] === trimmed);
      if (matchedLabel) return matchedLabel;
    }

    return labels[0];
  }

  startQuiz(quizId, teamMembersCount, onTimeoutCallback, overrideTimeLimit = null) {
    const quiz = this.quizLoader.getQuizById(quizId) || this.quizLoader.getRandomQuiz();
    if (!quiz) return null;
    const normalizedQuiz = this.normalizeQuiz(quiz);

    this.currentQuiz = normalizedQuiz;
    this.answerWindowOpenedAt = Date.now();
    this.answeredSet.clear();
    
    this.answers = {};
    const teams = this.config.TEAMS || [];
    for (const t of teams) {
      this.answers[t.id] = {
        total: Math.max(0, Number(teamMembersCount[t.id]) || 0),
        responded: 0,
        votes: {}
      };
    }

    const requestedTimeLimit = Number(overrideTimeLimit || quiz.timeLimit || this.config.quizTimeLimit);
    const timeLimit = Math.max(1, Math.min(60, Number.isFinite(requestedTimeLimit) ? requestedTimeLimit : 10));
    this.answerDeadlineAt = Date.now() + timeLimit * 1000;

    this.timeoutCallback = onTimeoutCallback || null;
    this.pausedAt = null;
    this.pausedRemainingMs = null;
    this.scheduleTimeout(timeLimit * 1000);

    return {
      quizId: normalizedQuiz.id,
      question: normalizedQuiz.question,
      optionList: normalizedQuiz.optionList,
      optionMap: normalizedQuiz.optionMap,
      options: normalizedQuiz.optionList,
      timeLimit
    };
  }

  /**
   * 處理玩家作答與答案鎖定
   */
  markAnswerWindowOpened(timestamp = Date.now()) {
    if (!this.currentQuiz) return false;
    this.answerWindowOpenedAt = timestamp;
    return true;
  }

  handleAnswer(socketId, teamId, quizId, answerStr) {
    if (!this.currentQuiz || this.currentQuiz.id !== quizId) {
      return { success: false, reason: 'INVALID_QUIZ' };
    }

    const answerKey = `${socketId}:${quizId}`;
    if (this.answeredSet.has(answerKey)) {
      return { success: false, reason: 'ALREADY_ANSWERED' }; // 答案送出即鎖定，拒絕重複
    }

    const answeredAt = Date.now();
    if (this.answerDeadlineAt && answeredAt > this.answerDeadlineAt) {
      return { success: false, reason: 'ANSWER_WINDOW_CLOSED' };
    }
    const answerTimeMs = this.answerWindowOpenedAt
      ? Math.max(0, answeredAt - this.answerWindowOpenedAt)
      : null;
    const normalizedAnswer = typeof answerStr === 'string' ? answerStr.trim().toUpperCase() : answerStr;
    if (!this.currentQuiz.optionMap || this.currentQuiz.optionMap[normalizedAnswer] === undefined) {
      return { success: false, reason: 'INVALID_ANSWER' };
    }

    this.answeredSet.add(answerKey);
    const isCorrect = (normalizedAnswer === this.currentQuiz.correctAnswer);
    if (teamId && this.answers[teamId]) {
      const teamAnswers = this.answers[teamId];
      teamAnswers.responded++;
      teamAnswers.votes[normalizedAnswer] = (teamAnswers.votes[normalizedAnswer] || 0) + 1;
    }

    return {
      success: true,
      isCorrect,
      answer: normalizedAnswer,
      answerTimeMs,
      teamProgress: this.getTeamProgress(teamId)
    };
  }

  getTeamProgress(teamId) {
    const ans = this.answers[teamId];
    if (!ans) return null;
    return {
      teamId,
      answeredCount: ans.responded,
      totalCount: ans.total,
      progress: ans.total > 0 ? ans.responded / ans.total : 0
    };
  }

  scheduleTimeout(delayMs, referenceNow = Date.now()) {
    if (this.timer) clearTimeout(this.timer);
    const waitMs = Math.max(0, Number(delayMs) || 0);
    this.answerDeadlineAt = referenceNow + waitMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      const callback = this.timeoutCallback;
      if (callback) callback(this.calculateResults());
    }, waitMs);
  }

  pauseTimer(now = Date.now()) {
    if (!this.currentQuiz || this.pausedAt) return false;
    this.pausedAt = now;
    this.pausedRemainingMs = this.answerDeadlineAt
      ? Math.max(0, this.answerDeadlineAt - now)
      : 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return true;
  }

  resumeTimer(now = Date.now()) {
    if (!this.currentQuiz || !this.pausedAt) return false;
    const pausedDuration = Math.max(0, now - this.pausedAt);
    if (this.answerWindowOpenedAt) this.answerWindowOpenedAt += pausedDuration;
    const remainingMs = Math.max(0, Number(this.pausedRemainingMs) || 0);
    this.pausedAt = null;
    this.pausedRemainingMs = null;
    this.scheduleTimeout(remainingMs, now);
    return true;
  }

  calculateResults() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.currentQuiz) return null;

    const result = {
      quizId: this.currentQuiz.id,
      correctAnswer: this.currentQuiz.correctAnswer,
      correctAnswerText: this.currentQuiz.correctAnswerText,
      teamResults: {}
    };

    const teams = this.config.TEAMS || [];
    for (const t of teams) {
      const ans = this.answers[t.id];
      if (!ans) continue;
      const sortedVotes = Object.entries(ans.votes)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const highestVotes = sortedVotes.length > 0 ? sortedVotes[0][1] : 0;
      const leaders = sortedVotes.filter(([, count]) => count === highestVotes);
      const hasTie = leaders.length > 1;
      const teamAnswer = !hasTie && leaders.length === 1 ? leaders[0][0] : null;
      const isCorrect = teamAnswer === this.currentQuiz.correctAnswer;
      const effect = isCorrect
        ? { effect: 'large_boost', val: this.config.quizThresholds.LARGE_BOOST }
        : { effect: 'stun', val: this.config.stunDuration };
      result.teamResults[t.id] = {
        teamAnswer,
        isCorrect,
        hasTie,
        noAnswer: ans.responded === 0,
        voteCounts: { ...ans.votes },
        answeredCount: ans.responded,
        totalCount: ans.total,
        responseRate: ans.total > 0 ? ans.responded / ans.total : 0,
        ...effect
      };
    }

    this.currentQuiz = null;
    this.timeoutCallback = null;
    this.answerWindowOpenedAt = null;
    this.answerDeadlineAt = null;
    this.pausedAt = null;
    this.pausedRemainingMs = null;
    return result;
  }

  migrateAnswerIdentity(previousSocketId, socketId) {
    if (!this.currentQuiz || !previousSocketId || !socketId) return false;
    const previousKey = `${previousSocketId}:${this.currentQuiz.id}`;
    if (!this.answeredSet.has(previousKey)) return false;
    this.answeredSet.delete(previousKey);
    this.answeredSet.add(`${socketId}:${this.currentQuiz.id}`);
    return true;
  }

  getRecoveryPayload() {
    if (!this.currentQuiz) return null;
    const remainingMs = this.pausedAt
      ? Math.max(0, Number(this.pausedRemainingMs) || 0)
      : (this.answerDeadlineAt ? Math.max(0, this.answerDeadlineAt - Date.now()) : 0);
    const timeLimit = Math.max(1, Math.ceil(remainingMs / 1000));
    return {
      quizId: this.currentQuiz.id,
      question: this.currentQuiz.question,
      optionList: this.currentQuiz.optionList,
      optionMap: this.currentQuiz.optionMap,
      timeLimit
    };
  }

  /**
   * 中止進行中的突發關卡並清理計時器 (用於主持人強制重置賽事)
   */
  cancelQuiz() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.currentQuiz = null;
    this.timeoutCallback = null;
    this.answerWindowOpenedAt = null;
    this.answerDeadlineAt = null;
    this.pausedAt = null;
    this.pausedRemainingMs = null;
  }
}

module.exports = QuizManager;
