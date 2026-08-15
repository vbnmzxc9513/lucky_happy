/**
 * 視覺特效控制
 */
class EffectsController {
  static triggerBoostEffect(teamId) {
    const horseEl = document.getElementById(`horse-${teamId}`);
    if (!horseEl) return;
    horseEl.style.filter = 'drop-shadow(0 0 25px #ff9900)';
    setTimeout(() => { horseEl.style.filter = ''; }, 1000);
  }

  static triggerStunEffect(teamId) {
    const horseEl = document.getElementById(`horse-${teamId}`);
    if (!horseEl) return;
    horseEl.style.filter = 'grayscale(100%) opacity(0.7)';
    setTimeout(() => { horseEl.style.filter = ''; }, 2500);
  }

  static showFloatingText(teamId, text, color = '#f59e0b') {
    const horseEl = document.getElementById(`horse-${teamId}`);
    if (!horseEl) return;
    const floatEl = document.createElement('div');
    floatEl.innerText = text;
    floatEl.style.position = 'absolute';
    floatEl.style.top = '-40px';
    floatEl.style.left = '20px';
    floatEl.style.fontSize = '24px';
    floatEl.style.fontWeight = 'bold';
    floatEl.style.color = color;
    floatEl.style.transition = 'all 1s ease-out';
    floatEl.style.zIndex = '50';
    horseEl.appendChild(floatEl);

    setTimeout(() => {
      floatEl.style.transform = 'translateY(-50px) scale(1.3)';
      floatEl.style.opacity = '0';
    }, 50);

    setTimeout(() => { floatEl.remove(); }, 1000);
  }
}
window.EffectsController = EffectsController;
