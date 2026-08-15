const fs = require('fs');
const path = require('path');
const config = require('../config');

class MapManager {
  constructor() {
    this.maps = new Map();
    this.currentMapId = 'wedding-final-showdown';
    this.loadAllMaps();
  }

  loadAllMaps() {
    try {
      if (!fs.existsSync(config.paths.maps)) return;
      const files = fs.readdirSync(config.paths.maps);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = fs.readFileSync(path.join(config.paths.maps, file), 'utf8');
          const mapData = JSON.parse(content);
          this.maps.set(mapData.id, mapData);
        }
      }
    } catch (err) {
      console.error('載入地圖失敗:', err);
    }
  }

  getMapList() {
    const list = [];
    for (const [id, map] of this.maps) {
      list.push({
        id: map.id,
        name: map.name,
        description: map.description,
        thumbnail: map.thumbnail,
        difficulty: map.difficulty,
        checkpointsCount: map.checkpoints ? map.checkpoints.length : 0,
        track: map.track,
        checkpoints: map.checkpoints || [],
        items: map.items,
        config: map.config
      });
    }
    return list;
  }

  selectMap(mapId) {
    if (this.maps.has(mapId)) {
      this.currentMapId = mapId;
      return true;
    }
    return false;
  }

  getCurrentMap() {
    return this.maps.get(this.currentMapId) || this.maps.values().next().value;
  }

  normalizeCheckpoint(cp, index) {
    if (!cp) return null;
    if (cp.trigger && cp.trigger.type) {
      return {
        ...cp,
        id: cp.id || `cp_${index + 1}`
      };
    }
    return {
      id: cp.id || `cp_${index + 1}`,
      trigger: {
        type: 'team_progress',
        percent: Number(cp.progress) || 30
      },
      quizId: cp.quizId || null
    };
  }

  saveMap(mapData) {
    if (!mapData || !mapData.id) return false;
    const normalizedMap = {
      ...mapData,
      checkpoints: (mapData.checkpoints || [])
        .map((cp, index) => this.normalizeCheckpoint(cp, index))
        .filter(Boolean)
    };
    this.maps.set(normalizedMap.id, normalizedMap);
    try {
      if (!fs.existsSync(config.paths.maps)) {
        fs.mkdirSync(config.paths.maps, { recursive: true });
      }
      const filePath = path.join(config.paths.maps, `${normalizedMap.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(normalizedMap, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('寫入地圖失敗:', err);
      return false;
    }
  }

  deleteMap(mapId) {
    if (this.maps.has(mapId)) {
      this.maps.delete(mapId);
      try {
        const filePath = path.join(config.paths.maps, `${mapId}.json`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error('刪除地圖檔案失敗:', err);
      }
      if (this.currentMapId === mapId) {
        this.currentMapId = this.maps.keys().next().value || 'cherry-blossom-lane';
      }
      return true;
    }
    return false;
  }
}

module.exports = MapManager;
