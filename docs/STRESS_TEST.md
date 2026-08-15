# Stress Test

Run against a local server:

```bash
npm run stress -- --clients 150 --tapRate 5 --maxSeconds 600
```

Run against a deployed DigitalOcean server:

```bash
SERVER_URL=http://DROPLET_IP npm run stress -- --clients 150 --tapRate 5 --maxSeconds 600
```

PowerShell:

```powershell
$env:SERVER_URL="http://DROPLET_IP"; npm run stress -- --clients 150 --tapRate 5 --maxSeconds 600
```

Use `ADMIN_USER` and `ADMIN_PASS` when the deployed admin credentials are different from local defaults.

## 2026-08-15 Local Results

Environment: local Windows machine, server and stress runner on the same machine, WebSocket transport.

| Clients | Tap Rate | Completed | Round Time | Disconnects | Errors | Quiz Results | Host Update Gap P95 | HTTP P95 |
|---:|---:|:---:|---:|---:|---:|---:|---:|---:|
| 150 | 5/sec/client | yes | 7:47 | 0 | 0 | 3/3 | 48ms | 24ms |
| 200 | 5/sec/client | yes | 7:48 | 0 | 0 | 3/3 | 48ms | 32ms |

Notes:

- 150 clients sent 299,851 tap events; 200 clients sent 399,069 tap events.
- Both runs completed final awards with 4 awards.
- The local runner adds extra load because it simulates all phones on the same machine, so deployed results may differ. Re-run this from another machine against the VPS before the event.
