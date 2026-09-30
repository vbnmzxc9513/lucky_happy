# 正式賽事節奏

更新日期：2026-09-30

正式 16 題、4 關採主持手動進題。`shared/stage-plan.js` 回傳 `timedSeconds` 與 `totalSeconds: null`，不得把自動計時部分顯示成總時長。

## 自動計時部分

| 項目 | 次數 | 每次秒數 | 合計 |
| --- | ---: | ---: | ---: |
| 開賽倒數 | 1 | 3 | 3 |
| 連點 | 4 | 8 | 32 |
| 作答 | 16 | 10 | 160 |
| 最後衝刺 | 1 | 10 | 10 |
| 自動計時合計 | | | 205 秒 |

每題之間及每關之間由主持控制，統計與本關結算會持續保留；總時間取決於主持停留時間與暫停，完賽後另有 5 秒頒獎轉場。
自動壓測以合法 Control 推進等待階段；manualHost 不代按按鈕。16 題版本負載數據須實際重跑，不能套用歷史報告。

## 賽道距離

`GameManager.applyRacePacing()` 在開賽時計算適合畫面與獎勵的 track length。四關模式的計算以：

- 固定 racing seconds。
- `maxSpeed` 換算的最大移動速度。
- 每階段最高六格的答題獎勵。
- 10% 緩衝。

作為估算基礎。這個長度用於進度、排名與畫面比例，不是提前完賽門檻；正式模式仍要走完所有階段與最後衝刺。

## 調整規則

修改下列任一數值時，必須同時更新 `shared/game-config.js`、正式地圖、`shared/stage-plan.js` 的測試預期、本文件與操作驗收時間：

- `countdownSeconds`
- `quizStages.tapSeconds`
- 各 checkpoint `timeLimit`
- `quizStages.sprintSeconds`

不要再使用舊版「10 題、9 分鐘開始衝刺、10 分鐘硬結束」模型估算正式賽事；該守門機制只屬於未啟用 quiz stages 的 legacy 流程。
