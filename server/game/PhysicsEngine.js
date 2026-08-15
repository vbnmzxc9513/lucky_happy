const DEFAULT_CONFIG = require('../../shared/game-config');

class PhysicsEngine {
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
  }

  /**
   * 計算一次點擊帶來的速度加速
   * 根據GAME_DESIGN.md公式：實際加速 = boost / sqrt(team_size)
   */
  calculateBoost(teamSize, customBoost = null) {
    const boost = customBoost || this.config.baseBoost;
    const size = Math.max(1, teamSize || 1);
    return boost / Math.sqrt(size);
  }

  /**
   * 更新隊伍位置與速度 (在 30fps 廣播迴圈中呼叫)
   */
  updateTeamPhysics(team, dtSeconds = 0.033) {
    // 檢查暈眩狀態
    if (team.isStunned) {
      if (Date.now() >= team.stunUntil) {
        team.isStunned = false;
        team.stunUntil = 0;
      } else {
        team.speed = 0;
        return;
      }
    }

    // 套用阻力與衰減
    team.speed *= this.config.friction;
    if (team.speed < 0.05) team.speed = 0;
    if (team.speed > this.config.maxSpeed) team.speed = this.config.maxSpeed;

    // 更新位置
    team.position += team.speed;
  }
}

module.exports = PhysicsEngine;
