# Lucky Horse 婚禮即時互動賽馬

Lucky Horse 是為婚禮現場設計的多人即時互動遊戲。賓客不需安裝 App，以手機掃描 QR Code 即可加入五隊連點與答題賽事；投影、主持控制與設定後台各自獨立。

目前正式版本採 Network Protocol v2、五隊、單局、五關三題制。完整架構、資料流、權限與維護邊界請先閱讀 [`docs/PROJECT_ARCHITECTURE.md`](docs/PROJECT_ARCHITECTURE.md)。

## 現行玩法

- 五隊，每隊最多 50 人；未選隊者在開賽時自動平衡分配。
- 單局決勝，五關、每關三題，共 15 題。
- 每關先連點 8 秒；主持人逐題開始，每題作答 10 秒後保留統計；第三題後手動顯示本關結算。
- 每題隊伍答對人數須嚴格超過題目開始時隊伍總人數的 50%；未作答者仍計入分母，剛好 50% 不算答對。
- 每關答對 0／1／2／3 題，分別前進 0／1／2／4 格。
- 五關完成後最後衝刺 10 秒，以伺服器累積距離決定勝負。
- 手機只顯示選項控制器；題目文字與完整選項只顯示在投影。
- 點擊、答案與個人獎統計可隨穩定 session 斷線復原。

自動計時只涵蓋倒數、連點、題目作答與最後衝刺，共 203 秒；每題之間及每關之間由主持控制，總時間取決於主持停留時間。完賽後另有 5 秒頒獎轉場。

## 快速啟動

需求：Node.js 20 以上。

```powershell
npm install
npm start
```

啟動後使用：

| 用途 | 網址 | 權限 |
| --- | --- | --- |
| 賓客手機 | `http://localhost:3000/guest/` | 公開 |
| 工作人員選單 | `http://localhost:3000/manage` | 驗證碼 |
| 投影 | `http://localhost:3000/host/` | 驗證碼 |
| 主持控制台 | `http://localhost:3000/control/` | 驗證碼 |
| 設定與彩排 | `http://localhost:3000/admin/` | 驗證碼 |
| 健康檢查 | `http://localhost:3000/healthz` | 公開、唯讀 |

開發預設工作人員驗證碼為 `1009`。正式環境必須以 `STAFF_ACCESS_CODE` 與至少 32 字元的 `STAFF_SESSION_SECRET` 覆寫。

## 手機 QR 網址

QR Code 由伺服器直接產生，不依賴外部 CDN。開發時若從 localhost 開啟投影，伺服器會嘗試使用實體 LAN IP；正式環境必須設定公開 HTTPS 網域：

```powershell
$env:PUBLIC_BASE_URL="https://game.example.com"
npm start
```

正式環境不可使用 `localhost`、私有 `.local` 網域或直接公開 Node 的 3000 埠。

## 設定與內容

- 隊伍、物理、階段秒數：`shared/game-config.js`
- 正式地圖與 15 題順序：`data/maps/wedding-final-showdown.json`
- 題庫：`data/quizzes/*.json`
- 道具：`data/items.json`
- Socket 事件契約：`shared/events.js`

Admin 會直接寫入地圖與自訂題庫檔案。正式 release freeze 後請在 Git 中修改、測試再部署，不要在線上後台改資料。

## 測試

```powershell
# 快速信心測試：單元、UI、Network v2、30 人復原、操作競態、preflight
npm test

# 完整信心測試：另含 120／150 人全賽程與 15 人重連
npm run test:confidence

# Control 瀏覽器回歸（需先安裝下述 Playwright）
npm run test:control-browser

# 主持操作、暫停、重置與競態
npm run test:operations

# 指定站點婚禮前預檢
$env:SERVER_URL="https://game.example.com"
$env:STAFF_ACCESS_CODE="活動驗證碼"
npm run preflight
```

150 或 190 個 Socket 模擬器通過，不等於場地網路或真實手機通過。正式 Go／No-Go 必須另做場地網路、iPhone／Android、投影、音響與 LAN 備援彩排。詳細案例見 [`docs/WEDDING_OPERATION_TEST_PLAN.md`](docs/WEDDING_OPERATION_TEST_PLAN.md)。

瀏覽器測試在部署前由 `npm run test:predeploy` 強制執行（依序執行 `npm test`、Control 瀏覽器測試、部署靜態檢查），缺少依賴或瀏覽器會失敗，不會靜默略過。一般 `npm test` 保持不依賴瀏覽器。請在測試工作站或隔離 CI 環境安裝：

```powershell
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
npm run test:predeploy
```

Linux CI 可將瀏覽器安裝指令改成 `npx playwright install --with-deps chromium`。測試預設使用 Playwright Chromium，不依賴系統 Chrome；已有共用安裝時可指定 `PLAYWRIGHT_MODULE`，若要使用已安裝的 Chrome，另設 `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome`。這些工具只需在測試環境安裝，不需安裝到正式站。

## 正式部署

正式架構為 Caddy HTTPS 反向代理至 `127.0.0.1:3000`，由 systemd 管理 Node。部署前執行：

```powershell
npm run test:predeploy
npm run security:check
```

完整步驟見 [`deploy/README.md`](deploy/README.md)。進行中的遊戲只存在記憶體；活動中不得部署或重啟，程序重啟後必須回 Lobby 重賽。

## 專案結構

```text
lucky-horse/
├── server/       Express、Socket.IO、權威狀態機
├── shared/       前後端共用事件、設定與顯示計算
├── guest/        手機賓客端
├── host/         16:9 投影端
├── control/      主持控制台
├── admin/        設定與彩排後台
├── data/         地圖、題庫、道具 JSON
├── tests/        核心單元與協定測試
├── scripts/      UI、操作、壓力、部署與預檢腳本
├── deploy/       Caddy、systemd、Ubuntu 部署資源
└── docs/         架構、操作與歷史驗收文件
```

## 文件入口

- 開發者架構總覽：[`docs/PROJECT_ARCHITECTURE.md`](docs/PROJECT_ARCHITECTURE.md)
- 產品與體驗原則：[`GAME_DESIGN.md`](GAME_DESIGN.md)
- 現行五關賽制：[`docs/FORMAL_GAME_RULES.md`](docs/FORMAL_GAME_RULES.md)
- 現場操作：[`docs/WEDDING_RUNBOOK.md`](docs/WEDDING_RUNBOOK.md)
- 完整驗收：[`docs/WEDDING_OPERATION_TEST_PLAN.md`](docs/WEDDING_OPERATION_TEST_PLAN.md)
- 正式部署：[`deploy/README.md`](deploy/README.md)
