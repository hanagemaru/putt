// ランキングの窓口（`docs/ranking.md` §6）。**画面はここだけを見る。**
//
// 中身は3つのうちどれか。`?ranking=api|mock|off` で切り替えると**保存へ移って続く**
// （言語の `?lang=` と同じ作り）。既定は `CONFIG.game.ranking.source`。
//
//   api  … 本物の Worker（`src/server/worker.ts`）
//   mock … サーバなしで動く偽データ（`src/ranking-mock.ts`）。実機確認はこれで通す
//   off  … 入口を出さない。**いまの既定。** GitHub Pages（`/putt/`）は常にこれ
//
// **ここから先はゲームを止めない。** 送れない・読めないは普通に起きることとして扱い、
// 例外はこのファイルの中か、呼んだ画面の中で必ず受け止める。

import { CONFIG } from './config';
import {
  mockDeletePlayer,
  mockFetchRanking,
  mockSubmitRecord,
  mockUpdatePlayerName,
  type MockScenario,
} from './ranking-mock';
import {
  normalizeDisplayName,
  type PlayerIdentity,
  type RankingBoard,
  type SubmitRecordRequest,
  type SubmitRecordResponse,
  type UpdatePlayerRequest,
} from './ranking-shared';

const R = CONFIG.game.ranking;

export type RankingSource = 'api' | 'mock' | 'off';

/**
 * `?key=` で選んだものを保存へ移して、画面を移っても続くようにする。
 * **言語（`?lang=`）と同じ作り。** 遷移でクエリを持ち回らないので、
 * これが無いとトップでモックを選んでもゲームへ入った時点で消える
 */
function stickyChoice<T extends string>(
  key: string,
  storageKey: string,
  allowed: readonly T[],
): T | null {
  const isAllowed = (value: string | null): value is T =>
    value !== null && (allowed as readonly string[]).includes(value);

  const requested = new URLSearchParams(window.location.search).get(key);
  if (isAllowed(requested)) {
    try {
      localStorage.setItem(storageKey, requested);
    } catch {
      // 保存できなくても、この画面の間は効く
    }
    return requested;
  }
  try {
    const stored = localStorage.getItem(storageKey);
    if (isAllowed(stored)) return stored;
  } catch {
    // 読めなければ既定へ
  }
  return null;
}

/**
 * どこから取るか。
 *
 * **GitHub Pages（`/putt/`）にはAPIが無い**ので、`api` を指定されても `off` へ落とす。
 * 配信先の見分けはベースパス1本（`DEPLOY.md`）。`/` なら Cloudflare Workers。
 */
export function rankingSource(): RankingSource {
  const source =
    stickyChoice<RankingSource>('ranking', R.sourceStorageKey, ['api', 'mock', 'off']) ?? R.source;
  if (source === 'api' && import.meta.env.BASE_URL !== '/') return 'off';
  return source;
}

/**
 * モックで作る場面（`src/ranking-mock.ts`）。**実機で見たい分岐をここで指定する。**
 * `?rankingMock=empty|crowded|fail-submit|fail-fetch|pending`
 */
export function mockScenario(): MockScenario {
  return (
    stickyChoice<MockScenario>('rankingMock', R.mockScenarioStorageKey, [
      'empty',
      'crowded',
      'fail-submit',
      'fail-fetch',
      'pending',
    ]) ?? 'normal'
  );
}

/** ランキングの入口を出してよいか */
export function rankingAvailable(): boolean {
  return rankingSource() !== 'off';
}

// --- identity と表示名 ----------------------------------------------------

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

