(function initGameSound(global) {
  const AudioContextClass = global.AudioContext || global.webkitAudioContext;
  let audioContext = null;
  let enabled = false;
  const lastPlayedAt = new Map();

  function getContext() {
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass();
    return audioContext;
  }

  async function enable() {
    const context = getContext();
    if (!context) return false;
    if (context.state === 'suspended') await context.resume();
    enabled = context.state === 'running';
    return enabled;
  }

  function tone(frequency, startOffset, duration, options = {}) {
    const context = getContext();
    if (!context || !enabled) return;

    const startAt = context.currentTime + startOffset;
    const endAt = startAt + duration;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const peak = Math.max(0.001, Number(options.gain) || 0.08);

    oscillator.type = options.type || 'sine';
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, endAt);
    }
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + Math.min(0.018, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.02);
  }

  function canPlay(name, minimumIntervalMs) {
    const now = Date.now();
    const previous = lastPlayedAt.get(name) || 0;
    if (now - previous < minimumIntervalMs) return false;
    lastPlayedAt.set(name, now);
    return true;
  }

  function play(name) {
    if (!enabled || !audioContext || audioContext.state !== 'running') return false;
    const interval = name === 'boost' ? 450 : 120;
    if (!canPlay(name, interval)) return false;

    switch (name) {
      case 'ready':
        tone(523.25, 0, 0.1, { gain: 0.06 });
        tone(659.25, 0.1, 0.14, { gain: 0.07 });
        break;
      case 'countdown':
        tone(620, 0, 0.14, { type: 'square', gain: 0.045 });
        break;
      case 'go':
        tone(523.25, 0, 0.13, { gain: 0.075 });
        tone(659.25, 0.09, 0.13, { gain: 0.08 });
        tone(783.99, 0.18, 0.24, { gain: 0.09 });
        break;
      case 'correct':
        tone(659.25, 0, 0.12, { type: 'triangle', gain: 0.08 });
        tone(880, 0.1, 0.12, { type: 'triangle', gain: 0.085 });
        tone(1046.5, 0.2, 0.23, { type: 'triangle', gain: 0.09 });
        break;
      case 'wrong':
        tone(246.94, 0, 0.16, { type: 'triangle', gain: 0.055 });
        tone(196, 0.13, 0.22, { type: 'triangle', gain: 0.05 });
        break;
      case 'boost':
        tone(360, 0, 0.22, { type: 'sawtooth', endFrequency: 880, gain: 0.035 });
        break;
      case 'sprint':
        tone(293.66, 0, 0.12, { type: 'square', gain: 0.055 });
        tone(392, 0.13, 0.12, { type: 'square', gain: 0.06 });
        tone(523.25, 0.26, 0.14, { type: 'square', gain: 0.065 });
        tone(783.99, 0.42, 0.35, { type: 'triangle', gain: 0.085 });
        break;
      case 'award':
        tone(523.25, 0, 0.25, { type: 'triangle', gain: 0.07 });
        tone(659.25, 0.12, 0.28, { type: 'triangle', gain: 0.075 });
        tone(783.99, 0.24, 0.32, { type: 'triangle', gain: 0.08 });
        tone(1046.5, 0.4, 0.55, { type: 'sine', gain: 0.1 });
        break;
      default:
        return false;
    }
    return true;
  }

  global.GameSound = {
    enable,
    isEnabled: () => enabled,
    play
  };
})(window);
