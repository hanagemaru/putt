// One-off, READ-ONLY production D1 audit. No Cloudflare Zone/Routes writes.
// Deploy a transient Workers.dev audit service using the existing Putt D1
// binding, compare its PUBLIC leaderboards to the legacy Worker, then delete
// the transient service. All names are namespaced with the GitHub run ID.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { TOUR_SETS } from '../src/course/tour-holes.ts';
import { tourBoardId } from '../src/ranking-shared.ts';

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const runId = process.env.GITHUB_RUN_ID;
if (!token || !account || !runId || !/^\d{8,15}$/.test(runId)) {
  throw new Error('Missing GitHub-run-scoped account credentials');
}
const name = `putt-hub-d1-ro-audit-${runId}`;
assert.match(name, /^putt-hub-d1-ro-audit-\d{8,15}$/);
const base = `https://${name}.jibunnha.workers.dev`;
const legacy = 'https://putt.hanage.app';
const configFile = '.wrangler/readonly-audit-config.jsonc';
mkdirSync('.wrangler', { recursive: true });
writeFileSync(configFile, JSON.stringify({
  name,
  main: './src/server/readonly-ranking-audit.ts',
  compatibility_date: '2026-08-01',
  d1_databases: [{
    binding: 'DB',
    database_name: 'putt-ranking',
    database_id: 'e86f3491-0b57-404d-8662-bb8628803b5d',
  }],
  vars: { GAMEPLAY_ANALYTICS: 'false' },
  // No routes, no custom domains, no assets: workers.dev only.
}, null, 2));

const env = { ...process.env };
let deployed = false;
async function compare() {
  for (const tour of TOUR_SETS) {
    const board = encodeURIComponent(tourBoardId(tour));
    const path = `/games/putt/play/api/rankings?board=${board}`;
    const oldPath = `/api/rankings?board=${board}`;
    const [oldResult, freshResult] = await Promise.all([
      fetch(legacy + oldPath, { cache: 'no-store', signal: AbortSignal.timeout(20000) }),
      fetch(base + path, { cache: 'no-store', signal: AbortSignal.timeout(20000) }),
    ]);
    assert.equal(oldResult.status, 200, `legacy ranking GET status for ${tour.id}`);
    assert.equal(freshResult.status, 200, `new read-only ranking GET status for ${tour.id}`);
    const [oldBoard, newBoard] = await Promise.all([oldResult.json(), freshResult.json()]);
    assert.equal(oldBoard.boardId, newBoard.boardId, `board ID ${tour.id}`);
    // A new score can arrive between the two GETs. If so, recheck once.
    if (JSON.stringify(oldBoard.entries) !== JSON.stringify(newBoard.entries) ||
        oldBoard.playerCount !== newBoard.playerCount) {
      const again = await fetch(legacy + oldPath, { signal: AbortSignal.timeout(20000) });
      const secondOld = await again.json();
      assert.deepEqual(newBoard.entries, secondOld.entries, `public ranking rows ${tour.id}`);
      assert.equal(newBoard.playerCount, secondOld.playerCount, `player count ${tour.id}`);
    }
    console.log(`PASS: ${tour.id} — same public leaderboard across two separate Workers (count: ${newBoard.playerCount})`);
  }
  const h = await fetch(base + '/games/putt/play/api/health');
  const health = await h.json();
  assert.equal(h.status, 200);
  assert.equal(health.database, true);
  assert.equal(health.schema, true);
  for (const [path, method] of [
    ['/games/putt/play/api/records', 'POST'],
    ['/games/putt/play/api/player', 'PUT'],
    ['/games/putt/play/api/player', 'DELETE'],
    ['/games/putt/play/api/gameplay-events', 'POST'],
  ]) {
    const response = await fetch(base + path, { method, signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 405, `audit Worker must never accept ${method} ${path}`);
  }
  console.log('PASS: production D1 is accessible from a separate Worker; read-only guard rejects writes');
}

let testError: unknown = null;
try {
  console.log('AUDIT: deploy temporary read-only Worker, without any Zone routes');
  execFileSync('npx', [
    '--yes', 'wrangler@4.148.0', 'deploy', '--config', configFile,
  ], { env, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
  deployed = true;
  let ready = false;
  for (let i = 0; i < 16; i++) {
    try {
      const response = await fetch(base + '/games/putt/play/api/health', {
        cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      if (response.status === 200) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  assert.ok(ready, 'audit Worker must become reachable');
  await compare();
} catch (error) {
  testError = error;
} finally {
  // All cleanup strictly scoped to the generated, CI-run-specific Worker.
  // The original putt and hanage-hub scripts and their D1 are NEVER deleted.
  if (deployed) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${name}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.success) {
      console.error('CLEANUP FAILED: the temporary audit Worker requires manual removal:', name);
      testError = testError ?? new Error('Could not delete temporary read-only Worker');
    } else {
      console.log('PASS: temporary read-only audit Worker deleted');
    }
  }
}
if (testError) throw testError;
