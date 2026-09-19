-- 検証の状態に `flagged` を足す（`docs/ranking.md` §4-4）。
--
-- **機械の判定だけで記録を板から外さない**ための1段。
-- リプレイと打数が合わなかった記録は `flagged` にして**板には載せたまま**にし、
-- 検証ワークフローをわざと失敗させて持ち主へ知らせる。
-- 板から外れるのは、人が黒と決めて `suspicious` を書いたときだけ。
--
-- SQLite は CHECK 制約だけを後から書き換えられないので、**表を作り直して移す。**
-- 本番の記録がゼロのうちにやる（公開後にやると止める時間が要る）。

-- 1. 新しい制約の表を作る（records と同じ並び、verification_status だけ4値）
CREATE TABLE IF NOT EXISTS records_new (
  player_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  total_strokes INTEGER NOT NULL CHECK (total_strokes > 0 AND total_strokes <= 999),
  total_par INTEGER NOT NULL CHECK (total_par > 0 AND total_par <= 999),
  hole_strokes_json TEXT NOT NULL,
  gave_up INTEGER NOT NULL DEFAULT 0 CHECK (gave_up IN (0, 1)),
  generator TEXT NOT NULL,
  rules_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  shots_json TEXT NOT NULL DEFAULT '[]',
  -- verified/pending/flagged は板に載る。**外れるのは suspicious だけ**
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('verified', 'pending', 'flagged', 'suspicious')),
  achieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id, board_id),
  FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE
);

-- 2. 中身をそのまま移す（列は増えていないので値の読み替えは要らない）
INSERT OR IGNORE INTO records_new
  SELECT player_id, board_id, total_strokes, total_par, hole_strokes_json, gave_up,
         generator, rules_version, app_version, shots_json, verification_status,
         achieved_at, updated_at
  FROM records;

-- 3. 古い表と索引を捨てて置き換える
DROP INDEX IF EXISTS idx_records_ranking;
DROP TABLE IF EXISTS records;
ALTER TABLE records_new RENAME TO records;

-- 4. 索引を張り直す（0001 と同じ並び）
CREATE INDEX IF NOT EXISTS idx_records_ranking
  ON records (board_id, verification_status, total_strokes, achieved_at, player_id);
