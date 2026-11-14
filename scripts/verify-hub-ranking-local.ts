// Real Cloudflare Worker + local, disposable D1 E2E. Never uses --remote
// and never accesses the production Cloudflare D1 database.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { DEFAULT_TOUR } from '../src/course/tour-holes.ts';
import { tourBoardId } from '../src/ranking-shared.ts';
import { CONFIG } from '../src/config.ts';

const wrangler = ['--yes', 'wrangler@4.148.0'];
const config = 'wrangler.hub-local-ranking.jsonc';
const port = 18789;
const origin = `http://127.0.0.1:${port}`;
const base = `${origin}/games/putt/play/api`;
const oldBase = `${origin}/api`;
const identity = {
  playerId: randomUUID(),
  credential: randomBytes(32).toString('hex'),
};
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${identity.playerId}.${identity.credential}`,
};
const runner = { env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' } };

function npx(args: string[]): void {
  // Explicit local flag and synthetic DB ID. No remote resources used.
  execFileSync('npx', [...wrangler, ...args], {
    stdio: 'pipe', timeout: 90_000, env: runner.env,
  });
}

npx(['d1', 'migrations', 'apply', 'putt-ranking-hub-test-local-only', '--local', '--config', config]);

const processHandle = spawn('npx', [
  ...wrangler, 'dev', '--local', '--config', config, '--port', String(port), '--ip', '127.0.0.1',
], { env: runner.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
processHandle.stdout?.on('data', chunk => { output = (output + chunk.toString()).slice(-3000); });
processHandle.stderr?.on('data', chunk => { output = (output + chunk.toString()).slice(-3000); });

async function call(url: string, method = 'GET', body?: unknown) {
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  let data: any = null;
  try { data = await response.json(); } catch { /* No content for some responses */ }
  return { status: response.status, data };
}

try {
  let ready = false;
  for (let i = 0; i < 75; i++) {
    if (processHandle.exitCode !== null) throw new Error('Local worker exited before health check');
    try {
      const res = await call(`${base}/health`);
      if (res.status === 200 && res.data?.schema === true && res.data?.database === true) {
        ready = true;
        break;
      }
    } catch { /* Workers startup or local D1 migration may still be in progress. */ }
    await delay(750);
  }
  if (!ready) throw new Error(`Local ranking DB never became ready: ${output}`);
  const boardId = tourBoardId(DEFAULT_TOUR);
  const boardParam = encodeURIComponent(boardId);

  let response = await call(`${base}/rankings?board=${boardParam}`);
  assert.equal(response.status, 200, 'initial empty board must be available');
  assert.equal(response.data.playerCount, 0);

  response = await call(`${base}/player`, 'PUT', { displayName: 'LOCAL-TEST' });
  assert.equal(response.status, 200, 'create player');
  response = await call(`${oldBase}/rankings?board=${boardParam}`);
  assert.equal(response.status, 200, 'legacy API path must still work');
  assert.equal(response.data.playerCount, 0);

  const holes = DEFAULT_TOUR.seeds.map((seed: number, index: number) => ({
    number: index + 1, seed, par: 4, strokes: 5, holedOut: true,
  }));
  const body = {
    submissionId: randomUUID(), boardId, displayName: 'LOCAL-TEST',
    totalStrokes: holes.length * 5, totalPar: holes.length * 4,
    gaveUp: false, holes, shots: [], generator: DEFAULT_TOUR.generator ?? 'v1',
    rulesVersion: CONFIG.game.ranking.rulesVersion,
    appVersion: CONFIG.game.ranking.appVersion,
    putterPowerScale: CONFIG.game.putterTuning.defaultScale,
  };
  const first = await call(`${base}/records`, 'POST', body);
  assert.equal(first.status, 200, `submit local-only score: ${JSON.stringify(first.data)}`);
  assert.equal(first.data.newBest, true);

  const duplicate = await call(`${oldBase}/records`, 'POST', body);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.data, first.data, 'cross-path submission must be idempotent');

  const ranked = await call(`${oldBase}/rankings?board=${boardParam}`);
  assert.equal(ranked.status, 200);
  assert.equal(ranked.data.playerCount, 1);
  assert.equal(ranked.data.yourRank, 1);
  assert.equal(ranked.data.yourBest.strokes, body.totalStrokes);

  response = await call(`${base}/player`, 'PUT', { displayName: 'MIGRATED' });
  assert.equal(response.status, 200);
  const renamed = await call(`${oldBase}/rankings?board=${boardParam}`);
  assert.equal(renamed.data.entries[0].name, 'MIGRATED');

  const fakeCredential = await fetch(`${base}/rankings?board=${boardParam}`, {
    headers: { Authorization: `Bearer ${identity.playerId}.${'0'.repeat(64)}` },
  });
  assert.equal(fakeCredential.status, 401, 'wrong credentials must not access a registered player');

  response = await call(`${base}/player`, 'DELETE');
  assert.equal(response.status, 200);
  response = await call(`${oldBase}/rankings?board=${boardParam}`);
  assert.equal(response.data.playerCount, 0);
  assert.equal(response.data.yourBest, null);
  console.log('PASS: isolated local D1 real ranking registration, old/new URLs, credentials, idempotence, rename and deletion');
} finally {
  // npx spawns Wrangler as a child. Kill the *whole group* so an orphaned
  // workerd cannot retain stdout pipes and keep CI running indefinitely.
  try { process.kill(-processHandle.pid!, 'SIGTERM'); } catch { /* exited */ }
  await delay(500);
  try { process.kill(-processHandle.pid!, 'SIGKILL'); } catch { /* exited */ }
  processHandle.stdout?.destroy();
  processHandle.stderr?.destroy();
}
