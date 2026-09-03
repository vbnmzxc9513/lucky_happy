# Wedding Day Runbook

The complete rehearsal checklist and evidence form is in `docs/WEDDING_OPERATION_TEST_PLAN.md`.

## One Week Before

1. Freeze questions, team names, awards, and track settings.
2. Run `npm run test:confidence` from the release commit.
3. Run the 150-client stress test from a second computer against the DigitalOcean URL.
4. Confirm the local LAN backup uses the same release commit and question data.

## One Hour Before

1. Connect the host computer by wired Ethernet when possible and keep it on AC power.
2. Disable sleep, automatic OS updates, and browser power saving for the event window.
3. Open the 16:9 host screen at 100% browser zoom and enter full screen.
4. Run the read-only production check:

```powershell
$env:SERVER_URL="https://YOUR_DOMAIN"
$env:STAFF_ACCESS_CODE="1009"
npm run preflight
```

The production process must set `PUBLIC_BASE_URL=https://YOUR_DOMAIN`. The preflight QR check fails when the generated guest URL is only `localhost` or `127.0.0.1`.

All preflight checks must pass and the reported state must be `LOBBY`. It must also report `max=50 players/team`, `sprint=540s`, and `deadline=600s`.

## Thirty Minutes Before

1. Scan the QR code with at least one iPhone and one Android phone.
2. Join different teams, lock and unlock both phones, then confirm they reconnect.
3. Confirm the projector shows the full QR code and all five team lanes without scrolling.
4. Click `啟用音效` once and confirm the ready chime is audible through the venue sound system.
5. Keep the DigitalOcean dashboard and a terminal ready, but do not deploy new code.
6. Confirm no team card can exceed 50 players; ask guests to choose another team when a card shows full.

## Emergency Actions

- A few phones disconnect: wait for automatic recovery; their team and statistics are retained.
- Host browser refreshes during a quiz: reopen `/host`; the current question and remaining time are restored.
- Internet venue failure: switch guests and host to the prepared local LAN server and restart the match.
- Node process or VPS restarts: current race state is held in memory and cannot be resumed; return to the lobby and restart the single match.
- Slow participation: let the built-in final sprint run. It starts at 9:00, preserves all 10 questions, and requests the leader decision at 10:00.

The local LAN backup is important because it covers venue or ISP failure, which application stress tests cannot prevent.
