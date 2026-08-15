/**
 * 前後端共用的遊戲預設參數與設定
 */

const DEFAULT_CONFIG = {
  trackLength: 15000,
  teamsCount: 5,
  TEAMS: [
    {
      id: "red",
      name: "一哈牛仔隊",
      color: "red",
      hex: "#ef4444",
      slogan: "⚡ 西部狂野 奔馳無敵 ⚡",
      imgPath: "/host/assets/heipi_cowboy_nobg.png",
      runImgPath: "/host/assets/heipi_cowboy_run.png"
    },
    {
      id: "blue",
      name: "夢幻氣球隊",
      color: "blue",
      hex: "#3b82f6",
      slogan: "💨 一飛沖天 直達雲端 💨",
      imgPath: "/host/assets/heipi_balloon_nobg.png",
      runImgPath: "/host/assets/heipi_balloon_run.png"
    },
    {
      id: "yellow",
      name: "生日快樂隊",
      color: "yellow",
      hex: "#f59e0b",
      slogan: "🎂 慶祝派對 幸運滿分 🎂",
      imgPath: "/host/assets/heipi_birthday_nobg.png",
      runImgPath: "/host/assets/heipi_birthday_run.png"
    },
    {
      id: "pink",
      name: "小公主黑皮隊",
      color: "pink",
      hex: "#ec4899",
      slogan: "👑 閃亮登場 甜美致勝 👑",
      imgPath: "/host/assets/heipi_pink_nobg.png",
      runImgPath: "/host/assets/heipi_princess_run.png"
    },
    {
      id: "purple",
      name: "還珠格格黑皮隊",
      color: "purple",
      hex: "#8b5cf6",
      slogan: "🌸 皇阿瑪駕到 所向披靡 🌸",
      imgPath: "/host/assets/heipi_purple_nobg.png",
      runImgPath: "/host/assets/heipi_gege_run.png"
    }
  ],
  quizTimeLimit: 10,           // 答題秒數
  stunDuration: 3000,          // 停滯毫秒數 (3秒)
  baseBoost: 0.5,              // 基礎加速力
  friction: 0.95,              // 摩擦阻力
  maxSpeed: 20.0,              // 最高速度
  tapCooldown: 50,             // 點擊冷卻時間 ms (單人最多 20/s)
  positionUpdateRate: 33,      // 伺服器廣播頻率 ms (約 30fps)
  stateSyncRate: 5000,         // 全量狀態校正同步頻率 ms
  countdownSeconds: 3,         // 賽前倒數秒數
  totalRounds: 3,              // 固定三局制
  
  // 答題正確率獎懲門檻
  quizThresholds: {
    HIGH_CORRECT: 0.7,         // >= 70% 衝刺加速
    MED_CORRECT: 0.4,          // >= 40% 小幅加速
    LARGE_BOOST: 1500,         // 衝刺加速位移 (px)
    SMALL_BOOST: 500,          // 小幅加速位移 (px)
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DEFAULT_CONFIG;
} else {
  window.GameConfig = DEFAULT_CONFIG;
}
