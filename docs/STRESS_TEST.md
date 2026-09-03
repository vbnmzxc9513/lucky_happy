# Stress Test

Run against a local server:

```bash
npm run stress -- --clients 150 --tapRate 5 --reconnectClients 15 --reconnectAtQuiz 5 --maxSeconds 600
```

## 真人主持混合彩排

由 147 個模擬玩家配合 3 支真實手機時，壓測程式只負責玩家行為，不自動重置或開始比賽：

```powershell
npm run stress -- --url https://YOUR_DOMAIN --clients 147 --manualHost --expectedTotalPlayers 150 --tapRate 5 --answerRate 0.98 --reconnectClients 15 --reconnectAtQuiz 5 --manualStartTimeoutSeconds 1800 --maxSeconds 720 --enforceDuration true --report reports/manual-host-150.json
```

看到 `READY` 後讓三支手機加入，再由 `/control/` 開始。結束時會留下 JSON 指標報表，且不會自動重置真人主持的畫面。

若只要快速確認模擬玩家能全部報到與選隊，而且工具不會自行開賽，可加上 `--readyOnly true`；驗證完成後模擬玩家會離線，伺服器仍保持在大廳。

Run against a deployed DigitalOcean server:

```bash
SERVER_URL=http://DROPLET_IP npm run stress -- --clients 150 --tapRate 5 --reconnectClients 15 --reconnectAtQuiz 5 --maxSeconds 600
```

PowerShell:

```powershell
$env:SERVER_URL="http://DROPLET_IP"
$env:STAFF_ACCESS_CODE="1009"
npm run stress -- --clients 150 --tapRate 5 --reconnectClients 15 --reconnectAtQuiz 5 --maxSeconds 600
```

Use `STAFF_ACCESS_CODE` when the deployed staff verification code is different from the local default.

## 2026-08-29 Full Confidence Result

Environment: local Windows machine, server and stress runner on the same machine, WebSocket transport.

| Clients | Tap Rate | Completed | Round Time | Forced Reconnects | Errors | Quiz Results | Host Gap P95 | Health P95 | Loop Lag P95 | RSS Peak |
|---:|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 150 | 5/sec/client | yes | 7:07 | 15/15 recovered | 0 | 10/10 | 34ms | 38ms | 3ms | 79MB |

Notes:

- 150 clients sent 196,116 tap events and all 150 joined one of the five teams.
- Quiz answer acknowledgements were 1,477/1,477 accepted; every quiz result retained the expected participant data.
- The 15 forced network drops happened during quiz 5; all 15 sessions recovered without losing the active quiz or accepting a duplicate answer.
- The match completed all four final awards with zero unexpected disconnects, connect errors, or system errors.
- The local runner adds extra load because it simulates all phones on the same machine, so deployed results may differ. Re-run this from another machine against the VPS before the event.

For the complete repeatable suite, including unit, UI-state, 30-client resilience, preflight, and the full match:

```bash
npm run test:confidence
```
