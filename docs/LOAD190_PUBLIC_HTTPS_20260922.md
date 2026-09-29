# Public HTTPS 190-player retest

## Verdict

**FAIL / No-Go for this tested network path.** The isolated server completed its
schedule, but the client-side stress host did not receive completion within
nine minutes. This is not a successful 190-player end-to-end game.

## Scope

Test date: September 22, 2026 (Asia/Taipei).
Target: `https://luckyhappy1009.com:8443`, on the existing DigitalOcean server.
Caddy used a valid certificate and proxied to a separate Node process bound to
127.0.0.1:3998. No SSH tunnel carried test HTTP or WebSocket traffic. Firewall
access to the temporary port was restricted to the generator's public IP.
The normal HTTPS 443 production backend, game state, and app version were left
unchanged. Only the Caddy configuration was gracefully reloaded to add the
temporary listener. The isolated app uses commit `9537820`.

This validates an Internet/TLS/WebSocket path, but not the identical port 443
route. All simulated phones share one Windows machine and one Taiwan WAN/NAT
connection; it is not a geographically distributed 190-device mobile test.

## Attempts

1. Same join burst as the earlier test: 190 connections, one join every 8 ms,
   selection deadline 22.8 seconds. **FAIL** before game start: 190 sockets
   connected, 144 join acknowledgements, 46 team-selection acknowledgements.
   Zero taps. Evidence: `reports/load190-https.json`.
2. Diagnostic staggered joining: 190 connections, one join every 250 ms,
   selection deadline 180 seconds. Joined/selected successfully and started at
   08:30:39 after joining began at 08:29:38. Same 10 taps/second/player target,
   18 questions, six tap windows, and planned 19-player reconnect wave.
   The relaxed JOIN deadline is not a pass for attempt 1 and does not relax
   in-game latency thresholds. Evidence: `reports/load190-https-staggered.json`.

## Final staggered-run measurements

| Measurement | Result |
|---|---:|
| Joined / selected | 190 / 190 |
| Stress host completion observed | No; 540-second timeout |
| Unexpected disconnect events (not unique people) | 532 |
| Connection error events | 1,083 |
| Reconnected join acknowledgements (not unique people) | 401 |
| Planned 19-player drop wave actually executed | 0; host did not reach quiz 5 |
| Taps sent / ACKs received by report time | 123,212 / 62,502 |
| Successful tap ACKs | 6,706 |
| Answer submissions / accepted ACKs | 1,366 / 363 |
| Guest-page HTTP P95 | 12,380.7 ms |
| Health HTTP P95 | 10,232.9 ms |
| Sampled server event-loop P95 / RSS peak | 2 ms / 106 MB |

The generator's stale state meant it could continue tapping while the server
was already in a quiz. Therefore this was NOT a maintained 190-client,
58-second tapping workload comparable to the earlier successful loopback run.
Missing ACKs mean not observed by the deadline, not proof of lost score entries.
The raw tap latency P95 in the JSON must NOT be treated as accurate RTT:
the harness used a FIFO pending-tap queue spanning unexpected reconnections,
which can associate a later ACK with an earlier abandoned tap. Independent TCP
and HTTP measurements above establish the network problem without that figure.

## Projection assessment

The browser observer did receive MATCH_FINISHED. Its 8,839 sampled animation
frames were smooth (P95 18.2 ms; 100% <=25 ms; no window errors). However:

- Received-update P95: 45.6 ms, which looks acceptable in isolation.
- Received-update P99: 1,671.5 ms.
- Longest measured update gap: **12,187.2 ms**.
- **24** measured gaps exceeded one second.

This is a concrete counterexample to accepting P95 cadence and animation FPS
alone. Many packets arriving in bursts mask long stalls. The original observer
artifact says passed=true under its old P95-only gate; the overall network run
failed independently. The observer now additionally rejects update gaps above
one second. Raw data is unchanged; `reports/load190-https-assessment.json`
records the corrected interpretation. The observed 156 seconds of locally
"racing" animation also reflects delayed state delivery, not actual game timing.

## Network evidence

During joining, sampled TCP connections showed retransmissions, queued outgoing
bytes, and smoothed RTT around 700 ms despite minimum RTT around 86-186 ms.
A later sample showed approximately 5.7-6.2 second smoothed RTT and individual
send queues of 130-301 KB. Server event-loop samples stayed at 0-1 ms and RSS
around 91-103 MB. Connected-socket samples fell from 192 to 34, then recovered
to 127, indicating instability rather than a steady 190-player load.

Raw TCP/health evidence: `reports/load190-https-network-sample.txt`.
These observations do not prove whether the constrained segment is local
Wi-Fi/router/ISP, transit, or the server's network path. They do rule out
blaming only the previous SSH tunnel. Low server CPU/event-loop lag does not
establish network readiness.

## Follow-up priorities

- Reproduce from another WAN connection to distinguish path-specific problems.
- Measure and reduce fan-out: GameManager broadcasts five-team position updates
  to every socket; GuestHandler broadcasts joins/team changes/disconnections.
- Consider separate mobile/projection update rates and coalesced roster updates;
  keep authoritative answers, score acknowledgements and state transitions
  reliable. Test any changes separately before deploying.
- Test loss/reconnect behavior, avoiding stale position queues and reconnect
  broadcast storms. Verify on real phones and the venue network before Go.

No application optimization or production deployment is included in this retest.

## Reproduction

Use an isolated instance only: automatic mode resets its target.

```powershell
node scripts/stress-wedding-game.js --url https://luckyhappy1009.com:8443 --clients 190 --tapRate 10 --answerRate 1 --reconnectClients 19 --enforceDuration --report reports/load190-https.json
node scripts/stress-wedding-game.js --url https://luckyhappy1009.com:8443 --clients 190 --tapRate 10 --answerRate 1 --reconnectClients 19 --enforceDuration --joinIntervalMs 250 --joinTimeoutMs 180000 --report reports/load190-https-staggered.json
```

The temporary public port is not intended to remain available after testing.

## Cleanup and residual maintenance

- Restored the original Caddyfile byte-for-byte, removed the temporary firewall
  rule, and stopped `luckyhorse-load190`. No listeners remain on 8443 or 3998.
- Production `/healthz` over HTTPS still responds OK with MATCH_FINISHED and
  five existing sockets. The production Node process was not restarted.
- Caddy's restore reload entered an indefinite grace period and its admin
  endpoint stopped responding within five seconds. Systemd logged a reload
  timeout. The pending reload job was canceled without killing Caddy, but
  `ActiveState=reloading` / `SubState=reload-notify` remained. Port 443 continues
  serving; this is a residual maintenance issue, NOT a clean all-green rollback.
  A proxy restart in an approved idle window may be needed; it will interrupt
  WebSocket connections even though the Node game state stays intact. No such
  production proxy restart was performed during this test.
- `npm test` passed after the harness changes, including preflight 13/13.
