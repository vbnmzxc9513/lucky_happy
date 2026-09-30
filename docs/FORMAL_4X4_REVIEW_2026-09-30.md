# 正式 4×4 修改與審查紀錄

日期：2026-09-30。範圍：本機未提交工作樹；未連線修改正式站。

## 修改摘要與狀態流程

正式地圖固定 16 個不重複題目、四關、每關四題。共用設定定義正式結構與 `[0, 1, 2, 4, 6]` 獎勵，伺服器依隊伍四題結果只結算一次，Host 顯示答對數、前進格數及套用後權威距離。MapManager 儲存、GameManager 開賽與 Admin 編排共用正式結構驗證；runtime 與地圖覆寫均不能繞過 4×4。

每關流程：`tap → awaiting_question → (answer → reveal) × 4 → summary`。

- 主持開始第一題，前三題統計後按「下一題」，第四題統計後按「顯示本關結算」。
- 統計、等待與結算不排自動推進計時器。
- 前三關結算後按「開始下一關」，第四關結算後只提供「開始最後衝刺」。
- 衝刺完成由伺服器權威累積距離判定勝負，5 秒後進入頒獎。
- 保留題目開始時隊伍總人數（含未作答）為分母，嚴格超過 50% 才答對；平票不任選隊伍答案。
- 保留 Guest 角色隔離、重連答案鎖與目前階段恢復。
- 補上每局已消耗 requestId 帳本，搭配 runId、stageNumber、flowRevision，防止重複推進；重置清除帳本與舊排程。

自動計時由設定計算：`3 + 4×8 + 16×10 + 10 = 205 秒`。總時間另加主持停留、暫停與 5 秒頒獎轉場，非固定 205 秒完賽。

## 題庫驗證

新增 `data/quizzes/wedding-formal.json`，沿用 options 陣列與 correctAnswer 字母格式。正式地圖按序引用 `wedding_2026_01` 至 `wedding_2026_16`。測試以獨立 prompt fixture 比對每題全文、四個選項與答案；reviewer 亦逐項人工核對。

答案（共 16 題）：`B, C, D, C, A, C, A, D, B, C, B, D, A, B, D, A`。

## 驗證結果

- `npm test`：通過。包括單元、UI、Network v2、150/190 人虛擬時間逐玩家對帳、30 人實際 Socket 重連、雙 Control 操作競態、預檢 13/13。
- `npm run test:predeploy`：通過；其中實際執行 `npm test`、`npm run test:control-browser`、`npm run deploy:check`，未略過瀏覽器測試。
- `npm run security:check`：通過，0 vulnerabilities。
- 依 README 執行 `npm install --no-save --package-lock=false playwright@1.62.1` 與 `npx playwright install chromium`。package.json、package-lock.json 未變更。
- `node --test tests/test-quiz-stages.js`：28/28 通過；reviewer 獨立重跑也通過。
- `node scripts/test-answer-reveal.js`：16 題統計於 1280×720、1920×1080 均通過選項、五隊結果與無裁切檢查。
- `node scripts/test-stage-browser.js --fixturesOnly`：通過；桌面五種獎勵、權威距離、最後衝刺提示，以及 390px／320px 手機四題結算與重置均通過，並檢視截圖。
- 本機隔離 150 人完整 Socket 壓測：passed=true；16 次開始／16 次揭曉、4 次結算、4 段 8 秒連點、最後衝刺、四獎完成。15 次強制重連全部恢復；150 位玩家 receipts 對帳全部相符；2352/2352 答案 ACK、30351/30351 點擊 ACK，0 系統錯誤。實測局長 211 秒，包含自動主持操作延遲與頒獎轉場。
- 獨立逐玩家對帳：150 mixed、190 mixed、150 silent 均通過；每組 16 題、20 筆隊伍結算（4 關×5 隊），分別 70080、88408、34128 個檢查。
- `git diff --check`：通過。

