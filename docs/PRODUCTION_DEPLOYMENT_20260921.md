# Production deployment verification - 2026-09-21

Public site: https://luckyhappy1009.com

- DigitalOcean Singapore, Ubuntu 24.04, 2 vCPU / 2 GB RAM.
- Cloudflare proxied apex A record; SSL mode Full (strict).
- Caddy HTTPS and HTTP-to-HTTPS redirect; systemd startup/restart enabled.
- Node binds to 127.0.0.1:3000; UFW allows SSH and HTTP/HTTPS.
- Application release tested: b53d2d4. Later stress-tool-only update: 0bc6aaa.
- Local npm test passed; public preflight passed 13/13 after the load test.

## Complete cloud load test

The generator ran on the Droplet and connected through the public Cloudflare
HTTPS/WebSocket endpoint. This exercises the proxy and application, but does
not represent 150 independent mobile devices or the venue network.

| Metric | Result |
| --- | --- |
| Joined and selected a team | 150/150 |
| Forced disconnects recovered | 15/15 |
| Questions / settlements / awards | 18 / 6 / 4 |
| Tap windows | Six, each 8 seconds |
| Match duration including transition | 349 seconds |
| Accepted answers | 2643/2643 sent |
| Unexpected disconnects / system errors | 0 / 0 |
| Guest HTTP P95 | 101.1 ms |
| Host update interval P95 | 43.7 ms |
| Event loop delay P95 | 5 ms |
| Peak Node RSS | 101 MB |

Raw report: reports/public-150-cloud-20260921.json (local, Git-ignored).

## Outstanding venue verification

The Windows-origin 150-client public readiness test timed out: 150 connected,
62 join acknowledgements and 9 team confirmations received within its window,
while the host observed 150 players. A 30-client run from Windows and a
150-client run from the Droplet both passed. The cause of the Windows-path
delay remains unconfirmed; waiting for the join acknowledgement before team
selection did not resolve it. Do not claim this proves venue network readiness.

Use real iPhone/Android devices on the venue network to rehearse QR entry,
background/reconnect, projection/audio, a complete match, and LAN fallback.
190 concurrent players have not been validated by this deployment test.

## Entry points

- Guests: https://luckyhappy1009.com/guest/
- Projection: https://luckyhappy1009.com/host/
- Presenter: https://luckyhappy1009.com/control/
- Staff menu: https://luckyhappy1009.com/manage

Only the apex hostname was configured; www is not configured.
