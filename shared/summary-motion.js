(function (root) {
  const defaults = typeof module !== 'undefined' && module.exports ? require('./game-config') : root.GameConfig;
  function duration(steps, config = defaults) { return config.summaryAnimation.durationBySteps[steps] || 0; }
  function timeline(teamResults, now, config = defaults) {
    const movementStartedAt = now + config.summaryAnimation.revealMs;
    const movementEndsAt = movementStartedAt + Math.max(0, ...Object.values(teamResults).map(r => duration(r.steps, config)));
    return { summaryStartedAt: now, movementStartedAt, movementEndsAt, readyAt: movementEndsAt + config.summaryAnimation.holdMs };
  }
  function progress(summary, steps, now, config = defaults) {
    const ms = duration(steps, config);
    if (!ms) return 1;
    return Math.max(0, Math.min(1, (now - summary.movementStartedAt) / ms));
  }
  function ease(t) { return t * t * (3 - 2 * t); }
  const api = { duration, timeline, progress, ease };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SummaryMotion = api;
})(typeof window === 'undefined' ? globalThis : window);
