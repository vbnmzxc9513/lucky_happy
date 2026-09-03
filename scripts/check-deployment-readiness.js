const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
let failed = 0;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function check(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
    return;
  }
  failed++;
  console.error(`FAIL ${message}`);
}

const requiredFiles = [
  '.env.example',
  'package-lock.json',
  'deploy/bootstrap-ubuntu.sh',
  'deploy/Caddyfile.example',
  'deploy/lucky-horse.env.example',
  'deploy/lucky-horse.service',
  'deploy/verify-public.ps1'
];

for (const file of requiredFiles) {
  check(fs.existsSync(path.join(root, file)), `${file} exists`);
}

const envExample = read('.env.example');
const deployEnv = read('deploy/lucky-horse.env.example');
for (const key of ['NODE_ENV', 'PORT', 'PUBLIC_BASE_URL', 'STAFF_ACCESS_CODE', 'STAFF_SESSION_SECRET']) {
  check(envExample.includes(`${key}=`), `.env.example documents ${key}`);
  check(deployEnv.includes(`${key}=`), `deploy environment documents ${key}`);
}
check(!/ADMIN_(USER|PASS)/.test(`${envExample}\n${deployEnv}`), 'obsolete Basic Auth variables are absent');

const bootstrap = read('deploy/bootstrap-ubuntu.sh');
check(bootstrap.includes('caddy validate'), 'bootstrap validates Caddy configuration');
check(bootstrap.includes('npm test'), 'bootstrap runs the confidence suite');
check(bootstrap.includes('npm run security:check'), 'bootstrap rejects vulnerable dependency releases');
check(bootstrap.includes('npm run preflight'), 'bootstrap runs public preflight');
check(bootstrap.includes('ufw allow 443/tcp'), 'bootstrap opens HTTPS without exposing port 3000');

const service = read('deploy/lucky-horse.service');
check(service.includes('Restart=always'), 'systemd restarts Node after failure');
check(service.includes('LimitNOFILE=65536'), 'systemd allows sufficient concurrent sockets');
check(service.includes('ReadWritePaths=/opt/lucky-horse/data'), 'systemd limits write access to game data');

const caddy = read('deploy/Caddyfile.example');
check(caddy.includes('reverse_proxy 127.0.0.1:__PORT__'), 'Caddy proxies to the private Node port');

function runProductionConfig(extraEnv) {
  const env = { ...process.env };
  delete env.PUBLIC_BASE_URL;
  delete env.STAFF_ACCESS_CODE;
  delete env.STAFF_SESSION_SECRET;
  delete env.SESSION_SECRET;
  return spawnSync(process.execPath, ['-e', "require('./server/config')"], {
    cwd: root,
    env: { ...env, NODE_ENV: 'production', ...extraEnv },
    encoding: 'utf8'
  });
}

check(runProductionConfig({}).status !== 0, 'production rejects missing secrets and public URL');
check(runProductionConfig({
  PUBLIC_BASE_URL: 'http://localhost:3000',
  STAFF_ACCESS_CODE: '1009',
  STAFF_SESSION_SECRET: 'x'.repeat(64)
}).status !== 0, 'production rejects localhost and non-HTTPS public URLs');
check(runProductionConfig({
  PUBLIC_BASE_URL: 'https://game.example.com',
  STAFF_ACCESS_CODE: '1009',
  STAFF_SESSION_SECRET: 'replace-with-at-least-32-random-characters'
}).status !== 0, 'production rejects the documented secret placeholder');
check(runProductionConfig({
  PUBLIC_BASE_URL: 'https://game.example.com',
  STAFF_ACCESS_CODE: '1009',
  STAFF_SESSION_SECRET: 'x'.repeat(64)
}).status === 0, 'production accepts a complete HTTPS environment');

if (failed > 0) {
  console.error(`\nDeployment readiness failed: ${failed} check(s).`);
  process.exit(1);
}

console.log('\nDeployment readiness passed.');
