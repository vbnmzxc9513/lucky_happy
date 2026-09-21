# Player Accounting Confidence Tests

Run `npm run test:accounting` from the repository root. These tests also run in
`npm test`. They use the production game managers with virtual time, isolated
players and fixed question fixtures. They never connect to or reset production.

## Independent Ledger

For each player, the test records planned actions, timestamps, stable identity,
team, socket migration, acknowledgements, rejected actions, accepted taps,
critical taps, answered/correct/wrong counts and answer latency. Expectations
come from the action schedule rather than copying server counters.

After each question, compare server counters with the independent ledger.
After each stage, check majority results and reward distance. At completion,
compare the full individual award rankings and winners, not only the number
of awards. Check reset removes players, statistics and pending game flow.

Accounting rules:

- Attempted taps are not accepted taps. Cooldown and wrong-phase taps must not count.
- Correct plus wrong equals accepted answers. Skipping is not an individual wrong answer.
- Accepted answers plus skipped questions equals 18 for these full-match participants.
- Rejected, duplicate, invalid, expired and paused answers must not alter statistics.
- Reconnecting retains identity and the answer lock, without duplicating statistics.
- Answer latency excludes paused time.
- Team answers use submitted votes; ties and no votes are incorrect for the team.
- Stage rewards for 0/1/2/3 correct answers are 0/1500/3000/6000 distance, paid once.
- Individual correct/wrong ties use average latency across all accepted answers,
  then join time. Skippers cannot win the wrong-answer award.

## Scenarios

| Scenario | Players | Behavior |
| --- | --- | --- |
| Mixed | 150 | Correct, incorrect, skipped, tied team votes, variable taps |
| Mixed | 190 | Same independent accounting at larger player count |
| Silent | 150 | No accepted taps or answers; no fictitious correct/wrong winner |

All scenarios execute six tap stages, 18 answers/reveals, six settlements,
final sprint, four awards and reset. Mixed scenarios reconnect players after
an accepted answer and attempt another answer from both old and new sockets.

## Evidence

Generated files in `reports/accounting/` (ignored by Git):

- `150-mixed.json`, `190-mixed.json`, `150-silent.json`: action-by-action evidence,
  expected/actual statistics, team results, awards and failure stack if any.
- Matching `.csv` files: one row per player for quick comparison in Excel.

Reports are overwritten on the next run; archive them separately for a rehearsal.
The CSV `passed` value is the scenario result, not an assertion that every row
was reached after a failure. Missing actual values indicate an unfinished check.
`unansweredExpected` is independently calculated because the server does not
maintain a separate unanswered counter. Generated identities are synthetic.

## Boundaries and Additional Rehearsal Variables

This is not a persistent production action log or network load test. Physics is
disabled so reward-distance reconciliation is exact and independent of race
movement. Use existing Socket stress and operations tests for actual transport,
movement, capacity, team changes/full teams, join races, item effects and stun.
Also rehearse disconnect-before-answer, packet loss, device backgrounding,
refresh, deadline-boundary submissions, operator reset and server restart.
For each real rehearsal record app version, question-set version, configuration,
player/session identity, phase, server timestamps, rejection reasons and final
awards. Avoid collecting device identifiers or unnecessary personal information.

A green run proves these deterministic scenarios, not all possible user actions
or wedding venue connectivity. Any counter discrepancy or incorrect award is
a release blocker; retain the failing JSON before rerunning.
