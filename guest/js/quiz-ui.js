/**
 * 手機分屏答題介面：只有選項 A/B/C/D！答案送出即鎖定！
 */
class QuizUI {
  constructor(onAnswerCallback, onEntryReady = () => {}) {
    this.onAnswerCallback = onAnswerCallback;
    this.onEntryReady = onEntryReady;
    this.entering = false;
    this.timerInterval = null;
    this.isAnswered = false;
    this.initButtons();
  }

  initButtons() {
    document.querySelectorAll('.opt-btn').forEach(btn => {
      const ready = () => !this.isAnswered && !this.paused && !this.entering && !btn.disabled;
      btn.addEventListener('pointerdown', event => {
        this.gesture = ready() && event.isPrimary ? { button: btn, pointerId: event.pointerId, key: this.entryKey } : null;
      });
      btn.addEventListener('pointercancel', () => { this.gesture = null; });
      btn.addEventListener('keydown', event => {
        if (ready() && !event.repeat && ['Enter', ' '].includes(event.key)) this.gesture = { button: btn, key: this.entryKey };
      });
      btn.onclick = () => {
        const gesture = this.gesture;
        this.gesture = null;
        if (!ready() || gesture?.button !== btn || gesture.key !== this.entryKey) return;
        this.selectOption(btn.getAttribute('data-opt'), btn);
      };
    });
  }

  beginQuestion(key) {
    if (!key || this.entryKey === key) return;
    this.cancelEntry();
    this.entryKey = key;
    this.gesture = null;
    this.isAnswered = false;
    this.entering = false;
    this.disableAll();
    const message = document.getElementById('quiz-lock-msg');
    message.classList.remove('is-correct', 'is-wrong');
    message.textContent = '閱讀中';
    message.style.display = 'block';
    document.querySelectorAll('.opt-btn').forEach(btn => btn.classList.remove('selected'));
  }

  cancelEntry() {
    clearTimeout(this.entryTimer);
    this.entryTimer = null;
    this.entryKey = null;
    this.entering = false;
    document.querySelector('.quiz-ctrl-box')?.classList.remove('quiz-entering');
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
    this.cancelEntry();
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
        if (this.paused) return;
        left--;
        if (left > 0) {
          lockMsg.innerText = `⚠️ 突發關卡即將開始... ${left}`;
        } else {
          clearInterval(this.timerInterval);
        }
      }, 1000);
    }
  }

  showOptions(optionsData, timeLimit, authorityClock = null) {
    this.gesture = null;
    this.isAnswered = false;
    const optionsMap = this.normalizeOptions(optionsData);
    const lockMsg = document.getElementById('quiz-lock-msg');
    if (lockMsg) lockMsg.style.display = 'none';

    document.querySelectorAll('.opt-btn').forEach(btn => {
      btn.disabled = true;
      btn.classList.remove('selected');
      const opt = btn.getAttribute('data-opt');
      const textEl = btn.querySelector('.opt-text');
      if (textEl) {
        textEl.innerText = optionsMap[opt] || `選項 ${opt}`;
      }
    });

    const localDeadline = performance.now() + (timeLimit || 10) * 1000;
    const timerEl = document.getElementById('mobile-quiz-timer');
    const tick = () => {
      const left = authorityClock ? authorityClock() : Math.max(0, Math.ceil((localDeadline - performance.now()) / 1000));
      if (timerEl) timerEl.innerText = left;
      if (left <= 0) { this.stopTimer(); this.disableAll(); }
    };
    this.stopTimer();
    this.timerInterval = setInterval(tick, 100);
    tick();
  }

  selectOption(optStr, btnEl) {
    if (this.onAnswerCallback && this.onAnswerCallback(optStr) === false) return;
    this.isAnswered = true;
    this.disableAll();
    if (btnEl) btnEl.classList.add('selected');

    const lockMsg = document.getElementById('quiz-lock-msg');
    if (lockMsg) {
      lockMsg.style.display = 'block';
      lockMsg.innerText = '送出中';
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

    lockMsg.textContent = '已作答';
  }

  showWaiting() {
    this.cancelEntry();
    this.stopTimer(); this.disableAll();
    document.getElementById('mobile-quiz-timer').innerText = '—';
    const message = document.getElementById('quiz-lock-msg');
    message.style.display = 'block'; message.textContent = '等待主持人開始本題';
  }

  showTeamResult(teamResult, result = {}) {
    this.cancelEntry();
    this.disableAll();
    this.stopTimer();
    const lockMsg = document.getElementById('quiz-lock-msg');
    if (!lockMsg || !teamResult) return;
    lockMsg.classList.remove('is-correct', 'is-wrong');
    lockMsg.classList.add(teamResult.isCorrect ? 'is-correct' : 'is-wrong');
    lockMsg.style.display = 'block';
    this.isAnswered = true;
    document.getElementById('mobile-quiz-timer').innerText = '—';
    lockMsg.textContent = `正確答案：${result.correctAnswer || ''} ${result.correctAnswerText || ''}\n`
      + `本隊答對 ${teamResult.correctCount} / ${teamResult.totalCount} 人（${(teamResult.correctRate * 100).toFixed(1)}%）\n`
      + `${teamResult.isCorrect ? '✓ 整隊答對' : '未超過 50%'} `;
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
    this.cancelEntry();
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
