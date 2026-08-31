// コース生成器（spec §1）。シードひとつから遊べる `CourseDefinition` を1ホール作る。
//
// 生成した形が必ず遊べるとは限らないので、**検証器（`validateCourse`）を通ったものだけを返す**。
// 通らなければ枝番を進めて作り直し、それでも駄目なら池なしの素直な形へ落とす。
//
// 決定論の約束: 戻り値はシード（と難易度・型の指定）だけで決まる。
// 実行ごとに変わる値（時刻・Math.random）は一切使わない。

import { CONFIG } from '../config';
import { distanceToRoute } from './course-map';
import { validateCourse } from './course-validate';
import type {
  CourseDefinition,
  CoursePoint,
  EllipseHazard,
  TerrainType,
} from './course-types';

const G = CONFIG.course.generator;
const N = CONFIG.course.edgeNoise;
const T = CONFIG.course.terrain;

export type Difficulty = 'easy' | 'normal' | 'hard';
export type HoleShape = 'straight' | 'dogleg' | 'doubleDogleg';

export interface GenerateOptions {
  /** 難易度を決め打ちする。省略するとシードから選ぶ */
  difficulty?: Difficulty;
  /** 形の型を決め打ちする。省略するとシードから選ぶ */
  shape?: HoleShape;
  /** 地形の性格を決め打ちする。省略するとシードから選ぶ */
  terrain?: TerrainType;
  /** 表示名。省略すると難易度と型から作る */
  name?: string;
  /** ID。省略するとシードから作る */
  id?: string;
}

/** mulberry32。シードから再現可能な擬似乱数（green.ts と同じ実装） */
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

type Range = readonly [number, number];

function pick(rng: () => number, range: Range): number {
  return range[0] + (range[1] - range[0]) * rng();
}

function pickInt(rng: () => number, range: Range): number {
  return Math.floor(range[0] + (range[1] - range[0] + 1) * rng());
}

/** 重み付きの選択。キーの並び順は固定なので、同じシードなら同じものを選ぶ */
function pickWeighted<K extends string>(rng: () => number, weights: Record<K, number>): K {
  const keys = Object.keys(weights) as K[];
  let total = 0;
  for (const key of keys) total += weights[key];
  let r = rng() * total;
  for (const key of keys) {
    r -= weights[key];
    if (r <= 0) return key;
  }
  return keys[keys.length - 1];
}

/**
 * 揺らぎが最大まで振れたときの、芝＋ラフ＋セカンドカットの片側の幅 [m]。
 * ここより外は必ずOBなので、コース枠をこの幅を基準に広げるとOBの量を狙って作れる。
 * （枠が狭すぎると盤面が丸ごと芝になってOBが消え、広すぎると外周の無駄な余白が増える）
 */
function maxPlayableHalfWidth(greenWidth: number, rough: number, deep: number): number {
  return (
    (greenWidth / 2) * (1 + N.greenAmplitude) +
    rough * (1 + N.roughAmplitude) +
    deep * (1 + N.deepRoughAmplitude)
  );
}

