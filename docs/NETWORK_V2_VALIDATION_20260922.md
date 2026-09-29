# Network protocol v2: implementation and validation

## Scope and rollout boundary

Target: 190 guests, primarily separate 4G/5G connections, with a stable projector
connection. Scoring, critical taps, six stages, 18 questions, eight-second tap
windows and individual award rules are unchanged. No production deployment is
included. Old clients must refresh after a coordinated server/client deployment;
the server rejects clients without `protocolVersion: 2` rather than silently
accepting incompatible inputs.

## Implemented delivery changes

- Authenticated roles receive separate streams: host about 30 Hz; guests at most
  5 Hz, only their own team's position/rank; control/admin at most 2 Hz.
- Position and heartbeat messages are volatile. State transitions, question
  options/results, award events and input acknowledgements remain reliable.
- Roster and question-progress bursts are coalesced over 250 ms. Guests no longer
  receive the full roster, active item list, full config or admin question bank.
- Tap receipts contain authoritative personal counts instead of a full status
  snapshot. Server distance remains the sole scoring authority.
- Operations carry request/run/state identifiers. Repeated requests return the
  original result; conflicting IDs and stale operations do not execute again.
  Answer receipts survive session reconnection. Reset clears the operation cache.
- Phones stop input offline or after three seconds of stale authoritative data.
  Reconnection requires identity and state recovery. Taps are never replayed;
  an unconfirmed answer retries the same ID at most twice, within the deadline.
- The projector freezes stale racing presentation and requests resynchronization.
  Browser back/forward-cache recovery reloads the phone to restore its timers.

## Measurement safeguards

The stress client matches ACK latency by request ID and run ID, never FIFO. Its
report separates sent, acknowledged, accepted, rejected, missing and abandoned
requests per player. Missing ACKs mean uncertainty, not proof of lost scoring.
An accounting mismatch therefore blocks acceptance but needs investigation before
being described as a scoring bug.

`--requireAccounting` requires a staff-authenticated, isolated-server diagnostic
endpoint. Enable `ENABLE_TEST_DIAGNOSTICS=1`; it is disabled when `NODE_ENV` is
`production`. Accepted client operations are compared against each player's
server tap/answer/correct/wrong totals. HTTP probes have bounded timeouts and do
not overlap. Clock-offset tracking prevents delayed heartbeats from extending
input deadlines in the stress generator.

`NETWORK_METRICS=1` counts attempted serialized event bytes and recipients by
role/event. It does not measure actual NIC/TLS traffic or prove delivery of
volatile events. No claim of a measured total-bandwidth reduction percentage is
made without a comparable baseline.

## Evidence so far

| Run | Result | Limits |
| --- | --- | --- |
| Early-v2 localhost 190 + 19 reconnects | Passed: 18 questions, six summaries, four awards, 3420 answers | Predates own-team-only streams and final accounting endpoint |
| Early-v2 public HTTPS 190 | Failed: 192 unexpected disconnect events, 410 connection errors; harness timed out | These are event counts, not unique people |
| Early-v2 real Chromium projector | Rendering passed; network cadence failed | Max update gap about 9.87 seconds, max silence about 13.41 seconds |
| Protocol delivery/client regression | Passed | Automated fixtures, not physical devices |
| Real Chromium phone 390/320 px | Passed: five confirmed taps, offline lock, recovery, one answer, no page errors | Desktop browser emulation; not iPhone/Android hardware |
| Full fast confidence suite | Passed, including preflight 13/13 | Latest test additions must also pass before completion |

Early evidence files are preserved under `reports/network-v2-*`; subsequent runs
use separate `network-v2-r2-*` names so failed runs are not overwritten. Final
public-run results and cleanup status are recorded below after execution.

## Isolated HTTPS procedure

The test Node instance listens on loopback 3998. A separate Caddy process listens
on 8443 with a separate admin port and the existing certificate. The firewall
allows only the load-generator IP. Do not modify or reload production Caddy to
run this test. Automatic stress mode resets its target: never point it at a live
wedding game.

```powershell
node scripts/stress-wedding-game.js --url https://luckyhappy1009.com:8443 --clients 190 --tapRate 10 --answerRate 1 --reconnectClients 19 --enforceDuration --requireAccounting --report reports/network-v2-r2-https190.json
```

The real Chromium observer records frame spacing, update gaps, maximum silence,
relative data age and page errors. A good rendering FPS does not override bad
network cadence. Stress thresholds are not relaxed to make a failing run pass.

## Remaining acceptance gates

- Complete public normal/fault runs and 220-player headroom validation; repeat
  normal 190-player sessions before treating a one-off success as reliable.
- Use multiple external generators on genuinely different networks. This Windows
  generator sends all connections through one WAN and is not 190 mobile carriers.
- Rehearse with physical iPhone/Android phones, the venue projector and audio.
- Verify final rollout during an approved idle window, refresh every client and
  retain the previous complete server/client release for rollback.

## Public r2 result: failed

`reports/network-v2-r2-https190.json` and its renderer report preserve this run:

- 190/190 joined, 19/19 deliberate reconnects recovered, zero unexpected guest
  disconnect events and zero connection/system errors. The host disconnected once.
- Observed completion took 450 seconds. All 18 results, six summaries and four
  awards arrived, but only 3197 answers were acknowledged as accepted.
