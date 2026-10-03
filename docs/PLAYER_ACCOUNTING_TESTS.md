# Player Accounting Confidence Tests

Run `npm run test:accounting` from the repository root. These tests also run in
`npm test`. They use the production game managers with virtual time, isolated
players and fixed question fixtures. They never connect to or reset production.

## Independent Ledger

For each player, the test records planned actions, timestamps, stable identity,
team, socket migration, acknowledgements, rejected actions, accepted taps,
critical taps, answered/correct/wrong counts and answer latency. Expectations
come from the action schedule rather than copying server counters.

After each question, compare server counters with the independent ledger.
After each stage, check strict > 50% correct-rate results and reward distance. At completion,
compare the full individual award rankings and winners, not only the number
of awards. Check reset removes players, statistics and pending game flow.

Accounting rules:

- Attempted taps are not accepted taps. Cooldown and wrong-phase taps must not count.
- Correct plus wrong equals accepted answers. Skipping is not an individual wrong answer.
- Team display counts skipping as wrong: correctCount plus teamWrongCount equals
  the question's team size. unansweredCount is a subset of teamWrongCount;
  wrongCount still represents submitted incorrect answers for reconciliation.
- Accepted answers plus skipped questions equals 16 for these full-match participants.
- Rejected, duplicate, invalid, expired and paused answers must not alter statistics.
- Reconnecting retains identity and the answer lock, without duplicating statistics.
- Answer latency excludes paused time.
- Team correctness uses correctCount / team size captured at question start, strictly > 0.5.
  Unanswered players stay in the denominator; exactly 50% and empty teams are incorrect.
- Stage rewards for 0/1/2/3/4 correct answers are 0/1500/3000/6000/9000 distance, paid once.
- Individual correct/wrong ties use average latency across all accepted answers,
  then join time. Skippers cannot win the wrong-answer award.

## Scenarios

| Scenario | Players | Behavior |
| --- | --- | --- |
| Mixed | 150 | Correct, incorrect, skipped, tied team votes, variable taps |
| Mixed | 190 | Same independent accounting at larger player count |
| Silent | 150 | No accepted taps or answers; no fictitious correct/wrong winner |

Tests explicitly advance each waiting phase using the authoritative Control command.
All scenarios execute four tap stages, 16 answers/reveals, four settlements,
final sprint, four awards and reset. Mixed scenarios reconnect players after
an accepted answer and attempt another answer from both old and new sockets.

## Evidence

Generated files in `reports/accounting/` (ignored by Git):

- `150-mixed.json`, `190-mixed.json`, `150-silent.json`: action-by-action evidence,
  expected/actual statistics, team results, awards and failure stack if any.
- Matching `.csv` files: one row per player for quick comparison in Excel.

Reports are overwritten on the next run; archive them separately for a rehearsal.
The CSV `passed` value is the scenario result, not an assertion that every row
was reached after a failure. Missing actual values indicate an unfinished check.
`unansweredExpected` is independently calculated because the server does not
maintain a separate unanswered counter. Generated identities are synthetic.

## Boundaries and Additional Rehearsal Variables

This is not a persistent production action log or network load test. Physics is
disabled so reward-distance reconciliation is exact and independent of race
movement. Use existing Socket stress and operations tests for actual transport,
movement, capacity, team changes/full teams, join races, item effects and stun.
Also rehearse disconnect-before-answer, packet loss, device backgrounding,
refresh, deadline-boundary submissions, operator reset and server restart.
For each real rehearsal record app version, question-set version, configuration,
player/session identity, phase, server timestamps, rejection reasons and final
awards. Avoid collecting device identifiers or unnecessary personal information.

A green run proves these deterministic scenarios, not all possible user actions
or wedding venue connectivity. Any counter discrepancy or incorrect award is
a release blocker; retain the failing JSON before rerunning.


## 最近 10 場成績快照

