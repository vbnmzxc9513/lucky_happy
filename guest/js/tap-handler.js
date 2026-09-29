/**
 * 點擊控制與防抖處理 (節流上報伺服器，同時給予即時視覺回饋)
 */
class TapHandler {
  constructor(onTapCallback, canTapCallback = () => true) {
    this.onTapCallback = onTapCallback;
    this.canTapCallback = canTapCallback;
    this.lastTapTime = 0;
    this.cooldown = 100; // 100ms 防抖
    this.isStunned = false;
    this.enabled = null;
    this.init();
  }

  init() {
    const btn = document.getElementById('btn-tap');
    if (!btn) return;

    const handleTapEvent = (e) => {
      e.preventDefault();
      if (this.isStunned || !this.enabled || !this.canTapCallback()) return;

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
    if (this.isStunned === !!stunned) return;
    this.isStunned = !!stunned;
    const alertEl = document.getElementById('my-stun-alert');
    const btn = document.getElementById('btn-tap');
    if (alertEl) alertEl.style.display = stunned ? 'block' : 'none';
    if (btn) btn.style.filter = stunned ? 'grayscale(100%) opacity(0.5)' : '';
  }

  setEnabled(enabled) {
    if (this.enabled === !!enabled) return;
    this.enabled = !!enabled;
    const button = document.getElementById('btn-tap');
    if (button) button.disabled = !this.enabled;
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
    if (button?.animate) {
      this.criticalAnimation?.cancel();
      this.criticalAnimation = button.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(1.08)', offset: .45 },
        { transform: 'scale(1)' }
      ], { duration: 620, easing: 'ease-out' });
    }
    setTimeout(() => el.remove(), 900);
  }
}
window.TapHandler = TapHandler;
