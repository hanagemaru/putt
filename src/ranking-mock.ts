// ランキングのモック（`docs/ranking.md` §6-6）。
//
// **Worker も D1 も無い状態で、動線・UI・失敗時の見え方・実機確認まで全部通すためのもの。**
// 中身は localStorage と、板IDから決まる偽の対戦相手だけ。ネットワークへは一切出ない。
//
// モックの値打ちは「本物のサーバでは再現しにくい分岐を、その場で出せる」こと。
// 場面は `?rankingMock=` で選ぶ（読むのは `src/ranking-client.ts` の `mockScenario`）。
//
//   empty        … 誰も登録していない板
//   crowded      … 同打数が大量に並ぶ板（`T12` の見え方の確認）
//   fail-submit  … 登録が必ず失敗する（`あとで登録します` の確認）
//   fail-fetch   … 取得が必ず失敗する（`いま見られません` の確認）
//   pending      … 登録は通るが検証待ちになる（`確認中` の確認）
//
// 本物ができたら `src/ranking-client.ts` の差し替えだけで消える。ここはそのとき捨てる。

import { CONFIG } from './config';
import {
  DEFAULT_PLAYER_NAME,
  rankRecords,
  visibleEntries,
  type PlayerIdentity,
  type RankableRecord,
  type RankingBoard,
  type SubmitRecordRequest,
  type SubmitRecordResponse,
} from './ranking-shared';

const R = CONFIG.game.ranking;

export type MockScenario = 'normal' | 'empty' | 'crowded' | 'fail-submit' | 'fail-fetch' | 'pending';

/** mulberry32。コース生成と同じ実装。板IDが同じなら毎回同じ顔ぶれになる */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 文字列から種を作る（FNV-1a 32bit）。`round-storage.ts` の `seedsId` と同じ作り */
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 偽の名前。**幅の確認に使うので、短い英字だけにしない。**
 * 日本語の名前・長い名前・記号入りが混ざったときの折り返しを実機で見たい
 */
const MOCK_NAMES = [
  'ACE',
  'カップイン',
  'BIRDIE',
  'ハナゲ',
  'LIP OUT',
  'パターマン',
  'PUTT PUTT',
  'マレット',
  'GREEN',
  'ギブアップ',
  'SLOW ROLL',
  'ピンハイ',
];

/** 保存する自分の記録。板ごとに1件 */
interface MockOwnRecord {
  strokes: number;
  toPar: number;
  gaveUp: boolean;
  achievedAt: number;
  status: 'verified' | 'pending' | 'suspicious';
}

interface MockStore {
  name: string | null;
  /** 板ID → 自分の記録 */
  records: Record<string, MockOwnRecord>;
}

function loadStore(): MockStore {
  try {
    const raw = localStorage.getItem(R.mockStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MockStore>;
      if (parsed && typeof parsed === 'object' && parsed.records) {
        return { name: parsed.name ?? null, records: parsed.records };
      }
    }
  } catch {
    // 読めないときは空から始める。モックなので捨ててよい
  }
  return { name: null, records: {} };
}

function saveStore(store: MockStore): void {
  try {
    localStorage.setItem(R.mockStorageKey, JSON.stringify(store));
  } catch {
    // 保存できなくても、そのセッションの表示までは動く
  }
}

/**
 * 偽の対戦相手。板IDから決まるので、開き直しても同じ顔ぶれ・同じ打数になる。
 *
 * 打数はパー36に対して +2 〜 +30 くらいへ寄せる。**同打数が大量に並ぶこと**が
 * この競技の実態なので、散らしすぎない
 */
function fakeRivals(boardId: string, count: number, spread: number): RankableRecord[] {
  const rng = makeRng(hashString(boardId));
  const out: RankableRecord[] = [];
  for (let i = 0; i < count; i++) {
    // 2つの一様乱数の和で山なりにする（中央に寄り、端が薄い）
    const over = Math.round(2 + (rng() + rng()) * spread);
    const gaveUp = rng() < 0.08;
    out.push({
      playerId: `mock-${i}`,
      name: `${MOCK_NAMES[Math.floor(rng() * MOCK_NAMES.length)]} ${i + 1}`,
      strokes: 36 + over,
      toPar: over,
      gaveUp,
      // 到達時刻は古いほうから順に。同打数は**先に出した人が上**になる
      achievedAt: i,
    });
  }
  return out;
}

/** モックの板を1枚組み立てる */
export function mockFetchRanking(
  boardId: string,
  identity: PlayerIdentity,
  scenario: MockScenario,
): RankingBoard {
  if (scenario === 'fail-fetch') throw new Error('mock: fetch failed');

  const store = loadStore();
  const own = store.records[boardId];
  const records: RankableRecord[] = [];

  if (scenario !== 'empty') {
    // crowded は人数を倍にして散らばりを半分にする。同打数の団子を大きくするため
    const crowded = scenario === 'crowded';
    records.push(
      ...fakeRivals(boardId, crowded ? R.mockPlayerCount * 2 : R.mockPlayerCount, crowded ? 6 : 14),
    );
  }

  // `suspicious` は板から外す（本人にだけ「確認中」と見せる）
  if (own && own.status !== 'suspicious') {
    records.push({
      playerId: identity.playerId,
      name: store.name ?? DEFAULT_PLAYER_NAME,
      strokes: own.strokes,
      toPar: own.toPar,
      gaveUp: own.gaveUp,
      achievedAt: own.achievedAt,
    });
  }

  const ranked = rankRecords(records, identity.playerId);
  const mine = ranked.find((entry) => entry.isPlayer) ?? null;
  return {
    boardId,
    entries: visibleEntries(ranked),
    yourRank: mine?.rank ?? null,
    yourTied: mine?.tied ?? false,
    yourBest: own ? { strokes: own.strokes, toPar: own.toPar, gaveUp: own.gaveUp } : null,
    playerCount: ranked.length,
  };
}

/** モックの登録。自己ベストのときだけ書き換えるのは本物と同じ */
export function mockSubmitRecord(
  request: SubmitRecordRequest,
  identity: PlayerIdentity,
  scenario: MockScenario,
): SubmitRecordResponse {
  if (scenario === 'fail-submit') throw new Error('mock: submit failed');

  const store = loadStore();
  store.name = request.displayName;
  const previous = store.records[request.boardId];
  const newBest = !previous || request.totalStrokes < previous.strokes;
  const status = scenario === 'pending' ? 'pending' : 'verified';

  if (newBest) {
    store.records[request.boardId] = {
      strokes: request.totalStrokes,
      toPar: request.totalStrokes - request.totalPar,
      gaveUp: request.gaveUp,
      // 偽の対戦相手より後に出したことにする（同打数なら自分が下）
      achievedAt: Number.MAX_SAFE_INTEGER,
      status,
    };
  }
  saveStore(store);

  const board = mockFetchRanking(request.boardId, identity, scenario);
  return {
    accepted: true,
    newBest,
    rank: board.yourRank,
    tied: board.yourTied,
    playerCount: board.playerCount,
    status,
  };
}

export function mockUpdatePlayerName(displayName: string): void {
  const store = loadStore();
  store.name = displayName;
  saveStore(store);
}

/** モックの全消し。本物の `DELETE /api/player` と同じ見え方にする */
export function mockDeletePlayer(): void {
  saveStore({ name: null, records: {} });
}
