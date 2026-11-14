// Read-only Cloudflare zone audit. Does not create routes, Workers, DNS or D1.
// Prints only public route patterns and service labels relevant to hanage.app.
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token) throw new Error('Missing Cloudflare API token');

async function getApi(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    return { ok: false, status: response.status, errors: (data.errors || []).map(x => x.code) };
  }
  return { ok: true, results: data.result };
}

const result = {
  checkedAtUtc: new Date().toISOString(),
  zoneReadable: false,
  routesReadable: false,
  customDomainsReadable: false,
  matchingRoutes: [],
  relevantCustomDomains: [],
  checks: {},
};
const zones = await getApi('/zones?name=hanage.app&per_page=10');
if (!zones.ok) {
  result.checks.zones = `not readable (HTTP ${zones.status}, errors ${zones.errors.join(',')})`;
} else {
  const zone = zones.results.find(x => x.name === 'hanage.app');
  result.zoneReadable = Boolean(zone);
  if (!zone) result.checks.zones = 'hanage.app zone not visible to API token';
  else {
    result.checks.zoneStatus = zone.status;
    const routes = await getApi(`/zones/${zone.id}/workers/routes?per_page=100`);
    if (!routes.ok) {
      result.checks.routes = `not readable (HTTP ${routes.status}, errors ${routes.errors.join(',')})`;
    } else {
      result.routesReadable = true;
      result.matchingRoutes = routes.results
        .filter(x => (x.pattern || '').includes('hanage.app'))
        .map(x => ({ pattern: x.pattern, script: x.script ?? null }));
      const target = [
        'hanage.app/games/putt/play',
        'hanage.app/games/putt/play/*',
      ];
      result.checks.targetRouteAlreadyAssigned = result.matchingRoutes
        .filter(x => target.some(pattern => x.pattern === pattern || x.pattern === 'https://' + pattern));
      result.checks.routes = `read ${routes.results.length} zone routes`;
    }
  }
}
if (accountId) {
  const domains = await getApi(`/accounts/${accountId}/workers/domains?per_page=100`);
  if (!domains.ok) {
    result.checks.customDomains = `not readable (HTTP ${domains.status}, errors ${domains.errors.join(',')})`;
  } else {
    result.customDomainsReadable = true;
    result.relevantCustomDomains = domains.results
      .filter(x => ['hanage.app', 'www.hanage.app', 'putt.hanage.app', 'mcsweeper.hanage.app'].includes(x.hostname))
      .map(x => ({ hostname: x.hostname, service: x.service, environment: x.environment }));
  }
}
for(const suffix of ['/', '/games/putt/', '/games/putt/play/', '/games/putt/play/api/health']) {
  try {
    const response = await fetch('https://hanage.app' + suffix, { redirect: 'manual', signal: AbortSignal.timeout(14000) });
    result.checks['existing ' + suffix] = response.status;
  } catch {
    result.checks['existing ' + suffix] = 'network error (not a routing claim)';
  }
}
console.log('HUB_ROUTING_AUDIT_START');
console.log(JSON.stringify(result));
console.log('HUB_ROUTING_AUDIT_END');
