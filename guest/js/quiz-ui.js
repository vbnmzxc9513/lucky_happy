/**
 * 手機分屏答題介面：只有選項 A/B/C/D！答案送出即鎖定！
 */
class QuizUI {
  constructor(onAnswerCallback) {
    this.onAnswerCallback = onAnswerCallback;
    this.timerInterval = null;
    this.isAnswered = false;
    this.initButtons();
  }

  initButtons() {
    document.querySelectorAll('.opt-btn').forEach(btn => {
      btn.onclick = () => {
        if (this.isAnswered) return;
        const opt = btn.getAttribute('data-opt');
        this.selectOption(opt, btn);
      };
    });
  }

  normalizeOptions(optionsData) {
    const labels = ['A', 'B', 'C', 'D'];
    const map = {};
    if (Array.isArray(optionsData)) {
      labels.forEach((label, index) => {
        map[label] = optionsData[index] || '';
      });
      return map;
    }
    if (optionsData && typeof optionsData === 'object') {
      labels.forEach((label) => {
        map[label] = optionsData[label] || '';
      });
    }
    return map;
  }

  showPrepare(seconds = 3) {
    this.isAnswered = false;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.disableAll();
    const lockMsg = document.getElementById('quiz-lock-msg');
    
    // 清除任何選項文字，避免舊狀態干擾
    document.querySelectorAll('.opt-btn').forEach(btn => {
      const textEl = btn.querySelector('.opt-text');
      if (textEl) textEl.innerText = '';
    });

    if (lockMsg) {
      lockMsg.style.display = 'block';
      lockMsg.innerText = `⚠️ 突發關卡即將開始... ${seconds}`;
      
      let left = seconds;
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        left--;
        if (left > 0) {
          lockMsg.innerText = `⚠️ 突發關卡即將開始... ${left}`;
        } else {
          clearInterval(this.timerInterval);
        }
      }, 1000);
    }
  }

  showOptions(optionsData, timeLimit) {
    this.isAnswered = false;
    const optionsMap = this.normalizeOptions(optionsData);
    const lockMsg = document.getElementById('quiz-lock-msg');
    if (lockMsg) lockMsg.style.display = 'none';

    document.querySelectorAll('.opt-btn').forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('selected');
      const opt = btn.getAttribute('data-opt');
      const textEl = btn.querySelector('.opt-text');
      if (textEl) {
        textEl.innerText = optionsMap[opt] || `選項 ${opt}`;
      }
    });

    let left = timeLimit || 10;
    const timerEl = document.getElementById('mobile-quiz-timer');
    if (timerEl) timerEl.innerText = left;

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      left--;
      if (left < 0) left = 0;
      if (timerEl) timerEl.innerText = left;
      if (left <= 0) {
        clearInterval(this.timerInterval);
        this.disableAll();
      }
    }, 1000);
  }

  selectOption(optStr, btnEl) {
    this.isAnswered = true;
    this.disableAll();
    if (btnEl) btnEl.classList.add('selected');

    const lockMsg = document.getElementById('quiz-lock-msg');
    if (lockMsg) {
      lockMsg.style.display = 'block';
      lockMsg.innerText = '🔒 答案已鎖定送出';
    }

    if (this.onAnswerCallback) {
      this.onAnswerCallback(optStr);
    }
  }

  showAnswerAck(result) {
    const lockMsg = document.getElementById('quiz-lock-msg');
    if (!lockMsg) return;
    lockMsg.classList.remove('is-correct', 'is-wrong');
    lockMsg.style.display = 'block';

    if (!result || !result.success) {
      const reason = result && result.reason;
      lockMsg.innerText = reason === 'GAME_PAUSED'
        ? '現場暫停中，恢復後再作答'
        : '答案未送出，請留意大螢幕狀態';
      return;
    }

    lockMsg.classList.add(result.isCorrect ? 'is-correct' : 'is-wrong');
    lockMsg.innerHTML = result.isCorrect
      ? '<strong>答對了！</strong><span>漂亮命中，等待隊伍多數決</span>'
      : '<strong>差一點！</strong><span>答案已計入隊伍多數決</span>';
  }

  showTeamResult(teamResult) {
    const lockMsg = document.getElementById('quiz-lock-msg');
    if (!lockMsg || !teamResult) return;
    lockMsg.classList.remove('is-correct', 'is-wrong');
    lockMsg.classList.add(teamResult.isCorrect ? 'is-correct' : 'is-wrong');
    lockMsg.style.display = 'block';
    if (teamResult.noAnswer) {
      lockMsg.innerHTML = '<strong>本隊未作答</strong><span>這題沒有形成隊伍答案</span>';
    } else if (teamResult.hasTie) {
      lockMsg.innerHTML = '<strong>隊內票數平手</strong><span>這題沒有形成唯一答案</span>';
    } else {
      lockMsg.innerHTML = teamResult.isCorrect
        ? '<strong>隊伍答對！</strong><span>多數決成功，獲得大幅加速</span>'
        : `<strong>隊伍答錯</strong><span>多數選擇 ${teamResult.teamAnswer || '--'}</span>`;
    }
  }

  disableAll() {
    document.querySelectorAll('.opt-btn').forEach(btn => {
      btn.disabled = true;
    });
  }

  stopTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = null;
  }

  hide() {
    this.stopTimer();
    this.isAnswered = false;
    const lockMsg = document.getElementById('quiz-lock-msg');
    if (lockMsg) lockMsg.style.display = 'none';
    document.querySelectorAll('.opt-btn').forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('selected');
    });
  }
}
window.QuizUI = QuizUI;
