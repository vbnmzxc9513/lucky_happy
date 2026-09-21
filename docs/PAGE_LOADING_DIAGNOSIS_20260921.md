# Page Loading Diagnosis, 2026-09-21

Frontend improvement deployed as commit `213f42a` without restarting the game:

- Defer offscreen host images, load on screen entry, and warm images serially after load.
- Remove per-load timestamps from team images so their URLs can be cached.
- Make external font CSS nonblocking on host, guest and admin pages.
- Preload the lobby sprite and remove live backdrop blur on lobby side panels.
- Update host CSS and script asset versions.

Local verification passed: host UI flow, guest UI flow, stage display, and an actual
Chromium test that keeps font CSS pending while checking QR availability and all
deferred screen images. A screenshot is in `reports/page-loading/lobby.png`.

## Remaining Network Issue

Several independent fresh-browser tests through the public Cloudflare route
timed out after 20 seconds before DOMContentLoaded. Pending resources varied
between small CSS files, JavaScript files, and Socket.IO's client script.
Disabling HTTP/2 and QUIC in the diagnostic browser did not resolve it.

A diagnostic browser resolved only this hostname directly to `167.172.95.75`;
HTTPS certificate verification remained enabled, and system DNS was unchanged.
That run measured host DOMContentLoaded at 1011ms cold / 327ms warm, first
contentful paint at 1272ms / 448ms, and load at 4030ms / 554ms, with no page errors.
The live presentation was not changed; QR readiness checks presence rather than
visibility because an operator may be showing another screen.

Cloudflare Development Mode was briefly enabled to isolate caching. A subsequent
login request still timed out after 30 seconds. Development Mode was switched
back OFF. Proxying, DNS, encryption and security settings remain unchanged.

These observations implicate the proxied network path from this computer, but do
not establish a Cloudflare-wide fault or prove every attendee sees the same delay.
The public-page loading issue is not resolved by frontend changes alone.

## Evidence and Next Step

Local ignored JSON evidence: `reports/page-load-before.json`,
`reports/page-load-after.json`, `reports/page-load-origin.json`,
`reports/page-load-edge.json`, `reports/page-load-http1.json`.
`scripts/measure-page-load.js` records navigation, paints, resource timings and
pending requests; use PLAYWRIGHT_MODULE and CHROME_PATH for the available runtime.
`scripts/test-page-loading.js` is restricted to an isolated localhost server.

Next proposed intervention is DNS-only routing to the existing HTTPS origin.
It would bypass Cloudflare's proxy and associated WAF/CDN protections, so obtain
explicit user confirmation before changing it. Then test public DNS propagation,
host and guest first load, QR URL, staff authentication and Socket.IO reconnection.
No match should be reset as part of this network diagnosis.