工作人員從 `/manage` →「本輪成績」進入 `/results/`，頁面與唯讀 `GET /api/match-results` 都重用 staff session 驗證，API 設定 `Cache-Control: no-store`。頁面先列勝隊完整成員，再列五隊排名與所有玩家卡片；可切換場次、隊伍篩選、只顯示勝隊、排序與下載單場 JSON／CSV。

正式遊戲第一次進入 `MATCH_FINISHED` 時，以 runId 冪等建立不可變快照；`ROUND_FINISHED` 不寫入。GameManager 注入 MatchResultStore，組裝由獨立 buildMatchResult 負責。以 TeamManager.players 權威名單合併遷移後的 playerStats，包含零操作與斷線玩家，不以獎項排行榜充當名單。零操作統計為 0；未作答數為當場題數減作答數，最低 0。四獎只保存允許的成績欄位，不保存 socket/session/request 識別或 receipts。

schemaVersion 為 1，頂層包含 updatedAt、matches；每場包含 id、finishedAt、map、questionCount、stageCount、winner、teams、players、awards。依 finishedAt 新到舊排序，只保存最近 10 場。Reset 清除當輪狀態、玩家與計時器，不刪歷史；程序重啟讀回 JSON。

預設位置為專案 `data/runtime/match-results.json`（正式站 `/opt/lucky-horse/data/runtime/match-results.json`）。可用 `MATCH_RESULTS_FILE` 覆寫；建議使用絕對路徑並維持在 `/opt/lucky-horse/data`，沿用 systemd 可寫範圍。若另換目錄，維運必須同步調整 systemd ReadWritePaths、目錄擁有者、bootstrap 與部署檢查。目錄、JSON、暫存檔及 corrupt 備份含個資，不要把活動成績 commit 進 Git；runtime 目錄只有 .gitkeep 可追蹤。

寫入在相同目錄建立獨佔暫存檔，寫完並 fsync 後 rename 取代。損毀 JSON 先改名為 `.corrupt-時間戳-UUID.json` 備份；備份失敗時禁止覆寫原檔。錯誤記錄於伺服器，staff API 僅回傳安全狀態與錯誤碼，不回傳內部路徑。寫入失敗不阻止頒獎，當次程序仍可查記憶體快照，但尚未成功保存的紀錄可能在重啟後遺失；請立即下載此場並請維運處理。

部署必須保留 runtime JSON，勿使用會刪除忽略檔的清理命令。手動以 candidate 目錄切換部署時，先停止舊程序並複製或掛載原有 runtime 成績檔（含必要備份）、確認擁有者與可寫權限，再啟動新程序，避免遺失歷史。備份時停止服務，把 runtime 目錄複製到權限受限、位於部署目錄外的位置，確認可讀後恢復服務。若確需清除：先經活動負責人確認與完成上述備份，停止服務，再手動移走成績 JSON，啟動後為空紀錄；沒有前端清除按鈕。

驗證：`node tests/test-match-result-store.js` 使用 OS 暫存目錄驗證冪等、裁切排序、reset/restart、完整名單、重連、平手、資料隔離與故障保護。`npm run test:results-browser` 啟動本機隔離伺服器並使用暫存結果檔，驗證 staff HTTP 保護、完整勝隊名單、XSS、空狀態、平手、10 場切換、reset/reload、損毀警告及 390×844／320×568。已加入 `npm run test:predeploy`，不得跳過；Playwright 安裝方式見 README。測試不可寫入正式 runtime JSON。


## 2026-10-03 互動更新

每題額外閱讀 3 秒，由伺服器鎖定手機，開放後保留完整 10 秒作答；揭曉前 ACK 與恢復收據只確認「已作答」。正式主賽道採五隊共用的累積距離線性座標。結算先顯示成果 0.8 秒，再切回原主賽道角色前進；數字與排名同步動畫時間。獎勵跨過的道具被略過，不補觸發暈眩。

完整權威時間、資料過濾及相機契約見 [架構文件](PROJECT_ARCHITECTURE.md)；根因、測試和連續截圖見 [交接文件](INTERACTION_FIX_REVIEW.md)。
