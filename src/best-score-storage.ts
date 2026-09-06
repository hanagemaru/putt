import { seedsId } from './round-storage';

export interface BestScore {
  strokes: number;
  par: number;
}

export interface BestScoreUpdate {
  score: BestScore;
  isNewBest: boolean;
}

interface SavedBestScore extends BestScore {
  version: number;
  seedsId: string;
}

const STORAGE_VERSION = 1;
const STORAGE_KEY_PREFIX = 'putt-tour-best';

/**
 * 固定ツアー1セット分の自己ベスト保存。
 *
 * コースのシード列も一緒に識別するため、固定ホールを差し替えた後に
 * 古いベストが別コースの記録として表示されることはない。
 * localStorage が使えない環境でも、保存できないだけでゲームは続ける。
 */
export class TourBestScoreStore {
  private readonly key: string;
  private readonly id: string;

  constructor(tourId: string, seeds: readonly number[]) {
    this.key = `${STORAGE_KEY_PREFIX}-${tourId}`;
    this.id = seedsId(seeds);
  }

  load(): BestScore | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.key);
    } catch {
      return null;
    }
    if (raw === null) return null;

    let saved: SavedBestScore | null = null;
    try {
      saved = JSON.parse(raw) as SavedBestScore;
    } catch {
      this.clear();
      return null;
    }

    if (!validSavedBestScore(saved, this.id)) {
      this.clear();
      return null;
    }

    return { strokes: saved.strokes, par: saved.par };
  }

  /** 今回の完走スコアが自己ベストなら更新する。同打数は更新扱いにしない。 */
  record(strokes: number, par: number): BestScoreUpdate {
    const current = this.load();
    if (current && current.strokes <= strokes) {
      return { score: current, isNewBest: false };
    }

    const next: BestScore = { strokes, par };
    const saved: SavedBestScore = {
      version: STORAGE_VERSION,
      seedsId: this.id,
      ...next,
    };

    try {
      localStorage.setItem(this.key, JSON.stringify(saved));
    } catch {
      // 保存不可でも、今回の結果表示までは続ける
    }

    return { score: next, isNewBest: true };
  }

  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // localStorage が使えなくてもここで止めない
    }
  }
}

function validSavedBestScore(value: SavedBestScore | null, id: string): value is SavedBestScore {
  return (
    !!value &&
    typeof value === 'object' &&
    value.version === STORAGE_VERSION &&
    value.seedsId === id &&
    Number.isInteger(value.strokes) &&
    value.strokes > 0 &&
    Number.isInteger(value.par) &&
    value.par > 0
  );
}
