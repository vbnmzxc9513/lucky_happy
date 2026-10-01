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
      btn.onclick = () => {
        if (this.isAnswered || this.paused || this.entering || btn.disabled) return;
        const opt = btn.getAttribute('data-opt');
        this.selectOption(opt, btn);
      };
    });
  }

  beginQuestion(key) {
    if (!key || this.entryKey === key) return;
    this.cancelEntry();
    this.entryKey = key;
    this.entering = true;
    document.querySelector('.quiz-ctrl-box')?.classList.add('quiz-entering');
    this.disableAll();
    const readyAt = performance.now() + 500;
    const finishEntry = () => {
      if (this.entryKey !== key) return;
      const remaining = readyAt - performance.now();
      if (remaining > 0) { this.entryTimer = setTimeout(finishEntry, Math.ceil(remaining)); return; }
      this.entering = false;
      this.entryTimer = null;
      document.querySelector('.quiz-ctrl-box')?.classList.remove('quiz-entering');
      this.onEntryReady();
    };
    this.entryTimer = setTimeout(finishEntry, 500);
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
    this.isAnswered = false;
    const optionsMap = this.normalizeOptions(optionsData);
    const lockMsg = document.getElementById('quiz-lock-msg');
    if (lockMsg) lockMsg.style.display = 'none';

    document.querySelectorAll('.opt-btn').forEach(btn => {
      btn.disabled = this.entering;
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
      lockMsg.innerText = '答案傳送中，等待確認';
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
      ? '<strong>答對了！</strong><span>漂亮命中，等待隊伍答對率結算</span>'
      : '<strong>差一點！</strong><span>答案已鎖定，等待統計</span>';
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
      + `${teamResult.isCorrect ? '本題答對（超過 50%）' : '未達 50%（須嚴格大於 50%）'}\n等待主持人進入下一題`;
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
