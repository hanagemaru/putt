// コース境界へ自然な揺らぎを与えるための決定論的ノイズ（spec §1）。
//
// ここにある関数はすべて **引数だけで戻り値が決まる純関数**。内部状態も乱数列も持たないので、
// `surfaceAt` が任意座標を任意の順序・回数で呼んでも同じ答えを返す。
// 揺らぎの元は `CourseDefinition.seed` だけで、実行ごとに変わる値は使わない。

/**
 * 32bit の整数ハッシュ。座標（格子点）とシードだけから [0,1) を返す。
 * mulberry32 のような「列」ではなく1点ずつ引けるので、評価順に依存しない。
 */
function hashLattice(seed: number, i: number, j: number): number {
  let h = (seed ^ Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/** 5次のスムーズステップ。1階・2階微分が格子点で連続になり、境界に格子の目が出ない */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 格子ごとの値を補間する2Dバリューノイズ。戻り値は [-1, 1] */
export function valueNoise2(seed: number, x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const tx = fade(x - xi);
  const tz = fade(z - zi);
  const n00 = hashLattice(seed, xi, zi);
  const n10 = hashLattice(seed, xi + 1, zi);
  const n01 = hashLattice(seed, xi, zi + 1);
  const n11 = hashLattice(seed, xi + 1, zi + 1);
  const a = n00 + (n10 - n00) * tx;
  const b = n01 + (n11 - n01) * tx;
  return (a + (b - a) * tz) * 2 - 1;
}

/** オクターブごとにシードをずらす量。調整値ではなく、別のノイズ列を引くための識別子 */
const OCTAVE_SALT = 0x9e3779b9;

export interface FbmParams {
  /** 重ねる層の数 */
  octaves: number;
  /** 層ごとに周波数を何倍にするか */
  lacunarity: number;
  /** 層ごとに振幅を何倍にするか */
  gain: number;
}

/**
 * 複数オクターブを重ねた2Dノイズ。振幅の総和で正規化するので戻り値は必ず [-1, 1] に収まる。
 * 「必ず収まる」ことは重要で、帯の幅の揺らぎが 100% 未満なら幅が負にならない保証になる。
 */
export function fbm2(seed: number, x: number, z: number, p: FbmParams): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < p.octaves; o++) {
    sum += amplitude * valueNoise2((seed + o * OCTAVE_SALT) >>> 0, x * frequency, z * frequency);
    norm += amplitude;
    amplitude *= p.gain;
    frequency *= p.lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** 角度に対して周期的な揺らぎ。位相と重みをシードから決めた余弦波の重ね合わせ */
export interface AngularHarmonics {
  /** 波数 */
  order: number;
  /** 重み。総和が 1 になるよう正規化済み */
  weight: number;
  /** 位相 [rad] */
  phase: number;
}

/**
 * 波数 `orderMin`〜`orderMax` の調和成分を作る。
 * 角度の関数なので θ と θ+2π で必ず同じ値になり、輪郭が閉じる。
 */
export function makeAngularHarmonics(
  seed: number,
  orderMin: number,
  orderMax: number,
): AngularHarmonics[] {
  const harmonics: AngularHarmonics[] = [];
  let total = 0;
  for (let order = orderMin; order <= orderMax; order++) {
    // 高い波数ほど小さくして、細かいギザギザではなく大きな凹凸にする
    const weight = (0.4 + hashLattice(seed, order, 0) * 0.6) / order;
    harmonics.push({ order, weight, phase: hashLattice(seed, order, 1) * Math.PI * 2 });
    total += weight;
  }
  if (total > 0) {
    for (const h of harmonics) h.weight /= total;
  }
  return harmonics;
}

/** 調和成分を評価する。戻り値は [-1, 1] */
export function evalAngularHarmonics(harmonics: readonly AngularHarmonics[], theta: number): number {
  let sum = 0;
  for (const h of harmonics) sum += h.weight * Math.cos(h.order * theta + h.phase);
  return sum;
}
