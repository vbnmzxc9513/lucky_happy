# Lucky Horse 現行 QA 與發布門檻

更新日期：2026-09-30
正式規格：Network Protocol v2、五隊、單局、四關 16 題

這是現行 QA 規格。檔名含日期的 `LOAD*`、`PRODUCTION_*`、`POSTDEPLOY_*` 與 `NETWORK_*` 文件是歷史證據，不會自動改變本文件的發布門檻。

## 1. 目前結論

- 本機快速信心測試、30 人斷線復原、主持操作與 preflight 已具完整自動化。
- 本機 150／190／220 人與公開隔離 190／200 人曾取得不同網路路徑的測量結果。
- 最近的公開 community-Wi-Fi 路徑仍曾因冷頁面延遲或網路停頓未達門檻。
- 歷史測量不代表新版已通過；16 題手動賽制的完整負載、婚禮場地與真實手機需重新驗證，不得只引用舊模擬器結果。

## 2. 每次提交

```powershell
npm test
```

必須通過：

- 五隊、50 人上限、自動分隊與滿隊換隊保留原隊。
- 四關 16 題、四次結算、最後衝刺與四獎。
- 團隊答對率 0%、49%、50%、50.1%、51%、100%、無人作答、答案鎖與個人統計。
- Protocol v2、角色分流、冪等、舊狀態拒絕與 receipt accounting。
- 暫停、恢復、重置、競態與舊 timer 防護。
- Host、Guest、Control、Admin 的主要 UI 流程。
- 30 人斷線復原與 preflight 13/13。

修改 `GameManager`、`TeamManager`、`RealtimeDelivery`、事件契約或 GuestNetwork 時，不可只跑單一測試檔。

## 3. Release candidate

```powershell
npm run test:confidence
npm run deploy:check
npm run security:check
```

完整信心測試應包含 120／150 人全賽程與 15 人重連。Release freeze 後不得在線上 Admin 修改題庫或地圖。

## 4. 功能驗收矩陣

### Guest

- 320、360、390、430 px 寬度無水平捲動。
- 暱稱空白、過長、Unicode 正規化重名均有明確錯誤。
- 五隊選擇、換隊、額滿、自動分隊正確。
- 點擊有即時視覺回饋，權威數字只由 ACK／snapshot 更新。
- 每 20 次有效點擊顯示爆擊。
- 答案送出即鎖定；重送不重複計分。
- 離線、三秒無新鮮狀態、恢復中與版本過期都停用輸入。
- 鎖屏、背景切換、重整、Wi-Fi／行動網路切換後恢復原隊、統計與答案鎖。

### Host

- 1280×720、1366×768、1920×1080、3840×2160，100% 縮放無裁切或捲動。
- Lobby QR 可掃描，規則、五隊跑道、題目、揭曉、結算、衝刺及頒獎可讀。
- 題目中重整可恢復題目與剩餘時間。
- 斷線或資料過期時凍結舊位置並要求同步。
- 音效需經一次使用者操作啟用；關鍵資訊同時有視覺呈現。

### Control / Admin

- Host 沒有控制權，Control／Admin 特權需合法 staff session。
- 兩個控制台的畫面階段與賽事狀態一秒內一致。
- 同時開賽只建立一個倒數。
- 重複暫停／恢復安全拒絕。
- 作答、揭曉、結算或暫停中不能插入不合法題目／道具。
- 頒獎在 `MATCH_FINISHED` 前不可進入或揭曉。
- Admin 地圖與題目驗證不會默默刪題、重複題或產生非四的倍數題表。

## 5. 時間與計分門檻

| 指標 | 預期 |
| --- | ---: |
| 題目／結算／獎項 | 16／4／4 |
| 每段連點 | 8 秒 |
| 每題正式作答 | 10 秒 |
| 每題揭曉 | 保留至主持手動推進 |
| 每階段結算 | 保留至主持開始下一關 |
| 最後衝刺 | 10 秒 |
| 自動計時部分 | 205 秒；總時間另加主持停留 |
| 完賽至頒獎 | 5 秒 |
| 暫停期間 | 不計入排程 |

所有接受的點擊與答案必須能和伺服器逐玩家帳本對上。遺失 ACK 是不確定狀態，不能直接稱為遺失計分；需要用 request receipt 對帳。

## 6. 公開 HTTPS 負載測試

負載測試只能指向空的、明確授權可重置的正式站或隔離實例，不能對婚禮進行中的賽局執行。

基準場景：

- 預定活動人數，另加至少 10% 容量餘裕。
- 每人每秒 5–10 次點擊。
- 至少 10% 玩家在題目期間斷線重連。
- 16 題全員作答或接近正式參與率。
- 使用 `--requireAccounting` 時只在非 production 的隔離實例啟用診斷端點。

建議最低門檻：

| 指標 | 門檻 |
| --- | ---: |
| 加入成功 | 100% |
| 非預期斷線、連線錯誤、系統錯誤 | 0 |
| 強制重連恢復 | 100% |
| 逐玩家 receipt mismatch | 0 |
| Tap ACK P95 | ≤ 250 ms |
| Host update P95 | ≤ 100 ms |
| Host maximum update gap | ≤ 1 秒 |
| `/guest/` HTTP P95 | < 250 ms |
| Event-loop lag P95 | < 50 ms |
| Node RSS peak | < 512 MB |

單一產生器、單一 Wi-Fi 或單一 VPS 內回送測試不能代表多個行動網路或場地 Wi-Fi。

## 7. 場地驗收

至少包含：

- iPhone Safari、Android Chrome、較舊手機各一支；正式建議至少 10 支實機。
- 首次冷載入、掃 QR、加入、選隊、連點、16 題與四獎。
- 鎖屏、切背景、切網路與重整。
- 投影、HDMI 拔插、音響中斷與重新啟用。
- WAN 失效後三分鐘內切換 LAN 備援。
- Host／Control 關閉重開。
- 工作人員實際演練暫停、恢復、確認重置與揭獎。

## 8. No-Go 條件

以下任一項成立即不可正式開賽：

- QR 無法由現場手機首次載入。
- 玩家、隊伍或逐人帳本不一致。
- 16 題、四次結算或四獎不完整。
- 重置後仍有舊題目／舊計時器執行。
- 投影、控制台或音響沒有可用替代方案。
- LAN 備援版本與正式站不同或未演練。
- 預定場地／網路未通過核准的實機驗收。

## 9. 證據紀錄

每次正式驗收記錄：release commit／archive hash、日期與時區、環境、網路、裝置、指令、完整 JSON report、截圖、伺服器輸出、清理結果與最終判定。失敗報告保留原始結果，不得放寬門檻後改標 Pass。

## 手動進題與統計契約（16 題、4 關）

`CONTROL_ADVANCE_QUIZ_FLOW`（`control:advance_quiz_flow`）需帶 `requestId`、`runId`、`stageNumber`、`flowRevision`。
伺服器重新驗證工作人員 session 與 control/admin 角色、暫停狀態及流程版本。每次轉換消耗目前版本；雙控制台競態只成功一次。
`CONTROL_ACTION_RESULT` 回傳 `action: ADVANCE_QUIZ_FLOW`、`requestId`、`success`、失敗 `reason`；合法工作人員另收最新 `state`。
Host、Guest 或未驗證來源收到 FORBIDDEN，不附管理狀態。舊局 STALE_RUN、舊流程 STALE_FLOW、已消耗 requestId STALE_REQUEST（每局帳本，重置清除）、非法階段 INVALID_PHASE、暫停 GAME_PAUSED。

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