- 98,362 taps sent, 92,190 matched ACKs; ACK P95 11,289 ms. This is still a failed
  experience even though it is less disruptive than early-v2 mass disconnection.
- Renderer frame P95 16.8 ms and 99.96% of frames within 25 ms; maximum update gap
  5364 ms and one disconnection. Smooth local frames did not imply fresh data.
- Accounting endpoint timed out. `checked: 0` is not a successful reconciliation.
- HTTP probes in this run did not consume the complete response bodies and were
  not bounded. HTTP failure sentinels of 10,000 ms are not precise measured RTTs.
  The harness has been corrected before r3; r2 remains failed and is not discarded.

## Test-method boundaries for r3

R3 keeps the same public 190-player, 10-taps/s, 19-reconnect workload, and adds
bounded, fully consumed HTTP probes plus at most two same-ID answer retries.
The local 220-player/22-reconnect accounting run overlaps part of public r3 on
the same Windows generator. Local confidence/browser tests also ran there.
Therefore Windows-side frame/generator timings are not a dedicated-hardware
benchmark. The two game servers, states and player registries are separate.
Neither this setup nor loopback testing substitutes for distributed mobile WANs.

The stress report's recovery counter measures session/team restoration; the
browser and resilience tests check restored question/answer lock behavior.
There is not yet a per-device WAN recovery-latency distribution proving that
every guest resumed usable gameplay within ten seconds.

## Public r3 result: failed / No-Go

Evidence: `reports/network-v2-r3-https190.json` and
`reports/network-v2-r3-https190-renderer.json`.

- Completed in 436 observed seconds; 190 guests joined. There were nine
  unexpected disconnects affecting nine guests and 33 connection errors.
- Only 17 of the requested 19 deliberate drops were actually applied, because
  some targeted clients were already disconnected. The 26 recovery events
  include both deliberate and unexpected drops; they are not 26 unique guests.
- 98,572 taps sent, 97,997 matched ACKs, 40,938 confirmed accepted taps. ACK P95
  was 19,215 ms. Late/stale inputs were rejected rather than replayed into a
  subsequent phase, but this still represents unacceptable playing conditions.
- 3227 unique answer attempts, 2871 accepted ACKs, 1612 same-ID retries. An ACK
  count is not the authoritative server answer total when packets are missing.
- All 190 player totals were fetched for reconciliation; five mismatches remain.
  For example, Stress_001 had 14 accepted answer receipts but 15 server answers.
  These are unresolved receipt/accounting differences, not established proof of
  duplicate scoring. Do not mark them Pass or conceal them in an aggregate total.
- Server sampled event-loop lag P95 13 ms, peak RSS 114 MB; generator loop P95
  19.6 ms. Neither rules out network-path or queuing bottlenecks.
- Renderer P95 frame interval 16.8 ms, 99.98% within 25 ms; update P95 124.3 ms,
  maximum gap 5811 ms, relative data age P95 9081 ms. Renderer passed; freshness
  failed. Stress-host update max gap was 6859 ms (a separate observer).
- Idle HTTPS probe after load: TCP about 117 ms, TLS complete about 354 ms,
  first byte about 448 ms. DNS resolved directly to 167.172.95.75, with no AAAA
  record returned. These observations do not establish a single root cause.

The proposed acceptance gates are NOT all complete. Three passing independent
WAN runs and a 220-player public-WAN run are not available. Larger live-path
testing has not been substituted for fixing the failed 190-player acceptance.

## Final cleanup

### Local 220-player accounting: passed

`reports/network-v2-r3-local220.json`: 423 seconds, 220/220 joined, 22/22
deliberate reconnects restored, zero unexpected disconnects, connection errors
or system errors. All 120,039 tap requests received matched ACKs; 119,984 were
accepted under existing game rules. All 3960 answers were accepted, with 18
questions, six summaries and four awards. All 220 player tap/answer/correct/wrong
totals reconciled with zero mismatches.

Tap ACK P95/P99 9.8/18.7 ms; host update P95 47.0 ms and max gap 80.6 ms;
guest HTTP P95 11.1 ms; sampled event-loop lag P95 15 ms; peak RSS 141 MB.
This is Windows loopback accounting/capacity evidence, not DigitalOcean mobile
network capacity. The local test Node process was stopped after completion.

### Cleanup and final checks

- Stopped the isolated Node and Caddy units; removed the IP-limited TCP 8443
  firewall rule. No listeners remained on 3998, 8443 or test-admin port 2020.
- Production Node and Caddy remained active/running, with the same process IDs.
  Production health remained MATCH_FINISHED with five sockets. No production
  restart, deployment, reset, DNS change or proxy reload was performed.
- New delivery/measurement tests: 12/12. Final `npm test` passed, including the
  explicit old-protocol rejection test and preflight 13/13.
- Final real Chromium phone check passed at 390/320 px, with five authoritative
  taps, one confirmed answer, offline/recovery checks and no page errors.

## Production proxy maintenance observation

The prior test's Caddy reload-notify condition subsequently cleared. On this
continuation, production Caddy and Node both report active/running. No production
proxy restart was performed to resolve it. This observation supersedes the open
maintenance concern in the original public-load report, not its failed load data.
