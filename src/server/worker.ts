// ランキングのサーバ（Cloudflare Workers + D1）。`docs/ranking.md` §5。
//
// 参照実装は Multicolor Sweeper の `src/server/worker.ts`。**構造はそのまま踏襲する。**
// 違うのは競う値（クリア時間 → 合計打数）と、板が増え続けることの2点。
//
//   GET    /api/health   … 死活と、D1が繋がっているか・表ができているか
//   GET    /api/rankings … 板1枚（上位＋自分の周辺＋自分の順位）
//   POST   /api/records  … 登録（段1の検証まで）
//   PUT    /api/player   … 表示名の登録・変更
//   DELETE /api/player   … **自分の記録と名前を全部消す**
//
// ここでやる検証は段1（形・常識・レート制限・二重登録）だけ。**嘘のスコアはここでは通る。**
// それを弾く段2のリプレイ検証は、Workerの外（`scripts/verify-records.ts` を回す
// GitHub Actionsのバッチ）が後から判定して `verified` / `flagged` を書き戻す。
// **`flagged` でも板からは外さない**（人が見て `suspicious` にしたときだけ外れる）。
//
// **D1が無くても落ちない。** `wrangler.jsonc` に d1_databases が無ければ `env.DB` も無いので、
// 器が要る入口だけ 503 を返す（ゲームの配信には影響しない）。本番のD1は 2026-09-19 に作成済み。
//
// CPUの話（同 §4-3）: **無料枠は1リクエスト10ms。** ここでやるのはD1の読み書きだけで、
// **コース生成も物理も回さない**。リプレイ検証はWorkerの外（GitHub Actionsのバッチ）。

import { CONFIG } from '../config';
import {
  BOARD_VISIBLE_STATUSES,
  DEFAULT_PLAYER_NAME,
  isBoardId,
  normalizeDisplayName,
  type RankingBoard,
  type RankingEntry,
  type SubmitRecordRequest,
  type SubmitRecordResponse,
  type UpdatePlayerRequest,
} from '../ranking-shared';
import { validateSubmission } from './record-validation';

const R = CONFIG.game.ranking;
const S = R.server;

// --- D1 の最小の型。@cloudflare/workers-types は入れない（依存は最小限に） ---

interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface Env {
  /** D1を作る前は**無い**。無ければ器が要る入口だけ 503 を返す */
  DB?: D1Database;
}

interface AuthIdentity {
  playerId: string;
  credentialHash: string;
}

interface PlayerRow {
  player_id: string;
  credential_hash: string;
  display_name: string | null;
}

interface RankedRow {
  player_id: string;
  display_name: string | null;
  total_strokes: number;
  total_par: number;
  gave_up: number;
  /** 同打数をまとめたゴルフ流の順位（表示用） */
  rank: number;
  /** 一意の並び（内部用）。上位N件と自分の周辺を切り出すのに使う */
  position: number;
  /** 同じ打数の人数。2人以上なら `T12` と出す */
  tied: number;
}

interface OwnRecordRow {
  total_strokes: number;
  total_par: number;
  gave_up: number;
  verification_status: string;
}

/**
 * 板1枚の並び（`docs/ranking.md` §3-1）。**順位の付け方はここが正本。**
 *
 * - `RANK()` は打数だけで並べるので、**同打数は同じ番号**になり次が飛ぶ（38打が12人なら次は13位）
 * - `ROW_NUMBER()` は `打数 → 到達時刻 → playerId` で一意。切り出しにはこちらを使う
 * - **板から外れるのは `suspicious` だけ**（`pending` も `flagged` も載せる）。
 *   どれを載せるかは `BOARD_VISIBLE_STATUSES` が正本で、ここはそれを並べるだけ
 */
/** `'verified', 'pending', 'flagged'`。**定数の並びなので外から値は入らない** */
const VISIBLE_STATUS_SQL = BOARD_VISIBLE_STATUSES.map((status) => `'${status}'`).join(', ');

const RANKED_CTE = `
  WITH ranked AS (
    SELECT r.player_id AS player_id,
           p.display_name AS display_name,
           r.total_strokes AS total_strokes,
           r.total_par AS total_par,
           r.gave_up AS gave_up,
           RANK() OVER (ORDER BY r.total_strokes ASC) AS rank,
           ROW_NUMBER() OVER (
             ORDER BY r.total_strokes ASC, r.achieved_at ASC, r.player_id ASC
           ) AS position,
           COUNT(*) OVER (PARTITION BY r.total_strokes) AS tied
    FROM records r
    JOIN players p ON p.player_id = r.player_id
    WHERE r.board_id = ? AND r.verification_status IN (${VISIBLE_STATUS_SQL})
  )`;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `Authorization: Bearer <playerId>.<credential>` を読む。
 * **credential そのものは保存しない。** 突き合わせはSHA-256どうしで行う
 */
