# 2026-10-03 婚禮互動修正交接

範圍：本機 main 工作目錄的實作與驗證，未 commit、push 或部署。開始時工作目錄乾淨。使用者補充「醜的是 Host 答題頁」後，視覺重設集中於 Host；Guest 保留原有卡片、字體、按鈕與配色，只修正權威狀態、隱私、必要提示對比及橫向排版。

## 五項根因與修正

| 問題 | 根因 | 修正 |
| --- | --- | --- |
| 提早知道對錯 | QuizManager 立即計算答案，ACK 與重送帳本把 isCorrect 傳到 Guest；UI 依此套用對錯樣式。 | 伺服器保留內部真值，但在 reveal 前過濾新 ACK、快取 ACK、收據及恢復資料；手機只顯示「已作答」，保留選擇。個人統計維持 staff 權限，公開選項僅代號；歷史 docs 也改為 staff 驗證，題庫不公開。 |
| 閱讀時間不成立 | 正式流程 prepareSeconds=0，手機原本只有本地 500ms 進場鎖；不是額外的伺服器閱讀階段。 | 每題建立 readingStartedAt、opensAt、deadlineAt，額外閱讀 3 秒再開完整 10 秒。實際開放時重新設定完整截止時間，避免 event loop 延遲壓縮作答；直接 Socket、舊版本封包、前一階段手勢均被拒絕。暫停平移時間，重置失效舊 callback，bot 也等 answer。 |
| 看不到障礙卻暈眩 | items 父圖層在馬下、每隊折返 leg 過濾不一致，position+40 提前碰撞；獎勵跳躍後補碰撞舊道具。 | items 父圖層提高、素材載入與接觸點驗證、馬與道具共用相機。正常物理以 previousPosition 到 currentPosition 的跨越區間碰撞；獎勵／GM 加距離時標記略過途中道具。保留障礙、神秘箱、GM 的來源供 staff 查核。 |
| 獎勵不像主賽道前進 | 結算另建小角色，主賽道讀取已增加的終點；原折返映射甚至把不同累積距離投到同一位置或反向。 | 先簡潔顯示成果 0.8 秒，撤除遮罩後用既有 .horse-unit 從 beforePosition 播到權威 position；數字、排名使用同一時間。結算固定共同線性相機，0m 不動，100/200/400/600m 有比例差異，readyAt 前仍鎖主持操作。 |
| Host 答題頁層級與風格 | 舊布局中的框線、標籤和裝飾分散注意力，閱讀與揭曉的視覺不一致。 | Host 以大題目、四張大圓角選項卡、閱讀／作答倒數及精簡比例統計呈現；沿用 Guest 既有 A 玫粉、B 薰衣草、C 鼠尾草、D 香檳色系。長內容使用字級分級，保留未作答分母及嚴格 >50% 判定。Guest 沒有整體換皮。 |

## 主賽道相機與距離

所有隊伍與道具使用同一原始累積距離座標。`ShuttleRace.camera` 的 values 包含五隊當前距離；結算還包含所有 beforePosition 與 final position：

```
low = max(0, min(values) - 750)
high = max(low + 12000, max(values) + 7000)
screenFraction = (position - low) / (high - low)
```

沒有每隊折返、獨立縮放、固定名次位置或舊 trackLength 截斷。相同距離位置一致，較大的距離一定更向右。普通跑步維持既有共同視窗，7000 raw units 前方空間涵蓋下一段正常連點／最後衝刺；非正常的大幅 GM 增距超出視窗時才共同擴展。結算視窗在成果遮罩下建立並於整段推進固定，確保獎勵方向不倒退。巨大距離差時小獎勵受共同縮放壓縮，是維持五隊同屏比較的取捨。

權威位置、排名、歷史 JSON 原值和 DistanceDisplay 的 1500 raw units = 100m 均保留。原 `measure` 僅保留相容用途，正式 Host 主賽道改用 `camera/project`。前端動畫完全不逐幀修改伺服器距離；伺服器 summary 階段不跑普通物理、連點或碰撞。

