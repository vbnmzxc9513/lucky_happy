(function (root) {
  function enabled(config) { return !!config?.quizStages?.enabled; }
  function measure(position, config) {
    const distance = Math.max(0, Number(position) || 0);
    const legLength = Math.max(1, Number(config?.shuttleRace?.legLength) || 1500);
    const leg = Math.floor(distance / legLength);
    const fraction = (distance % legLength) / legLength;
    return { distance, leg, legLength, laps: Math.floor(distance / (legLength * 2)),
      direction: leg % 2 ? -1 : 1, x: leg % 2 ? 1 - fraction : fraction,
      progress: (distance % (legLength * 2)) / (legLength * 2) * 100 };
  }
  // One linear world coordinate and one shared camera for all lanes and items.
  function camera(positions, endpoints = positions) {
    const values = [...positions, ...endpoints].map(p => Math.max(0, Number(p) || 0));
    const low = Math.max(0, Math.min(...values) - 750);
    return { low, high: Math.max(low + 12000, Math.max(...values) + 7000) };
  }
  function project(position, view) { return (position - view.low) / (view.high - view.low); }
  function rank(teams) {
    const sorted = Object.entries(teams).sort((a, b) => (b[1].position || 0) - (a[1].position || 0));
    return Object.fromEntries(sorted.map(([id, team], i) => [id,
      sorted.findIndex(([, other]) => Math.abs((other.position || 0) - (team.position || 0)) < 0.5) + 1]));
  }
  const api = { enabled, measure, rank, camera, project };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShuttleRace = api;
})(typeof window === 'undefined' ? globalThis : window);
