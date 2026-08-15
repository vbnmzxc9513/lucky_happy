/**
 * 訊息格式驗證器
 */

const Validators = {
  validateJoin(data) {
    if (!data || typeof data.nickname !== 'string') return { valid: false, error: '暱稱必須為字串' };
    const nick = data.nickname.trim();
    if (nick.length === 0 || nick.length > 12) return { valid: false, error: '暱稱長度需介於 1~12 個字元' };
    return { valid: true, nickname: nick };
  },

  validateChooseTeam(data) {
    if (!data || typeof data.teamId !== 'string') return { valid: false, error: '隊伍 ID 必須為字串' };
    let validIds = [];
    if (typeof process !== 'undefined' && process.env) {
      // Backend
      validIds = require('./game-config').TEAMS.map(t => t.id);
    } else if (typeof window !== 'undefined' && window.GameConfig) {
      // Frontend
      validIds = window.GameConfig.TEAMS.map(t => t.id);
    } else {
      validIds = ['red', 'blue', 'yellow', 'pink', 'purple']; // Fallback
    }
    
    if (!validIds.includes(data.teamId)) return { valid: false, error: '無效的隊伍選擇' };
    return { valid: true, teamId: data.teamId };
  },

  validateTap(data) {
    if (!data || typeof data.timestamp !== 'number') return { valid: false, error: '時間戳無效' };
    return { valid: true, timestamp: data.timestamp };
  },

  validateQuizAnswer(data) {
    if (!data || typeof data.quizId !== 'string' || typeof data.answer !== 'string') {
      return { valid: false, error: '答題格式錯誤' };
    }
    return { valid: true, quizId: data.quizId, answer: data.answer };
  },

  validateSelectMap(data) {
    if (!data || typeof data.mapId !== 'string') return { valid: false, error: '地圖 ID 無效' };
    return { valid: true, mapId: data.mapId };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Validators;
} else {
  window.GameValidators = Validators;
}
