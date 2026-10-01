# Lucky Horse 婚禮現場完整測試計畫

版本日期：2026-09-30（Network Protocol v2、四關四題版）
驗收目標：190 位賓客；200 位模擬玩家作容量餘裕測試
正式架構：DigitalOcean 主站 + 本機 LAN 備援
人力與裝置：2 位工作人員 + 3 支真實手機 + 模擬玩家

## 1. 測試紀錄

| 欄位 | 紀錄 |
|---|---|
| 測試日期與場地 |  |
| 測試版本 Git commit |  |
| DigitalOcean 網址 |  |
| LAN 備援網址 |  |
| 主持／操作員 A |  |
| 技術／觀察員 B |  |
| iPhone 型號與版本 |  |
| Android 型號與版本 |  |
| 最舊手機型號與版本 |  |
| 投影解析度與瀏覽器 |  |
| 音響連接方式 |  |
| 開始／結束時間 |  |
| 最終結論 | PASS / CONDITIONAL PASS / NO-GO |

每個失敗項目都要附上時間、操作步驟、畫面截圖、瀏覽器錯誤與伺服器輸出。不得只寫「偶爾失敗」。

## 2. 人員分工

| 角色 | 婚禮當天職責 |
|---|---|
| 操作員 A | 只操作 `/control/`，負責規則、開賽、暫停、恢復、強制事件與頒獎。 |
| 觀察員 B | 監看 `/host/`、伺服器、音效與三支手機，負責 DigitalOcean／LAN 備援切換。 |
| 手機 1 | iPhone，正常玩家流程與 Safari 鎖屏重連。 |
| 手機 2 | Android，正常玩家流程與 Chrome 背景切換。 |
| 手機 3 | 現場最舊手機，負責慢速、斷網、重複操作與錯誤流程。 |

婚禮正式開賽後，操作員 A 不查看伺服器終端；觀察員 B 不操作遊戲流程。只有進入故障處置時才能交叉接手。

## 3. 自動測試梯次

### 每次提交

```powershell
npm test
```

必須通過單元測試、UI 流程、30 人復原、婚禮操作回歸及 preflight 13/13。

### 婚禮前一週

在第二台電腦對已授權重置的空站或隔離 HTTPS 實例執行下列測試。每次測試前都必須確認狀態為 `LOBBY`，不得指向進行中的正式賽局。

```powershell
npm run stress -- --url https://YOUR_DOMAIN --clients 30 --tapRate 5 --answerRate 0.98 --maxSeconds 720 --report reports/stress-30.json
npm run stress -- --url https://YOUR_DOMAIN --clients 75 --tapRate 5 --answerRate 0.98 --maxSeconds 720 --report reports/stress-75.json
npm run stress -- --url https://YOUR_DOMAIN --clients 150 --tapRate 5 --answerRate 0.98 --reconnectClients 15 --reconnectAtQuiz 5 --maxSeconds 720 --enforceDuration true --report reports/stress-150.json
npm run stress -- --url https://YOUR_DOMAIN --clients 190 --tapRate 5 --answerRate 0.98 --reconnectClients 19 --reconnectAtQuiz 5 --maxSeconds 720 --enforceDuration true --report reports/stress-190.json
npm run stress -- --url https://YOUR_DOMAIN --clients 200 --tapRate 5 --answerRate 0.98 --reconnectClients 20 --reconnectAtQuiz 5 --maxSeconds 720 --enforceDuration true --report reports/stress-200.json
```

190 人是目前 Network v2 驗收目標；200 人用來確認額外容量餘裕。30、75、150 人用來檢查不同參與規模的功能與傳輸行為；正式四關排程不因人數改變。

### 187 個模擬玩家加 3 支手機

先在第二台電腦執行：

