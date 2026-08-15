# Race Pacing

Default mode is one decisive round. The target runtime is about 7 minutes:

- Countdown: 3 seconds
- Quiz checkpoints: 3 questions
- Each quiz: 3 seconds prepare + 10 seconds answer + 3 seconds result
- Final transition: 5 seconds
- Racing movement budget: about 364 seconds

The server adjusts the current track length at round start using the actual player distribution. The estimate assumes about 5 taps per second per player and uses the fastest/largest team as the pacing reference, so the leading team should reach the finish near the target runtime.

Run the estimator:

```bash
node scripts/estimate-race-pacing.js
```

Useful rehearsal counts:

```bash
node scripts/estimate-race-pacing.js 50 100 150 200
```

Baseline estimates:

| Players | Per team | Auto track | Auto total | Fixed 104000 total | Questions |
|---:|---:|---:|---:|---:|---:|
| 30 | 6 | 49,081 | 7:00 | 14:32 | 3 |
| 50 | 10 | 62,053 | 7:00 | 11:26 | 3 |
| 80 | 16 | 77,300 | 7:00 | 9:14 | 3 |
| 100 | 20 | 85,893 | 7:00 | 8:20 | 3 |
| 150 | 30 | 104,186 | 7:00 | 6:59 | 3 |
| 200 | 40 | 119,607 | 7:00 | 6:11 | 3 |
