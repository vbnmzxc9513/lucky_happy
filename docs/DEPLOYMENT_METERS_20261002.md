# 公尺結算動畫部署紀錄

日期：2026-10-02（Asia/Taipei）
正式站：https://luckyhappy1009.com

依使用者「請部署」授權，發布目前未提交工作樹；沒有 commit 或 push。

- 本機既有 test:predeploy 全套通過。
- 封存包 255 檔，SHA-256：dbc0516c1b57de04ea695638af7d6fb4bc00820ade1b0b1999c0187b58cbd3fb。
- VPS 候選目錄核對全部 manifest，npm ci、npm audit --audit-level=moderate（0 vulnerabilities）、npm test 全部通過。
- 切換前確認健康 LOBBY、0 個連線；停止服務後複製最新 data/runtime，驗證所有檔案雜湊，換入候選版再啟動。
- 成績資料部署前後雜湊一致；正式環境憑證、Caddy 與防火牆未變更。
- 正式目錄：/opt/lucky-horse。
- 保留回復目錄：/opt/lucky-horse-rollback-20261002-before-meters。
- 公開 HTTPS preflight 13/13 通過；lucky-horse、Caddy 均 active。
- Windows 公開驗證：6 個公開 JS／CSS SHA-256 全部符合本機；Host／Control／Results 未登入均 HTTP 302。
- 最終健康：ok、LOBBY、0 連線、事件迴圈延遲 2 ms、RSS 71 MB。

本機證據位於 ignored 的 reports/meters-release-*、reports/meters-production-verification.json、reports/meters-production-preflight.log；VPS 證據位於 /tmp/meters-candidate-*.log 與 /tmp/meters-production-preflight.log。

已開啟的 Host、Control、Guest 分頁需重新整理。沒有在正式站開賽或執行玩家壓測；部署驗證不代表場地網路或真實手機彩排通過。
