/**
 * 伺服器端關卡觸發條件判定引擎
 * 根據GAME_DESIGN.md：題目觸發為後端操作，非玩家觸發
 */
class CheckpointTriggerEngine {
  constructor() {
    this.checkpoints = [];
    this.triggeredIds = new Set();
    this.gameStartTime = 0;
    this.totalTaps = 0;
  }

  initCheckpoints(mapCheckpoints) {
    this.checkpoints = mapCheckpoints || [];
    this.triggeredIds.clear();
    this.gameStartTime = Date.now();
    this.totalTaps = 0;
  }

  recordTap() {
    this.totalTaps++;
  }

  /**
   * 每次遊戲迴圈或點擊時呼叫，檢查是否滿足關卡觸發條件
   */
  checkTriggers(teams, trackLength) {
    if (this.checkpoints.length === 0) return null;

    const elapsedSeconds = (Date.now() - this.gameStartTime) / 1000;
    const progresses = Object.values(teams).map(t => (t.position / trackLength) * 100);
    const maxProgress = Math.max(...progresses);
    const sortedProgress = [...progresses].sort((a, b) => b - a);
    const gap = sortedProgress.length >= 2 ? sortedProgress[0] - sortedProgress[1] : 0;

    // console.log(`[Checkpoint] Elapsed: ${elapsedSeconds.toFixed(1)}s`); // Too noisy, avoid unless needed

    for (const cp of this.checkpoints) {
      if (this.triggeredIds.has(cp.id)) continue;
      const trigger = cp.trigger;
      if (!trigger) continue;

      let shouldTrigger = false;

      if (trigger.type === 'time_elapsed' && elapsedSeconds >= trigger.seconds) {
        console.log(`[Checkpoint] Triggering ${cp.id} by time_elapsed (${elapsedSeconds.toFixed(1)}s >= ${trigger.seconds}s)`);
        shouldTrigger = true;
      } else if (trigger.type === 'team_progress' && maxProgress >= trigger.percent) {
        shouldTrigger = true;
      } else if (trigger.type === 'combined_taps' && this.totalTaps >= trigger.count) {
        shouldTrigger = true;
      } else if (trigger.type === 'leading_gap' && gap >= trigger.percent) {
        shouldTrigger = true;
      }

      if (shouldTrigger) {
        this.triggeredIds.add(cp.id);
        return cp; // 觸發此關卡
      }
    }
    return null;
  }
}

module.exports = CheckpointTriggerEngine;
