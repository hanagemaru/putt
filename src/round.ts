// ラウンドの進行とスコア（spec §6）。基本ルールはストロークプレーで、
// ホールを順に回り、合計打数の少なさを競う。
//
// ここは**数の管理だけ**を持つ。コースの生成も表示も知らないので、
// 通常ツアー（固定9ホール）にもデイリー（自動生成3ホール）にも同じものを使う。

/** ホールアウトしたホール1つ分のスコア */
export interface HoleScore {
  /** 1始まりのホール番号 */
  number: number;
  seed: number;
  par: number;
  strokes: number;
  /** カップインしたか。false は打ち切り */
  holedOut: boolean;
}

/**
 * 1ラウンドの現在地とスコア。
 * ホールの中身はシードだけで決まるので、ここが持つのはシードの配列と何ホール目か。
 */
export class Round {
  private readonly seeds: readonly number[];
  private index = 0;
  private readonly played: HoleScore[] = [];

  constructor(seeds: readonly number[]) {
    if (seeds.length === 0) throw new Error('ラウンドには最低1ホール必要');
    this.seeds = seeds;
  }

  get holeCount(): number {
    return this.seeds.length;
  }

  /** 1始まりの現在ホール番号 */
  get holeNumber(): number {
    return this.index + 1;
  }

  get currentSeed(): number {
    return this.seeds[this.index];
  }

  /** ホールアウト済みのホールのスコア。表示用に読むだけ */
  get scores(): readonly HoleScore[] {
    return this.played;
  }

  get totalStrokes(): number {
    return this.played.reduce((sum, hole) => sum + hole.strokes, 0);
  }

  get totalPar(): number {
    return this.played.reduce((sum, hole) => sum + hole.par, 0);
  }

  /** ホールアウト済みのぶんのパー差 */
  get toPar(): number {
    return this.totalStrokes - this.totalPar;
  }

  /** まだ次のホールが残っているか */
  get hasNext(): boolean {
    return this.index + 1 < this.seeds.length;
  }

  /**
   * 現在のホールのスコアを確定する。1ホールにつき一度だけ記録し、
   * 二度目以降は無視する（カード表示中の再入で二重に積まない）。
   */
  recordHole(par: number, strokes: number, holedOut: boolean): void {
    if (this.played.length !== this.index) return;
    this.played.push({
      number: this.holeNumber,
      seed: this.currentSeed,
      par,
      strokes,
      holedOut,
    });
  }

  /** 次のホールへ進む。最終ホールでは何もしない */
  next(): void {
    if (this.hasNext) this.index++;
  }

  /** 最初のホールからやり直す */
  reset(): void {
    this.index = 0;
    this.played.length = 0;
  }
}

/** パー差の表示。0 は ±0、プラスは符号を付ける */
export function formatToPar(diff: number): string {
  if (diff === 0) return '±0';
  return diff > 0 ? `+${diff}` : String(diff);
}
