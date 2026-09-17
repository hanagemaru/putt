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

/**
 * 通常ツアーを作っている生成器。**板IDに入るので、v2へ繋ぐときにここを変える。**
 * 変えれば板が分かれ、v1のコースで出した打数がv2のコースの記録に混ざらない。
 * 将来 `TourDefinition.generator` を足したらそちらを正本にする（`docs/ranking.md` §2-1）
 */
export type GeneratorVersion = 'v1' | 'v2';
export const TOUR_GENERATOR: GeneratorVersion = 'v1';

/**
 * 板（ランキングの単位）のID。**これが違えば別のランキング。**
 *
 *   `tour:<tourId>:<generator>:<seedsId>:r<rulesVersion>`
 *
 * `seedsId` はシード列のFNV-1a（`src/round-storage.ts`）。
 * **固定ホールを選び直せば板が自動的に分かれる**ので、古い記録が新しいコースの
 * 記録として混ざることはない。自己ベスト（`TourBestScoreStore`）と同じ守り方。
 */
export function tourBoardId(
  tourId: string,
  generator: GeneratorVersion,
  seedsId: string,
): string {
  return `tour:${tourId}:${generator}:${seedsId}:r${R.rulesVersion}`;
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

/** 登録の状態。`pending` は段2の検証待ち（板には載る） */
export type VerificationStatus = 'verified' | 'pending' | 'suspicious';

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
