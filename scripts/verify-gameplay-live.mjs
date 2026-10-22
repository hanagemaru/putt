// Production smoke data is removed even when verification fails.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const session = randomUUID();
const sql = command => {
  const output = execFileSync('npx', ['wrangler', 'd1', 'execute', 'putt-ranking', '--remote', '--json', '--command', command], { encoding: 'utf8' });
  const result = JSON.parse(output);
  if (!result.every(item => item.success)) throw new Error('D1 query failed');
  return result[0].results;
};
try {
  const base = { session, source: 'direct', tour: '', hole: 0, outcome: 'none' };
  for (const payload of [
    { ...base, event: 'visit' },
    { ...base, event: 'first_shot', tour: 'beginner' },
    { ...base, event: 'first_shot', tour: 'beginner' },
    { ...base, event: 'hole_complete', tour: 'beginner', hole: 1, outcome: 'holed' },
    { ...base, event: 'round_complete', tour: 'beginner' },
  ]) {
    const response = await fetch('https://putt.hanage.app/api/gameplay-events', {
      method: 'POST', headers: { Origin: 'https://putt.hanage.app', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
    });
    if (response.status !== 204) throw new Error(`Event API: ${response.status}`);
  }
  const rows = sql(`SELECT event, COUNT(*) AS n FROM gameplay_events WHERE session_id='${session}' GROUP BY event`);
  if (rows.length !== 4 || rows.some(row => row.n !== 1)) throw new Error('Event persistence or deduplication failed');
  console.log('Gameplay events: visit, first shot, hole and round persisted; duplicate ignored.');
} finally {
  sql(`DELETE FROM gameplay_events WHERE session_id='${session}'`);
}
