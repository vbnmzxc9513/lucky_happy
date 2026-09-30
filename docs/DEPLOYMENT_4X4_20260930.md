# 正式 4×4 上線紀錄

日期：2026-09-30（Asia/Taipei）
正式網址：https://luckyhappy1009.com

依使用者明確部署授權，先將已審查的本機工作樹封存包發布至既有 VPS；其後依使用者要求提交並推送同一版本至 GitHub `main`。沒有建立 PR。

- 發布檔案：240 個，封存包 SHA-256：`d60d324c839860749d7eeb3fde76d1be8cd55357e27252434cf50d6c802d9322`。
- 候選目錄先核對全部檔案雜湊，執行 `npm ci`、`npm run security:check`、完整 `npm test`，全部通過；0 vulnerabilities，候選測試預檢 13/13。
- 切換前再次確認正式站為健康 `LOBBY`、0 個連線；停止 lucky-horse、保留原目錄、換入候選版並重啟。
- 正式路徑：`/opt/lucky-horse`。
- 回復用舊版：`/opt/lucky-horse-rollback-20260930-before-4x4`。未刪除。
- 原 `/etc/lucky-horse.env`、工作人員憑證、Caddy 設定及防火牆未修改。正式題圖與題庫依本次 16 題需求更新。
- 上線後公開 HTTPS preflight **13/13 通過**，確認 16 題、每關 4 題、4 關流程及獎勵設定。
- lucky-horse 與 Caddy 均 active；最終健康檢查為 `ok`、空白 `LOBBY`。
- 從 Windows 核對公開 game-config、stage-plan、stage-display、guest-app 的 SHA-256，均與本機一致；Control 檔案須登入，未登入維持 HTTP 302，其伺服器端雜湊亦與本機一致。

候選版安裝、安全與測試日誌及正式預檢日誌位於 VPS `/tmp/formal-4x4-candidate-*.log`、`/tmp/formal-4x4-production-preflight.log`；本機封存包、manifest 與公開驗證結果位於 gitignored 的 `reports/formal-4x4-*`。

本次沒有在正式站執行玩家壓測。上線成功不代表已完成婚禮場地、真實手機、投影音響或 LAN 備援驗收。現有 Host／Control／Guest 分頁應重新整理以載入新版。
