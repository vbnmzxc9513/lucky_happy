# Lucky Horse 專案架構總覽

更新日期：2026-10-01
適用版本：目前工作樹的 Network Protocol v2、五隊、單局、四關 16 題版本

這份文件是新開發者理解系統的主要入口。它描述目前程式實際行為，而不是早期企劃。若文件與程式衝突，依下列優先順序判定：

1. `shared/game-config.js`、正式地圖 JSON 與伺服器實作。
2. 本文件。
3. `docs/FORMAL_GAME_RULES.md`、`docs/WEDDING_RUNBOOK.md` 等現行操作文件。
4. 檔名含日期的部署、壓測與驗收報告；它們只代表當時版本的證據，不是現行規格。

## 1. 系統目標

Lucky Horse 是婚禮現場使用的多人即時互動遊戲。賓客以手機掃描 QR Code 加入；投影顯示賽道與題目；主持人透過獨立控制台控制流程；設定後台管理題庫、地圖與彩排機器人。

設計優先順序是：

1. 現場流程可預測、可暫停、可重置。
2. 手機斷線、鎖屏、切換網路後可恢復。
3. 計分只能由伺服器決定，舊封包或重送不能重複計分。
4. 190 人目標負載下，投影保持流暢，手機只接收必要資料。
5. 部署與 LAN 備援流程可在活動前驗證。

## 2. 執行架構

```text
公開手機 /guest ───────┐
受保護投影 /host ──────┤
主持控制 /control ──────┼── Socket.IO v2 ── GameManager
設定後台 /admin ────────┘                      │
                                                ├── TeamManager
                                                ├── PhysicsEngine
                                                ├── QuizManager / QuizLoader
                                                ├── ItemManager
                                                ├── CheckpointTriggerEngine
                                                ├── RoundManager
                                                └── MapManager

HTTP/HTTPS ── Express ── 靜態頁面、登入、QR、健康檢查
資料檔案 ─────────────── maps / quizzes / items JSON
```

正式環境的網路路徑是：

```text
Phone / Browser → HTTPS :443 → Caddy → Node 127.0.0.1:3000
```

Node 不直接公開 3000 埠。Caddy 處理 TLS 與 WebSocket 反向代理，systemd 負責程序重啟與權限隔離。

## 3. 使用者介面與權限

| 路徑 | Socket 角色 | 是否需工作人員登入 | 責任 |
| --- | --- | --- | --- |
| `/guest/` | `guest` | 否 | 登入、選隊、連點、作答、斷線復原 |
| `/host/` | `host` | 是 | 16:9 投影與音效；不具賽事控制權 |
| `/control/` | `control` | 是 | 切換投影、開賽、暫停、恢復、重置、GM 與揭獎 |
| `/admin/` | `admin` | 是 | 設定、地圖、題庫、機器人與彩排工具 |
| `/manage` | HTTP | 是 | 工作人員入口選單 |
| `/healthz` | HTTP | 否 | 狀態、連線數、事件迴圈與記憶體健康資訊 |

工作人員先以 `STAFF_ACCESS_CODE` 登入。伺服器建立 HMAC 簽署、HttpOnly、SameSite=Lax 的 Cookie；`host`、`control`、`admin` Socket 連線也必須帶有效 Cookie。伺服器只允許 `control` 與 `admin` 執行賽事控制事件，投影端即使送出特權事件也會被拒絕。

## 4. 啟動與組件生命週期

`server/index.js` 啟動時依序：

1. 驗證正式環境變數。
2. 建立 Express、HTTP Server 與 Socket.IO。
3. 建立 `GameManager`。
4. 從 `data/maps/`、`data/quizzes/`、`data/items.json` 載入資料至記憶體。
5. 建立 `SocketRouter` 與 `RealtimeDelivery`。
6. 開始監聽 HTTP 與 WebSocket。
7. 收到 `SIGINT`／`SIGTERM` 時停止遊戲迴圈、關閉 Socket.IO，再釋放 HTTP 埠。

遊戲狀態只存在 Node 記憶體。Node 或 VPS 重啟後不恢復進行中的比賽，現場標準處置是回到 Lobby 重新報到與開賽。

## 5. 權威狀態模型

