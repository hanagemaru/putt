// ランキングのサーバ（Cloudflare Workers + D1）。`docs/ranking.md` §5。
//
// 参照実装は Multicolor Sweeper の `src/server/worker.ts`。**構造はそのまま踏襲する。**
// 違うのは競う値（クリア時間 → 合計打数）と、板が増え続けることの2点。
//
// **いまあるのは器だけ**（`docs/ranking.md` §7 の「3. 器」）。
//
//   GET    /api/health  … 死活と、D1が繋がっているか
//   PUT    /api/player  … 表示名の登録・変更
//   DELETE /api/player  … **自分の記録と名前を全部消す**
//
// 登録（`POST /api/records`）と取得（`GET /api/rankings`）は段4で足す。
// それまでは 501 を返して、画面側は「あとで登録します」「いま見られません」へ落ちる。
//
// **D1をまだ作っていない間も落ちない。** `wrangler.jsonc` に d1_databases が無ければ
// `env.DB` が無いので、器が要る入口だけ 503 を返す（ゲームの配信には影響しない）。
//
// CPUの話（同 §4-3）: **無料枠は1リクエスト10ms。** ここでやるのはD1の読み書きだけで、
// **コース生成も物理も回さない**。リプレイ検証はWorkerの外（GitHub Actionsのバッチ）。

import { CONFIG } from '../config';
import { normalizeDisplayName, type UpdatePlayerRequest } from '../ranking-shared';

const S = CONFIG.game.ranking.server;

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

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Static Assets が先に当たるので、ここへ来るのは /api/* と、資産の無いパスだけ
  if (!url.pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json({ ok: true, database: Boolean(env.DB) });
  }

  // 段4で足す。それまでは黙って落ちるのではなく、理由の分かる形で断る
  if (url.pathname === '/api/records' || url.pathname === '/api/rankings') {
    return error('Ranking API is not open yet', 501);
  }

  const db = env.DB;
  // D1をまだ作っていない（`wrangler.jsonc` の d1_databases が無い）。
  // ゲームの配信は動いたまま、ランキングの入口だけが使えない状態にする
  if (!db) return error('Ranking database is not configured', 503);

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