async function readAuth(request: Request): Promise<AuthIdentity | null> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;
  const playerId = token.slice(0, separator);
  const credential = token.slice(separator + 1);
  if (playerId.length > 80 || credential.length < 32 || credential.length > 256) return null;
  return { playerId, credentialHash: await sha256(credential) };
}

async function requireAuth(request: Request): Promise<AuthIdentity | Response> {
  return (await readAuth(request)) ?? error('Authentication required', 401);
}

/** 名乗ったIDの持ち主か確かめる。credential が違えば 401 */
async function findAuthenticatedPlayer(
  db: D1Database,
  auth: AuthIdentity,
): Promise<PlayerRow | null | Response> {
  const existing = await db
    .prepare('SELECT player_id, credential_hash, display_name FROM players WHERE player_id = ?')
    .bind(auth.playerId)
    .first<PlayerRow>();
  if (existing && existing.credential_hash !== auth.credentialHash) {
    return error('Invalid player credential', 401);
  }
  return existing;
}

/** いなければ作り、名前が変わっていれば直す */
async function ensurePlayer(
  db: D1Database,
  auth: AuthIdentity,
  displayName: string,
): Promise<PlayerRow | Response> {
  const existing = await findAuthenticatedPlayer(db, auth);
  if (existing instanceof Response) return existing;
  if (existing) {
    if (existing.display_name !== displayName) {
      await db
        .prepare('UPDATE players SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?')
        .bind(displayName, auth.playerId)
        .run();
      return { ...existing, display_name: displayName };
    }
    return existing;
  }

  await db
    .prepare('INSERT INTO players (player_id, credential_hash, display_name) VALUES (?, ?, ?)')
    .bind(auth.playerId, auth.credentialHash, displayName)
    .run();
  return {
    player_id: auth.playerId,
    credential_hash: auth.credentialHash,
    display_name: displayName,
  };
}

async function consumeRateLimit(db: D1Database, key: string, limit: number): Promise<boolean> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = nowSeconds - (nowSeconds % S.rateWindowSeconds);
  await db
    .prepare(
      `INSERT INTO rate_limits (rate_key, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT(rate_key, window_start) DO UPDATE SET count = count + 1`,
    )
    .bind(key, windowStart)
    .run();
  const row = await db
    .prepare('SELECT count FROM rate_limits WHERE rate_key = ? AND window_start = ?')
    .bind(key, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? limit + 1) <= limit;
}

/**
 * 書き込みの上限。**IPは保存せず、ハッシュにしてキーへ入れるだけ**（同 §5-3）。
 * 1人あたりと、同じ回線からの合計の両方を見る。
 *
 * **数えるのは用途ごとに分ける。** ひとまとめにすると、名前を何度か直しただけで
 * 「記録を全部消す」が弾かれる。消す道は塞がない
 */
async function allowWrite(
  request: Request,
  db: D1Database,
  auth: AuthIdentity,
  scope: string,
  playerLimit: number,
  ipLimit: number,
): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (!(await consumeRateLimit(db, `ip:${scope}:${await sha256(ip)}`, ipLimit))) return false;
  return consumeRateLimit(db, `player:${scope}:${auth.playerId}`, playerLimit);
}

async function handleUpdatePlayer(request: Request, db: D1Database): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (!(await allowWrite(request, db, auth, 'name', S.namePerPlayer, S.namePerIp))) {
    return error('Too many updates', 429);
  }

  let body: UpdatePlayerRequest;
  try {
    body = (await request.json()) as UpdatePlayerRequest;
  } catch {
    return error('Invalid JSON');
  }
  // 整え方は画面と同じ関数（`src/ranking-shared.ts`）。片方だけ緩いと意味がない
  const displayName = normalizeDisplayName(body.displayName);
  if (!displayName) return error('Invalid display name');

  const player = await ensurePlayer(db, auth, displayName);
  if (player instanceof Response) return player;
  return json({ ok: true });
}

/**
 * 自分の記録と名前を全部消す（同 §5-3）。
 * **消し方が無い状態で公開しない。** 記録・送信の控え・名前の順に消す
 */
async function handleDeletePlayer(request: Request, db: D1Database): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (!(await allowWrite(request, db, auth, 'delete', S.deletePerPlayer, S.deletePerIp))) {
    return error('Too many updates', 429);
  }
  const player = await findAuthenticatedPlayer(db, auth);
  if (player instanceof Response) return player;
  // もう無いものを消せと言われたら、消えているので成功でよい
  if (!player) return json({ ok: true });

  await db.batch([
    db.prepare('DELETE FROM submission_log WHERE player_id = ?').bind(auth.playerId),
    db.prepare('DELETE FROM records WHERE player_id = ?').bind(auth.playerId),
    db.prepare('DELETE FROM players WHERE player_id = ?').bind(auth.playerId),
  ]);
  return json({ ok: true });
}

