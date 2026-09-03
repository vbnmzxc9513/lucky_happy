const os = require('os');

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function normalizeBaseUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function isLocalHostname(hostname) {
  return LOCAL_HOSTNAMES.has(String(hostname || '').trim().toLowerCase());
}

function isPrivateIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function getPreferredLanAddress(networkInterfaces = os.networkInterfaces()) {
  const candidates = [];

  for (const [name, entries] of Object.entries(networkInterfaces || {})) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || entry.family !== 'IPv4' || !isPrivateIpv4(entry.address)) continue;
      const virtualPenalty = /virtual|vmware|vbox|hyper-v|docker|wsl|loopback|vethernet/i.test(name) ? 10 : 0;
      const preferredRange = entry.address.startsWith('192.168.') ? 0 : 1;
      candidates.push({ address: entry.address, score: virtualPenalty + preferredRange });
    }
  }

  candidates.sort((a, b) => a.score - b.score || a.address.localeCompare(b.address));
  return candidates[0] ? candidates[0].address : '';
}

function resolvePublicBaseUrl({ configuredBaseUrl = '', requestOrigin = '', networkInterfaces } = {}) {
  const configured = normalizeBaseUrl(configuredBaseUrl);
  if (configured) {
    return { baseUrl: configured, source: 'configured' };
  }

  const requested = normalizeBaseUrl(requestOrigin);
  if (requested) {
    const requestUrl = new URL(requested);
    if (!isLocalHostname(requestUrl.hostname)) {
      return { baseUrl: requestUrl.origin, source: 'request' };
    }

    const lanAddress = getPreferredLanAddress(networkInterfaces);
    if (lanAddress) {
      const port = requestUrl.port ? `:${requestUrl.port}` : '';
      return {
        baseUrl: `${requestUrl.protocol}//${lanAddress}${port}`,
        source: 'lan'
      };
    }
  }

  return {
    baseUrl: requested || 'http://localhost:3000',
    source: 'fallback-loopback',
    warning: '目前只能產生本機網址，手機無法透過 localhost 加入。請設定 PUBLIC_BASE_URL 或確認區網連線。'
  };
}

module.exports = {
  getPreferredLanAddress,
  isLocalHostname,
  isPrivateIpv4,
  normalizeBaseUrl,
  resolvePublicBaseUrl
};