`GameManager` 是唯一的賽事權威。主要狀態如下：

```text
LOBBY / MAP_SELECT / ROUND_LOBBY
              │ startRound
              ▼
          COUNTDOWN
              ▼
      RACING ⇄ QUIZ
              ▼
       ROUND_FINISHED
              ▼
       MATCH_FINISHED
```

目前正式模式 `totalRounds = 1`。`presentation.stage` 是另一條獨立狀態，可為 `lobby`、`rules`、`team-select`、`race`、`scoreboard`、`awards`。切換投影畫面不會改變賽事狀態；`awards` 只有在 `MATCH_FINISHED` 後才能進入。

所有延遲流程都由 `GameManager` 的 managed timeout 與 `flowToken` 保護。暫停會凍結比賽迴圈、題目計時、暈眩截止時間與階段排程；恢復時統一平移時間軸。重置會遞增 `flowToken` 並清除計時器，使舊 callback 不能在新局套用結果。

## 6. 現行正式賽制

預設為五隊、每隊最多 50 人、單局決勝。正式地圖包含四關，每關四題，共 16 題。

```text
開賽倒數 3 秒
  └─ 四關：
       連點 8 秒
       連點倒數結束自動開始第 1 題
       第 1 題作答 10 秒 → 統計保留；第 2～4 題〔主持開始 → 作答 10 秒 → 統計保留〕
       主持顯示四題結算 → 保留至主持開始下一關／最後衝刺
  └─ 最後衝刺 10 秒
  └─ 完賽後 5 秒進入頒獎
```

自動計時部分合計 205 秒；每題之間及每關之間由主持控制，總時間取決於主持停留時間與暫停時間。完賽後 5 秒轉入頒獎。

### 6.1 連點計分

一次有效點擊增加隊伍速度：

```text
boost = baseBoost / sqrt(teamSize)
```

每位玩家每 20 次被接受的點擊會得到一次 2 倍爆擊；最後衝刺另套用預設 2 倍倍率。伺服器以 `tapCooldown` 限制單一玩家點擊頻率。

此公式會降低大隊伍優勢，但不會完全消除人數差；相同人均手速下，隊伍總推進能力仍大致隨 `sqrt(teamSize)` 增加。因此人數平衡應同時依賴選隊容量、開賽前自動分隊與現場引導。

### 6.2 答題計分

手機只顯示選項代號與按鈕，題目文字與完整選項顯示在投影。每隊以本題開始時隊伍總人數為分母，答對率嚴格 > 0.5 才算答對；剛好 50%、空隊伍或全隊無人回答均不算答對。個人未作答不增加 wrongCount。

每關四題結束後一次發獎：

| 答對題數 | 前進格數 | 預設距離 |
| ---: | ---: | ---: |
| 0 | 0 | 0 |
| 1 | 1 | 1500 |
| 2 | 2 | 3000 |
| 3 | 4 | 6000 |
| 4 | 6 | 9000 |

獎勵不在單題揭曉時發放，避免重連、重整或重複同步造成重複計分。

### 6.3 折返賽道

正式畫面使用折返跑道。`ShuttleRace.measure` 將累積距離換算成圈數、方向與畫面位置；畫面左右位置不是排名，排名以伺服器累積距離為準。折返端點不會結束四關模式，比賽在 16 題與四次結算完成後的最後衝刺結束。

## 7. 玩家生命週期與斷線復原

手機在 `localStorage` 保存暱稱、頭像、隊伍與穩定 `sessionId`。

1. Socket 連線後先請求狀態快照。
2. 已登入玩家以相同 `sessionId` 重新送出 Join。
3. `TeamManager` 將舊 socket 身分、隊伍成員資格移至新 socket。
4. `GameManager` 同步遷移個人統計與本題答案鎖。
5. 伺服器重送目前狀態、個人狀態與進行中的題目／剩餘時間。

在 `COUNTDOWN`、`RACING`、`QUIZ`、`ROUND_FINISHED`、`MATCH_FINISHED` 斷線時，具有穩定 session 的玩家會保留，以便重連。Lobby 中離線者會被移除並釋放暱稱與名額。

