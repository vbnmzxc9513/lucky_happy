# Race Pacing

Default mode is one decisive round. The formal show now uses 10 quiz checkpoints. The pacing model targets about 6:30, which usually lands closer to 7-8 minutes in full stress tests because real answer penalties and pauses add overhead:

- Countdown: 3 seconds
- Quiz checkpoints: at least 10 questions
- Each quiz: 3 seconds prepare + 10 seconds answer + 3 seconds result
- Final transition: 5 seconds
- Racing movement budget: about 228 seconds

The server adjusts the current track length at round start using the actual player distribution. The estimate assumes about 5 taps per second per player and uses the fastest/largest team as the pacing reference, so the leading team should reach the finish near the target runtime.

Each team accepts at most 50 players. If the round reaches 9:00, final sprint mode clears active stuns, doubles tap acceleration, and begins scheduling any remaining checkpoints needed to preserve all 10 questions. At 10:00, the current leader finishes as soon as every formal checkpoint has been presented; an exact position tie remains a team tie.

Run the estimator:

```bash
node scripts/estimate-race-pacing.js
```

Useful rehearsal counts:

```bash
node scripts/estimate-race-pacing.js 50 100 150 200
```

Baseline estimates:

| Players | Per team | Auto track | Auto total | Fixed 76000 total | Questions |
|---:|---:|---:|---:|---:|---:|
| 30 | 6 | 42,924 | 6:30 | 11:02 | 10 |
| 50 | 10 | 51,050 | 6:30 | 9:08 | 10 |
| 80 | 16 | 60,600 | 6:30 | 7:47 | 10 |
| 100 | 20 | 65,982 | 6:30 | 7:14 | 10 |
| 150 | 30 | 77,440 | 6:30 | 6:25 | 10 |
| 200 | 40 | 87,100 | 6:30 | 5:55 | 10 |