```powershell
npm run stress -- --url https://YOUR_DOMAIN --clients 187 --manualHost --expectedTotalPlayers 190 --tapRate 5 --answerRate 0.98 --reconnectClients 19 --reconnectAtQuiz 5 --manualStartTimeoutSeconds 1800 --maxSeconds 720 --enforceDuration true --report reports/manual-host-190.json
```

看到 `READY` 後才讓三支手機掃碼。控制台總人數顯示 190，再由操作員 A 正式開始。`--manualHost` 不會自動重置、開賽、進題、結算、開始下一關／衝刺或在結束時清場。自動主持模式則在等待狀態與每題結果後，以合法 Control 事件推進。

## 4. 功能操作案例

| ID | 前置狀態 | 操作 | 預期結果 | 實際結果／耗時／證據 | 結果 |
|---|---|---|---|---|---|
| OP-01 | 未登入 | 輸入錯誤驗證碼，再輸入本次設定碼 | 錯誤碼不能進入；正確碼可進入主持與控制台 |  |  |
| OP-02 | LOBBY | 以 localhost 開投影並掃 QR | QR 顯示區網或正式網址，不得包含 localhost |  |  |
| OP-03 | LOBBY | 三支手機同時掃 QR | 三支皆於 10 秒內進入，控制台人數增加 3 |  |  |
| OP-04 | LOBBY | 兩支手機使用相同、全形半形或大小寫不同的暱稱 | 第二支留在登入頁並顯示名稱已被使用 |  |  |
| OP-05 | LOBBY | 快速連點加入按鈕 | 只建立一位玩家，按鈕等待伺服器確認 |  |  |
| OP-06 | LOBBY | 三支手機選隊、換隊 | 人數與隊徽同步，換隊只屬於一隊 |  |  |
| OP-07 | LOBBY | 兩位玩家同時搶最後一個隊伍名額 | 只成功一位，另一位收到已額滿且保留原隊 |  |  |
| OP-08 | LOBBY | 手機 3 不選隊，直接開賽 | 系統自動分配最少人的未滿隊伍 |  |  |
| OP-09 | LOBBY | 兩個控制台同時按開始 | 只建立一次三秒倒數，不得重複開賽 |  |  |
| OP-10 | COUNTDOWN | 暫停、重複暫停、恢復、重複恢復 | 倒數凍結；重複命令安全拒絕；只繼續一次 |  |  |
| OP-11 | RACING | 每支手機一般點擊並完成 20 次有效點擊 | 點擊數、排行、進度更新；第 20 次顯示爆擊 |  |  |
| OP-12 | RACING | 強制加速與暈眩 | 指定隊伍畫面與數值正確；暈眩期間點擊不推進 |  |  |
| OP-13 | PAUSED | 強制出題、加速與暈眩 | 所有改變賽況的命令必須拒絕 |  |  |
| OP-14 | 等待本題 | 兩個 Control 同時進題 | 只成功一次，另一個收到 STALE_FLOW；Host／Guest 被拒絕 |  |  |
| OP-15 | QUIZ | 三支手機分別答對、答錯、不作答 | 團隊票數、正解、未作答與獎懲正確 |  |  |
| OP-16 | QUIZ | 同一手機連點兩個答案 | 第一個答案鎖定，後續回覆 `ALREADY_ANSWERED` |  |  |
| OP-17 | QUIZ | 暫停 5 秒再恢復 | 題目倒數凍結，恢復後延續剩餘秒數 |  |  |
| OP-18 | RACING/QUIZ | 切換投影到規則或大廳 | 遊戲狀態不變，賽道更新會維持正式賽況畫面 |  |  |
| OP-19 | 任意進行中狀態 | 點重置後取消 | 不送出重置，遊戲與倒數繼續 |  |  |
| OP-20 | QUIZ | 確認重置 | 回到 LOBBY，玩家與分數歸零，舊題目不得稍後再次結算 |  |  |
| OP-21 | 未完賽 | 嘗試切頒獎或送揭獎事件 | UI 與伺服器都拒絕，不得提前看到獎項 |  |  |
| OP-22 | MATCH_FINISHED | 依序操作揭曉、下一個、上一個、重複揭曉 | 四獎順序、神秘狀態、得獎者與音效皆正確 |  |  |

