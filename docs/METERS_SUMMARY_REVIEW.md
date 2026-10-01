# 公尺顯示與權威結算動畫：reviewer 交接

本次僅修改工作樹，未 commit、push 或部署。開始時 main 分支工作樹乾淨；正式題庫、物理、獎勵 raw distance、排名及歷史快照寫入機制未改。

## 行為

- 第四題揭曉後由主持顯示結算；先看 Q1～Q4 0.8 秒，五隊同時水平前進。
- 0／100／200／400／600 m 對應 0／1/6／2/6／4/6／全有效跑道；移動時間 0／1.4／1.8／2.4／3 秒，smoothstep 加速減速、不越界回彈。
- 最長實際移動完成後保留至少 1 秒；全隊零獎勵共 1.8 秒。Control 自動解鎖後仍需主持按下一關／最後衝刺。
- 只使用既有跑步素材、2px 步伐、淡速度線及陰影。移除印章、紙花、彈跳與慶祝文字。生日隊原跑步素材含紙花，因此 summaryImgPath 指定既有無紙花跑步素材；原隊名、顏色、賽跑素材不變。沒有新增手機聲音或第三方套件。

## 權威與換算

shared/distance-display.js 是唯一公尺換算入口。distanceDisplay.metersPerRewardStep 為 100，internalUnitsPerMeter = rewardUnitPx / metersPerRewardStep，positionMeters 採 floor，顯示整數／千分位／m。Host、Guest、Control、Results 及 fixture 使用同一 helper；原 position 不改寫。

shared/summary-motion.js 產生 summaryStartedAt、movementStartedAt、movementEndsAt、readyAt，時長來自 game-config.summaryAnimation。showStageSummary 仍只在合法 reveal 套用一次 raw reward。advanceQuizFlow 在 readyAt 前拒絕 SUMMARY_ANIMATION_ACTIVE；其餘 requestId、runId、stageNumber、flowRevision、pause 防護保留。

Resume 平移四個時間。瀏覽器用 serverNow + performance.now 差值計算本地 transform；pausedAt 凍結，重整直接計算當下進度，reduced motion 直接完成視覺位置。Reset／換關取消 RAF，舊 run／revision 拒絕。DOM 僅在新結算建立；無逐幀 layout 讀取、DOM 重建、Socket 廣播或伺服器動畫 timer。Guest 快照保留共同時間，teamResults 僅本隊。

Results 按舊 JSON 的原 position 顯示換算；JSON／CSV 匯出、歷史排序、最近十場與安全寫入不變。注意舊快照建立器本來會取整 raw position，本次未修改該行為。

## 實際驗證

| 指令 | 結果 | 證據（ignored） |
| --- | --- | --- |
| npm test | PASS，含 30 人復原、操作競態、preflight 13/13 | reports/meters-npm-test.log |
| npm run test:host-browser | PASS | reports/meters-host.log |
| npm run test:guest-browser | PASS，含真實四題後 400 m summary 重整／pause／resume | reports/meters-guest.log |
| npm run test:control-browser | PASS，含播放中停用與到期解鎖 | reports/meters-control.log |
| npm run test:results-browser | PASS，舊快照顯示與原值匯出 | reports/meters-results.log |
| npm run test:predeploy | PASS，全部 browser 與部署靜態檢查 | reports/meters-predeploy.log |
| npm audit --audit-level=moderate | PASS，0 vulnerabilities | reports/meters-audit.log |
| git diff --check | PASS | 終端 |
| 距離、伺服器階段、Realtime、文件的補充測試 | 63/63 PASS | reports/meters-targeted.log |

首次 Results 擴充測試曾將既有 raw 取整行為誤認為保留小數，修正為比對原快照後重跑通過；沒有修改成績儲存器。首次穩定 DOM 測試發現 footer 重寫相同文字，已改成僅文字變更才更新後通過。

## 截圖與人工檢視

已實際開啟查看各尺寸圖像，確認五隊、長隊名、答案、距離無遮擋，馬匹位置比例清楚，沒有紙花／印章或慶祝文字。以下路徑均位於 reports/stages/：

| 畫面 | 尺寸 | 檔案 |
| --- | --- | --- |
| Host 起點／移動／終點 | 1280×720、1920×1080、1366×768、1134×855 | host-start-W.png、host-running-W.png、host-rewards-W.png |
| Host 長隊名 | 同上 | host-long-W.png |
| Guest 五種獎勵 | 390×844、320×568 | guest-W-N.png，N=0～4 題答對 |
| 真實手機 summary 重整恢復 | 320×568 | guest-live-reloaded-320.png |

100 m 在 1280 寬約位移 138 px，320 寬手機約 37 px。四種桌面尺寸的本地動畫抽樣 P95 約 16.7～16.8 ms；原始樣本為 frames-W.json。這是本機 Chromium 測量，不能視為 190 支實機或場地投影的效能保證。

## 已知限制

沒有進行現場投影後排、真實 iPhone／Android 或公開 HTTPS 190 人彩排；既有 190 人分流單元回歸通過。伺服器程序重啟仍不恢復進行中的遊戲。跨裝置同步精度受既有 serverNow 快照傳輸延遲影響。下一位 reviewer 可使用下方清單審查，產生的 reports／截圖均 ignored。

## 修改檔案與 git status --short

```text
 M GAME_DESIGN.md
 M README.md
 M control/index.html
 M control/js/control-app.js
 M docs/FORMAL_GAME_RULES.md
 M docs/PROJECT_ARCHITECTURE.md
 M docs/QA_TEST_PLAN.md
 M docs/WEDDING_OPERATION_TEST_PLAN.md
 M docs/WEDDING_RUNBOOK.md
 M guest/index.html
 M guest/js/guest-app.js
 M host/index.html
 M host/js/host-app.js
 M host/js/race-renderer.js
 M host/js/scoreboard.js
 M host/js/shuttle-preview.js
 M results/index.html
 M results/results.js
 M scripts/run-confidence-tests.js
 M scripts/stress-wedding-game.js
 M scripts/test-control-browser.js
 M scripts/test-control-ui-flow.js
 M scripts/test-network-browser.js
 M scripts/test-results-browser.js
 M scripts/test-shuttle-browser.js
 M scripts/test-shuttle-renderer.js
 M scripts/test-stage-browser.js
 M scripts/test-stage-display.js
 M server/game/GameManager.js
 M server/websocket/RealtimeDelivery.js
 M shared/game-config.js
 M shared/stage-display.css
 M shared/stage-display.js
 M tests/test-bot-rehearsal.js
 M tests/test-network-delivery.js
 M tests/test-quiz-stages.js
?? docs/METERS_SUMMARY_REVIEW.md
?? shared/distance-display.js
?? shared/summary-motion.js
?? tests/test-distance-display.js
```