const LABEL: Record<Difficulty, string> = { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' };
const SHAPE_LABEL: Record<HoleShape, string> = {
  straight: 'ストレート',
  dogleg: 'ドッグレッグ',
  doubleDogleg: 'S字',
};

/**
 * ルート（芝の中心線）を作る。局所座標でティーを原点・進行方向を +Z として組み立ててから、
 * 外接矩形の中心が原点へ来るよう平行移動する。コース枠は原点中心の長方形なので、
 * この平行移動でルートが枠の真ん中に収まる。
 */
function buildRoute(rng: () => number, shape: HoleShape, total: number, cornerDeg: Range): CoursePoint[] {
  const points: CoursePoint[] = [{ x: 0, z: 0 }];
  let x = 0;
  let z = 0;
  let heading = 0; // +Z を 0 とした進行方向 [rad]

  const advance = (distance: number) => {
    x += Math.sin(heading) * distance;
    z += Math.cos(heading) * distance;
    points.push({ x, z });
  };

  // 曲がる向き。左右どちらにも同じだけ出す
  const side = rng() < 0.5 ? -1 : 1;

  if (shape === 'straight') {
    // 完全な直線は幾何学的すぎるので、中間を少しだけ膨らませて弓なりにする
    const bow = pick(rng, G.straightBow) * side;
    const half = total / 2;
    points.length = 0;
    points.push({ x: 0, z: 0 });
    points.push({ x: bow, z: half });
    points.push({ x: 0, z: total });
  } else if (shape === 'dogleg') {
    const first = total * pick(rng, [0.4, 0.6]);
    advance(first);
    heading += (pick(rng, cornerDeg) * Math.PI) / 180 * side;
    advance(total - first);
  } else {
    // S字。2回、逆向きに曲がる
    const first = total * pick(rng, [0.28, 0.38]);
    const second = total * pick(rng, [0.28, 0.38]);
    advance(first);
    heading += (pick(rng, cornerDeg) * Math.PI) / 180 * side;
    advance(second);
    heading -= (pick(rng, cornerDeg) * Math.PI) / 180 * side;
    advance(total - first - second);
  }

  // 外接矩形の中心を原点へ寄せる
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return points.map((p) => ({ x: p.x - cx, z: p.z - cz }));
}

/** ルートの全長 [m] */
function routeLength(route: readonly CoursePoint[]): number {
  let sum = 0;
  for (let i = 1; i < route.length; i++) {
    sum += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
  }
  return sum;
}

function parFor(length: number): number {
  const [a, b, c] = G.parThresholds;
  if (length <= a) return 2;
  if (length <= b) return 3;
  if (length <= c) return 4;
  return 5;
}

/**
 * 池を置く。ティーとカップを結ぶ直線の途中（＝近道を狙う線）の脇に寄せるので、
 * 「真っ直ぐ狙うと池、刻めば安全」という選択になる。
 * 芝の通り道を塞がない距離まで離せなければ、その池は諦める（数を減らす）。
 */
function placeHazards(
  rng: () => number,
  count: number,
  draft: CourseDefinition,
): EllipseHazard[] {
  const hazards: EllipseHazard[] = [];
  const halfWidth = draft.bounds.width / 2;
  const halfLength = draft.bounds.length / 2;
  // 芝の通り道は必ず空けておく。ここへ食い込むと刻むルートまで塞いでしまう
  const corridor = draft.greenWidth / 2 + draft.waterFringe;

  for (let i = 0; i < count; i++) {
    const radiusMajor = pick(rng, G.hazardRadius);
    const aspect = pick(rng, G.hazardAspect);
    const radiusX = radiusMajor;
    const radiusZ = radiusMajor * aspect;
    const maxRadius = Math.max(radiusX, radiusZ);
    const minRouteDistance = corridor + maxRadius * G.hazardRouteClearance;

    let placed: EllipseHazard | null = null;
    for (let attempt = 0; attempt < 24 && !placed; attempt++) {
      // ティー→カップの直線上を基準に、直交方向へずらす
      const t = pick(rng, [0.25, 0.75]);
      const baseX = draft.tee.x + (draft.cup.x - draft.tee.x) * t;
      const baseZ = draft.tee.z + (draft.cup.z - draft.tee.z) * t;
      const angle = rng() * Math.PI * 2;
      const offset = pick(rng, [0, minRouteDistance + maxRadius]);
      const center = {
        x: baseX + Math.cos(angle) * offset,
        z: baseZ + Math.sin(angle) * offset,
      };
      // 枠からはみ出す池は、外周のOBと繋がって池に見えない
      if (Math.abs(center.x) + radiusX > halfWidth - 0.5) continue;
      if (Math.abs(center.z) + radiusZ > halfLength - 0.5) continue;
      if (distanceToRoute(draft, center.x, center.z) < minRouteDistance) continue;
      const clearance = G.hazardTeeCupClearance + maxRadius;
      if (Math.hypot(center.x - draft.tee.x, center.z - draft.tee.z) < clearance) continue;
      if (Math.hypot(center.x - draft.cup.x, center.z - draft.cup.z) < clearance) continue;
      // 池どうしがくっつくと1つの大きな池になり、意図した数より効きが強くなる
      const tooClose = hazards.some(
        (h) =>
          Math.hypot(h.center.x - center.x, h.center.z - center.z) <
          Math.max(h.radiusX, h.radiusZ) + maxRadius + 0.8,
      );
      if (tooClose) continue;
      placed = { type: 'water', center, radiusX, radiusZ };
    }
    if (placed) hazards.push(placed);
  }
  return hazards;
}

/** 1回分の生成。検証はしない */
function draftCourse(seed: number, options: GenerateOptions): CourseDefinition {
  const rng = makeRng(seed);
  const difficulty = options.difficulty ?? pickWeighted(rng, G.difficultyWeights);
  const shape = options.shape ?? pickWeighted(rng, G.shapeWeights);
  const d = G.difficulty[difficulty];

  const total = pick(rng, d.routeLength);
  const route = buildRoute(rng, shape, total, d.cornerAngle);
  const greenWidth = pick(rng, d.greenWidth);
  const roughFringe = pick(rng, d.roughFringe);
  const deepRoughFringe = pick(rng, d.deepRoughFringe);
  const waterFringe = pick(rng, G.waterFringe);

  // コース枠。ルートの外接矩形を、揺らぎなしの芝の幅を基準に広げる
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of route) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const expand =
    maxPlayableHalfWidth(greenWidth, roughFringe, deepRoughFringe) * pick(rng, G.boundsExpand);
  const round = (v: number) => Math.ceil(v / G.boundsStep) * G.boundsStep;
  const bounds = {
    width: round(maxX - minX + expand * 2),
    length: round(maxZ - minZ + expand * 2),
  };

  const tee = route[0];
  const cup = route[route.length - 1];
  const terrain = options.terrain ?? pickWeighted(rng, T.weights);
  const hazardCount = pickInt(rng, d.hazardCount);

  const draft: CourseDefinition = {
    id: options.id ?? `gen-${(seed >>> 0).toString(36)}`,
    name: options.name ?? `${LABEL[difficulty]}・${SHAPE_LABEL[shape]}`,
    par: parFor(routeLength(route)),
    seed: seed >>> 0,
    terrain,
    bounds,
    tee,
    cup,
    route,
    greenWidth,
    roughFringe,
    deepRoughFringe,
    waterFringe,
    hazards: [],
  };
  return { ...draft, hazards: placeHazards(rng, hazardCount, draft) };
}