陌生 session 在比賽開始後不能加入；既有 session 可以取回原玩家。隊伍額滿時，換隊失敗不會讓玩家離開原隊。

## 8. Network Protocol v2

所有客戶端必須以 `protocolVersion: 2` 連線。舊版客戶端會收到 `PROTOCOL_MISMATCH` 並被要求重新整理，避免新舊協定混用。

### 8.1 操作封包

點擊與作答必須附帶：

```text
requestId   單次操作識別碼
runId       本局識別碼；重置後更換
stateVersion 權威狀態版本
```

`RealtimeDelivery.operation()` 以穩定 session 作為冪等帳本身分：

- 同一 `requestId`、相同內容重送：回傳第一次結果，不再次計分。
- 同一 `requestId`、不同內容：拒絕 `REQUEST_ID_CONFLICT`。
- 舊 `runId`：拒絕 `STALE_RUN`。
- 點擊的舊 `stateVersion`：拒絕 `STALE_STATE`；答案改以同局、同題與截止時間驗證，避免展示更新淘汰合法答案。
- 已超過連點／答題截止時間：拒絕，不跨階段補算。

手機不重送未確認的點擊；未確認答案最多以同一 request ID 重試兩次，且必須仍在本題截止時間內。

### 8.2 傳輸分流

| 接收者 | 位置更新頻率 | 內容 |
| --- | ---: | --- |
| Host | 約 30 Hz | 全部隊伍 |
| Guest | 最多 5 Hz | 自己隊伍的位置、暈眩與名次 |
| Control / Admin | 最多 2 Hz | 全部隊伍的操作摘要 |

位置與 heartbeat 使用 volatile 訊息；狀態快照、題目、結果、頒獎與操作 ACK 使用可靠訊息。隊伍名單與答題進度以 250 ms 合併，降低同時加入／作答造成的廣播尖峰。

Guest 狀態快照不包含完整玩家名單、道具、管理設定、題庫或完整頒獎資料。手機若三秒未收到新鮮權威時間，立即停用輸入並要求重新同步。

## 9. 資料與設定

| 資料 | 位置 | 說明 |
| --- | --- | --- |
| 預設遊戲設定與隊伍 | `shared/game-config.js` | 前後端共用；修改後整套部署 |
| Socket 事件名稱 | `shared/events.js` | 新事件必須先在此登記 |
| 正式地圖與題序 | `data/maps/wedding-final-showdown.json` | 16 個不重複 checkpoint |
| 題庫 | `data/quizzes/*.json` | `QuizLoader` 啟動時合併載入 |
| 道具 | `data/items.json` | 伺服器套用效果 |
| 時長估算 | `shared/stage-plan.js` | Admin 與伺服器共用 |

Admin 儲存地圖時會直接寫入 `data/maps/<id>.json`；自訂題目寫入 `data/quizzes/custom-quizzes.json`。正式 release freeze 後不要在線上 Admin 修改資料，否則伺服器工作樹會變髒並阻擋安全的 fast-forward 更新。題庫與地圖應先在 Git 中修改、測試、審查再部署。

`GameManager` 啟動時深拷貝預設設定，Admin 的 runtime 設定只存在記憶體；程序重啟後回到程式與資料檔的預設值。

## 10. 測試與驗收層級

```powershell
npm test                  # 快速信心測試、30 人復原、操作競態、preflight
npm run test:confidence   # 另含 120/150 人完整賽程與 15 人重連
npm run test:operations   # 主持、暫停、重置與競態回歸
npm run preflight         # 對指定站點做 13 項上線前檢查
npm run deploy:check      # 部署檔與正式環境防護
npm run security:check    # npm dependency audit
```

本機通過不等於婚禮場地通過。正式 Go／No-Go 還需要：

- 預定場地或實際行動網路的公開 HTTPS 測試。
- 真實 iPhone、Android、較舊手機的登入、鎖屏與切網路復原。
- 實際投影解析度、瀏覽器、HDMI 與音響。
- 與正式站相同 commit、題庫及設定的 LAN 備援演練。
- 每位玩家的 tap／answer receipt accounting 無不一致。

檔名含日期的負載報告是特定版本、特定網路路徑的歷史證據。不得用本機或單一模擬器結果宣稱場地網路已驗收。

