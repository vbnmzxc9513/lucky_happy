# Revised public HTTPS acceptance and Wi-Fi diagnosis

Date: 2026-09-23, Asia/Taipei. The load generator and Chromium projector ran on
one Windows computer connected to community Wi-Fi (`Xiaomi_376B_5G`). The game
ran on an isolated Node process at `127.0.0.1:3998`, reached through an
independent Caddy HTTPS listener on port 8443. Production Node, Caddy, DNS and
game state were not changed. The isolated endpoint and its IP-limited firewall
rule were removed after this single full round.

## Result

**FAIL against the existing latency gates; game completion and accounting PASS.**
Do not describe this as a successful 190-player public acceptance run.

| Measurement | Result | Gate |
| --- | ---: | ---: |
| Joined / selected | 190 / 190 | 190 / 190 |
| Game duration | 7:04 | 6:55-7:25 |
| Questions / stage summaries / awards | 18 / 6 / 4 | 18 / 6 / 4 |
| Tap windows | 6 x 8.00 s | 6 x 8 s |
| Tap requests / matched ACKs | 105,806 / 105,806 | Equal |
| Tap ACK P95 / P99 | 458.9 / 627.5 ms | P95 <=250 ms: FAIL |
| Answer submissions / accepted | 3420 / 3420 | All |
| Deliberate reconnects / recovered | 19 / 19 | All |
| Unexpected disconnect / connection / system errors | 0 / 0 / 0 | Zero |
| Per-player receipt reconciliation | 190 checked, zero mismatches | Zero |
| Guest-page HTTP P95 | 905.9 ms | <250 ms: FAIL |
| Health HTTP P95 | 139.6 ms | <500 ms |
| Generator host updates P95 | 66.7 ms | <=100 ms |
| Chromium projector updates P95 / max gap | 67.5 / 425.8 ms | <=100 / <=1000 ms |
| Chromium frames within 25 ms | 99.97% | >=95% |
| Server event-loop lag P95 / peak RSS | 28 ms / 114 MB | <50 ms / <512 MB |

Evidence: `reports/revised-acceptance190-20260923.json`,
`reports/revised-acceptance190-20260923-renderer.json`. The revised guest page
also passed a separate public HTTPS read-only load audit: 279,845 initial bytes,
zero eager team images and zero resource failures. The browser's observed load
event took 1.22 s on this path (`reports/revised-acceptance-guest-page-load-20260923.json`).

The server attempted about 99.4 MB of serialized outbound Socket.IO payloads
over the 424-second game: approximately 1.88 Mbit/s averaged across the entire
190-player simulation. About 87.9 MB targeted guests and 8.1 MB the projector
role. This counter is before WebSocket framing, TLS, compression, retransmission
and network overhead; it is **not** a measured NIC throughput. The Windows Wi-Fi
adapter's rough during-run byte delta was about 119 MB received and 36 MB sent,
but includes unrelated machine traffic. Average application throughput alone
cannot rule out short queues, competing users or route congestion.
The 1.88 Mbit/s serialized average is about 25% of the one-time 7.5 Mbit/s
FAST.com download result. The projector-role share was about 0.15 Mbit/s.

## Local network check

One official FAST.com browser run after the game measured **7.5 Mbit/s down,
19 Mbit/s up, 14 ms unloaded latency and 992 ms loaded latency**. FAST.com
uses Netflix's distributed servers; these numbers measure this computer's
current access connection, not the DigitalOcean path. The page remained open
for the owner to inspect. Source: https://fast.com/zh/tw/.

Windows reported a 5 GHz 802.11ac Wi-Fi association with 80% signal and
260-292.5 Mbit/s negotiated link rate. That association rate is not Internet
capacity. During FAST.com's load, ten pings to the local gateway ranged from
1 to 65 ms (28 ms average). After the speed test ended, 20 gateway pings were
1-10 ms (2 ms average), and 20 pings to the Singapore VPS were 86-98 ms
(90 ms average), with no loss in either idle series.