最終日誌與本機產物位於 `reports/npm-test.log`、`reports/predeploy.log`、`reports/security-check.log`、`reports/formal-stress-150.json`、`reports/accounting/`、`reports/answer-reveal/`、`reports/stages/`。reports 為 gitignored 本機測試產物。

初次完整測試找出兩支 Socket 測試依賴舊首題 ID，已改讀正式地圖首題；額外結算瀏覽器測試首次受隔離伺服器啟動時序影響，重跑後另發現舊測試在動畫 0.1 秒時就期待結束文案，已改為驗證初始揭曉並等待實際動畫狀態。未降低安全、權限、計分、重連或隔離門檻。

## 獨立 reviewer

已交由獨立 reviewer `review_formal_4x4` 唯讀審查。初審指出 requestId 重用、map override 掩蓋 runtime 結構，以及預檢五關文案；均已修正並補回歸。複審確認先前三項已修正，未發現新的阻擋問題。

## 尚需現場驗證

未驗證真實 iPhone／Android 鎖屏及切換網路、婚禮場地 Wi-Fi／行動網路、公開 HTTPS 正式規模負載、投影 HDMI／音響與 LAN 備援演練。本機模擬和 Chromium 不代表場地已驗收。未執行含 120 人第二場景的完整 `test:confidence`；本次另外完成上述 150 人完整賽程。

歷史日期報告及 STRESS_TEST 的歷史數據保持原樣；文件測試只檢查現行章節。

## 修改檔案

- `GAME_DESIGN.md`
- `README.md`
- `admin/index.html`
- `admin/js/admin-app.js`
- `control/index.html`
- `control/js/control-app.js`
- `data/maps/wedding-final-showdown.json`
- `data/quizzes/wedding-formal.json`
- `docs/ART_READABILITY_FIXES.md`
- `docs/DIGITALOCEAN_STEP_BY_STEP.md`
- `docs/FORMAL_4X4_REVIEW_2026-09-30.md`
- `docs/FORMAL_GAME_RULES.md`
- `docs/PLAYER_ACCOUNTING_TESTS.md`
- `docs/PROJECT_ARCHITECTURE.md`
- `docs/QA_TEST_PLAN.md`
- `docs/RACE_PACING.md`
- `docs/REALTIME_DEFENSIVE_GUIDE.md`
- `docs/STRESS_TEST.md`
- `docs/WEDDING_OPERATION_TEST_PLAN.md`
- `docs/WEDDING_RUNBOOK.md`
- `guest/index.html`
- `host/index.html`
- `host/js/quiz-display.js`
- `host/js/shuttle-preview.js`
- `scripts/audit-art-readability.js`
- `scripts/check-deployment-readiness.js`
- `scripts/estimate-race-pacing.js`
- `scripts/stress-wedding-game.js`
- `scripts/test-admin-quiz-planner.js`
- `scripts/test-answer-reveal.js`
- `scripts/test-control-browser.js`
- `scripts/test-control-ui-flow.js`
- `scripts/test-guest-ui-flow.js`
- `scripts/test-realtime-resilience.js`
- `scripts/test-shuttle-mobile.js`
- `scripts/test-stage-browser.js`
- `scripts/test-stage-display.js`
- `scripts/test-ui-flow.js`
- `scripts/test-wedding-operations.js`
- `scripts/wedding-preflight.js`
- `server/game/GameManager.js`
- `server/game/MapManager.js`
- `shared/game-config.js`
- `shared/stage-display.css`
- `shared/stage-display.js`
- `shared/stage-plan.js`
- `tests/fixtures/formal-questions.json`
- `tests/test-documentation.js`
- `tests/test-game-manager.js`
- `tests/test-network-delivery.js`
- `tests/test-player-accounting.js`
- `tests/test-quiz-stages.js`
- `tests/test-wedding-readiness.js`

## 發布限制

本紀錄完成當時尚未 commit、push、建立 PR或部署；後續經使用者明確授權，已先部署至正式站，再提交並推送同一版本至 GitHub `main`。沒有建立 PR。
