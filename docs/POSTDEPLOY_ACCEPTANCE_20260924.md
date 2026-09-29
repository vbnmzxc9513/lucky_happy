# Post-deployment acceptance, 2026-09-24 (Taipei)

## Deployment

- Released the tested local working tree to `/opt/lucky-horse` on the existing
  DigitalOcean Singapore VPS. Release archive SHA-256:
  `24db76bc49401d2a241b06849bf1ceddb9d6be1c807b87ede2c59b891bfbccea`.
- Preserved production `data/` and `/etc/lucky-horse.env`. The previous release
  remains at `/opt/lucky-horse-prev-20260923T1550` for rollback.
- Candidate server ran the full `npm test` suite and 13/13 local preflight
  before promotion. Production was `MATCH_FINISHED` with zero sockets before
  restart; after promotion it was a healthy empty `LOBBY`.
- Public `https://luckyhappy1009.com` passed 13/13 preflight. The public guest
  JavaScript hash matched the local release. Production was not used for the
  full-game load test.

## Isolated public HTTPS run

The same deployed release was copied into an isolated app at port 3998, behind
separate HTTPS port 8443, restricted to the generator's community-Wi-Fi source
IP. Diagnostics were enabled on that isolated instance only. One real Chromium
page at 390x844 and 189 Socket.IO clients completed one full game. Nineteen
bot connections were deliberately dropped and all recovered. The isolated
services and 8443 firewall rule were stopped and removed afterward. Production
remained a healthy empty lobby.

| Metric | Result |
| --- | ---: |
| Peak players / unexpected disconnects / system errors | 190 / 0 / 0 |
| Questions / three-question summaries / awards | 18 / 6 / 4 |
| Round duration | 7:04 |
| Forced reconnections restored | 19 / 19 |
| Bot tap sends / ACKs | 98,030 / 96,797 |
| Bot tap ACK P95 / P99 | 2,615.5 / 4,981.4 ms |
| Bot answers sent / accepted | 3,218 / 3,218 |
| Question 17 answers | 5 / 189 bots |
| HTTP `/guest/` P95 | 859.4 ms |
| Projector update P95 / maximum gap | 48.0 / 4,750.5 ms |
| Server event-loop P95 / peak RSS | 9 ms / 115 MB |
| Browser frame P95 / within 25 ms / worst | 16.8 ms / 99.88% / 66.7 ms |
| Browser count update P95 | 125.9 ms (30 measured changes) |

**Verdict: No-Go on this community-Wi-Fi path.** The browser renderer itself
was smooth, but a late network stall prevented most bots from participating in
question 17 and delayed many tap confirmations by seconds. The low server
event-loop lag and memory use do not suggest VPS CPU or RAM saturation. This
does not isolate a particular router, ISP hop or cross-border link. It also
does not represent 190 separate physical devices on the venue network.

Existing answer receipts reconciled all accepted answers. For taps, 76 of 189
bots had server totals exceeding their accepted ACK totals by 349 in aggregate;
the older test API did not retain per-tap receipts, so this run cannot prove
which of those request IDs were accepted after their ACK was lost. Do not call
the accounting gate passed. The browser observer sampled 30 displayed taps
against 31 server taps immediately when the *control* socket received match
finish; cross-socket delivery order may explain it, but the original run did
not wait for the guest's final state sync. Its raw result remains FAIL.

After this run, local test tooling was updated to wait up to 10 seconds for
the browser's final authoritative count and to record diagnostic-only accepted
tap request IDs. Unit tests cover missing ACK, duplicate receipt, reconnect
identity, reset, and final snapshot rendering. These later test-tool changes
were **not part of the release tested in this run** and were not used to
re-label this failed run.

Evidence: `reports/postdeploy-wifi190-20260923.json`,
`reports/postdeploy-browser-wifi190-20260923.json` and the browser PNGs.

## Next acceptance

Use the intended venue connection or a different mobile carrier, with real
phones and projector. First verify cold page load and quiz delivery under low
traffic. A later full 190-player run must show 18 usable questions (not merely
18 server events), zero per-player receipt mismatch, timely final count sync,
tap ACK P95 <=250 ms, projector P95 <=100 ms and maximum gap <=1 second.
Keep this community-Wi-Fi result as a failed baseline; do not claim wedding
readiness based only on unit tests or this network path.

## Subsequent production release, 2026-09-24

- At the user's request, promoted the local working tree to production after
  both local and VPS candidate `npm test` passed. This includes non-blocking
  guest input rendering and the later test-tool changes, but **not** a new
  190-player acceptance result.
- Release archive SHA-256:
  `83eab1d3fe08c7cf7c2b905f1f888999929aae8db1c407267c54b3077b4d9683`.
- Preserved production `data/` and `/etc/lucky-horse.env`. The immediately
  preceding release is retained at `/opt/lucky-horse-prev-20260924T1812`.
- Promoted only while production was `LOBBY` with one host-preview socket and
  no game in progress. The host socket was disconnected by the restart and
  should refresh its page.
- Public HTTPS preflight passed 13/13; production and Caddy are active and
  `/healthz` is healthy in an empty `LOBBY`. Public guest JavaScript SHA-256
  matched the promoted file, and the diagnostic-only endpoint returned 404.
- **Acceptance is still pending.** The previous community-Wi-Fi run remains
  a failed baseline. Wedding venue/mobile-network rehearsal and a separately
  approved isolated load test are still required before a 190-player Go call.
