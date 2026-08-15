/**
 * 賽道與馬匹動畫渲染器 (使用 transform: translate3d 達到 60fps 流暢度)
 */
class RaceRenderer {
  constructor() {
    this.trackLen = 1000;
    this.containerWidth = 1200;
    this.finishLineX = 1050;
    this.itemsMap = new Map();
  }

  initTrack(trackLength, activeItems) {
    this.trackLen = trackLength || 1000;
    const container = document.getElementById('track-container');
    this.containerWidth = container ? container.clientWidth : 1200;
    this.finishLineX = this.containerWidth - 140;

    this.renderItems(activeItems);
  }

  renderItems(activeItems) {
    const layer = document.getElementById('items-layer');
    if (!layer) return;
    layer.innerHTML = '';
    this.itemsMap.clear();

    if (!activeItems || !window.GameConfig || !window.GameConfig.TEAMS) return;
    const teams = window.GameConfig.TEAMS;

    // 手繪風障礙物與道具圖片映射
    const itemImgMap = {
      accelerator: '/host/assets/item_speedboost.png',
      obstacle: '/host/assets/obstacle_rock.png',
      shield: '/host/assets/obstacle_fence.png',
      magnet: '/host/assets/obstacle_puddle.png',
      mystery: '/host/assets/item_mystery_box.png'
    };

    const container = document.getElementById('dynamic-lanes-container');
    if (!container) return;

    // Use DOM geometry instead of window innerWidth
    const containerRect = container.getBoundingClientRect();
    this.trackWidth = containerRect.width;

    const renderLaneItems = (items, laneTopPct) => {
      for (const item of items) {
        if (item.triggered) continue;
        const el = document.createElement('div');
        el.className = 'item-dom';
        el.id = `item-${item.id}`;
        
        const imgSrc = itemImgMap[item.type] || '/host/assets/item_mystery_box.png';
        el.innerHTML = `<img src="${imgSrc}" alt="${item.type}" />`;

        // 映射虛擬座標到實際 DOM 寬度
        const domX = (item.x / this.trackLen) * this.finishLineX;
        el.style.left = `${domX}px`;
        el.style.top = `${laneTopPct}%`;
        el.style.marginTop = '-50px'; // center vertically
        layer.appendChild(el);
        this.itemsMap.set(item.id, el);
      }
    };

    teams.forEach((t, i) => {
      // 每條 lane 的中心: 10%, 30%, 50%, 70%, 90%
      const topPos = i * 20 + 10;
      renderLaneItems(activeItems[t.id] || [], topPos);
    });
  }

  updatePositions(teamsData) {
    if (!teamsData || !window.GameConfig || !window.GameConfig.TEAMS) return;
    const teams = window.GameConfig.TEAMS;

    for (const t of teams) {
      const teamId = t.id;
      const data = teamsData[teamId];
      if (!data) continue;

      const horseEl = document.getElementById(`horse-${teamId}`);
      if (!horseEl) continue;

      // 計算在螢幕上的實際 X 坐標
      const domX = Math.min(this.finishLineX + 20, (data.position / this.trackLen) * this.finishLineX);
      horseEl.style.left = `${domX}px`;

      // 跑步動畫 class 控制
      if (data.isStunned) {
        horseEl.classList.remove('is-running');
        horseEl.classList.add('is-stunned');
      } else if (data.speed > 0.3) {
        horseEl.classList.add('is-running');
        horseEl.classList.remove('is-stunned');
      } else {
        horseEl.classList.remove('is-running');
        horseEl.classList.remove('is-stunned');
      }

      // 更新頂部進度條
      const pct = Math.min(100, Math.round((data.position / this.trackLen) * 100));
      const fillEl = document.getElementById(`${teamId}-progress-fill`);
      const textEl = document.getElementById(`${teamId}-progress-text`);
      const stunEl = document.getElementById(`${teamId}-stun-tag`);

      if (fillEl) fillEl.style.width = `${pct}%`;
      if (textEl) textEl.innerText = `${pct}%`;
      if (stunEl) stunEl.style.display = data.isStunned ? 'inline-block' : 'none';
    }
  }

  removeItemDom(itemId) {
    const el = this.itemsMap.get(itemId);
    if (el) {
      el.style.transform = 'scale(2)';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
      this.itemsMap.delete(itemId);
    }
  }
}
window.RaceRenderer = RaceRenderer;
