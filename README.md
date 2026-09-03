# 🏇 Lucky Horse — 婚禮互動賽馬遊戲 v1.1

> **為婚禮現場打造的 150 人即時互動派對遊戲！**
> 賓客無需下載安裝，手機掃描 QR Code 即可參與五隊點擊加速與終極關卡答題對抗賽！

---

## 🌟 核心特色 (v1.1)

1. **📱 零安裝秒開**：純 HTML5 + Vanilla JS，行動裝置載入時間 < 0.5 秒。
2. **🏆 一戰決勝**：預設單局完賽，正式賽道固定觸發 10 道題目，實測 150 人約 7~8 分鐘。
3. **🗺️ 正式婚禮賽道**：預設使用「幸福一戰決勝」，後台可調整賽道長度、出題頻率、題目與時限。
4. **📺 答題分屏互動**：關卡觸發時，**題目與倒數僅顯示在大螢幕**，賓客手機上**僅顯示 A/B/C/D 選項按鈕**，創造全場專注共讀題目的沉浸氛圍！
5. **🔒 權威鎖定機制**：
   - **比賽中鎖定加入**：遊戲開始後拒絕新連線干擾，保證公平。
   - **答案送出即鎖定**：手機端點擊選項後立刻反灰鎖定，防止修改。
6. **⚙️ 伺服器條件觸發**：關卡由伺服器根據時間、進度或雙方差距自動觸發，非玩家主動觸發。
7. **⚖️ 隊伍平衡公式**：自動依據隊伍人數調整單人點擊貢獻度 `boost / sqrt(team_size)`，解決隊伍人數不均問題。
8. **🔄 斷線自動復原**：手機網路切換或重新整理後，可還原隊伍、當前題目、點擊與個人獎統計，並防止重複作答。
9. **🏁 終極衝刺守門**：第 9 分鐘解除暈眩並將點擊推進加倍；接近第 10 分鐘時自動補齊十題，再由當下領先隊伍完成賽事。
10. **👥 每隊 50 人上限**：伺服器強制容量，滿隊不可再選；換隊失敗仍保留原隊，原隊成員可正常斷線重連。

---

## 🚀 快速啟動指南

### 1. 安裝套件
```bash
npm install
```

### 2. 啟動伺服器
```bash
# 開發/婚禮現場模式 (預設 Port 3000)
npm start
```

### 3. 開啟遊戲視窗
- 🎛️ **主持人控制台**：
  開啟 `http://localhost:3000/control`，輸入工作人員驗證碼 `1009`
- 🖥️ **大螢幕投影端**：
  開啟瀏覽器訪問 `http://localhost:3000/host` 或 `http://<您的電腦IP>:3000/host`
- 📱 **手機賓客端 (控制器)**：
  賓客使用手機相機掃描大螢幕上的 QR Code，或訪問 `http://<您的電腦IP>:3000/guest`

題庫與賽道設定入口為 `http://localhost:3000/admin`；主持人頁、投影頁與設定頁共用同一個驗證碼登入狀態。正式部署時可用 `STAFF_ACCESS_CODE` 環境變數更換驗證碼。

QR Code 由伺服器直接產生，不需要外部 CDN。以 `localhost` 開啟投影時會自動改用主機的區網 IP；DigitalOcean 正式站應明確設定公開網址，確保反向代理與網域切換後仍編入正確網址：

```powershell
$env:PUBLIC_BASE_URL="https://game.example.com"
npm start
```

正式環境的 `PUBLIC_BASE_URL` 必須是手機可連線的 HTTPS 網域，不要填入 `localhost`。

---

## 🛠️ 自訂題庫與地圖

- **修改題庫**：請編輯 `data/quizzes/` 目錄下的 JSON 檔案（如 `wedding-couples.json`），可自行填入新郎新娘的專屬問答。
- **修改地圖**：請編輯 `data/maps/` 目錄下的 JSON 檔案，可自訂關卡觸發條件與道具密度。

## ✅ 上線前測試

```bash
# 快速信心測試：單元、資料、畫面狀態、30 人斷線復原
npm test

# 完整正式測試：再跑 150 人、10 題全賽程與 15 人同時重連
npm run test:confidence

# 主持、暫停、重複開賽、重置與操作競態回歸
npm run test:operations
```

147 個模擬玩家配合 3 支真實手機彩排時，使用 `npm run stress -- --clients 147 --manualHost --expectedTotalPlayers 150`。完整執行表請見 `docs/WEDDING_OPERATION_TEST_PLAN.md`。

伺服器監控端點為 `/healthz`，會回報遊戲狀態、Socket 連線數、事件迴圈延遲與記憶體。

## 🌐 正式部署準備

DigitalOcean 正式環境已備妥 Caddy HTTPS、systemd 自動重啟、UFW 防火牆、環境檢查與公開站驗收腳本。部署前先執行：

```bash
npm run deploy:check
npm run security:check
npm test
```

完整步驟請見 [`deploy/README.md`](deploy/README.md)。正式站只公開 `80/443`，Node.js 的 `3000` 埠不得直接對外開放。

---

## 📁 專案結構

```
lucky-horse/
├── server/                     # Node.js + Socket.IO 後端權威狀態機
├── control/                    # 主持人即時控制台
├── host/                       # 16:9 大螢幕投影端 (Vanilla JS + CSS)
├── guest/                      # 手機賓客端控制器 (行動優先設計)
├── shared/                     # 前後端共用事件名稱與驗證器
└── data/                       # 地圖、題庫與道具 JSON 定義檔
```
