const assert = require('assert');
const {
  getPreferredLanAddress,
  resolvePublicBaseUrl
} = require('../server/network/JoinUrlResolver');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
    failed++;
  }
}

const networkInterfaces = {
  'vEthernet (WSL)': [
    { address: '172.28.64.1', family: 'IPv4', internal: false }
  ],
  'Wi-Fi': [
    { address: '192.168.50.27', family: 'IPv4', internal: false }
  ],
  Loopback: [
    { address: '127.0.0.1', family: 'IPv4', internal: true }
  ]
};

test('Configured public URL takes priority', () => {
  const resolved = resolvePublicBaseUrl({
    configuredBaseUrl: 'https://game.example.com/',
    requestOrigin: 'http://localhost:3000',
    networkInterfaces
  });
  assert.deepStrictEqual(resolved, { baseUrl: 'https://game.example.com', source: 'configured' });
});

test('A public request origin remains unchanged behind a reverse proxy', () => {
  const resolved = resolvePublicBaseUrl({
    requestOrigin: 'https://wedding.example.com',
    networkInterfaces
  });
  assert.strictEqual(resolved.baseUrl, 'https://wedding.example.com');
  assert.strictEqual(resolved.source, 'request');
});

test('A localhost request is converted to the preferred physical LAN address', () => {
  const resolved = resolvePublicBaseUrl({
    requestOrigin: 'http://localhost:3996',
    networkInterfaces
  });
  assert.strictEqual(resolved.baseUrl, 'http://192.168.50.27:3996');
  assert.strictEqual(resolved.source, 'lan');
});

test('Physical Wi-Fi is preferred over a virtual network interface', () => {
  assert.strictEqual(getPreferredLanAddress(networkInterfaces), '192.168.50.27');
});

test('A clear warning is returned when no phone-reachable address exists', () => {
  const resolved = resolvePublicBaseUrl({
    requestOrigin: 'http://localhost:3000',
    networkInterfaces: { Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] }
  });
  assert.strictEqual(resolved.source, 'fallback-loopback');
  assert.ok(resolved.warning.includes('localhost'));
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