## 11. 部署與故障邊界

正式環境必須設定：

```text
NODE_ENV=production
BIND_HOST=127.0.0.1
PUBLIC_BASE_URL=https://正式網域
STAFF_ACCESS_CODE=活動驗證碼
STAFF_SESSION_SECRET=至少 32 字元的隨機值
```

`PUBLIC_BASE_URL` 決定 QR Code。開發環境未設定時，伺服器會嘗試使用實體 LAN IP；不得把 `localhost` QR 提供給手機。

故障處置原則：

- 少量手機斷線：等待自動重連，必要時由主持暫停。
- Host／Control 重新整理：重新登入並依狀態快照恢復。
- Node／VPS 重啟：進行中狀態無法恢復，回 Lobby 重賽。
- WAN 或正式站不可用：切換預演完成的 LAN 備援，所有裝置掃新 QR 重新報到。

## 12. 主要程式閱讀順序

新開發者建議依序閱讀：

1. `shared/game-config.js`
2. `data/maps/wedding-final-showdown.json`
3. `shared/events.js`
4. `server/game/GameManager.js` 的 constructor、`startRound()`、`update()`、`triggerQuiz()`、`finishRound()`
5. `server/websocket/SocketRouter.js`
6. `server/websocket/RealtimeDelivery.js`
7. `server/websocket/GuestHandler.js` 與 `server/game/TeamManager.js`
8. `guest/js/guest-network.js` 與 `guest/js/guest-app.js`
9. `host/js/host-app.js`
10. `control/js/control-app.js` 與 `admin/js/admin-app.js`

## 13. 已知技術債與修改注意事項

- `GameManager` 同時管理狀態、計時、流程、統計、機器人與頒獎；任何修改都要補狀態轉換、暫停、重置與重連測試。
- 前端是無 bundler 的 Vanilla JS，全域載入順序即相依順序；更新共享介面後必須同步調整 HTML asset version。
- `shared/events.js` 是事件名稱契約，但部分舊 Admin 私有事件仍使用字串；新增功能不應繼續擴大此例外。
- `GuestHandler` 對格式不合法的 tap／answer payload 目前直接丟棄而不送 ACK；正常 v2 client 不會產生此格式，但若要完整落實零靜默失敗，仍應補明確拒絕回覆與測試。
- 隊伍人數平衡公式只降低人數優勢，不能取代現場分隊管理。
- 伺服器狀態沒有持久化；不要在活動進行中部署或重啟。
- Protocol v2 必須前後端整套共同部署，不能只更新其中一端。

## 14. 文件維護規則

- 改變隊伍數、題數、階段秒數、網路協定或權限時，必須同一個變更中更新本文件、README、相關測試與操作手冊。
- 新的測試結果寫入帶日期的報告，不要把歷史測量改寫成現行保證。
- 不再複製完整事件表或設定值到多份文件；詳細值以程式碼為準，文件只描述責任、流程與不變量。
- 舊企劃若已被實作取代，刪除或明確標示為歷史，不得和現行規格並列而不說明。

## 自動首題、手動進題與統計契約（16 題、4 關）

`CONTROL_ADVANCE_QUIZ_FLOW`（`control:advance_quiz_flow`）需帶 `requestId`、`runId`、`stageNumber`、`flowRevision`。
伺服器重新驗證工作人員 session 與 control/admin 角色、暫停狀態及流程版本。每次轉換消耗目前版本；雙控制台競態只成功一次。
`CONTROL_ACTION_RESULT` 回傳 `action: ADVANCE_QUIZ_FLOW`、`requestId`、`success`、失敗 `reason`；合法工作人員另收最新 `state`。
Host、Guest 或未驗證來源收到 FORBIDDEN，不附管理狀態。舊局 STALE_RUN、舊流程 STALE_FLOW、已消耗 requestId STALE_REQUEST（每局帳本，重置清除）、非法階段 INVALID_PHASE、暫停 GAME_PAUSED。

`tap → answer（本關第 1 題自動） → reveal → answer → reveal → answer → reveal → answer → reveal → summary → tap / sprint`。
揭曉及結算的 endsAt 為 null，不排自動推進 timeout；第四題統計必須先保留，再由主持切到結算。
自動計時只涵蓋倒數、連點、題目作答與最後衝刺；每題之間及每關之間由主持控制，總時間取決於主持停留時間。

