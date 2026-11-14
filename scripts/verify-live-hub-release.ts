// Production smoke test. GET requests only; no ranking submission, player
// creation, analytics events or D1 mutations.
import assert from 'node:assert/strict';
import { TOUR_SETS } from '../src/course/tour-holes.ts';
import { tourBoardId } from '../src/ranking-shared.ts';

const hub = 'https://hanage.app';
const newBase = hub + '/games/putt/play/';
const legacy = 'https://putt.hanage.app/';

async function get(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'Cache-Control': 'no-cache' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  return response;
}
async function retry200(url: string): Promise<Response> {
  let res: Response | null = null;
  let last: unknown;
  for (let attempt = 0; attempt < 18; attempt++) {
    try {
      res = await get(url);
      if (res.status === 200) return res;
      last = new Error(`HTTP ${res.status} ${url}`);
    } catch (e) { last = e; }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw last ?? new Error(`Cannot access ${url}`);
}

const [hubResponse, legacyResponse, gameResponse] = await Promise.all([
  retry200(hub + '/'),
  retry200(legacy),
  retry200(newBase),
]);
assert.equal(hubResponse.status, 200);
assert.equal(legacyResponse.status, 200);
assert.equal(gameResponse.status, 200);
assert.equal(new URL(gameResponse.url).origin, hub);
const html = await gameResponse.text();
assert.match(html, /rel="canonical" href="https:\/\/hanage\.app\/games\/putt\/play\/"/);
assert.ok(html.includes('/games/putt/play/assets/'));
assert.doesNotMatch(gameResponse.headers.get('x-robots-tag') ?? '', /noindex/i);

const scriptPath = [...html.matchAll(/src="([^"]+\.js)"/g)]
  .map(match => match[1]).find(url => url.startsWith('/games/putt/play/assets/'));
assert.ok(scriptPath, 'game JS should resolve under the new path');
assert.equal((await retry200(hub + scriptPath)).status, 200);
const manifestResponse = await retry200(newBase + 'manifest.webmanifest');
const manifest = await manifestResponse.json();
assert.equal(manifest.start_url, '/games/putt/play/');
assert.equal(manifest.scope, '/games/putt/play/');
assert.equal((await retry200(newBase + 'sw.js')).status, 200);

const healthResponse = await retry200(newBase + 'api/health');
const health = await healthResponse.json();
assert.equal(health.database, true);
assert.equal(health.schema, true);

for (const tour of TOUR_SETS) {
  const boardId = encodeURIComponent(tourBoardId(tour));
  const [old, fresh] = await Promise.all([
    retry200(legacy + 'api/rankings?board=' + boardId),
    retry200(newBase + 'api/rankings?board=' + boardId),
  ]);
  const oldBoard = await old.json();
  const newBoard = await fresh.json();
  assert.equal(newBoard.boardId, oldBoard.boardId);
  if (oldBoard.playerCount !== newBoard.playerCount ||
      JSON.stringify(oldBoard.entries) !== JSON.stringify(newBoard.entries)) {
    const another = await retry200(legacy + 'api/rankings?board=' + boardId);
    const oldAgain = await another.json();
    assert.equal(newBoard.playerCount, oldAgain.playerCount);
    assert.deepEqual(newBoard.entries, oldAgain.entries);
  }
  console.log(`PASS: Putt ${tour.id} public leaderboard shared across live old/new URLs`);
}

// Existing hub content and old game must remain reachable.
assert.equal((await retry200(hub + '/games/putt/')).status, 200);
assert.equal((await retry200(hub + '/games/putt/how-to-play/')).status, 200);
console.log('PASS: production game/PWA/assets/canonical/health, old game and all leaderboards (GET only)');
