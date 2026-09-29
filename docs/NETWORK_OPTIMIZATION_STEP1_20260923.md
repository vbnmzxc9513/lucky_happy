# Network optimization step 1 and mobile-hotspot baseline

## Scope

Production is unchanged. Existing user edits in the deployment guide are retained.
The user supplied a mobile hotspot for this computer, then requested ONE public
test round only. No second round, new paid server or regional migration is authorized
by this test request.

## Step 1 implementation (local, not deployed to the baseline server)

- Finish notifications are role-specific. Staff retain the full award payload;
  guests get only the authoritative run/state envelope. The 190-player fixture
  requires a guest payload below 256 bytes, aggregate below 50,000 bytes, and
  below 1% of the equivalent full award payload per recipient.
- Successful answers retain request ID, run ID, quiz ID, chosen answer, correctness,
  response time and server receipt timestamp in the existing bounded operation
  ledger. Retries return the original result without making another receipt.
- Receipts follow the stable session when a socket reconnects. Active-question
  recovery returns only that guest's receipt. Another player cannot receive it
  through recovery. Reset clears receipts; these are in-memory, not crash-durable.
- The staff-only test accounting endpoint includes individual answer receipts.
  It remains disabled by default and in production mode.
- Stress reconciliation independently checks receipts against actual sent
  request IDs, run/quiz IDs, chosen answers and the test question answer key.
  Unknown, duplicate, stale, contradictory or missing receipts fail validation.
- A server-confirmed answer with a missing ACK is reported separately rather
  than rewriting ACK counts. Transport latency/loss gates remain unchanged.
- `--accountingMode ack` explicitly retains the prior ACK-only comparison for
  older servers; default `receipts` requires receipt-level evidence. This mode
  does not alter game traffic or waive connection/performance thresholds.

Validation: `reports/network-step1-confidence.log` passed `npm test`, including
the finish payload bound, receipt privacy/reconnect/reset cases, lost-ACK
reconciliation, corrupted receipt rejection, actual Socket.IO question recovery
and preflight 13/13. No full public load run of the step-1 server is claimed.

## Mobile test design

The remote server is the previous `network-v2` isolated application, not the new
step-1 application. Singapore VPS, TLS endpoint, 190 guests, 10 taps/s, 18 questions,
six stages and 19 forced reconnections are retained. This isolates the change in
access network more closely than deploying both code and network changes at once.

The SSH-observed source address changed from the prior network to the hotspot.
Node and Caddy are independent test processes on loopback 3998 / public 8443.
Only the hotspot source IP is allowed through the temporary firewall rule.
Production Node, Caddy, DNS and game state are not changed.

The generator and real Chromium observer use the same Windows computer and
hotspot. No concurrent local load run is started. The short confidence suite
completed before the game started. The load harness has received reporting and
receipt-mode changes since the previous run, and the time of day differs; this
is useful comparative evidence, not a perfectly controlled carrier experiment.

```powershell
node scripts/stress-wedding-game.js --url https://luckyhappy1009.com:8443 --clients 190 --tapRate 10 --answerRate 1 --reconnectClients 19 --enforceDuration --requireAccounting --accountingMode ack --progressMs 30000 --maxSeconds 540 --report reports/mobile-baseline190-20260923.json
```

Evidence prefix: `reports/mobile-baseline190-20260923`. Linux TCP counter
snapshots and one socket send-queue sample use `reports/mobile-baseline190-tcp-*`.
These kernel counters cover the whole VPS, not exclusively the game. Their
delta is not a direct measurement of end-to-end packet-loss probability.

## Acceptance and limits

Do not declare success before the complete game and renderer reports finish.
Record HTTP failures, transport errors and accounting differences separately.
Even a passing hotspot run would not prove that every carrier or the wedding
venue will work, nor imply that 190 guests should connect to one phone hotspot.

## Single-round result (2026-09-23 01:18-01:25, Asia/Taipei)

The real-time game and renderer gates passed. The aggregate stress verdict remains
FAIL because guest-page HTTP P95 exceeded the unchanged 250 ms gate. No second
public load round was started.

| Measurement | Mobile hotspot baseline |
| --- | ---: |
| Guests joined / selected | 190 / 190 |
| Completed duration | 423 seconds (7:03) |
| Tap requests / matched ACKs | 106,921 / 106,921 |
| Rule-accepted taps | 105,541 |
| Tap ACK P95 / P99 | 109.3 / 125.1 ms |
| Answers sent / accepted | 3420 / 3420 |
| Questions / summaries / awards | 18 / 6 / 4 |
| Deliberate reconnects / recovered | 19 / 19 |
| Unexpected disconnects / connection errors / system errors | 0 / 0 / 0 |
| ACK-based individual accounting | 190 checked, zero mismatches |
| Stress host update gap P95 / max | 43.2 / 86.2 ms |
| Chromium update gap P95 / max | 41.2 / 126.9 ms |
| Chromium frames within 25 ms | 100% of 3445 measured racing frames |
| Chromium page errors / disconnects | 0 / 0 |
| Guest HTTP P95 | 369.6 ms (FAIL, gate 250 ms) |
| Health HTTP P95 | 117.6 ms |
| Sampled server event-loop lag P95 / peak RSS | 20 ms / 113 MB |

