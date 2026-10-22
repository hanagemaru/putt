-- Anonymous, short-lived tab sessions. Not linked to players/credentials/ranking records.
CREATE TABLE IF NOT EXISTS gameplay_events (
  session_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('visit','first_shot','hole_complete','round_complete')),
  source TEXT NOT NULL,
  tour TEXT NOT NULL,
  hole INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, event, tour, hole)
);
CREATE INDEX IF NOT EXISTS gameplay_events_received_at ON gameplay_events(received_at);
