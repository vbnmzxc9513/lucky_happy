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
    const layer = document.getElementById('tap-feedback-layer');
    if (!layer) return;

    const el = document.createElement('div');
    el.innerText = '⚡ +1';
    el.style.position = 'absolute';
    el.style.left = `${50 + (Math.random() - 0.5) * 40}%`;
    el.style.top = `${40 + (Math.random() - 0.5) * 30}%`;
    el.style.fontSize = '28px';
    el.style.fontWeight = '900';
    el.style.color = '#f59e0b';
    el.style.transition = 'all 0.5s ease-out';
    layer.appendChild(el);

    setTimeout(() => {
      el.style.transform = 'translateY(-60px) scale(1.3)';
      el.style.opacity = '0';
    }, 20);

    setTimeout(() => el.remove(), 500);
  }
}
window.TapHandler = TapHandler;