function makePlayerId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${randomHex(16)}-${Date.now().toString(16)}`;
}

/**
 * 匿名の身元を読む。無ければ作って保存する。
 *
 * **localStorage に閉じるので端末を変えると引き継げない**（`docs/ranking.md` §6-1）。
 * 保存できない環境でも、そのセッションの間だけ使える身元を返して先へ進む
 */
export function readOrCreateIdentity(): PlayerIdentity {
  try {
    const raw = localStorage.getItem(R.identityStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerIdentity>;
      if (parsed && typeof parsed.playerId === 'string' && typeof parsed.credential === 'string') {
        if (parsed.playerId && parsed.credential) {
          return { playerId: parsed.playerId, credential: parsed.credential };
        }
      }
    }
  } catch {
    // 壊れていたら作り直す
  }

  const identity: PlayerIdentity = { playerId: makePlayerId(), credential: randomHex(32) };
  try {
    localStorage.setItem(R.identityStorageKey, JSON.stringify(identity));
  } catch {
    // 保存できなくても、このセッションの間は使える
  }
  return identity;
}

/** 表示名。**まだ決めていなければ null**（登録の前に一度だけ聞く） */
export function loadPlayerName(): string | null {
  try {
    return normalizeDisplayName(localStorage.getItem(R.nameStorageKey));
  } catch {
    return null;
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(R.nameStorageKey, name);
  } catch {
    // 保存できない環境では、そのセッションの登録にだけ使われる
  }
}

function clearPlayerName(): void {
  try {
    localStorage.removeItem(R.nameStorageKey);
  } catch {
    // 消せなくてもここで止めない
  }
}

// --- 保留（送れなかった記録） ---------------------------------------------

type PendingMap = Record<string, SubmitRecordRequest>;

function loadPending(): PendingMap {
  try {
    const raw = localStorage.getItem(R.pendingStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PendingMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePending(pending: PendingMap): void {
  try {
    if (Object.keys(pending).length === 0) localStorage.removeItem(R.pendingStorageKey);
    else localStorage.setItem(R.pendingStorageKey, JSON.stringify(pending));
  } catch {
    // 積めなくても今回の表示は続ける
  }
}

/**
 * 送れなかった記録を積む。**板ごとに最新の1件だけ**でよい
 * （古い記録は自己ベストではないので、送っても上書きされない）
 */
function holdForLater(request: SubmitRecordRequest): void {
  const pending = loadPending();
  pending[request.boardId] = request;
  savePending(pending);
}

/**
 * 積んであった記録を送り直す。**起動時に一度だけ呼ぶ。**
 * 失敗しても積んだままにするので、次の起動でまた試す
 */
export async function flushPendingSubmissions(): Promise<void> {
  if (rankingSource() === 'off') return;
  const pending = loadPending();
  const boards = Object.keys(pending);
  // 積んでいるものが無ければ何もしない。**ここで identity を作らない**
  // （ランキングを使っていない人の端末に匿名IDを置かないため）
  if (boards.length === 0) return;

  const identity = readOrCreateIdentity();
  let changed = false;
  for (const boardId of boards) {
    try {
      await sendRecord(pending[boardId], identity);
      delete pending[boardId];
      changed = true;
    } catch {
      // まだ送れない。積んだままにして次の起動を待つ
    }
  }
  if (changed) savePending(pending);
}

// --- HTTP -----------------------------------------------------------------

function authHeaders(identity: PlayerIdentity): Record<string, string> {
  return {
    Authorization: `Bearer ${identity.playerId}.${identity.credential}`,
    'Content-Type': 'application/json',
  };
}

/**
 * 待ちすぎない取得。**電波が弱いときにラウンド終了カードを止めない**ため、
 * `requestTimeoutMs` で打ち切って失敗として扱う
 */
async function request<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), R.requestTimeoutMs);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`ranking api ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function sendRecord(
  body: SubmitRecordRequest,
  identity: PlayerIdentity,
): Promise<SubmitRecordResponse> {
  if (rankingSource() === 'mock') return mockSubmitRecord(body, identity, mockScenario());
  return request<SubmitRecordResponse>('/api/records', {
    method: 'POST',
    headers: authHeaders(identity),
    body: JSON.stringify(body),
  });
}

// --- 画面から呼ぶ3つ ------------------------------------------------------

/** 板を1枚取る。**失敗は投げる**（呼んだ画面が「いま見られません」を出す） */
export async function fetchRanking(
  boardId: string,
  identity: PlayerIdentity,
): Promise<RankingBoard> {
  if (rankingSource() === 'mock') return mockFetchRanking(boardId, identity, mockScenario());
  return request<RankingBoard>(
    `/api/rankings?board=${encodeURIComponent(boardId)}`,
    { method: 'GET', headers: authHeaders(identity) },
  );
}

/** 登録の結果。**失敗しても投げない**（ゲームを止めないため） */
export type SubmitOutcome =
  | { ok: true; response: SubmitRecordResponse }
  | { ok: false; held: true };

/**
 * 記録を登録する。送れなければ保留へ積んで `held` を返す。
 * 呼び側は「あとで登録します」と出すだけでよい
 */
export async function submitRecord(
  body: SubmitRecordRequest,
  identity: PlayerIdentity,
): Promise<SubmitOutcome> {
  try {
    return { ok: true, response: await sendRecord(body, identity) };
  } catch {
    holdForLater(body);
    return { ok: false, held: true };
  }
}

/** 表示名を変える。保存は先に済ませ、サーバへの反映は失敗してもよい */
export async function updatePlayerName(name: string, identity: PlayerIdentity): Promise<void> {
  savePlayerName(name);
  if (rankingSource() === 'mock') {
    mockUpdatePlayerName(name);
    return;
  }
  const body: UpdatePlayerRequest = { displayName: name };
  await request<{ ok: true }>('/api/player', {
    method: 'PUT',
    headers: authHeaders(identity),
    body: JSON.stringify(body),
  });
}

/**
 * 自分の記録と名前を全部消す（`docs/ranking.md` §5-3）。
 * **消し方が無い状態で公開しない。** 端末側の名前と保留も一緒に片付ける
 */
export async function deletePlayer(identity: PlayerIdentity): Promise<void> {
  if (rankingSource() === 'mock') mockDeletePlayer();
  else {
    await request<{ ok: true }>('/api/player', {
      method: 'DELETE',
      headers: authHeaders(identity),
    });
  }
  clearPlayerName();
  savePending({});
}