每題 `GAME_QUIZ_RESULT` 的完整結果含 options、distribution 及 teamResults。
全場分布的 totalPlayers = answeredCount + unansweredCount；options 每項保留 count 和 answeredPercent（0–1 比例）。
answeredPercent 分母為全場已作答人數；無人回答時為 0。Host 顯示為百分比到小數一位。
每隊 correctRate 的分母是本題開始時的 totalCount，包含未作答；嚴格 > 0.5 才 isCorrect，50% 為 false，空隊為 0／false。

Host／Control／Admin 收完整全場分布與五隊統計；Guest 僅收正解及自己的 teamResult（totalCount、correctCount、correctRate、isCorrect）。
Guest 重連快照不含其他隊結果、options 分布或 results 歷史；只附自己的答案鎖與 answer，以及本隊關卡結算。
等待、作答剩餘時間、統計、結算與衝刺皆由伺服器快照／題目恢復事件重建，不依賴 DOM。

驗收需涵蓋所有等待 phase 重連、雙控制台競態、暫停／重置、0%、49%、50%、50.1%、51%、100%、空隊、全場分布守恆與 Guest 隔離。
本版完整負載、公開 HTTPS、真實手機與場地投影須重新驗證；有日期的歷史壓測報告保持原始數據。

純投影切換不增加 stateVersion。正式地圖 wedding-final-showdown 在儲存與開賽時必須剛好 16 題；其他題數需另建自訂地圖。推進缺少或畸形 requestId 回 INVALID_REQUEST_ID，不改變狀態。

正式地圖與最後一張地圖禁止刪除，Admin 會收到明確失敗原因。沒有可用地圖時，狀態快照回傳 `currentMap: null` 與 `mapError: NO_MAP_AVAILABLE`，開賽失敗且不啟動倒數。

`shared/client-id.js` 提供 Guest session／操作與 Control 推進的識別碼；支援缺少 randomUUID 的 LAN HTTP 環境，識別碼不作為工作人員驗證憑證。Control 只有收到 UNAUTHORIZED_STAFF_SOCKET 才提示重新驗證；一般斷線自動重連，主要按鈕等待新狀態快照後才重新啟用。

所有 Control 發送事件在等待最新快照時均被攔截，僅允許 GUEST_SYNC 取得新狀態；離線與版本不相容時也不送出操作。部署前使用 `npm run test:predeploy`，包含標準測試、`test:control-browser` 與部署靜態檢查；Playwright 安裝與可攜 Chromium 設定見 README。


## 最近 10 場成績快照

工作人員從 `/manage` →「本輪成績」進入 `/results/`，頁面與唯讀 `GET /api/match-results` 都重用 staff session 驗證，API 設定 `Cache-Control: no-store`。頁面先列勝隊完整成員，再列五隊排名與所有玩家卡片；可切換場次、隊伍篩選、只顯示勝隊、排序與下載單場 JSON／CSV。

正式遊戲第一次進入 `MATCH_FINISHED` 時，以 runId 冪等建立不可變快照；`ROUND_FINISHED` 不寫入。GameManager 注入 MatchResultStore，組裝由獨立 buildMatchResult 負責。以 TeamManager.players 權威名單合併遷移後的 playerStats，包含零操作與斷線玩家，不以獎項排行榜充當名單。零操作統計為 0；未作答數為當場題數減作答數，最低 0。四獎只保存允許的成績欄位，不保存 socket/session/request 識別或 receipts。

schemaVersion 為 1，頂層包含 updatedAt、matches；每場包含 id、finishedAt、map、questionCount、stageCount、winner、teams、players、awards。依 finishedAt 新到舊排序，只保存最近 10 場。Reset 清除當輪狀態、玩家與計時器，不刪歷史；程序重啟讀回 JSON。

