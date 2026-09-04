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
  /** カップインしたか。false はギブアップ */
  holedOut: boolean;
}

/**
 * 保存・復元でやりとりする進行の中身（spec §6）。
 * **現在のホールの頭から再開する**方式なので、進行中のホールの打数や
 * ボール位置は持たない。持つのは何ホール目かとホールアウト済みのスコアだけ。
 */
export interface RoundProgress {
  /** 0始まりの現在ホール添字 */
  holeIndex: number;
  /** ホールアウト済みのスコア。ホール1から順に並ぶ */
  scores: HoleScore[];
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

  /**
   * 保存用に今の進行を取り出す。進行中のホールの打数は入らない。
   *
   * ホールアウトのカードを出している間は、スコアを記録済みでもまだ `index` が
   * そのホールに残っている。**再開の単位は「まだ打っていない最初のホールの頭」**なので、
   * ここでは記録済みのぶんだけ先へ進めた形で出す（カードは1タップで消えるだけの表示）
   */
  snapshot(): RoundProgress {
    return {
      holeIndex: Math.max(this.index, this.played.length),
      scores: this.played.map((hole) => ({ ...hole })),
    };
  }

  /**
   * 保存から進行を戻す。**戻せたときだけ true。**
   *
   * 保存が今のシード列と食い違っていたら（ツアーのシードを選び直した後など）
   * ホール番号と中身がずれて別のホールのスコアが混ざるので、少しでも
   * 合わないものは戻さない。呼び側はその保存を捨てて最初から始める
   */
  restore(progress: RoundProgress | null | undefined): boolean {
    if (!progress || typeof progress !== 'object') return false;
    const { holeIndex, scores } = progress;
    if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex >= this.seeds.length) {
      return false;
    }
    // ホールアウト済みは「現在ホールより前の全部」でなければならない
    if (!Array.isArray(scores) || scores.length !== holeIndex) return false;
    for (let i = 0; i < scores.length; i++) {
      if (!validHoleScore(scores[i], i + 1, this.seeds[i])) return false;
    }
    this.index = holeIndex;
    this.played.length = 0;
    for (const hole of scores) this.played.push({ ...hole });
    return true;
  }
}

/** 保存から読んだ1ホール分が、今のシード列のそのホールとして筋が通っているか */
function validHoleScore(hole: HoleScore, number: number, seed: number): boolean {
  return (
    !!hole &&
    typeof hole === 'object' &&
    hole.number === number &&
    hole.seed === seed &&
    Number.isInteger(hole.par) &&
    hole.par > 0 &&
    Number.isInteger(hole.strokes) &&
    hole.strokes >= 0 &&
    typeof hole.holedOut === 'boolean'
  );
}

/** パー差の表示。0 は ±0、プラスは符号を付ける */
export function formatToPar(diff: number): string {
  if (diff === 0) return '±0';
  return diff > 0 ? `+${diff}` : String(diff);
}
