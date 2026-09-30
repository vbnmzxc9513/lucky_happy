# DigitalOcean Production Deployment

Lucky Horse requires a Node.js server because the game uses Express and Socket.IO. The production path is Cloudflare DNS, Caddy HTTPS, and a DigitalOcean Ubuntu Droplet. Port 3000 stays private on the Droplet.

For component ownership, runtime state, protocol and failure boundaries, read [`../docs/PROJECT_ARCHITECTURE.md`](../docs/PROJECT_ARCHITECTURE.md) first.

## Prepared Architecture

```text
Phone -> https://game.example.com -> Cloudflare -> Caddy :443 -> Node 127.0.0.1:3000
```

Repository deployment files:

- `bootstrap-ubuntu.sh`: idempotent first install and update command.
- `Caddyfile.example`: automatic HTTPS and WebSocket reverse proxy.
- `lucky-horse.service`: systemd process supervision and service hardening.
- `lucky-horse.env.example`: production environment reference.
- `verify-public.ps1`: preflight and optional 150-player verification from Windows.

## Pre-deployment regression gate

On the test workstation or isolated CI runner, install the browser test prerequisites described in [README](../README.md), then run `npm run test:predeploy`. This runs the standard suite, the LAN HTTP/mobile Control browser regression, and deployment configuration checks. Missing Playwright or browser binaries fail the gate; do not skip it. This command does not deploy or contact the production game.

## Prerequisites

1. Create an Ubuntu 24.04 LTS Droplet with an SSH key.
2. Add a Cloudflare DNS `A` record such as `game.example.com` pointing to the Droplet IPv4 address.
3. Set Cloudflare SSL/TLS mode to `Full (strict)` and keep WebSockets enabled.
4. During first certificate setup, DNS-only mode is the simplest. Enable the Cloudflare proxy only after HTTPS and preflight pass, then run preflight again.

## First Deployment

SSH into the Droplet as `root`, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/vbnmzxc9513/lucky_happy/main/deploy/bootstrap-ubuntu.sh -o bootstrap-ubuntu.sh
DOMAIN=game.example.com STAFF_ACCESS_CODE=1009 bash bootstrap-ubuntu.sh
```

The script installs Node.js 22, Caddy and native dependencies; clones the repository; checks dependency advisories; runs `npm test`; creates a random session secret; configures systemd and UFW; validates HTTPS; and runs the 13-item public preflight.

The command intentionally fails when DNS, HTTPS, tests, environment variables, or health checks are not ready. `SKIP_PUBLIC_CHECK=1` is available only for setup before DNS propagation; rerun without it before considering the deployment complete.

## Updating

Push and test changes locally first. Then rerun the same bootstrap command. It only accepts a clean fast-forward update and preserves the existing session secret.

Do not edit maps or quizzes in the production admin screen after the release is frozen. Those files belong in Git, and server-side edits can block the next fast-forward update.

Never update the server during the wedding. Finish the release and public load test at least two days earlier.

## Public Verification From Windows

From a second computer with this repository installed:

```powershell
.\deploy\verify-public.ps1 -Domain game.example.com
```

Run the full 150-player match and save a JSON report:

```powershell
.\deploy\verify-public.ps1 -Domain game.example.com -RunStress
```

## Useful Commands

```bash
systemctl status lucky-horse caddy
journalctl -u lucky-horse -f
journalctl -u caddy -f
systemctl restart lucky-horse
caddy validate --config /etc/caddy/Caddyfile
curl -fsS https://game.example.com/healthz
```

Production URLs:

- Guest: `https://game.example.com/guest/`
- Projection: `https://game.example.com/host/`
- Host control: `https://game.example.com/control/`
- Staff menu: `https://game.example.com/manage`

The local LAN server remains the disaster fallback. An in-progress cloud match is intentionally not restored after a process or WAN failure; return to the lobby and restart the single match.


## 最近 10 場成績快照

工作人員從 `/manage` →「本輪成績」進入 `/results/`，頁面與唯讀 `GET /api/match-results` 都重用 staff session 驗證，API 設定 `Cache-Control: no-store`。頁面先列勝隊完整成員，再列五隊排名與所有玩家卡片；可切換場次、隊伍篩選、只顯示勝隊、排序與下載單場 JSON／CSV。

正式遊戲第一次進入 `MATCH_FINISHED` 時，以 runId 冪等建立不可變快照；`ROUND_FINISHED` 不寫入。GameManager 注入 MatchResultStore，組裝由獨立 buildMatchResult 負責。以 TeamManager.players 權威名單合併遷移後的 playerStats，包含零操作與斷線玩家，不以獎項排行榜充當名單。零操作統計為 0；未作答數為當場題數減作答數，最低 0。四獎只保存允許的成績欄位，不保存 socket/session/request 識別或 receipts。

schemaVersion 為 1，頂層包含 updatedAt、matches；每場包含 id、finishedAt、map、questionCount、stageCount、winner、teams、players、awards。依 finishedAt 新到舊排序，只保存最近 10 場。Reset 清除當輪狀態、玩家與計時器，不刪歷史；程序重啟讀回 JSON。

預設位置為專案 `data/runtime/match-results.json`（正式站 `/opt/lucky-horse/data/runtime/match-results.json`）。可用 `MATCH_RESULTS_FILE` 覆寫；建議使用絕對路徑並維持在 `/opt/lucky-horse/data`，沿用 systemd 可寫範圍。若另換目錄，維運必須同步調整 systemd ReadWritePaths、目錄擁有者、bootstrap 與部署檢查。目錄、JSON、暫存檔及 corrupt 備份含個資，不要把活動成績 commit 進 Git；runtime 目錄只有 .gitkeep 可追蹤。

寫入在相同目錄建立獨佔暫存檔，寫完並 fsync 後 rename 取代。損毀 JSON 先改名為 `.corrupt-時間戳-UUID.json` 備份；備份失敗時禁止覆寫原檔。錯誤記錄於伺服器，staff API 僅回傳安全狀態與錯誤碼，不回傳內部路徑。寫入失敗不阻止頒獎，當次程序仍可查記憶體快照，但尚未成功保存的紀錄可能在重啟後遺失；請立即下載此場並請維運處理。

部署必須保留 runtime JSON，勿使用會刪除忽略檔的清理命令。手動以 candidate 目錄切換部署時，先停止舊程序並複製或掛載原有 runtime 成績檔（含必要備份）、確認擁有者與可寫權限，再啟動新程序，避免遺失歷史。備份時停止服務，把 runtime 目錄複製到權限受限、位於部署目錄外的位置，確認可讀後恢復服務。若確需清除：先經活動負責人確認與完成上述備份，停止服務，再手動移走成績 JSON，啟動後為空紀錄；沒有前端清除按鈕。

驗證：`node tests/test-match-result-store.js` 使用 OS 暫存目錄驗證冪等、裁切排序、reset/restart、完整名單、重連、平手、資料隔離與故障保護。`npm run test:results-browser` 啟動本機隔離伺服器並使用暫存結果檔，驗證 staff HTTP 保護、完整勝隊名單、XSS、空狀態、平手、10 場切換、reset/reload、損毀警告及 390×844／320×568。已加入 `npm run test:predeploy`，不得跳過；Playwright 安裝方式見 README。測試不可寫入正式 runtime JSON。
