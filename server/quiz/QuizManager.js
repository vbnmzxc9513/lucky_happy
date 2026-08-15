const DEFAULT_CONFIG = require('../../shared/game-config');

class QuizManager {
  constructor(quizLoader, config = DEFAULT_CONFIG) {
    this.quizLoader = quizLoader;
    this.config = config;
    this.currentQuiz = null;
    this.answeredSet = new Set(); // socketId:quizId 答案鎖定 Set
    this.answers = { red: { correct: 0, total: 0 }, blue: { correct: 0, total: 0 } };
    this.timer = null;
    this.answerWindowOpenedAt = null;
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

  startQuiz(quizId, teamMembersCount, onTimeoutCallback) {
    const quiz = this.quizLoader.getQuizById(quizId) || this.quizLoader.getRandomQuiz();
    if (!quiz) return null;
    const normalizedQuiz = this.normalizeQuiz(quiz);

    this.currentQuiz = normalizedQuiz;
    this.answerWindowOpenedAt = Date.now();
    this.answeredSet.clear();
    
    this.answers = {};
    const teams = this.config.TEAMS || [];
    for (const t of teams) {
      this.answers[t.id] = { correct: 0, total: teamMembersCount[t.id] || 1 };
    }

    const timeLimit = quiz.timeLimit || this.config.quizTimeLimit;

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (onTimeoutCallback) onTimeoutCallback(this.calculateResults());
    }, timeLimit * 1000);

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

    this.answeredSet.add(answerKey);

    const answeredAt = Date.now();
    const answerTimeMs = this.answerWindowOpenedAt
      ? Math.max(0, answeredAt - this.answerWindowOpenedAt)
      : null;
    const normalizedAnswer = typeof answerStr === 'string' ? answerStr.trim().toUpperCase() : answerStr;
    const isCorrect = (normalizedAnswer === this.currentQuiz.correctAnswer);
    if (teamId && this.answers[teamId]) {
      if (isCorrect) {
        this.answers[teamId].correct++;
      }
    }

    return { success: true, isCorrect, answerTimeMs };
  }

  calculateResults() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.currentQuiz) return null;

    const getEffect = (rate) => {
      if (rate >= this.config.quizThresholds.HIGH_CORRECT) return { effect: 'large_boost', val: this.config.quizThresholds.LARGE_BOOST };
      if (rate >= this.config.quizThresholds.MED_CORRECT) return { effect: 'small_boost', val: this.config.quizThresholds.SMALL_BOOST };
      return { effect: 'stun', val: this.config.stunDuration };
    };

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
      const rate = ans.total > 0 ? ans.correct / ans.total : 0;
      result.teamResults[t.id] = {
        correctCount: ans.correct,
        totalCount: ans.total,
        rate: rate,
        ...getEffect(rate)
      };
    }

    this.currentQuiz = null;
    this.answerWindowOpenedAt = null;
    return result;
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
    this.answerWindowOpenedAt = null;
  }
}

module.exports = QuizManager;
