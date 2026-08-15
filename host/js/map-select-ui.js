/**
 * 地圖選擇介面渲染
 */
class MapSelectUI {
  constructor(onSelectCallback) {
    this.onSelectCallback = onSelectCallback;
    this.selectedMapId = null;
  }

  render(mapList, currentMapId) {
    const container = document.getElementById('map-list-container');
    if (!container || !mapList) return;
    container.innerHTML = '';
    this.selectedMapId = currentMapId;

    for (const map of mapList) {
      const card = document.createElement('div');
      card.className = `map-card ${map.id === currentMapId ? 'selected' : ''}`;
      card.onclick = () => {
        if (this.onSelectCallback) this.onSelectCallback(map.id);
      };

      const stars = '⭐'.repeat(map.difficulty || 1);
      card.innerHTML = `
        <div>
          <div class="map-card-header">
            <span>${map.thumbnail || '🗺️'} ${map.name}</span>
            <span>${stars}</span>
          </div>
          <p>${map.description}</p>
        </div>
        <div class="map-card-footer">
          <span>🎯 關卡數: ${map.checkpointsCount} 關</span>
          <span>${map.id === currentMapId ? '✅ [已選擇]' : '👉 點擊選擇'}</span>
        </div>
      `;
      container.appendChild(card);
    }
  }
}
window.MapSelectUI = MapSelectUI;