## 修改檔案

- 權威流程與道具：`server/game/{GameManager,ItemManager,TeamManager}.js`、`server/quiz/QuizManager.js`、`server/websocket/RealtimeDelivery.js`、`server/index.js`。
- 共享契約與呈現：`shared/{events,game-config,shuttle-race,stage-plan,stage-display}.js`、`shared/stage-display.css`。
- Host：`host/index.html`、`host/js/{host-app,quiz-display,race-renderer}.js`、`host/css/{quiz-statistics,shuttle-race}.css`。
- Guest 功能修正與必要排版：`guest/index.html`、`guest/js/{guest-app,guest-network,quiz-ui}.js`、`guest/css/guest.css`。原手機視覺保留。
- Control：`control/index.html`、`control/js/control-app.js`，閱讀狀態與原結算 gate 一起展示。
- 自動測試：新增 `tests/test-interaction-authority.js`；更新 bot、guest input、item、player accounting、quiz stages，以及 confidence、Host／Guest／Control browser、UI／statistics／stage／renderer、realtime resilience、wedding operations、planner、preflight 與 stress 腳本。完整清單可由 `git status --short` 檢查。
- 文件：README、GAME_DESIGN、PROJECT_ARCHITECTURE、FORMAL_GAME_RULES、QA_TEST_PLAN、WEDDING_OPERATION_TEST_PLAN、WEDDING_RUNBOOK、RACE_PACING、PLAYER_ACCOUNTING_TESTS、STRESS_TEST 更新閱讀流程；METERS_SUMMARY_REVIEW 標為歷史版本並連結本文。自動計時總長改為 253 秒，不含主持停留。

## 驗證與視覺證據

所有路徑相對專案根目錄；`reports/` 是 ignored 本機產物，reviewer 如需跨機器檢視，須另外帶走。

- `npm test`：包含新權威回歸、16 題 bot、計分、穩定 session、權限、事件去重、UI 与流程測試；完整結果在 `reports/fix-predeploy.log`。
- `npm run test:predeploy`：最終整輪通過，exit code 0，記錄在 `reports/fix-predeploy.log`。包含 npm test（Confidence suite passed）、results browser、Control browser、Host browser、Guest 實際 Socket.IO browser、部署前設定檢查；不執行部署。新版長文字門檻與 Guest 原有外觀均納入這一輪。
- `node --test tests/test-interaction-authority.js tests/test-bot-rehearsal.js`：10 個案例通過，`reports/fix-authority.log`。涵蓋 reading 2999/3000ms、延遲開放仍完整 10 秒、ACK/收據 session 重送過濾、reading 舊封包、暫停／重置、可見路障跨越、獎勵略過、暈眩來源、共同座標與 16 題 400 份單次答案。
- `node scripts/test-stage-browser.js --fixturesOnly`：通過，`reports/fix-stage-browser.log`。Host 1280×720、1920×1080、1366×768，Guest 320×568、390×844、844×390，觸控區與溢出檢查；包含五個獎勵級距、reduced motion、暫停重整、馬匹 DOM 穩定與障礙素材/遮擋測試。
- Host 題目與揭曉：`reports/answer-reveal/{reading,answer,statistics}-1280.png`（另外有 1920／1366），`long-content-1280.png`。瀏覽器逐一檢查全部 16 題，也涵蓋 1134×855；題目、長選項、長隊名不可溢出。
- 真正主賽道連續截圖（fixture，走實際 Host app/renderer）：`reports/stages/main-1280-{800,1400,2000,2800,3800,4800}.png`，同樣有 1920／1366；五隊分別 0／100／200／400／600m，測試原 .horse-unit 身分與比例。`main-large-gap-1280.png` 驗證超過舊賽道上限的大差距。
- 正常路障連續截圖：`reports/stages/obstacle-1280-{800,1480,1499,1500}.png`，另有 1920／1366；前後皆檢查 actual asset 載入與圖層可見。伺服器物理跨越與恢復後不補暈由 authority 測試另外證明。
- 真正伺服器 + Chromium + Socket.IO：`reports/stages/live-main-0.png`、`live-main-900.png`、`live-main-reloaded.png`、`live-main-resume-{300,600,900,1200,1500}.png`。跑一整關四題後實際 400m 獎勵，Host/Guest 重整、暫停再恢復；畫面與距離接續且只結算一次。
- 完整 predeploy 後補強並再次執行 `node scripts/test-network-browser.js`，exit code 0，`reports/fix-live-browser.log`；直接斷言 ACK 後 selected=A、重新整理後仍 selected=A 且沒有對錯 class，截圖等待原按鈕短轉場完成。這次補強只增加瀏覽器檢查，沒有再改產品程式。
- Guest 原樣控制器狀態：`reports/stages/controller-{reading,answer,submitted,reveal}-320x568.png`，另外有 390×844／844×390。真實作答 ACK：`reports/network-v2-mobile320-answer.png`；作答後重新整理的收據恢復：`reports/guest-answer-restored-320.png`。Control 閱讀／操作截圖在 `reports/control/`。

