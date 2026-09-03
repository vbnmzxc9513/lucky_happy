# DigitalOcean Production Deployment

Lucky Horse requires a Node.js server because the game uses Express and Socket.IO. The production path is Cloudflare DNS, Caddy HTTPS, and a DigitalOcean Ubuntu Droplet. Port 3000 stays private on the Droplet.

## Prepared Architecture

```text
Phone -> https://game.example.com -> Cloudflare -> Caddy :443 -> Node 127.0.0.1:3000
```

Repository deployment files:

- `bootstrap-ubuntu.sh`: idempotent first install and update command.
- `Caddyfile.example`: automatic HTTPS and WebSocket reverse proxy.
- `lucky-horse.service`: systemd process supervision and service hardening.
- `lucky-horse.env.example`: production environment reference.
- `verify-public.ps1`: preflight and optional 150-player verification from Windows.

## Prerequisites

1. Create an Ubuntu 24.04 LTS Droplet with an SSH key.
2. Add a Cloudflare DNS `A` record such as `game.example.com` pointing to the Droplet IPv4 address.
3. Set Cloudflare SSL/TLS mode to `Full (strict)` and keep WebSockets enabled.
4. During first certificate setup, DNS-only mode is the simplest. Enable the Cloudflare proxy only after HTTPS and preflight pass, then run preflight again.

## First Deployment

SSH into the Droplet as `root`, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/vbnmzxc9513/lucky_happy/main/deploy/bootstrap-ubuntu.sh -o bootstrap-ubuntu.sh
DOMAIN=game.example.com STAFF_ACCESS_CODE=1009 bash bootstrap-ubuntu.sh
```

The script installs Node.js 22, Caddy and native dependencies; clones the repository; checks dependency advisories; runs `npm test`; creates a random session secret; configures systemd and UFW; validates HTTPS; and runs the 13-item public preflight.

The command intentionally fails when DNS, HTTPS, tests, environment variables, or health checks are not ready. `SKIP_PUBLIC_CHECK=1` is available only for setup before DNS propagation; rerun without it before considering the deployment complete.

## Updating

Push and test changes locally first. Then rerun the same bootstrap command. It only accepts a clean fast-forward update and preserves the existing session secret.

Do not edit maps or quizzes in the production admin screen after the release is frozen. Those files belong in Git, and server-side edits can block the next fast-forward update.

Never update the server during the wedding. Finish the release and public load test at least two days earlier.

## Public Verification From Windows

From a second computer with this repository installed:

```powershell
.\deploy\verify-public.ps1 -Domain game.example.com
```

Run the full 150-player match and save a JSON report:

```powershell
.\deploy\verify-public.ps1 -Domain game.example.com -RunStress
```

## Useful Commands

```bash
systemctl status lucky-horse caddy
journalctl -u lucky-horse -f
journalctl -u caddy -f
systemctl restart lucky-horse
caddy validate --config /etc/caddy/Caddyfile
curl -fsS https://game.example.com/healthz
```

Production URLs:

- Guest: `https://game.example.com/guest/`
- Projection: `https://game.example.com/host/`
- Host control: `https://game.example.com/control/`
- Staff menu: `https://game.example.com/manage`

The local LAN server remains the disaster fallback. An in-progress cloud match is intentionally not restored after a process or WAN failure; return to the lobby and restart the single match.
