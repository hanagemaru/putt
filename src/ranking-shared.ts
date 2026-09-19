// オンラインランキングで、画面とサーバの両方が使う型と規則（`docs/ranking.md`）。
//
// **ここはブラウザにもWorkerにも読み込まれる。** DOM も three.js も触らないこと。
// 数値は `CONFIG.game.ranking` に置く（`CLAUDE.md` の約束どおり、マジックナンバーを書かない）。
//
// 参照実装は Multicolor Sweeper の `src/ranking-shared.ts`。競うものが
// 「クリア時間」から「合計打数」へ変わったぶんと、**同打数が大量に出る**ぶんが違う。

import { CONFIG } from './config';

const R = CONFIG.game.ranking;

/** 名前を入れていない人の表示名。サーバも同じ既定を使う */
export const DEFAULT_PLAYER_NAME = 'PLAYER';

export type GeneratorVersion = 'v1' | 'v2';

/**
 * 板IDを決めるのに要るぶんだけのツアー（`TourDefinition` がそのまま入る）。
 * **course の型を持ち込まないため**に、構造だけで受ける（ここはWorkerからも読む）
 */
export interface TourIdentity {
  id: string;
  seeds: readonly number[];
  generator?: GeneratorVersion;
  setup?: unknown;
  holes?: readonly unknown[];
}

/** FNV-1a 32bit。`src/round-storage.ts` の `seedsId` と同じ作り */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * コースの作り方そのものの指紋。**これが同じなら、出てくる27ホールは同じ。**
 *
 * シード列だけでは足りない。いまの固定コースは
 * **ホールごとの仕立て（`holes[].setup`）と生成器（`holes[].generator`）**でも中身が変わるので、
 * 「シードは同じまま細い道を1本足す」と別のコースになるのに板が分かれない。
 * 生成に効くものを全部入れて、**中身が変わったら板も分かれる**ようにする。
 *
 * 名前と説明は入れない（変えても同じコースなので、板を分ける理由がない）。
 */
export function tourFingerprint(tour: TourIdentity): string {
  return fnv1a(
    JSON.stringify([tour.seeds, tour.generator ?? 'v1', tour.setup ?? null, tour.holes ?? null]),
  );
}

/**
 * 板（ランキングの単位）のID。**これが違えば別のランキング。**
 *
 *   `tour:<tourId>:<generator>:<fingerprint>:r<rulesVersion>`
 *
 * **コースの中身を変えれば板が自動的に分かれる**ので、古い記録が新しいコースの
 * 記録として混ざることはない。自己ベスト（`TourBestScoreStore`）と同じ守り方。
 */
export function tourBoardId(tour: TourIdentity): string {
  return `tour:${tour.id}:${tour.generator ?? 'v1'}:${tourFingerprint(tour)}:r${R.rulesVersion}`;
}

/** 板IDの形。サーバが受け取った文字列を検証するのに使う */
const BOARD_ID_PATTERN = /^(tour|weekly):[a-z0-9-]{1,40}(:[a-z0-9-]{1,40})*:r[0-9]{1,3}$/;

export function isBoardId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && BOARD_ID_PATTERN.test(value);
}

/** 匿名の身元。localStorage にだけ持ち、サーバは credential のハッシュしか持たない */
export interface PlayerIdentity {
  playerId: string;
  credential: string;
}

/** 1打の打ち出し。**再生に要るのはこの2つだけ**（打つ位置は前の打の結果） */
export type ShotInput = readonly [speed: number, direction: number];

/** ラウンド1つぶんの打ち出しの列。ホール順に並べる */
export type RoundShots = readonly (readonly ShotInput[])[];

/** 登録する1ホールぶんの結果 */
export interface SubmittedHole {
  number: number;
  seed: number;
  par: number;
  strokes: number;
  /** カップインしたか。false はギブアップ */
  holedOut: boolean;
}

export interface SubmitRecordRequest {
  /** 二重登録を弾く鍵。同じIDで送り直しても結果は1つ */
  submissionId: string;
  boardId: string;
  displayName: string;
  totalStrokes: number;
  totalPar: number;
  /** ギブアップを含むラウンドか。打数の後ろに `*` を出す */
  gaveUp: boolean;
  holes: readonly SubmittedHole[];
  /**
   * リプレイ用の打ち出しの列（`docs/ranking.md` §4）。
   * **段2の検証を後から有効にできるよう、段1の時点でも送って保存する。**
   * まだ記録していない段階では空配列で送る
   */
  shots: RoundShots;
  generator: GeneratorVersion;
  rulesVersion: number;
  appVersion: string;
  /**
   * スワイプ→初速の個人調整（0.5〜1.5）。**再現には要らない。**
   * 分布を見たいので送るだけで、**性能差ではなく感度なので順位には使わない**
   */
  putterPowerScale: number;
}

/**
 * 登録の状態（`docs/ranking.md` §4-4）。**板から外れるのは `suspicious` だけ。**
 *
 *   verified   … 段2のリプレイ検証が通った
 *   pending    … 検証待ち。**板には載る**（登録の直後はこれ）
 *   flagged    … 再生と打数が合わなかった。**板には載せたまま**こちらへ知らせ、人が判断する
 *   suspicious … 人が黒と決めた。**ここで初めて板から外れる**
 *
 * 機械の判定だけで記録を消さないための4段。物理の版ずれや取りこぼしで
 * **ちゃんと遊んだ人の記録が黙って消える**ほうが、嘘が1件混じるより悪い
 */