已用圖片工具實際查看 Host 題目、主賽道連續幀、碰撞前障礙、手機鎖定與中性 ACK，並據此修正 item 父圖層、馬距離文字換行及題目字形裁切。Fixture 負責可重現的時間/級距/尺寸邊界；live browser 負責真正身分、Socket、重連、送答與結算。

## Reviewer 提出的三項回歸修正

- P2 相機：原本越界直接修改 high，累積距離 +1 可能造成數百設計像素跳退。現改為同一仿射投影的連續 smoothstep 過渡，依像素位移設定時間；道具也使用過渡中的相機。這是平滑縮放，畫面間距仍會隨共同視窗調整；不把各隊鎖在名次位置。暫停／重連凍結並接续過渡，summary 仍固定相機。
- P2 快照：原本 updatePositions 後又 paint(latest)，下一個 RAF 才 paint(100ms delayed)，形成先前進再回退。現在快照與 RAF 共用 paintInterpolated，resize 使用 presented。
- P3 倒數：移除 HTML 中原「秒」，閱讀／作答偽元素改為正常 flex 排版，避免兩種標籤及數字重疊。更新 Host CSS／renderer cache key。
- 新增 renderer 邊界 +1、每 16ms 位移小於 8 設計像素、相機收斂、道具共用座標、過渡暫停／恢復／重連、名單完整快照下一幀不回退、resize 保留呈現時間的回歸。`reports/review-renderer.log` 通過。
- 瀏覽器新增單一階段標籤與正常排版檢查；相機連續截圖 `reports/stages/review-camera-{0,500,1200,2400,4000}.png`、逐幀紀錄 `review-camera-frames.json`。最新完整驗證記錄是 `reports/review-predeploy.log`。
- 實際 1280×720 邊界錄得 201 幀，+1 當幀向右 0.11 設計像素；重新縮放耗時約 3326ms，最大單幀向左位移 4.49 設計像素（原問題約 554px 單幀）。閱讀截圖 `reports/answer-reveal/reading-1280.png` 已目視確認只有「閱讀」標籤且不覆蓋數字。
- 本輪 `npm run test:predeploy` 全部通過，exit code 0（包含 npm test、Host/Guest/Control/results browser 與部署設定檢查）；補強過渡暫停／重連後的 renderer 回歸另行通過。`git diff --check` 通過，未 commit、push 或部署。

### 現場驗證限制

尚未在真實 iPhone Safari／Android、婚宴投影機、後排觀眾視距、場地 Wi-Fi／公開 HTTPS/WAN 和 190 人真實手機同時在線環境驗證。本機 Chromium 與 bot／計分測試不能取代現場彩排。未安裝套件、未操作正式伺服器、未 commit、push 或部署；交由 reviewer 檢查未提交 diff。
