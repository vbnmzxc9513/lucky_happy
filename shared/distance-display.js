(function (root) {
  const defaults = typeof module !== 'undefined' && module.exports ? require('./game-config') : root.GameConfig;
  const settings = config => config || defaults;
  function internalUnitsPerMeter(config) {
    const c = settings(config);
    return c.quizStages.rewardUnitPx / c.distanceDisplay.metersPerRewardStep;
  }
  function positionMeters(position, config) {
    return Math.floor((Number(position) || 0) / internalUnitsPerMeter(config));
  }
  function rewardMeters(steps, config) { return steps * settings(config).distanceDisplay.metersPerRewardStep; }
  function formatMeters(meters) { return `${Math.floor(meters).toLocaleString('en-US')} m`; }
  function position(position, config) { return formatMeters(positionMeters(position, config)); }
  function reward(steps, config) { return formatMeters(rewardMeters(steps, config)); }
  const api = { internalUnitsPerMeter, positionMeters, rewardMeters, formatMeters, position, reward };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DistanceDisplay = api;
})(typeof window === 'undefined' ? globalThis : window);
