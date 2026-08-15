const fs = require('fs');
const path = require('path');
const config = require('../config');

class QuizLoader {
  constructor() {
    this.quizzes = new Map();
    this.loadAllQuizzes();
  }

  loadAllQuizzes() {
    try {
      if (!fs.existsSync(config.paths.quizzes)) return;
      const files = fs.readdirSync(config.paths.quizzes);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = fs.readFileSync(path.join(config.paths.quizzes, file), 'utf8');
          const data = JSON.parse(content);
          if (data && data.quizzes) {
            for (const q of data.quizzes) {
              this.quizzes.set(q.id, q);
            }
          }
        }
      }
    } catch (err) {
      console.error('載入題庫失敗:', err);
    }
  }

  getQuizById(id) {
    return this.quizzes.get(id);
  }

  getRandomQuiz(pool = []) {
    if (pool && pool.length > 0) {
      const validIds = pool.filter(id => this.quizzes.has(id));
      if (validIds.length > 0) {
        const randomId = validIds[Math.floor(Math.random() * validIds.length)];
        return this.quizzes.get(randomId);
      }
    }
    const all = Array.from(this.quizzes.values());
    if (all.length === 0) return null;
    return all[Math.floor(Math.random() * all.length)];
  }

  getAllQuizzes() {
    return Array.from(this.quizzes.values());
  }

  saveQuiz(quizData) {
    if (!quizData || !quizData.id) return false;
    this.quizzes.set(quizData.id, quizData);
    try {
      if (!fs.existsSync(config.paths.quizzes)) {
        fs.mkdirSync(config.paths.quizzes, { recursive: true });
      }
      const filePath = path.join(config.paths.quizzes, 'custom-quizzes.json');
      let data = { quizzes: [] };
      if (fs.existsSync(filePath)) {
        try {
          data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (!data.quizzes) data.quizzes = [];
        } catch (e) {
          data = { quizzes: [] };
        }
      }
      const idx = data.quizzes.findIndex(q => q.id === quizData.id);
      if (idx >= 0) {
        data.quizzes[idx] = quizData;
      } else {
        data.quizzes.push(quizData);
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('寫入題庫失敗:', err);
      return false;
    }
  }

  deleteQuiz(quizId) {
    if (this.quizzes.has(quizId)) {
      this.quizzes.delete(quizId);
      try {
        const filePath = path.join(config.paths.quizzes, 'custom-quizzes.json');
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (data && data.quizzes) {
            data.quizzes = data.quizzes.filter(q => q.id !== quizId);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
          }
        }
      } catch (err) {
        console.error('刪除題庫檔案失敗:', err);
      }
      return true;
    }
    return false;
  }
}

module.exports = QuizLoader;