The near-one-second loaded latency and the 459 ms tap ACK P95 under the game
load show substantial queuing on this community connection. The larger delay
than local-gateway ping suggests that most of the queue lies at the router's
WAN side, ISP or onward path, but these samples cannot isolate the exact hop.
FAST.com's 992 ms loaded latency is about 71 times its 14 ms unloaded reading.
The server's low event-loop lag and RSS, clean receipt totals, and smooth
projector cadence do not point to an overloaded Node process. A prior
single-round run from this same computer on a phone hotspot, using the same VPS
and game workload, measured 109 ms tap ACK P95 and no disconnects. It used the
previous isolated app revision, so it is strong comparative network evidence,
not a perfectly controlled A/B trial.

The 190 simulated guests shared one computer and one Wi-Fi/WAN path. Actual
guests on separate 4G/5G connections would distribute that traffic across many
access networks. This test cannot establish their aggregate wedding experience,
nor should its failure be dismissed without venue and carrier checks.

## Practical resolution

1. Keep the Singapore VPS for now. The idle 90 ms Singapore RTT and the passing
   phone-hotspot game show no evidence that a new server region is required.
2. Give the projector and host-control computer a dedicated wired venue uplink
   or a proven phone hotspot. Do not use this community Wi-Fi as the sole live
   game uplink. Have the second connection ready before guests scan the QR code.
3. Ask guests to use their own 4G/5G where practical. If venue Wi-Fi is needed,
   verify its loaded latency and capacity with several real phones before the
   event; do not infer readiness from the 260 Mbit/s Wi-Fi association rate.
4. If this Xiaomi/community line must carry live game traffic, enable router
   SQM/queue management where available and initially cap the measured line to
   about 6 Mbit/s down and 15 Mbit/s up (roughly 80% of this one FAST.com run).
   Re-measure loaded latency, because the actual bottleneck rate changes with
   time and other users. A simple priority toggle without queue management is
   not an established fix.
5. At venue rehearsal, measure unloaded/loaded latency, run three physical
   phones on distinct access networks and check QR, reconnect and audio. A
   future full 190-player public run should use at least two independent WAN
   generators. The unchanged 250 ms HTTP gate also requires an explicit
   decision: even idle cold TCP/TLS connections to Singapore measured
   407-430 ms P95 from this access path. Meeting <250 ms for first connections
   would require an edge/closer HTTP endpoint or different measurement scope;
   this report does not silently relax the threshold.

The existing guest initial-load reduction and browser caching mitigate opening
time. They cannot remove access-network queuing during rapid WebSocket play.

## Cleanup

Stopped `luckyhorse-acceptance-node` and `luckyhorse-acceptance-https`, removed
the source-IP TCP 8443 firewall rule, and confirmed no listeners on 3998,
8443 or 2020. Production Caddy/Node remained active; production health was
`MATCH_FINISHED` with zero connected sockets. The isolated test directory remains
on disk, but is not serving traffic.

## Same-revision phone-hotspot comparison

Later on 2026-09-23, the user switched this Windows generator from community
Wi-Fi to a Samsung S25 Ultra hotspot. The VPS observed the source address change
from `180.177.202.9` to `27.53.24.108`. We reused the exact same isolated
application files, certificate, Node/Caddy ports, 190-client generator, 10
taps/second/client target, 18 questions, 19 deliberate reconnections and
Chromium projector observer. No production service was restarted or deployed.

The read-only HTTPS diagnosis before the full game gave a cold `/guest/` P95 of
346.2 ms on the hotspot, versus 407.0 ms on community Wi-Fi. Reused-connection
P95 was 126.8 ms versus 117.0 ms respectively. The cold connection still
exceeds the existing 250 ms HTTP gate on both networks.