export type VerificationStatus = 'verified' | 'pending' | 'flagged' | 'suspicious';

/** 板に載せる状態。並びの問い合わせ（`src/server/worker.ts`）はこれだけを見る */
export const BOARD_VISIBLE_STATUSES: readonly VerificationStatus[] = [
  'verified',
  'pending',
  'flagged',
];

/** 板に載る状態か */
export function isOnBoard(status: string): boolean {
  return (BOARD_VISIBLE_STATUSES as readonly string[]).includes(status);
}

export interface SubmitRecordResponse {
  accepted: boolean;
  /** サーバ側でも自己ベストのときだけ書き換える */
  newBest: boolean;
  rank: number | null;
  /** 同じ順位が他にもいるか。`T12` と出すかどうか */
  tied: boolean;
  playerCount: number;
  status: VerificationStatus;
}

export interface RankingEntry {
  /** 同打数を同順位にまとめた表示順位（1始まり） */
  rank: number;
  /** 同じ順位が複数いるか。true なら `T12` と出す */
  tied: boolean;
  playerId: string;
  name: string;
  strokes: number;
  toPar: number;
  gaveUp: boolean;
  isPlayer: boolean;
  /**
   * この行の前で順位が飛んでいるか（上位と自分の周辺の間）。
   * **順位の差では判定できない**（同打数が12人並べば順位は12飛ぶ）ので、
   * 一覧を組んだ側が印を付ける
   */
  gapBefore?: boolean;
}

export interface RankingBoard {
  boardId: string;
  /**
   * 上位＋自分の周辺。**順位の昇順で、間が飛ぶことがある**
   * （飛んだところに `…` の行を1本入れるのは画面側の仕事）
   */
  entries: readonly RankingEntry[];
  yourRank: number | null;
  yourTied: boolean;
  yourBest: { strokes: number; toPar: number; gaveUp: boolean } | null;
  /** 板に登録している人数 */
  playerCount: number;
}

export interface UpdatePlayerRequest {
  displayName: string;
}

/**
 * 表示名を整える。**サーバと画面で同じ関数を使う**（片方だけ緩いと意味がない）。
 * NFC正規化して前後の空白を落とし、長さと危ない字だけを見る。
 * 中身の良し悪し（不適切な語）はここでは見ない
 */
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim();
  if (!normalized) return null;
  // 絵文字は2文字と数えないよう、コードポイントで数える
  if (Array.from(normalized).length > R.nameMaxLength) return null;
  // 制御文字（改行・タブなど）とタグに見える字は名前に入れない
  if (/[<>]/u.test(normalized)) return null;
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }
  return normalized;
}

/** 順位を付ける前の1件 */
export interface RankableRecord {
  playerId: string;
  name: string;
  strokes: number;
  toPar: number;
  gaveUp: boolean;
  /** 到達時刻 [ms]。同打数は**先に出した人が上** */
  achievedAt: number;
}

/**
 * 打数で並べて順位を付ける（`docs/ranking.md` §3-1）。
 *
 * 内部の並びは `打数 → 到達時刻 → playerId` で一意に決まるが、
 * **表示の順位は同打数をまとめたゴルフ流**にする。38打が12人なら12人とも `T3` で、
 * 次は `T15`。画面では同打数を並べ替えない（0.1打の差が無い競技で恣意的な上下を見せない）。
 *
 * サーバ（段4）は同じ規則をSQLの `RANK()` で出す。ここはモックと検証が使う。
 */
export function rankRecords(
  records: readonly RankableRecord[],
  playerId?: string,
): RankingEntry[] {
  const sorted = [...records].sort(
    (a, b) =>
      a.strokes - b.strokes ||
      a.achievedAt - b.achievedAt ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );

  return sorted.map((record, index) => {
    // 同打数の先頭の位置がその一団の順位。1位が12人なら次は13位
    let first = index;
    while (first > 0 && sorted[first - 1].strokes === record.strokes) first--;
    const tied =
      first !== index ||
      (index + 1 < sorted.length && sorted[index + 1].strokes === record.strokes);
    return {
      rank: first + 1,
      tied,
      playerId: record.playerId,
      name: record.name,
      strokes: record.strokes,
      toPar: record.toPar,
      gaveUp: record.gaveUp,
      isPlayer: record.playerId === playerId,
    };
  });
}

/**
 * 上位と自分の周辺だけを残す（`docs/ranking.md` §6-3）。
 * 全件を画面へ出すと、板が育つほど読み込みも描画も重くなる。
 */
export function visibleEntries(entries: readonly RankingEntry[]): RankingEntry[] {
  const own = entries.findIndex((entry) => entry.isPlayer);
  const out: RankingEntry[] = entries.slice(0, R.topCount);
  if (own < 0) return out;

  const from = Math.max(R.topCount, own - R.nearbyRadius);
  const to = Math.min(entries.length - 1, own + R.nearbyRadius);
  for (let i = from; i <= to; i++) {
    // 上位から飛んだところにだけ印を付ける。画面はここへ `…` の行を1本入れる
    out.push(i === from && from > R.topCount ? { ...entries[i], gapBefore: true } : entries[i]);
  }
  return out;
}