預設位置為專案 `data/runtime/match-results.json`（正式站 `/opt/lucky-horse/data/runtime/match-results.json`）。可用 `MATCH_RESULTS_FILE` 覆寫；建議使用絕對路徑並維持在 `/opt/lucky-horse/data`，沿用 systemd 可寫範圍。若另換目錄，維運必須同步調整 systemd ReadWritePaths、目錄擁有者、bootstrap 與部署檢查。目錄、JSON、暫存檔及 corrupt 備份含個資，不要把活動成績 commit 進 Git；runtime 目錄只有 .gitkeep 可追蹤。

寫入在相同目錄建立獨佔暫存檔，寫完並 fsync 後 rename 取代。損毀 JSON 先改名為 `.corrupt-時間戳-UUID.json` 備份；備份失敗時禁止覆寫原檔。錯誤記錄於伺服器，staff API 僅回傳安全狀態與錯誤碼，不回傳內部路徑。寫入失敗不阻止頒獎，當次程序仍可查記憶體快照，但尚未成功保存的紀錄可能在重啟後遺失；請立即下載此場並請維運處理。

部署必須保留 runtime JSON，勿使用會刪除忽略檔的清理命令。手動以 candidate 目錄切換部署時，先停止舊程序並複製或掛載原有 runtime 成績檔（含必要備份）、確認擁有者與可寫權限，再啟動新程序，避免遺失歷史。備份時停止服務，把 runtime 目錄複製到權限受限、位於部署目錄外的位置，確認可讀後恢復服務。若確需清除：先經活動負責人確認與完成上述備份，停止服務，再手動移走成績 JSON，啟動後為空紀錄；沒有前端清除按鈕。

驗證：`node tests/test-match-result-store.js` 使用 OS 暫存目錄驗證冪等、裁切排序、reset/restart、完整名單、重連、平手、資料隔離與故障保護。`npm run test:results-browser` 啟動本機隔離伺服器並使用暫存結果檔，驗證 staff HTTP 保護、完整勝隊名單、XSS、空狀態、平手、10 場切換、reset/reload、損毀警告及 390×844／320×568。已加入 `npm run test:predeploy`，不得跳過；Playwright 安裝方式見 README。測試不可寫入正式 runtime JSON。

### 自動首題與 bot 排程防護

`beginTapStage` 使用現有 `stage-tap` managed timeout，捕捉 runId、flowToken、stage 物件，消耗 tap 後直接 `startStageQuestion`。正式模式 prepare 為 0 秒；不是另一條自動流程。timeout 必須仍是 Map 中同一 entry 與同一代排程；Pause 清 timer、Resume 以剩餘時間重新武裝。`quiz-prepare` 另驗證 pending 物件，舊回呼不能啟動後一題。Control 僅 reveal／summary 可以推進，維持 requestId／runId／flowRevision 冪等防護。

QuizManager 的 `getProgressSnapshot()` 產生全場及五隊答題進度；開始事件、staff recovery、staff state 的 quizProgress 與合併後進度事件共用它。Guest 快照移除 quizProgress。揭曉仍使用 `GAME_QUIZ_RESULT` 或 `quizStage.reveal`，Host 只格式化權威數值，不判斷 isCorrect、獎勵或距離。進度更新只改現有文字與 bar，揭曉以 quizId 去重；倒數以 endsAt／serverNow 同步。

bot 原先以 socketId 記一次答案、只有 RACING 才清除；同關第 2～4 題永遠停在 QUIZ，造成鎖死。現在 bot 共用 QuizManager 的 socketId＋quizId 答案鎖，每題開窗排入 managed timeout，隨機分散在窗口內。回呼核對 runId、flowToken、quiz 物件、bot 身分與 answer phase，再走 handleQuizAnswer。Pause 凍結，reveal／stop／Reset 取消排程；tap interval 在每一關繼續。正式成績快照契約不變。

### Guest 進場與更名責任

`QuizUI.beginQuestion` 以 runId／關／題辨識 500ms 進場，重複快照不重啟；離題取消排程，啟用選項仍須通過 `GuestNetwork.canAnswer()`。手機倒數讀取權威 endsAt/serverNow。更名重用 guest:join 的 rename 意圖，GuestHandler 限制開賽前且未鎖加入，沿用 TeamManager 暱稱驗證與唯一性檢查；由目前 socket 的既有身分更新名稱、同步統計及 roster，成功 ACK 後手機才保存名稱。
