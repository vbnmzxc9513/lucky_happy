const { io } = require('socket.io-client');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return args;
}

const cli = parseArgs(process.argv.slice(2));
const SERVER_URL = (cli.url || process.env.SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');
const STAFF_ACCESS_CODE = cli.staffAccessCode || process.env.STAFF_ACCESS_CODE || '1009';
const results = [];

function record(name, success, detail) {
  results.push({ name, success, detail });
  console.log(`${success ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}

async function fetchTimed(pathname, options = {}) {
  const startedAt = Date.now();
  const response = await fetch(`${SERVER_URL}${pathname}`, {
    ...options,
    cache: 'no-store',
    signal: AbortSignal.timeout(5000)
  });
  return { response, latencyMs: Date.now() - startedAt };
}

async function connectHost(cookie) {
  const socket = io(SERVER_URL, {
    auth: { role: 'host' },
    extraHeaders: { Cookie: cookie },
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000
  });

  return new Promise((resolve, reject) => {
    let state = null;
    let mapList = null;
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('timed out waiting for host state'));
    }, 7000);

    const finish = () => {
      if (!state || !mapList) return;
      clearTimeout(timer);
      socket.disconnect();
      resolve({ state, mapList });
    };

    socket.on('game:state_sync', data => {
      state = data;
      finish();
    });
    socket.on('game:map_list', data => {
      mapList = data;
      finish();
    });
    socket.once('connect_error', error => {
      clearTimeout(timer);
      socket.disconnect();
      reject(error);
    });
  });
}

async function main() {
  console.log(`Wedding preflight: ${SERVER_URL}`);

  const healthLatencies = [];
  let health = null;
  for (let index = 0; index < 3; index++) {
    const probe = await fetchTimed('/healthz');
    healthLatencies.push(probe.latencyMs);
    if (!probe.response.ok) throw new Error(`/healthz returned HTTP ${probe.response.status}`);
    health = await probe.response.json();
  }
  const maxHealthLatency = Math.max(...healthLatencies);
  record('server health', health.status === 'ok', `state=${health.state}, max=${maxHealthLatency}ms`);
  record('event loop', Number(health.eventLoopLagMs) < 150, `${health.eventLoopLagMs}ms lag`);
  record('memory headroom', Number(health.memory && health.memory.rssMb) < 512, `${health.memory.rssMb}MB RSS`);
  record('lobby ready', health.state === 'LOBBY', `current state is ${health.state}`);

  const guestPage = await fetchTimed('/guest/');
  const guestHtml = await guestPage.response.text();
  record('guest page', guestPage.response.ok && guestHtml.includes('guest-app.js'), `HTTP ${guestPage.response.status}, ${guestPage.latencyMs}ms`);

  const joinInfoProbe = await fetchTimed('/api/join-info');
  const joinInfo = await joinInfoProbe.response.json();
  const phoneReachable = !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/)/i.test(joinInfo.joinUrl || '');
  record(
    'phone-ready local QR',
    joinInfoProbe.response.ok &&
      String(joinInfo.qrDataUrl || '').startsWith('data:image/png;base64,') &&
      String(joinInfo.joinUrl || '').endsWith('/guest/') &&
      phoneReachable,
    `${joinInfo.joinUrl || 'missing URL'}, source=${joinInfo.source || 'unknown'}`
  );

  const unauthorizedHost = await fetchTimed('/host/', { redirect: 'manual' });
  record('host access lock', unauthorizedHost.response.status === 302, `unauthorized HTTP ${unauthorizedHost.response.status}`);

  const login = await fetchTimed('/staff-login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: STAFF_ACCESS_CODE, next: '/manage' })
  });
  const cookie = login.response.headers.get('set-cookie')?.split(';')[0] || '';
  record('staff verification code', login.response.status === 302 && !!cookie, `HTTP ${login.response.status}`);

  const authorizedHost = await fetchTimed('/host/', { headers: { Cookie: cookie } });
  const hostHtml = await authorizedHost.response.text();
  record('host verified session', authorizedHost.response.ok && hostHtml.includes('host-app.js'), `HTTP ${authorizedHost.response.status}`);

  if (cookie) {
    const realtime = await connectHost(cookie);
    const currentMap = realtime.state.currentMap || {};
    record('host WebSocket', true, `state=${realtime.state.state}, maps=${realtime.mapList.length}`);
    record(
      'formal 10-question map',
      currentMap.id === 'wedding-final-showdown' && Array.isArray(currentMap.checkpoints) && currentMap.checkpoints.length === 10,
      `${currentMap.id || 'no map'}, checkpoints=${(currentMap.checkpoints || []).length}`
    );
    const config = realtime.state.config || {};
    record(
      'team capacity',
      Number(config.maxPlayersPerTeam) === 50,
      `max=${config.maxPlayersPerTeam || 'missing'} players/team`
    );
    const sprint = config.finalSprint || {};
    record(
      'final sprint guard',
      sprint.enabled === true && Number(sprint.startAfterSeconds) === 540 && Number(sprint.hardFinishAfterSeconds) === 600,
      `sprint=${sprint.startAfterSeconds || 'missing'}s, deadline=${sprint.hardFinishAfterSeconds || 'missing'}s`
    );
  }

  const failures = results.filter(result => !result.success);
  console.log(`\nPreflight result: ${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length > 0) process.exit(1);
}

main().catch(error => {
  console.error(`Preflight failed: ${error.message}`);
  process.exit(1);
});
