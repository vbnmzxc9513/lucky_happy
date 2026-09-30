# 即時互動防禦性工程指南

更新日期：2026-09-29

本指南描述目前 Network Protocol v2 的工程規則。完整元件關係見 [`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md)。

## 1. 核心不變量

1. 伺服器是位置、得分、答案、階段與獎項的唯一權威。
2. 未登入的手機不能因收到全域狀態而跳過登入生命週期。
3. 任何被拒絕的操作都要有可辨識的 ACK 或錯誤事件。
4. 點擊不重送；答案只以相同 request ID 有限重送。
5. 舊局、舊協定與截止時間後的操作一律拒絕；點擊另檢查 stateVersion，答案以 runId + quizId + deadline 驗證。
6. 重連必須恢復玩家、隊伍、個人統計與答案鎖。
7. 暫停、重置與同時操作不得留下幽靈 timer 或重複獎勵。

## 2. 連線與狀態恢復

```text
手機建立 Socket(protocolVersion=2)
  → 伺服器送最小化狀態快照
  → 手機以 localStorage sessionId 重新 Join
  → 伺服器遷移舊 socket 身分與統計
  → 手機要求同步
  → 伺服器送目前狀態、個人狀態、題目與答案收據
  → 權威時間新鮮後才重新啟用輸入
```

手機端 `GuestNetwork.ready()` 必須同時滿足：Socket 在線、身份恢復、完成同步、沒有 fatal protocol error，且最近權威時間不超過三秒。

若 heartbeat 表示狀態或 paused flag 已改變，但本地快照尚未更新，手機應停用輸入並要求新快照，不可自行猜測狀態。

## 3. 操作冪等與過期防護

點擊與答案封包必須包含：

```js
{
  requestId,
  runId,
  stateVersion,
  // tap: timestamp
  // answer: quizId, answer
}
```

伺服器按下列順序驗證：

1. `requestId` 格式合法。
2. `runId` 等於目前比賽。
3. 玩家存在且連線身分有效。
4. 相同 request ID 若曾執行，內容必須一致並回傳原結果。
5. 點擊要求 `stateVersion` 等於權威版本；答案在相同 runId、quizId 且伺服器期限內仍可接受較早的展示版本。
6. 仍在允許的賽事／題目階段與截止時間內。
7. 最後才執行遊戲邏輯並把結果放入 operation ledger。

同一 session 重連後沿用同一份 operation ledger，因此答案 ACK 遺失後以同一 ID 重送不會重複計分。重置會更換 `runId` 並清空帳本。

## 4. 可靠與可丟棄事件

適合 volatile：

- 高頻位置更新。
- 每秒 heartbeat。

必須可靠：

- 狀態快照與狀態切換。
- 加入、選隊、點擊與答案 ACK。
- 題目準備、選項、答案揭曉、階段結算。
- 完賽、頒獎與控制台結果。

遺失一個位置 frame 可以由下一 frame 修正；遺失答案 ACK 或狀態轉換可能造成使用者誤判，所以不能使用 volatile。

## 5. 角色分流與最小資料

- Host 約 30 Hz，收到全部隊伍位置。
- Guest 最多 5 Hz，只收到自己隊伍的位置、暈眩與名次。
- Control／Admin 最多 2 Hz，收到操作需要的全隊資訊。
- Guest 快照不得包含完整 roster、題庫、道具清單、完整 Admin config 或完整頒獎排名。
- 題目文字只送 Staff；Guest 只收選項 map 與截止時間。

新增廣播前必須先回答：哪些角色需要、是否可 volatile、是否可合併、是否會洩漏題目或管理資料。

## 6. 前端即時回饋

觸控視覺回饋可以在網路 ACK 前顯示，但不得提前增加權威個人點擊數或隊伍距離。

- 點擊：立即按壓／振動；ACK 後顯示接受、爆擊或拒絕原因。
- 選隊：按鈕可顯示等待，但必須等伺服器確認才保存隊伍。
- 答題：送出後立即鎖按鈕；若權威拒絕，先同步狀態，再由恢復 payload 決定是否重新開放。
- 離線、資料過期或恢復中：停用輸入並顯示明確 banner。

## 7. 暫停與重置

暫停時必須停止：

- 物理更新 loop。
- race guard。
- managed timeout。
- QuizManager timeout。

恢復時要平移 race start、stage end、quiz deadline、stun deadline 與 checkpoint timeline。不可只重新開始 UI 倒數。

重置時必須：

- 更換 `runId`、重設 `stateVersion`。
- 遞增 `flowToken`。
- 清除所有 managed timeout、quiz timer、delivery ledger 與 progress buffer。
- 清空玩家、隊伍、個人統計與舊答案。
- 回到 Lobby 並重新廣播快照。

## 8. 靜默失敗禁止事項

下列情況必須回應：

- 加入被鎖：`GAME_JOIN_LOCKED`。
- 隊伍額滿：`GAME_TEAM_FULL`，玩家保留原隊。
- 特權不足：`SYSTEM_ERROR/FORBIDDEN`。
- 舊頁面：`SYSTEM_ERROR/PROTOCOL_MISMATCH` 後斷線。
- 點擊或答案：一律回對應 ACK，包含 `success`、`reason`、`requestId`、`runId`。
- 控制台操作：`CONTROL_ACTION_RESULT`，包含最新 state。

驗證器拒絕畸形輸入時，也應避免讓正常使用者長期停在等待狀態；新增輸入流程要同時設計前端 timeout 或錯誤回復。

## 9. 修改檢查表

新增或修改即時功能時：

1. 先更新 `shared/events.js`。
2. 定義角色、payload、可靠性與權威來源。
3. 補 validator 與伺服器狀態 guard。
4. 決定是否需要 request ID 冪等。
5. 補重連 recovery payload。
6. 補暫停、重置、舊局與截止時間測試。
7. 驗證 Guest payload 沒有多餘資料。
8. 跑 `npm test`；高風險協定改動再跑 `npm run test:confidence`。

## 10. 測試重點

現有測試涵蓋：

- 190 人角色分流與 snapshot 大小。
- duplicate／conflicting request ID。
- reconnect 後的 answer receipt 與 tap accounting。
- 離線或過期資料不產生輸入。
- 30 人 Socket 重連。
- 同時搶最後名額、同時開賽、重複暫停／恢復。
- reset 後沒有舊題目 callback。

公開 HTTPS 與場地網路仍要另做測量；單元測試不能證明 ISP、Wi-Fi、瀏覽器音訊或投影設備可用。

## 手動進題與統計契約（16 題、4 關）

`CONTROL_ADVANCE_QUIZ_FLOW`（`control:advance_quiz_flow`）需帶 `requestId`、`runId`、`stageNumber`、`flowRevision`。
伺服器重新驗證工作人員 session 與 control/admin 角色、暫停狀態及流程版本。每次轉換消耗目前版本；雙控制台競態只成功一次。
`CONTROL_ACTION_RESULT` 回傳 `action: ADVANCE_QUIZ_FLOW`、`requestId`、`success`、失敗 `reason`；合法工作人員另收最新 `state`。
Host、Guest 或未驗證來源收到 FORBIDDEN，不附管理狀態。舊局 STALE_RUN、舊流程 STALE_FLOW、非法階段 INVALID_PHASE、暫停 GAME_PAUSED。

`tap → awaiting_question → answer → reveal → answer → reveal → answer → reveal → answer → reveal → summary → tap / sprint`。
等待、揭曉及結算的 endsAt 為 null，不排自動推進 timeout；第四題統計必須先保留，再由主持切到結算。
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
