-- オンラインランキングの器（docs/ranking.md §5-1）。
-- 参照実装は Multicolor Sweeper の migrations/0001_ranking.sql。
-- 違うのは「競う値」（クリア時間 → 合計打数）と、板（ランキングの単位）が
-- コース差し替えと週替わりで増え続けること。
--
-- 持つのは匿名ID・認証用ハッシュ・表示名・スコア・リプレイだけ。
-- **IPは保存しない**（レート制限のキーにハッシュとして使うだけ）。

CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  -- credential そのものは持たない。突き合わせはSHA-256どうしで行う
  credential_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1人1板1件（自己ベストだけ持つ）。
-- board_id は `tour:<tourId>:<generator>:<seedsId>:r<rulesVersion>` の文字列1本で、
-- **シード列を選び直せば板が自動的に分かれる**（古い記録が新しいコースへ混ざらない）。
CREATE TABLE IF NOT EXISTS records (
  player_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  total_strokes INTEGER NOT NULL CHECK (total_strokes > 0 AND total_strokes <= 999),
  total_par INTEGER NOT NULL CHECK (total_par > 0 AND total_par <= 999),
  -- ホール別の打数とホールアウト有無。表示ではなく、後の検証と突き合わせに使う
  hole_strokes_json TEXT NOT NULL,
  -- ギブアップを含むラウンドか。**登録は許し、打数の後ろに `*` を出す**（同 §3-3）
  gave_up INTEGER NOT NULL DEFAULT 0 CHECK (gave_up IN (0, 1)),
  generator TEXT NOT NULL,
  rules_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  -- リプレイ用の打ち出しの列（1打 = 初速と方向の2つ）。
  -- **段2の検証を後から有効にできるよう、段1しか動いていない時点でも受け取って保存する**
  shots_json TEXT NOT NULL DEFAULT '[]',
  -- pending は検証待ち（板には載せる）。suspicious は板から外す
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('verified', 'pending', 'suspicious')),
  -- 同打数は**先に出した人が上**（同 §3-1）。並び替えの第2キー
  achieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id, board_id),
  FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE
);

-- 板ごとの並びをそのまま引く索引。ORDER BY と同じ順に並べる
CREATE INDEX IF NOT EXISTS idx_records_ranking
  ON records (board_id, verification_status, total_strokes, achieved_at, player_id);

-- 同じ送信を二度受け取っても結果を1つにする（冪等）
CREATE TABLE IF NOT EXISTS submission_log (
  submission_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'pending', 'suspicious')),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (submission_id, player_id),
  FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submission_log_player_created
  ON submission_log (player_id, created_at);

-- レート制限。**IPは生では持たず、ハッシュにしてキーへ入れるだけ**
CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rate_key, window_start)
);
