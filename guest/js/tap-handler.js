/**
 * 點擊控制與防抖處理 (節流上報伺服器，同時給予即時視覺回饋)
 */
class TapHandler {
  constructor(onTapCallback) {
    this.onTapCallback = onTapCallback;
    this.lastTapTime = 0;
    this.cooldown = 100; // 100ms 防抖
    this.isStunned = false;
    this.init();
  }

  init() {
    const btn = document.getElementById('btn-tap');
    if (!btn) return;

    const handleTapEvent = (e) => {
      e.preventDefault();
      if (this.isStunned) return;

      const now = Date.now();
      if (now - this.lastTapTime < this.cooldown) return;
      this.lastTapTime = now;

      this.triggerVisualFeedback();
      if (this.onTapCallback) this.onTapCallback(now);
    };

    btn.addEventListener('touchstart', handleTapEvent, { passive: false });
    btn.addEventListener('mousedown', handleTapEvent);
  }

  setStunned(stunned) {
    this.isStunned = stunned;
    const alertEl = document.getElementById('my-stun-alert');
    const btn = document.getElementById('btn-tap');
    if (alertEl) alertEl.style.display = stunned ? 'block' : 'none';
    if (btn) btn.style.filter = stunned ? 'grayscale(100%) opacity(0.5)' : '';
  }

  triggerVisualFeedback() {
    const button = document.getElementById('btn-tap');
    if (!button) return;
    this.pressAnimation?.cancel();
    if (button.animate) this.pressAnimation = button.animate([
      { transform: 'scale(.96)', filter: 'brightness(1.12)' },
      { transform: 'scale(1)', filter: 'brightness(1)' }
    ], { duration: 130, easing: 'ease-out' });
  }

  showAckFeedback(result) {
    if (!result || !result.success) return;
    const layer = document.getElementById('tap-feedback-layer');
    const button = document.getElementById('btn-tap');
    if (!layer || !result.critical) return;

    const el = document.createElement('div');
    el.className = 'critical-hit-feedback';
    el.innerHTML = '<strong>CRITICAL</strong><span>2 倍爆擊</span>';
    layer.appendChild(el);
    if (button) {
      button.classList.remove('critical-hit');
      void button.offsetWidth;
      button.classList.add('critical-hit');
      setTimeout(() => button.classList.remove('critical-hit'), 650);
    }
    setTimeout(() => el.remove(), 900);
  }
}
window.TapHandler = TapHandler;
