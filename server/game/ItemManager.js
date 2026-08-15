const fs = require('fs');
const config = require('../config');
const DEFAULT_CONFIG = require('../../shared/game-config');

class ItemManager {
  constructor(gameConfig = DEFAULT_CONFIG) {
    this.itemsData = {};
    this.gameConfig = gameConfig;
    this.activeItems = {};
    this._initActiveItems();
    this.loadItemsData();
  }

  _initActiveItems() {
    this.activeItems = {};
    const teams = this.gameConfig.TEAMS || [];
    for (const t of teams) {
      this.activeItems[t.id] = [];
    }
  }

  loadItemsData() {
    try {
      if (fs.existsSync(config.paths.items)) {
        this.itemsData = JSON.parse(fs.readFileSync(config.paths.items, 'utf8'));
      }
    } catch (err) {
      console.error('載入道具檔案失敗:', err);
    }
  }

  /**
   * 根據地圖設定為賽道生成道具
   */
  generateTrackItems(mapData) {
    this._initActiveItems();
    if (!mapData || !mapData.items) return;

    const density = mapData.items.density || 3;
    const types = mapData.items.types || ['accelerator', 'obstacle'];
    const trackLen = (mapData.track && mapData.track.length) ? mapData.track.length : 1000;

    const minX = trackLen * 0.2;
    const maxX = trackLen * 0.85;
    const step = (maxX - minX) / density;

    const teamIds = Object.keys(this.activeItems);
    for (let i = 0; i < density; i++) {
      for (const teamId of teamIds) {
        const x = minX + i * step + (Math.random() - 0.5) * (step * 0.6);
        const type = types[Math.floor(Math.random() * types.length)];
        this.activeItems[teamId].push({ id: `${teamId}_item_${i}`, type, x: Math.round(x), triggered: false });
      }
    }
  }

  /**
   * 檢查馬匹與道具碰撞
   */
  checkCollisions(teamId, position, teamObj, onTriggerCallback) {
    const items = this.activeItems[teamId] || [];
    for (const item of items) {
      if (!item.triggered && (position + 40) >= item.x) {
        item.triggered = true;
        this.applyItemEffect(teamId, item, teamObj, onTriggerCallback);
      }
    }
  }

  applyItemEffect(teamId, item, teamObj, onTriggerCallback) {
    let effectType = item.type;
    if (effectType === 'mystery') {
      const randomTypes = ['accelerator', 'obstacle', 'shield'];
      effectType = randomTypes[Math.floor(Math.random() * randomTypes.length)];
    }

    const itemDef = this.itemsData[effectType] || {};
    let effectResult = itemDef.effect || 'none';

    if (effectResult === 'stun') {
      if (teamObj.shieldCount > 0) {
        teamObj.shieldCount--;
        effectResult = 'shield_blocked';
      } else {
        teamObj.isStunned = true;
        teamObj.stunUntil = Date.now() + (itemDef.duration || 2500);
      }
    } else if (effectResult === 'boost') {
      teamObj.speed += (itemDef.value || 30);
    } else if (effectResult === 'shield') {
      teamObj.shieldCount = (teamObj.shieldCount || 0) + 1;
    }

    if (onTriggerCallback) {
      onTriggerCallback(teamId, item.type, effectResult, itemDef);
    }
  }

  getActiveItems() {
    return this.activeItems;
  }
}

module.exports = ItemManager;
