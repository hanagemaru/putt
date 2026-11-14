// Read-only operational report for the Putt production D1.
// No identifiers, names, IP, or record payloads are printed.
// All commands are constant SELECTs; this script never mutates production.
import { execFileSync } from 'node:child_process';

function run(sql) {
  if (!/^\s*(WITH|SELECT)\b/i.test(sql)) throw new Error('Only SELECT reports are permitted');
  const output = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'putt-ranking', '--remote', '--json',
    '--config', 'wrangler.jsonc', '--command', sql,
  ], { encoding: 'utf8', timeout: 60000 });
  const json = JSON.parse(output);
  if (!Array.isArray(json) || !json[0]?.success) throw new Error('Remote read-only query failed');
  return json[0].results ?? [];
}

const activity = run(`
WITH bounds AS (
  SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS now_ms
), visits AS (
  SELECT session_id, source, received_at FROM gameplay_events, bounds
  WHERE event = 'visit'
)
SELECT
  datetime('now') AS asof_utc,
  (SELECT COUNT(*) FROM visits, bounds WHERE received_at >= now_ms - 7*86400000) AS tab_visits_7d,
  (SELECT COUNT(*) FROM visits, bounds WHERE received_at >= now_ms - 14*86400000 AND received_at < now_ms - 7*86400000) AS tab_visits_prior_7d,
  (SELECT COUNT(*) FROM visits, bounds WHERE received_at >= now_ms - 30*86400000) AS tab_visits_30d,
  (SELECT COUNT(DISTINCT session_id) FROM gameplay_events, bounds WHERE event = 'first_shot' AND received_at >= now_ms - 7*86400000) AS first_shot_sessions_7d,
  (SELECT COUNT(DISTINCT session_id) FROM gameplay_events, bounds WHERE event = 'round_complete' AND received_at >= now_ms - 7*86400000) AS completed_sessions_7d,
  (SELECT COUNT(DISTINCT session_id) FROM gameplay_events, bounds WHERE event = 'first_shot' AND received_at >= now_ms - 30*86400000) AS first_shot_sessions_30d,
  (SELECT COUNT(DISTINCT session_id) FROM gameplay_events, bounds WHERE event = 'round_complete' AND received_at >= now_ms - 30*86400000) AS completed_sessions_30d,
  (SELECT MIN(received_at) FROM gameplay_events) AS oldest_event_ms
`);

const weeklySource = run(`
SELECT source, COUNT(*) AS tab_visits_7d
FROM gameplay_events
WHERE event = 'visit' AND received_at >= CAST(strftime('%s','now') AS INTEGER)*1000 - 7*86400000
GROUP BY source ORDER BY tab_visits_7d DESC, source
`);

const daily = run(`
SELECT date(received_at / 1000, 'unixepoch', '+9 hours') AS day_jst, COUNT(*) AS tab_visits
FROM gameplay_events
WHERE event = 'visit' AND received_at >= CAST(strftime('%s','now') AS INTEGER)*1000 - 14*86400000
GROUP BY day_jst ORDER BY day_jst
`);

const rankingTotals = run(`
SELECT
  (SELECT COUNT(*) FROM players) AS players_ever_registered,
  (SELECT COUNT(DISTINCT player_id) FROM records) AS players_with_record,
  (SELECT COUNT(DISTINCT player_id) FROM records WHERE achieved_at >= datetime('now','-30 days')) AS players_with_new_best_30d,
  (SELECT COUNT(*) FROM records) AS score_records
`);

console.log('PUTT_ACTIVITY_REPORT_START');
console.log(JSON.stringify({ activity: activity[0], sources_7d: weeklySource, daily_jst_14d: daily, ranking: rankingTotals[0] }));
console.log('PUTT_ACTIVITY_REPORT_END');
