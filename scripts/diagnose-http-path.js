const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { performance } = require('node:perf_hooks');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    args[key] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const target = new URL(args.url || 'https://luckyhappy1009.com');
const count = Math.max(1, Number(args.count || 20));
const intervalMs = Math.max(1000, Number(args.intervalMs || 1000));
const timeoutMs = Math.max(1000, Number(args.timeoutMs || 10000));
const reportPath = path.resolve(args.report || `reports/http-path-${Date.now()}.json`);
const endpoints = ['/guest/', '/healthz'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p / 100) - 1))];
};
const round = value => value == null ? null : Math.round(value * 10) / 10;

function requestOnce(endpoint, agent) {
  return new Promise(resolve => {
    const started = performance.now();
    const timing = { startedAt: new Date().toISOString(), endpoint, reusedSocket: false,
      dnsMs: null, tcpMs: null, tlsMs: null, firstByteMs: null, totalMs: null,
      status: null, bytes: 0, contentEncoding: null, remoteAddress: null, error: null };
    let lookupAt = null, connectAt = null;
    const request = https.request({ protocol: target.protocol, hostname: target.hostname,
      port: target.port || 443, path: endpoint, method: 'GET', agent,
      headers: { 'User-Agent': 'LuckyHorse-HTTP-Diagnostic/1.0', Accept: '*/*' } }, response => {
      timing.firstByteMs = performance.now() - started;
      timing.status = response.statusCode;
      timing.contentEncoding = response.headers['content-encoding'] || null;
      response.on('data', chunk => { timing.bytes += chunk.length; });
      response.on('end', () => {
        timing.totalMs = performance.now() - started;
        resolve(timing);
      });
    });
    timing.reusedSocket = request.reusedSocket === true;
    request.once('socket', socket => {
      timing.reusedSocket = request.reusedSocket === true;
      timing.remoteAddress = socket.remoteAddress || null;
      if (timing.reusedSocket) return;
      socket.once('lookup', (error, address) => {
        lookupAt = performance.now();
        timing.dnsMs = lookupAt - started;
        timing.remoteAddress = address || timing.remoteAddress;
      });
      socket.once('connect', () => {
        connectAt = performance.now();
        timing.tcpMs = connectAt - (lookupAt || started);
        timing.remoteAddress = socket.remoteAddress || timing.remoteAddress;
      });
      socket.once('secureConnect', () => {
        timing.tlsMs = performance.now() - (connectAt || lookupAt || started);
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    request.once('error', error => {
      timing.error = error.message;
      timing.totalMs = performance.now() - started;
      resolve(timing);
    });
    request.end();
  });
}

function summarize(samples) {
  const successful = samples.filter(sample => !sample.error && sample.status >= 200 && sample.status < 400);
  const metric = name => ({
    p50: round(percentile(successful.map(sample => sample[name]).filter(Number.isFinite), 50)),
    p95: round(percentile(successful.map(sample => sample[name]).filter(Number.isFinite), 95)),
    max: round(Math.max(...successful.map(sample => sample[name]).filter(Number.isFinite), 0))
  });
  return { requests: samples.length, successful: successful.length,
    errors: samples.filter(sample => sample.error || sample.status < 200 || sample.status >= 400).length,
    reusedSockets: samples.filter(sample => sample.reusedSocket).length,
    dnsMs: metric('dnsMs'), tcpMs: metric('tcpMs'), tlsMs: metric('tlsMs'),
    firstByteMs: metric('firstByteMs'), totalMs: metric('totalMs'),
    bytes: [...new Set(successful.map(sample => sample.bytes))],
    contentEncodings: [...new Set(successful.map(sample => sample.contentEncoding || 'identity'))] };
}

async function runSeries(mode, endpoint, agent) {
  const samples = [];
  for (let index = 0; index < count; index++) {
    const sample = await requestOnce(endpoint, agent);
    samples.push(sample);
    console.log(`${mode} ${endpoint} ${index + 1}/${count}: status=${sample.status || 'ERR'} total=${round(sample.totalMs)}ms reused=${sample.reusedSocket}`);
    if (index + 1 < count) await sleep(Math.max(0, intervalMs - sample.totalMs));
  }
  return samples;
}

async function main() {
  if (target.protocol !== 'https:') throw new Error('This diagnostic expects an HTTPS URL');
  const report = { generatedAt: new Date().toISOString(), target: target.origin, count, intervalMs, timeoutMs,
    note: 'Read-only HTTP diagnostics. No game socket, join, reset or control event.', series: {} };
  for (const endpoint of endpoints) {
    const samples = await runSeries('cold', endpoint, false);
    report.series[`cold:${endpoint}`] = { summary: summarize(samples), samples };
  }
  for (const endpoint of endpoints) {
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
    const samples = await runSeries('warm', endpoint, agent);
    agent.destroy();
    report.series[`warm:${endpoint}`] = { summary: summarize(samples), samples };
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.series).map(([key, value]) => [key, value.summary])), null, 2));
  console.log(`Wrote ${reportPath}`);
  if (Object.values(report.series).some(series => series.summary.errors > 0)) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
