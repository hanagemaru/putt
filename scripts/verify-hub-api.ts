// Does not connect to D1 or touch production. Both URL variants must reach the
// same Worker routes, while the preview must reject ranking writes.
import assert from 'node:assert/strict';
import { handleRequest } from '../src/server/worker.ts';

const previewEnv = { GAMEPLAY_ANALYTICS: 'false' };

async function check(url: string, method: string, status: number): Promise<Response> {
  const response = await handleRequest(new Request(url, { method }), previewEnv);
  assert.equal(response.status, status, `${method} ${url}`);
  return response;
}

for (const originAndPath of [
  'https://putt.hanage.app/api',
  'https://hanage.app/games/putt/play/api',
  'https://putt-hub-preview.jibunnha.workers.dev/games/putt/play/api',
]) {
  const health = await check(`${originAndPath}/health`, 'GET', 200);
  const data = (await health.json()) as { ok: boolean; database: boolean; schema: boolean };
  assert.equal(data.ok, true);
  assert.equal(data.database, false);
  assert.equal(data.schema, false);
  await check(`${originAndPath}/rankings?board=dummy`, 'GET', 503);
  await check(`${originAndPath}/records`, 'POST', 503);
  await check(`${originAndPath}/player`, 'PUT', 503);
  await check(`${originAndPath}/player`, 'DELETE', 503);
  // No D1 or analytics in the isolated preview; no analytics data can be written.
  await check(`${originAndPath}/gameplay-events`, 'POST', 204);
}
await check('https://hanage.app/games/putt/play/no-such-api', 'GET', 404);
console.log('PASS: legacy/subpath API routing and preview D1 isolation');