| Measurement | Community Wi-Fi | Phone hotspot |
| --- | ---: | ---: |
| Guests joined | 190 / 190 | 190 / 190 |
| Duration | 7:04 | 7:02 |
| Approximate tap rate | 249.5/s | 252.0/s |
| Tap requests / matched ACKs | 105,806 / 105,806 | 106,340 / 106,340 |
| Tap ACK P95 / P99 | 458.9 / 627.5 ms | 113.7 / 166.4 ms |
| 18 questions / six summaries / four awards | Complete | Complete |
| Answer submissions accepted | 3420 / 3420 | 3420 / 3420 |
| Forced reconnects restored | 19 / 19 | 19 / 19 |
| Unexpected disconnects / system errors | 0 / 0 | 0 / 0 |
| Receipt accounting | 190 checked, zero mismatch | 190 checked, zero mismatch |
| HTTP `/guest/` P95 under load | 905.9 ms | 374.1 ms |
| Projector update P95 / max gap | 67.5 / 425.8 ms | 43.1 / 121.3 ms |
| Server event-loop lag P95 / peak RSS | 28 ms / 114 MB | 11 ms / 116 MB |
| Attempted serialized server output | 99.38 MB | 99.18 MB |
| FAST.com down / up after run | 7.5 / 19 Mbit/s | 92 / 25 Mbit/s |
| FAST.com unloaded / loaded latency | 14 / 992 ms | 31 / 313 ms |

The hotspot reduced tap ACK P95 by about fourfold while game load, server
version, total serialized output and accounting were closely matched. This is
strong evidence that the community access path, under this traffic pattern,
caused the excessive real-time delay. Both FAST.com tests were single samples
after their respective games and used Netflix endpoints, not the Singapore
VPS. They support the access-path diagnosis but do not identify a particular
router/ISP hop. Time of day and mobile/ISP routing also differed; this is a
controlled practical comparison, not a laboratory isolation of each link.

The hotspot run **passed real-time gameplay, projector and accounting gates**,
but the aggregate harness verdict remains **FAIL** because the unchanged
`/guest/` HTTP P95 <250 ms gate measured 374.1 ms. Do not relabel the entire
run as PASS. A Singapore origin reached via a fresh TCP/TLS connection already
costs roughly 300-350 ms on this hotspot before game load. Improving that
first connection requires an edge/closer HTTP endpoint or a revised acceptance
definition, neither of which was applied here.

Evidence: `reports/http-path-hotspot-20260923.json`,
`reports/revised-hotspot190-20260923.json`, and
`reports/revised-hotspot190-20260923-renderer.json`. FAST.com results were read
from the actual Chrome tab on this Windows computer and left open for the user.

The hotspot test services and the source-IP 8443 firewall rule were stopped
and removed. Production Caddy/Node remained active, production state stayed
`MATCH_FINISHED` with zero sockets, and no test port remained listening.

## Focused player-screen test on phone hotspot

A separate isolated HTTPS run on 2026-09-23 used 189 simulated guests plus one
real Chromium player page at a 390x844 viewport. It completed 18 questions,
six summaries and four awards with 190 total players. All 19 forced bot
reconnections recovered; bot receipt accounting had no mismatches. There were
no unexpected disconnects, connection errors, server errors or page errors.

The browser observed seven racing windows and 3,546 animation frames. Frame
interval P95 was 18.7 ms and 98.0% of frames were within 25 ms, with a worst
single interval of 239.6 ms. The local press animation was requested in the
same event turn (P95 0.2 ms from pointer event); this measures scheduling, not
light reaching the display. The server-confirmed tap counter changed at P95
190.2 ms. The page displayed 30 taps, and a separate staff-accounting query
confirmed 30 taps for the same player. No browser errors were recorded.

The browser observer's raw `passed: false` and `serverTapCount: null` were a
test-script lookup error: the script queried its original nickname after the
guest input truncated it to 12 characters. The script was corrected to use
the actual 12-character nickname. The original report was not rewritten;
the independent accounting check is the evidence for the 30/30 match.

The companion bot run had tap ACK P95/P99 231.6/580.9 ms, and the projector
update maximum gap was 1.327 seconds. HTTP `/guest/` P95 was 850.8 ms, above
the unchanged 250 ms gate, so the **whole run remains FAIL**. These spikes
mean occasional visible delay is possible even though the player screen was
mostly smooth. This was desktop Chromium with a mobile viewport, not a physical
phone or the venue network; older-device rendering and Wi-Fi behavior still
need a real-phone rehearsal.

Evidence: `reports/guestframe-browser-hotspot190-20260923.json`,
`reports/guestframe-hotspot190-20260923.json` and the corresponding racing and
quiz PNG screenshots. The isolated services and 8443 firewall rule were removed
after this run; production stayed active and unchanged.
