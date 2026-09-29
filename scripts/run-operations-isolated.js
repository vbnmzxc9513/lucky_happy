const { spawn } = require('node:child_process');
const net = require('node:net');

async function main() {
  const port = 3995;
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), BIND_HOST: '127.0.0.1', QUIET_SOCKET_LOGS: '1' },
    stdio: ['ignore', 'ignore', 'inherit']
  });
  try {
    const url = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error('Isolated server exited');
      try { ready = (await fetch(`${url}/healthz`)).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Isolated server did not start');
    await new Promise((resolve, reject) => {
      const test = spawn(process.execPath, ['scripts/test-wedding-operations.js'], {
        env: { ...process.env, SERVER_URL: url }, stdio: 'inherit'
      });
      test.once('error', reject);
      test.once('exit', code => code === 0 ? resolve() : reject(new Error(`Operations exited ${code}`)));
    });
  } finally { server.kill('SIGTERM'); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