function rankingEntry(row: RankedRow, playerId: string | null): RankingEntry {
  return {
    rank: row.rank,
    tied: row.tied > 1,
    playerId: row.player_id,
    name: row.display_name ?? DEFAULT_PLAYER_NAME,
    strokes: row.total_strokes,
    toPar: row.total_strokes - row.total_par,
    gaveUp: row.gave_up === 1,
    isPlayer: row.player_id === playerId,
  };
}

/** 板に載っている自分の1行。`suspicious` で外れていれば null */
async function ownRankedRow(
  db: D1Database,
  boardId: string,
  playerId: string,
): Promise<RankedRow | null> {
  return db
    .prepare(`${RANKED_CTE} SELECT * FROM ranked WHERE player_id = ?`)
    .bind(boardId, playerId)
    .first<RankedRow>();
}

async function boardPlayerCount(db: D1Database, boardId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM records
       WHERE board_id = ? AND verification_status IN (${VISIBLE_STATUS_SQL})`,
    )
    .bind(boardId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/**
 * 板を1枚返す（同 §6-3）。**上位10件＋自分の周辺±3**だけ。
 * 全件返すと板が育つほど重くなるし、画面もそこまでは出さない
 */
async function handleRanking(request: Request, db: D1Database, url: URL): Promise<Response> {
  const boardId = url.searchParams.get('board');
  if (!isBoardId(boardId)) return error('Invalid board');

  // 認証は任意。名乗らなければ上位だけを返す
  const header = request.headers.get('Authorization');
  const auth = header ? await readAuth(request) : null;
  if (header && !auth) return error('Invalid player credential', 401);
  if (auth) {
    const player = await findAuthenticatedPlayer(db, auth);
    if (player instanceof Response) return player;
  }
  const playerId = auth?.playerId ?? null;

  const top = await db
    .prepare(`${RANKED_CTE} SELECT * FROM ranked WHERE position <= ? ORDER BY position`)
    .bind(boardId, R.topCount)
    .all<RankedRow>();
  const entries: RankingEntry[] = (top.results ?? []).map((row) => rankingEntry(row, playerId));

  let yourRank: number | null = null;
  let yourTied = false;
  let yourBest: RankingBoard['yourBest'] = null;

  if (auth) {
    // 自分の記録は板から外れていても読む（`確認中` を本人にだけ見せるため）
    const own = await db
      .prepare(
        `SELECT total_strokes, total_par, gave_up, verification_status
         FROM records WHERE player_id = ? AND board_id = ?`,
      )
      .bind(auth.playerId, boardId)
      .first<OwnRecordRow>();
    if (own) {
      yourBest = {
        strokes: own.total_strokes,
        toPar: own.total_strokes - own.total_par,
        gaveUp: own.gave_up === 1,
      };
    }

    const mine = await ownRankedRow(db, boardId, auth.playerId);
    if (mine) {
      yourRank = mine.rank;
      yourTied = mine.tied > 1;

      // 上位に入っていない人の周りだけ、追加で切り出して繋げる
      if (mine.position > R.topCount) {
        const from = Math.max(R.topCount + 1, mine.position - R.nearbyRadius);
        const to = mine.position + R.nearbyRadius;
        const nearby = await db
          .prepare(
            `${RANKED_CTE} SELECT * FROM ranked WHERE position BETWEEN ? AND ? ORDER BY position`,
          )
          .bind(boardId, from, to)
          .all<RankedRow>();
        const rows = nearby.results ?? [];
        rows.forEach((row, index) => {
          const entry = rankingEntry(row, playerId);
          // 上位から飛んでいるときだけ印を付ける。画面はここへ `…` の行を入れる
          if (index === 0 && from > R.topCount + 1) entry.gapBefore = true;
          entries.push(entry);
        });
      }
    }
  }

  const board: RankingBoard = {
    boardId,
    entries,
    yourRank,
    yourTied,
    yourBest,
    playerCount: await boardPlayerCount(db, boardId),
  };
  return json(board);
}

/**
 * 記録を登録する（同 §3-4・§4-4）。
 *
 * - **自己ベストのときだけ書き換える。** 同打数は更新扱いにしないので、
 *   一度38打を出した人は何度38打を出しても順位が動かない
 * - 同じ `submissionId` は二度受けない。**返す答えも1回目と同じ**にする
 * - 検証は段1まで。通ったものは `initialStatus`（いまは `pending`）で板に載る
 */
async function handleSubmit(request: Request, db: D1Database): Promise<Response> {
  if (Number(request.headers.get('Content-Length') ?? 0) > S.maxBodyBytes) {
    return error('Request too large', 413);
  }
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (!(await allowWrite(request, db, auth, 'submit', S.submitPerPlayer, S.submitPerIp))) {
    return error('Too many submissions', 429);
  }

  let body: SubmitRecordRequest;
  try {
    body = (await request.json()) as SubmitRecordRequest;
  } catch {
    return error('Invalid JSON');
  }
  const check = validateSubmission(body);
  if (!check.ok) return error(`Record rejected: ${check.reason}`, 422);

  const displayName = normalizeDisplayName(body.displayName);
  if (!displayName) return error('Invalid display name');
  const player = await ensurePlayer(db, auth, displayName);
  if (player instanceof Response) return player;

  // 二度目の送信。**同じ答えを返す**（電波が切れて送り直したときに二重登録しない）
  const duplicate = await db
    .prepare('SELECT response_json FROM submission_log WHERE submission_id = ? AND player_id = ?')
    .bind(body.submissionId, auth.playerId)
    .first<{ response_json: string }>();
  if (duplicate) return json(JSON.parse(duplicate.response_json) as SubmitRecordResponse);

  const previous = await db
    .prepare('SELECT total_strokes FROM records WHERE player_id = ? AND board_id = ?')
    .bind(auth.playerId, body.boardId)
    .first<{ total_strokes: number }>();
  const newBest = previous === null || body.totalStrokes < previous.total_strokes;

  if (newBest) {
    await db
      .prepare(
        `INSERT INTO records (
           player_id, board_id, total_strokes, total_par, hole_strokes_json, gave_up,
           generator, rules_version, app_version, shots_json, verification_status,
           achieved_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(player_id, board_id) DO UPDATE SET
           total_strokes = excluded.total_strokes,
           total_par = excluded.total_par,
           hole_strokes_json = excluded.hole_strokes_json,
           gave_up = excluded.gave_up,
           generator = excluded.generator,
           rules_version = excluded.rules_version,
           app_version = excluded.app_version,
           shots_json = excluded.shots_json,
           verification_status = excluded.verification_status,
           achieved_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE excluded.total_strokes < records.total_strokes`,
      )
      .bind(
        auth.playerId,
        body.boardId,
        body.totalStrokes,
        body.totalPar,
        JSON.stringify(body.holes),
        body.gaveUp ? 1 : 0,
        body.generator,
        body.rulesVersion,
        body.appVersion,
        JSON.stringify(body.shots),
        S.initialStatus,
      )
      .run();
  }

  const mine = await ownRankedRow(db, body.boardId, auth.playerId);
  const response: SubmitRecordResponse = {
    accepted: true,
    newBest,
    rank: mine?.rank ?? null,
    tied: (mine?.tied ?? 0) > 1,
    playerCount: await boardPlayerCount(db, body.boardId),
    status: S.initialStatus,
  };
  await db
    .prepare(
      `INSERT INTO submission_log (submission_id, player_id, board_id, status, response_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(body.submissionId, auth.playerId, body.boardId, S.initialStatus, JSON.stringify(response))
    .run();

  // 古いレート制限の行は溜め続けない。登録のついでに片付ける
  await db
    .prepare('DELETE FROM rate_limits WHERE window_start < ?')
    .bind(Math.floor(Date.now() / 1000) - S.rateKeepSeconds)
    .run();
  return json(response);
}

/**
 * 表ができているか。**繋いだだけでスキーマを流していない状態**を見分けるために引く。
 * 1行も読まない `LIMIT 1` なので、無料枠の行数にも実質響かない
 */
async function schemaReady(db: D1Database): Promise<boolean> {
  try {
    await db.prepare('SELECT 1 FROM records LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Static Assets が先に当たるので、ここへ来るのは /api/* と、資産の無いパスだけ
  if (!url.pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });

  if (request.method === 'GET' && url.pathname === '/api/health') {
    // `database` はバインディングの有無、`schema` は表ができているか。
    // **2つを分けて返す**ので、「D1は繋がっているが移行を流していない」が一目で分かる
    return json({
      ok: true,
      database: Boolean(env.DB),
      schema: env.DB ? await schemaReady(env.DB) : false,
    });
  }

  const db = env.DB;
  // D1をまだ作っていない（`wrangler.jsonc` の d1_databases が無い）。
  // ゲームの配信は動いたまま、ランキングの入口だけが使えない状態にする
  if (!db) return error('Ranking database is not configured', 503);

  if (request.method === 'GET' && url.pathname === '/api/rankings') {
    return handleRanking(request, db, url);
  }
  if (request.method === 'POST' && url.pathname === '/api/records') {
    return handleSubmit(request, db);
  }
  if (request.method === 'PUT' && url.pathname === '/api/player') {
    return handleUpdatePlayer(request, db);
  }
  if (request.method === 'DELETE' && url.pathname === '/api/player') {
    return handleDeletePlayer(request, db);
  }
  return error('Not found', 404);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
