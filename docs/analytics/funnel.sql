-- Last 7 days, using server timestamps. Visits are tab sessions, NOT people or CF Visits.
-- Attribution uses the visit row, never the event row. Exclude events outside the same window.
WITH bounds AS (
  SELECT CAST(strftime('%s','now','-7 days') AS INTEGER)*1000 AS start_ms,
         CAST(strftime('%s','now') AS INTEGER)*1000 AS end_ms
), visits AS (
  SELECT session_id, source, received_at
  FROM gameplay_events, bounds
  WHERE event='visit' AND received_at >= start_ms AND received_at < end_ms
), progress AS (
  SELECT e.session_id,
    MAX(e.event='first_shot') AS started,
    MAX(e.event='hole_complete' AND e.hole=1) AS hole1,
    MAX(e.event='hole_complete' AND e.hole=3) AS hole3,
    MAX(e.event='hole_complete' AND e.hole=6) AS hole6,
    MAX(e.event='round_complete') AS finished
  FROM gameplay_events e, bounds
  WHERE e.received_at >= start_ms AND e.received_at < end_ms
  GROUP BY e.session_id
)
SELECT date(v.received_at/1000, 'unixepoch', '+9 hours') AS visit_day_jst,
       v.source, COUNT(*) AS tab_sessions,
       SUM(COALESCE(p.started,0)) AS first_shot_sessions,
       SUM(COALESCE(p.hole1,0)) AS hole1_sessions,
       SUM(COALESCE(p.hole3,0)) AS hole3_sessions,
       SUM(COALESCE(p.hole6,0)) AS hole6_sessions,
       SUM(COALESCE(p.finished,0)) AS final_hole_sessions
FROM visits v LEFT JOIN progress p USING(session_id)
GROUP BY visit_day_jst, v.source ORDER BY visit_day_jst, v.source;