All six tap windows measured 8.000 seconds, except one at 7.999 seconds. This
baseline used ACK-only accounting on the old isolated server, not the new receipt
audit. It does not resolve the earlier five lost-confirmation cases retroactively.

Compared with the previous network's r3 report, tap P95 fell from about 19,215 ms
to 109 ms, unexpected guest disconnects from nine to zero, and the Chromium
maximum update gap from 5811 ms to 127 ms. The VPS and game-server version stayed
the same. This supports investigating the previous access network/router/ISP
route ahead of assuming that the Singapore region itself cannot handle the game.
It does not identify which network segment was responsible, exclude time-of-day
effects, or establish performance on every mobile carrier or venue network.

The guest HTTP measurement includes connection setup and response-body transfer;
the health request follows it and may reuse a connection. The gap is not proof
of slow HTML execution or a specific TLS fault. A later small, isolated HTTP
timing check should distinguish DNS/TCP/TLS/first-byte/body and cold/warm requests,
without relaxing the current threshold.

## Community Wi-Fi low-traffic diagnosis

After returning to the community Wi-Fi, the read-only diagnostic sent 20 requests
per endpoint and mode at no more than one request per second. It did not open a
game socket, join, reset, restart or change production. Full samples are in
`reports/http-path-community-wifi-20260923.json`.

| Path and connection mode | Total P50 | Total P95 | Result against 250 ms |
| --- | ---: | ---: | --- |
| `/guest/`, new TCP/TLS connection | 348.3 ms | 407.0 ms | FAIL |
| `/healthz`, new TCP/TLS connection | 332.8 ms | 430.1 ms | FAIL |
| `/guest/`, reused connection | 97.2 ms | 117.0 ms | PASS |
| `/healthz`, reused connection | 94.5 ms | 128.4 ms | PASS |

For a new `/guest/` connection, TCP alone was about 103 ms at P50 and TLS added
about 122 ms at P50. The 9 KB HTML body added only a few milliseconds after the
first byte. The tiny `/healthz` response shows the same cold-connection pattern,
while both endpoints pass comfortably once the connection is reused. The evidence
therefore classifies the remaining cold-request delay as network round trips on
the Taiwan-to-Singapore path, not application rendering or Node response work.
This does not justify relaxing the 250 ms threshold or moving region before the
wedding venue and carrier paths are measured.

The production page waterfall (`reports/guest-page-load-community-wifi-20260923.json`)
also identified a separate, fixable transfer problem: all five hidden team PNGs
loaded on the login screen. They contributed about 1.71 MB to a 1.99 MB initial
transfer. The Google Fonts stylesheet was the next largest request at about 204 KB.
The production Caddyfile already enables zstd and gzip, so adding another proxy
compression layer is not indicated by this evidence.

## Step 2 local initial-load optimization

The local revision, which is not deployed, now:

- marks team-choice images lazy and asynchronous so the login screen does not
  fetch hidden team art;
- uses lossless WebP copies of the five PNGs after team selection, reducing their
  combined file size from about 1.71 MB to 0.95 MB;
- gives versioned static assets a one-day browser cache plus stale revalidation,
  while HTML remains `no-cache` so a new deployment is discovered immediately;
- adds an enforceable page-load audit with a 600 KB initial-transfer budget and
  a hard failure if a team image is fetched before team selection.

The WebP assets are pixel-identical to the PNGs after compositing transparency on
the game's mint background. Chromium validation in
`reports/guest-page-load-step2-local-final.json` transferred 350,894 bytes with
zero eager team images and zero resource failures, an approximately 82% reduction
from the currently deployed page waterfall. This local comparison is useful for
resource volume; it is not a public latency result because it bypasses Singapore
and the production reverse proxy.

The real-browser flow also passed at 390x844 and 320x568: join, team selection,
five authoritative taps, offline input lock, identity recovery, one confirmed
answer, and no page errors. The complete fast confidence suite passed, including
receipt isolation/retry/reset, operational regression, real Socket.IO recovery
and preflight 13/13.

The external font stylesheet is now the largest initial resource. It remains
asynchronous, cacheable for one day, and preserves the existing visual design;
this iteration intentionally does not replace it with system fonts without a
separate visual review.

Supplementary kernel counter delta (partial run, whole VPS): 842,150 incoming
segments, 883,019 outgoing segments, 5270 retransmitted segments, 244 lost
retransmits, 107 TCP timeouts. These include proxy/loopback/SSH traffic and are
not a measured game packet-loss rate. One established-socket sample had total
send queue 5082 bytes, maximum per socket 3578 bytes; it is not a peak-run bound.

## Cleanup

- Stopped `luckyhorse-network-mobile-baseline` and `luckyhorse-https-mobile`.
- Removed the hotspot-IP TCP 8443 firewall rule; 3998/8443/2020 listeners absent.
- Production Node/Caddy remain active with unchanged process IDs. Production
  health stayed MATCH_FINISHED with zero sockets, as observed before this run.
- No production reset, deployment, proxy reload or DNS change. The locally
  implemented step-1 optimization still needs its own public validation later.
