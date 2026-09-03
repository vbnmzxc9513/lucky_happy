const { spawn } = require('child_process');

const isFullRun = process.argv.includes('--full');
const portArgIndex = process.argv.indexOf('--port');
const port = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 3996;
const serverUrl = `http://127.0.0.1:${port}`;
const fastTests = [
  'tests/test-checkpoint-engine.js',
  'tests/test-join-url-resolver.js',
  'tests/test-team-manager.js',
  'tests/test-quiz-manager.js',
  'tests/test-item-manager.js',
  'tests/test-round-manager.js',
  'tests/test-game-manager.js',
  'tests/test-wedding-readiness.js',
  'scripts/check-deployment-readiness.js',
  'scripts/test-admin-quiz-planner.js',
  'scripts/test-control-ui-flow.js',
  'scripts/test-ui-flow.js',
  'scripts/test-guest-ui-flow.js'
];

function runNode(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function assertPortIsFree() {
  try {
    const response = await fetch(`${serverUrl}/healthz`, { signal: AbortSignal.timeout(1000) });
    if (response.ok) throw new Error(`Port ${port} already has a Lucky Horse server`);
  } catch (error) {
    if (error.message && error.message.includes('already has')) throw error;
  }
}

async function waitForServer(serverProcess) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`Test server exited with code ${serverProcess.exitCode}`);
    try {
      const response = await fetch(`${serverUrl}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for isolated test server');
}

async function stopServer(serverProcess) {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => serverProcess.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 5000))
  ]);
  if (serverProcess.exitCode === null) serverProcess.kill();
}

async function main() {
  console.log(`Running ${fastTests.length} fast confidence tests...`);
  for (const testFile of fastTests) {
    console.log(`\n--- ${testFile} ---`);
    await runNode([testFile]);
  }

  await assertPortIsFree();
  const serverProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      QUIET_SOCKET_LOGS: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.on('data', chunk => process.stdout.write(`[server] ${chunk}`));
  serverProcess.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));

  try {
    await waitForServer(serverProcess);
    console.log('\n--- scripts/test-realtime-resilience.js ---');
    await runNode(['scripts/test-realtime-resilience.js'], {
      SERVER_URL: serverUrl,
      RESILIENCE_GUESTS: '30'
    });

    console.log('\n--- scripts/test-wedding-operations.js ---');
    await runNode(['scripts/test-wedding-operations.js'], {
      SERVER_URL: serverUrl
    });

    console.log('\n--- manual-host readiness smoke test ---');
    await runNode([
      'scripts/stress-wedding-game.js',
      '--url', serverUrl,
      '--clients', '10',
      '--manualHost', 'true',
      '--readyOnly', 'true',
      '--expectedTotalPlayers', '10',
      '--settleMs', '300'
    ]);

    console.log('\n--- scripts/wedding-preflight.js ---');
    await runNode(['scripts/wedding-preflight.js', '--url', serverUrl]);

    if (isFullRun) {
      console.log('\n--- 150 guest full-match stress test with 15 forced reconnects ---');
      await runNode([
        'scripts/stress-wedding-game.js',
        '--url', serverUrl,
        '--clients', '150',
        '--tapRate', '5',
        '--answerRate', '0.98',
        '--answerStrategy', 'random',
        '--reconnectClients', '15',
        '--reconnectAtQuiz', '5',
        '--maxSeconds', '600'
      ]);
    }
  } finally {
    await stopServer(serverProcess);
  }

  console.log(`\nConfidence suite passed (${isFullRun ? 'full 150-player run' : 'fast run'}).`);
}

main().catch(error => {
  console.error(`\nConfidence suite failed: ${error.stack || error.message}`);
  process.exit(1);
});