## 5. 時間與人數案例

| ID | 情境 | 驗收標準 | 實際結果 | 結果 |
|---|---|---|---|---|
| TM-01 | 30 人正常點擊 | 16 題、4 次結算完整；每段連點 8 秒 |  |  |
| TM-02 | 75 人正常點擊 | 16 題、4 次結算完整；每段連點 8 秒 |  |  |
| TM-03 | 150 人正常點擊 | 主持逐題推進；15/16 題、4 次結算、四獎完整 |  |  |
| TM-04 | 190 人正式目標 | 時間、重連、逐玩家對帳與網路門檻全部通過 |  |  |
| TM-05 | 200 人容量測試 | 無錯誤、無遺失玩家，五隊皆不超過 50 人 |  |  |
| TM-06 | 極快點擊 | 不得跳過任何關卡，16 題完成後才衝刺 10 秒 |  |  |
| TM-07 | 幾乎不點擊 | 一樣完成四關，16 題後衝刺 10 秒 |  |  |
| TM-08 | 四題結算 | 五隊答對 0/1/2/3/4 題分別前進 0/1/2/4/6 格，重整不重複發獎勵 |  |  |
| TM-09 | 第二／四題與結算時重連 | 恢復目前題目或結算；已作答不可再答，動畫不遮字 |  |  |

## 6. 裝置與投影案例

| ID | 操作 | 預期結果 | 實際結果／證據 | 結果 |
|---|---|---|---|---|
| DV-01 | iPhone Safari 鎖屏 20 秒後解鎖 | 10 秒內恢復原隊、題目、點擊與答案鎖 |  |  |
| DV-02 | Android Chrome 切背景 20 秒 | 10 秒內恢復，不建立第二位玩家 |  |  |
| DV-03 | 最舊手機重新整理 | 畫面可操作、文字不重疊、狀態恢復 |  |  |
| DV-04 | DigitalOcean 遊戲中 Wi-Fi 切行動網路再切回 | 自動重連，不可重複作答 |  |  |
| DV-05 | 390x844 選隊頁 | 五隊名稱、人數與按鈕同時可見，沒有水平捲動 |  |  |
| AV-01 | 1280x720、1920x1080 投影 | 所有正式畫面 16:9 無捲動、裁切或角色遮字 |  |  |
| AV-02 | QR 掃描 | QR 完整、三支手機首次掃描皆成功 |  |  |
| AV-03 | 點一次啟用音效 | Ready、倒數、答對、衝刺、揭獎音效可由音響聽見 |  |  |
| AV-04 | 主持頁重新整理 | 遊戲狀態恢復；重新點啟用音效後才播放聲音 |  |  |
| AV-05 | HDMI 拔除 10 秒再接回 | 伺服器與手機不中斷，投影恢復目前狀態 |  |  |

規則頁維持美觀優先；只驗收無重疊、無裁切、主要標題與主持人口頭說明足以理解流程。

## 7. 故障與備援演練

| ID | 故障注入 | 標準處置 | 通過標準 | 實際結果 | 結果 |
|---|---|---|---|---|---|
| DR-01 | 關閉主持頁 | 重新開啟 `/host/` | 10 秒內恢復目前賽道或題目 |  |  |
| DR-02 | 關閉控制台 | 重新開啟 `/control/` | 顯示正確狀態，可繼續暫停與主持 |  |  |
| DR-03 | 主持頁在題目中重新整理 | 重新登入並啟用音效 | 題目與剩餘時間恢復 |  |  |
| DR-04 | DigitalOcean WAN 中斷 | B 啟動 LAN 伺服器，投影 LAN QR；A 宣布重新報到 | 3 分鐘內回到可開賽狀態 |  |  |
| DR-05 | Node/VPS 中途重啟 | 不嘗試恢復舊局，回大廳重新開賽 | 沒有殘留題目或錯誤狀態 |  |  |
| DR-06 | 音響中斷 | B 修復輸出，重新整理主持頁並點啟用音效 | 畫面與遊戲不中斷，音效恢復 |  |  |
| DR-07 | 20% 模擬玩家同時斷線 | 等待自動重連，必要時暫停 | 10 秒內恢復，統計與答案鎖保留 |  |  |

