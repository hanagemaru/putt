// ラウンド進行の保存と復元（spec §6）。
//
// iOS Safari はバックグラウンドのタブを捨てて復帰時に読み込み直すので、
// 何もしないとホーム画面へ戻っただけでラウンドが最初からになる。
//
// 保存するのは **何ホール目かとホールアウト済みのスコアだけ**。
// 進行中のホールは打数もボール位置も持たず、**そのホールの頭から再開する**。
// 途中まで持つと狙い・直前のショット位置・罰打まで整合を取る必要があり、
// 保存漏れがそのままバグになるので、意図的に持たない。
//
// ここは localStorage への出し入れと妥当性の判断だけを持ち、ラウンドの中身は知らない。
// 通常ツアーだけでなく、チャレンジ（期間ごとの進行）や自己ベストでも同じ形で使う。

import type { RoundProgress } from './round';

/** localStorage に入れる形。読むときは全部疑ってかかる */
interface SavedRound {
  version: number;
  /** シード列の識別子。並びが変わったら合わなくなる */
  seedsId: string;
  progress: RoundProgress;
}

/**
 * シードの並びから決まる識別子（FNV-1a 32bit）。
 *
 * 固定9ホールのシード（`src/course/tour-holes.ts`）は選び直す予定で、
 * **並びが変わったのに古い保存を読むと、ホール番号と中身がずれて
 * まったく違うホールのスコアが混ざる。** 保存にこれを入れておき、
 * 合わなければ黙って捨てて最初から始める。
 */
export function seedsId(seeds: readonly number[]): string {
  let hash = 0x811c9dc5;
  const text = seeds.join(',');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * 1つのラウンド進行の保存場所。
 * `key` ごとに別々に持てるので、ツアーとチャレンジで同じものを使い分けられる。
 *
 * **localStorage が使えない環境（プライベートブラウズ等）でも落ちないこと。**
 * 読めない・書けないときは「保存がない」ものとして黙って続ける。
 */
export class RoundProgressStore {
  private readonly id: string;

  constructor(
    private readonly key: string,
    private readonly version: number,
    seeds: readonly number[],
  ) {
    this.id = seedsId(seeds);
  }

  /**
   * 保存を読む。**バージョン違い・シード列違い・壊れた JSON はすべて null**。
   * 古い保存はここで捨てる（呼び側は最初から始めるだけでよい）
   */
  load(): RoundProgress | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.key);
    } catch {
      // localStorage が使えない環境では保存なしとして扱う
      return null;
    }
    if (raw === null) return null;
    let saved: SavedRound | null = null;
    try {
      saved = JSON.parse(raw) as SavedRound;
    } catch {
      // 壊れた JSON も古い保存と同じ扱い
      this.clear();
      return null;
    }
    if (
      !saved ||
      typeof saved !== 'object' ||
      saved.version !== this.version ||
      saved.seedsId !== this.id ||
      !saved.progress
    ) {
      this.clear();
      return null;
    }
    return saved.progress;
  }

  /** 今の進行を保存する。書けなくても黙って続ける */
  save(progress: RoundProgress): void {
    const saved: SavedRound = { version: this.version, seedsId: this.id, progress };
    try {
      localStorage.setItem(this.key, JSON.stringify(saved));
    } catch {
      // 容量超過やプライベートブラウズ。保存できないだけでゲームは続く
    }
  }

  /** 保存を片付ける。終わったラウンドを再開してしまわないように */
  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // 消せなくてもここで止めない
    }
  }
}