export interface GeneratedCourse {
  course: CourseDefinition;
  /** 何回目の試行で通ったか（1 始まり）。調整の目安に使う */
  attempts: number;
  /** 検証を通せず、池なしの安全形へ落としたか */
  fallback: boolean;
}

/**
 * シードから1ホール生成する。検証器を通ったものだけを返す。
 *
 * 通らなかった場合は枝番だけを進めて作り直すので、**同じシードなら必ず同じホール**になる。
 * `maxAttempts` 回で決まらなければ、池を外した形をもう一度だけ試し、
 * それも駄目ならその形をそのまま返す（呼び出し側が必ず1ホール得られるようにする）。
 */
export function generateCourseDetailed(
  seed: number,
  options: GenerateOptions = {},
): GeneratedCourse {
  const cellSize = G.validationCellSize;
  const [obMin, obMax] = G.obRatio;

  for (let attempt = 0; attempt < G.maxAttempts; attempt++) {
    // 枝番はシードから決まる固定の飛び幅。実行ごとに変わる値は使わない
    const course = draftCourse((seed + attempt * 0x9e3779b1) >>> 0, options);
    const result = validateCourse(course, { cellSize });
    if (!result.ok) continue;
    if (result.areaRatio.ob < obMin || result.areaRatio.ob > obMax) continue;
    return { course, attempts: attempt + 1, fallback: false };
  }

  // ここまで来たら形の当たりが悪い。池を外せばルートは必ず繋がる
  const safe = { ...draftCourse(seed >>> 0, options), hazards: [] };
  return { course: safe, attempts: G.maxAttempts + 1, fallback: true };
}

/** `generateCourseDetailed` のコース定義だけを返す薄い入口 */
export function generateCourse(seed: number, options: GenerateOptions = {}): CourseDefinition {
  return generateCourseDetailed(seed, options).course;
}

/**
 * 最終アプローチの向き（ティー側からカップへ向かう単位ベクトル）。
 * 地形の性格をカップ基準で置くために使う。
 */
export function approachDirection(course: CourseDefinition): CoursePoint {
  const route = course.route;
  const from = route.length >= 2 ? route[route.length - 2] : course.tee;
  const to = route[route.length - 1] ?? course.cup;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length === 0) return { x: 0, z: 1 };
  return { x: dx / length, z: dz / length };
}