LAN 備援演練必須使用和 DigitalOcean 相同的 Git commit、題庫、地圖與 `STAFF_ACCESS_CODE`。切換 LAN 後手機需重新掃描新 QR，進行中的雲端賽事不會移轉。

## 8. 效能門檻

| 指標 | 通過門檻 |
|---|---:|
| 正式加入 | 190 / 190 |
| 系統錯誤 | 0 |
| 強制重連 | 19 / 19 恢復 |
| 題目 | 16 次開始、16 次答案揭曉、4 次四題結算 |
| 最終獎項 | 4 個 |
| 正常總時長 | 總時間取決於主持停留時間；自動計時 205 秒，另加 5 秒頒獎轉場 |
| 最後衝刺 | 完成 16 題與四次結算後衝刺 10 秒 |
| HTTP `/guest/` P95 | < 250ms |
| 投影位置更新間隔 P95 | < 100ms，最大間隔 < 1 秒 |
| 逐玩家 receipt mismatch | 0 |
| Node 事件迴圈延遲 P95 | < 50ms |
| RSS 記憶體峰值 | < 512MB |
| 兩控制台同步 | < 1 秒 |
| 手機狀態恢復 | < 10 秒 |
| LAN 備援恢復 | < 3 分鐘 |

## 9. 婚禮前 30 分鐘 Go／No-Go

```powershell
$env:SERVER_URL="https://YOUR_DOMAIN"
$env:STAFF_ACCESS_CODE="活動驗證碼"
npm run preflight
```

- [ ] preflight 為 13/13，狀態為 LOBBY。
- [ ] QR 不含 localhost，三支手機皆可加入。
- [ ] 投影為 16:9、100% 縮放與全螢幕。
- [ ] 已點啟用音效，現場音響可聽見 Ready 音。
- [ ] 三支手機完成選隊、點擊與鎖屏重連。
- [ ] 操作員 A 完成一次暫停與恢復。
- [ ] LAN 備援伺服器可開啟，Git commit 與正式站相同。
- [ ] 主持、技術人員知道 Node 重啟後必須重賽。
- [ ] DigitalOcean 與本機電腦電源、網路保持穩定。

以下任一情況必須判定 NO-GO：P0 未關閉、QR 無法供手機連線、玩家或隊伍資料錯亂、未完成 16 題、四題獎勵重複發放、重置失效、投影無法恢復、音響無替代方案，或 LAN 備援未準備完成。

## 10. 缺陷紀錄範本

| 欄位 | 內容 |
|---|---|
| 缺陷 ID／嚴重度 |  |
| 發生時間與遊戲狀態 |  |
| 裝置／瀏覽器／網路 |  |
| 前置條件 |  |
| 重現步驟 |  |
| 預期結果 |  |
| 實際結果 |  |
| 是否可穩定重現 |  |
| 截圖／錄影／報表路徑 |  |
| 暫時處置 |  |
| 修正版本與複測結果 |  |

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

### 自動首題彩排補充

每一關 tap 期間確認 Control 首題按鈕不可按、訊息及倒數正確；最後 3 秒暫停再恢復，首題仍只出現一次。由兩個 Control 同時按揭曉後的下一題，必須只成功一次。bot 預演走滿 16 題，停止後名冊與排程清除；當題已接受答案及固定分母仍保留，Reset 才清空上一場。
