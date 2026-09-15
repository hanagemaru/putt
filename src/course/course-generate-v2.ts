// コース生成器v2（`docs/course-generator-v2.md`）。シードひとつから遊べる `CourseDefinition` を1ホール作る。
//
// **v1（`course-generate.ts`）は一切触らない。** 既存3ツアーと週替わりチャレンジv1は
// これまでどおりv1が作る。v2はここへ足すだけなので、v1のコースは1mmも変わらない。
//
// v1との違いは2つだけ。
//
//   1. **ルートを折れ線の「角」ではなく曲率から作る。**
//      曲率 κ(s) を弧長に沿った台形の山として置き、積分して骨格を得る。
//      その骨格から制御点を2〜4点だけ取り、Catmull-Rom で引き直して等間隔に刻む。
//      器（`CourseDefinition.route`）は今までどおりの折れ線で、点数だけが増える。
//      これで「どれだけ曲がるか」（総回頭角）と「どれだけ急に曲がるか」（最小曲率半径）を
//      別々の数字で指定できる。v1は `cornerAngle` ひとつが両方を決めていた。
//
//   2. **難易度を折れ角から切り離す。** 芝幅・池・高さのハザード・深いラフの島で作る。
//      高さのハザードと島は `CourseDefinition` の任意項目なので、
//      `surfaceAt` ・物理・検証器・セーブ形式はそのまま動く。
//
// 決定論の約束: 戻り値はシード（と難易度・型の指定）だけで決まる。
// 実行ごとに変わる値（時刻・Math.random）は一切使わない。

import { CONFIG } from '../config';
import { distanceToRoute, hazardReach, surfaceAt } from './course-map';
import { validateCourse } from './course-validate';
import type {
  CourseDefinition,
  CoursePoint,
  EllipseHazard,
  HazardOutline,
  HeightFeature,
  SandBunker,
  TerrainType,
} from './course-types';

const V = CONFIG.course.generatorV2;
const C = V.curve;
const H = V.height;
const B = V.bunker;
const S = V.hazardShape;
const N = CONFIG.course.edgeNoise;
const T = CONFIG.course.terrain;

export type DifficultyV2 = 'easy' | 'normal' | 'hard';
/**
 * 形の型。**型は「何回曲がるか」だけを決める。** 曲がる量は `totalTurn`、
 * 曲がる急さは `minTurnRadius` が別に決めるので、v1のように型と難易度が癒着しない。
 */
export type HoleShapeV2 = 'gentleCurve' | 'sweepingDogleg' | 'serpentine';

export interface GenerateOptionsV2 {
  /** 難易度を決め打ちする。省略するとシードから選ぶ */
  difficulty?: DifficultyV2;
  /** 形の型を決め打ちする。省略するとシードから選ぶ */
  shape?: HoleShapeV2;
  /** 地形の性格を決め打ちする。省略するとシードから選ぶ */
  terrain?: TerrainType;
  /** 表示名。省略すると難易度と型から作る */
  name?: string;
  /** ID。省略するとシードから作る */
  id?: string;
}

/** mulberry32。シードから再現可能な擬似乱数（v1・green.ts と同じ実装） */
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

const LABEL: Record<DifficultyV2, string> = {
  easy: 'やさしい',
  normal: 'ふつう',
  hard: 'むずかしい',
};
const SHAPE_LABEL: Record<HoleShapeV2, string> = {
  gentleCurve: 'ゆるいカーブ',
  sweepingDogleg: 'ドッグレッグ',
  serpentine: 'S字',
};

/** 表示名から型を引くための逆引き。走査スクリプトが使う */
export const SHAPE_LABEL_V2 = SHAPE_LABEL;
export const DIFFICULTY_LABEL_V2 = LABEL;

// --- ルートの曲線 ---------------------------------------------------------

/**
 * 曲率の台形プロファイル。`t` は窓の中の位置 [0,1]。
 * 立ち上がりと立ち下がりを5次ではなく3次のスムーズステップにしてある
 * （曲率が滑らかなら進行方向は十分に滑らか）。
 * 積分値は 1 - plateauRise。
 */
function trapezoid(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const p = C.plateauRise;
  if (p <= 0) return 1;
  if (t < p) {
    const u = t / p;
    return u * u * (3 - 2 * u);
  }
  if (t > 1 - p) {
    const u = (1 - t) / p;
    return u * u * (3 - 2 * u);
  }
  return 1;
}

/** 曲がり1回分。符号が向き、weight が総回頭角の取り分、phase が受け持ち区間の中での位置 */
interface Lobe {
  sign: number;
  weight: number;
  phase: number;
}

interface Spine {
  points: CoursePoint[];
  /** 始点の進行方向 [rad]。+Z を 0 とする */
  startHeading: number;
  /** 終点の進行方向 [rad] */
  endHeading: number;
}

/**
 * 曲率から骨格を作る。
 *
 * ローブ k は区間 `[k/n, (k+1)/n]` を受け持ち、そのうち `turnSpread` の割合だけ曲がる。
 * **受け持ち区間は重ならないので、逆向きのローブが打ち消し合うことがない。**
 * 窓の中の曲率は台形なので、0 から始まり 0 で終わる（＝折れ線のような「角」ができない）。
 *
 * ローブ k のピーク曲率は `turn * weight / (area * window)` なので、
 * 曲率半径の最小値は `area * window / (turn * weight)`。呼ぶ側はこの式から全長を決める。
 */
function buildSpine(
  length: number,
  totalTurn: number,
  turnSpread: number,
  lobes: readonly Lobe[],
): Spine {
  const n = lobes.length;
  const span = length / n;
  const window = span * turnSpread;
  const area = 1 - C.plateauRise;

  const starts: number[] = [];
  const peaks: number[] = [];
  let netTurn = 0;
  for (let k = 0; k < n; k++) {
    starts.push(k * span + (span - window) * lobes[k].phase);
    const turn = totalTurn * lobes[k].weight;
    peaks.push(window > 0 ? (lobes[k].sign * turn) / (area * window) : 0);
    netTurn += lobes[k].sign * turn;
  }

  const curvatureAt = (s: number): number => {
    for (let k = 0; k < n; k++) {
      const t = (s - starts[k]) / window;
      if (t > 0 && t < 1) return peaks[k] * trapezoid(t);
    }
    return 0;
  };

  // 進行方向の総変化を +Z の左右へ均等に振っておくと、ルートが枠に収まりやすい
  const startHeading = -netTurn / 2;
  const steps = Math.max(2, Math.round(length / C.spineStep));
  const ds = length / steps;
  let heading = startHeading;
  let x = 0;
  let z = 0;
  const points: CoursePoint[] = [{ x, z }];
  for (let i = 0; i < steps; i++) {
    // 中点法。進行方向を半ステップ進めてから動かす
    const k = curvatureAt((i + 0.5) * ds);
    const mid = heading + (k * ds) / 2;
    x += Math.sin(mid) * ds;
    z += Math.cos(mid) * ds;
    heading += k * ds;
    points.push({ x, z });
  }
  return { points, startHeading, endHeading: heading };
}

/** 折れ線の全長 [m] */
function polylineLength(points: readonly CoursePoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return sum;
}

/**
 * Catmull-Rom を細かく評価して密な折れ線にする。
 *
 * 両端の外側には、**骨格の本当の接線**から作った仮想点を置く。
 * 折り返し（P0 を挟んだ鏡像）にすると始点の向きが弦の向きになってしまい、
 * 骨格より総回頭角が小さく出る。
 */
function catmullRomPolyline(
  control: readonly CoursePoint[],
  startDir: CoursePoint,
  endDir: CoursePoint,
): CoursePoint[] {
  const n = control.length;
  const headSpan = Math.hypot(control[1].x - control[0].x, control[1].z - control[0].z);
  const tailSpan = Math.hypot(
    control[n - 1].x - control[n - 2].x,
    control[n - 1].z - control[n - 2].z,
  );
  const points: CoursePoint[] = [
    { x: control[0].x - startDir.x * headSpan, z: control[0].z - startDir.z * headSpan },
    ...control,
    { x: control[n - 1].x + endDir.x * tailSpan, z: control[n - 1].z + endDir.z * tailSpan },
  ];

  const out: CoursePoint[] = [{ x: control[0].x, z: control[0].z }];
  for (let i = 1; i < points.length - 2; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2];
    const chord = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(8, Math.ceil(chord / C.spineStep));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      // 一様 Catmull-Rom（張力 0.5）
      const a = -0.5 * t3 + t2 - 0.5 * t;
      const b = 1.5 * t3 - 2.5 * t2 + 1;
      const c = -1.5 * t3 + 2 * t2 + 0.5 * t;
      const d = 0.5 * t3 - 0.5 * t2;
      out.push({
        x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        z: a * p0.z + b * p1.z + c * p2.z + d * p3.z,
      });
    }
  }
  return out;
}

/** 密な折れ線を等間隔（弧長）に刻み直す。最後の点は必ず終点そのものにする */
function resampleByArcLength(dense: readonly CoursePoint[], spacing: number): CoursePoint[] {
  const total = polylineLength(dense);
  const count = Math.max(2, Math.round(total / spacing));
  const step = total / count;
  const out: CoursePoint[] = [{ x: dense[0].x, z: dense[0].z }];
  let index = 1;
  let walked = 0;
  for (let i = 1; i < count; i++) {
    const target = i * step;
    while (index < dense.length - 1) {
      const segment = Math.hypot(
        dense[index].x - dense[index - 1].x,
        dense[index].z - dense[index - 1].z,
      );
      if (walked + segment >= target) break;
      walked += segment;
      index++;
    }
    const a = dense[index - 1];
    const b = dense[index];
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    const t = segment > 0 ? (target - walked) / segment : 0;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  const last = dense[dense.length - 1];
  out.push({ x: last.x, z: last.z });
  return out;
}

/** 骨格から等間隔（弧長）に制御点を取る */
function controlPointsFrom(spine: Spine, count: number): CoursePoint[] {
  const last = spine.points.length - 1;
  const out: CoursePoint[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.round((last * i) / (count - 1));
    out.push(spine.points[index]);
  }
  return out;
}

export interface RouteMetrics {
  /** ルートの全長 [m] */
  length: number;
  /** ティーからカップまでの直線距離 [m] */
  straightDistance: number;
  /** 遠回り率（全長 ÷ 直線距離） */
  detourRatio: number;
  /** 総回頭角 [度]。弧長に沿った進行方向の変化の絶対値の総和 */
  totalTurnDeg: number;
  /** 最小曲率半径 [m]。折れ線の連続3点の外接円の半径の最小値。直線なら Infinity */
  minTurnRadius: number;
}

/**
 * 折れ線ルートの形を測る。**v1のルートにもそのまま使える**ので、v1とv2を同じ物差しで比べられる。
 * 連続3点の外接円は、点が円弧上に等間隔で並んでいればその円の半径と厳密に一致する。
 */
export function routeMetrics(route: readonly CoursePoint[]): RouteMetrics {
  const length = polylineLength(route);
  const first = route[0];
  const last = route[route.length - 1];
  const straightDistance = Math.hypot(last.x - first.x, last.z - first.z);

  let totalTurn = 0;
  let minTurnRadius = Infinity;
  for (let i = 1; i < route.length - 1; i++) {
    const ax = route[i].x - route[i - 1].x;
    const az = route[i].z - route[i - 1].z;
    const bx = route[i + 1].x - route[i].x;
    const bz = route[i + 1].z - route[i].z;
    const cross = ax * bz - az * bx;
    const dot = ax * bx + az * bz;
    totalTurn += Math.abs(Math.atan2(cross, dot));

    const a = Math.hypot(ax, az);
    const b = Math.hypot(bx, bz);
    const c = Math.hypot(route[i + 1].x - route[i - 1].x, route[i + 1].z - route[i - 1].z);
    // 外接円の半径 R = abc / (4 * 面積)。面積 0（＝一直線）なら半径は無限大
    const area = Math.abs(cross) / 2;
    if (area > 0) minTurnRadius = Math.min(minTurnRadius, (a * b * c) / (4 * area));
  }

  return {
    length,
    straightDistance,
    detourRatio: straightDistance > 0 ? length / straightDistance : 1,
    totalTurnDeg: (totalTurn * 180) / Math.PI,
    minTurnRadius,
  };
}

/** 曲がり方の設計値。走査スクリプトが「狙い」と「実測」を並べるために返す */
export interface CurvePlan {
  shape: HoleShapeV2;
  /** 狙った総回頭角 [度] */
  targetTurnDeg: number;
  /** 最小曲率半径の下限 [m]。芝幅から決まる */
  minTurnRadius: number;
  /** 回頭を配分した区間の割合 */
  turnSpread: number;
  /** 骨格の全長 [m] */
  spineLength: number;
}

interface BuiltRoute {
  route: CoursePoint[];
  plan: CurvePlan;
}

/**
 * ルートを作る。**ここが v2 の中心。**
 *
 * **全長が先で、総回頭角が後。** ローブ k のピーク曲率は `turn * weight / (area * window)`、
 * つまり曲率半径の最小値は `area * window / (turn * weight)` なので、
 * 設計半径を保ったまま曲がれる量は全長で頭打ちになる。
 *
 *   `maxTurn = area * turnSpread * length / (designRadius * maxWeight * lobes)`
 *
 * 逆順（回頭角を先に決めて全長を伸ばす）にすると、ほぼ全てのホールが難易度の上限まで
 * 引き伸ばされ、全長の分布＝PARの分布が潰れる。
 * **短いホールは大きく曲がれない。曲がりを鋭くするのではなく、曲がる量のほうを削る。**
 */
function buildRouteV2(
  rng: () => number,
  shape: HoleShapeV2,
  routeLengthRange: Range,
  greenWidth: number,
): BuiltRoute {
  const lobeCount = C.lobes[shape];
  const controlCount = C.controlPoints[shape];
  const side = rng() < 0.5 ? -1 : 1;
  const turnSpread = pick(rng, C.turnSpread);

  // 作り直し（relax）でも乱数の並びがずれないよう、形に関わる乱数は先に引き切る
  const lobes: Lobe[] = [];
  const bias = lobeCount > 1 ? pick(rng, C.lobeBias) : 1;
  for (let k = 0; k < lobeCount; k++) {
    lobes.push({
      // S字は逆向きに曲げる。ローブが増えても向きは交互
      sign: k % 2 === 0 ? side : -side,
      weight: lobeCount > 1 ? (k === 0 ? bias : (1 - bias) / (lobeCount - 1)) : 1,
      phase: rng(),
    });
  }
  const maxWeight = lobes.reduce((m, l) => Math.max(m, l.weight), 0);

  const minTurnRadius = Math.max(greenWidth * C.minTurnRadiusWidthFactor, C.minTurnRadiusFloor);
  const designRadius = minTurnRadius * C.turnRadiusSafety;
  const area = 1 - C.plateauRise;

  const length = pick(rng, routeLengthRange);
  // この全長で、設計半径を保ったまま曲がれる上限
  const maxTurn = (area * turnSpread * length) / (designRadius * maxWeight * lobeCount);
  let turn = Math.min((pick(rng, C.totalTurn[shape]) * Math.PI) / 180, maxTurn);
  const targetTurn = turn;

  // Catmull-Rom で引き直すと骨格よりわずかに曲率が上がることがある。
  // 測って下限を割っていたら総回頭角を縮めて作り直す（乱数は引かない＝決定論のまま）
  let route: CoursePoint[] = [];
  for (let attempt = 0; attempt <= C.relaxAttempts; attempt++) {
    const spine = buildSpine(length, turn, turnSpread, lobes);
    const control = controlPointsFrom(spine, controlCount);
    const dense = catmullRomPolyline(
      control,
      { x: Math.sin(spine.startHeading), z: Math.cos(spine.startHeading) },
      { x: Math.sin(spine.endHeading), z: Math.cos(spine.endHeading) },
    );
    route = resampleByArcLength(dense, C.sampleSpacing);
    const measured = routeMetrics(route);
    // 下限そのものではなく設計半径まで戻す。曲率は総回頭角にほぼ比例するので、
    // 下限を狙うと下限ちょうどへ収束し、丸め誤差で下回った判定になることがある
    if (measured.minTurnRadius >= designRadius) break;
    turn *= Math.max(C.relaxFloor, measured.minTurnRadius / designRadius);
  }

  // 外接矩形の中心を原点へ寄せる。コース枠は原点中心の長方形なので、これで枠の真ん中に収まる
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
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  return {
    route: route.map((p) => ({ x: p.x - cx, z: p.z - cz })),
    plan: {
      shape,
      targetTurnDeg: (targetTurn * 180) / Math.PI,
      minTurnRadius,
      turnSpread,
      spineLength: length,
    },
  };
}

// --- ルート上の位置 -------------------------------------------------------

interface RouteSample {
  x: number;
  z: number;
  /** 進行方向の単位ベクトル */
  dirX: number;
  dirZ: number;
  /** 曲がりの内側（＝近道側）を向く単位ベクトル */
  insideX: number;
  insideZ: number;
}

/** 弧長 `s` [m] の地点の進行方向。両端は端の線分の向きをそのまま使う */
function directionAtArc(route: readonly CoursePoint[], s: number): CoursePoint {
  let walked = 0;
  for (let i = 1; i < route.length; i++) {
    const dx = route[i].x - route[i - 1].x;
    const dz = route[i].z - route[i - 1].z;
    const segment = Math.hypot(dx, dz);
    if (walked + segment >= s || i === route.length - 1) {
      return segment > 0 ? { x: dx / segment, z: dz / segment } : { x: 0, z: 1 };
    }
    walked += segment;
  }
  return { x: 0, z: 1 };
}

/**
 * ルート上の、全長に対する割合 `t` の地点を取る。
 * 内側の向きは、前後に少し離した2点の進行方向の外積から決める
 * （曲率の中心がある側＝ティーとカップを直線で結んだときに近道になる側）。
 */
function sampleRoute(route: readonly CoursePoint[], t: number): RouteSample {
  const total = polylineLength(route);
  const target = Math.min(Math.max(t, 0), 1) * total;

  let walked = 0;
  let x = route[0].x;
  let z = route[0].z;
  for (let i = 1; i < route.length; i++) {
    const dx = route[i].x - route[i - 1].x;
    const dz = route[i].z - route[i - 1].z;
    const segment = Math.hypot(dx, dz);
    if (walked + segment >= target || i === route.length - 1) {
      const u = segment > 0 ? (target - walked) / segment : 0;
      x = route[i - 1].x + dx * u;
      z = route[i - 1].z + dz * u;
      break;
    }
    walked += segment;
  }

  const delta = total * 0.05;
  const dir = directionAtArc(route, target);
  const before = directionAtArc(route, Math.max(0, target - delta));
  const after = directionAtArc(route, Math.min(total, target + delta));
  const cross = before.x * after.z - before.z * after.x;
  // +Z へ進みながら +X へ曲がると cross は負。そのとき曲率の中心は +X 側にある
  const insideX = cross < 0 ? dir.z : -dir.z;
  const insideZ = cross < 0 ? -dir.x : dir.x;
  return { x, z, dirX: dir.x, dirZ: dir.z, insideX, insideZ };
}

// --- ハザード -------------------------------------------------------------

/**
 * 池を置く。**水は越えられないので、芝の通り道は必ず空ける。**
 * ティーとカップを結ぶ直線（＝近道を狙う線）の脇に寄せるので、
 * 曲がるホールでは自然とカーブの内側へ入り、「回り込めば安全・カットすれば池」になる。
 */
function placeHazards(
  rng: () => number,
  count: number,
  draft: CourseDefinition,
): EllipseHazard[] {
  const hazards: EllipseHazard[] = [];
  const halfWidth = draft.bounds.width / 2;
  const halfLength = draft.bounds.length / 2;
  const corridor = draft.greenWidth / 2 + draft.waterFringe;

  for (let i = 0; i < count; i++) {
    const radiusMajor = pick(rng, V.hazardRadius);
    const { aspect, outline } = pickOutline(rng, V.hazardAspect);
    const radiusX = radiusMajor;
    const radiusZ = radiusMajor * aspect;
    // 歪みを含めた実効半径。ひょうたん型は素の半径より外へ膨らむので、その分も空ける
    const maxRadius = hazardReach(radiusX, radiusZ, outline, N.waterAmplitude);
    const minRouteDistance = corridor + maxRadius * V.hazardRouteClearance;

    let placed: EllipseHazard | null = null;
    for (let attempt = 0; attempt < 24 && !placed; attempt++) {
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
      const clearance = V.hazardTeeCupClearance + maxRadius;
      if (Math.hypot(center.x - draft.tee.x, center.z - draft.tee.z) < clearance) continue;
      if (Math.hypot(center.x - draft.cup.x, center.z - draft.cup.z) < clearance) continue;
      const tooClose = hazards.some(
        (h) =>
          Math.hypot(h.center.x - center.x, h.center.z - center.z) <
          Math.max(h.radiusX, h.radiusZ) + maxRadius + 0.8,
      );
      if (tooClose) continue;
      placed = { type: 'water', center, radiusX, radiusZ, outline };
    }
    if (placed) hazards.push(placed);
  }
  return hazards;
}

/**
 * `(1 - r^2)^2` の最大勾配（半径 1・高さ 1 のとき）。
 * 微分 `-4r(1-r^2)` が r = 1/√3 で極値を取るので `8 / (3√3)`。
 * 調整値ではなく形から決まる定数なので config には置かない。
 */
const BUMP_PEAK_SLOPE = 8 / (3 * Math.sqrt(3));

/** 決めた輪郭の型と、そこから出る縦横比・歪ませ方 */
interface OutlineChoice {
  aspect: number;
  outline: HazardOutline | undefined;
}

/**
 * ハザードの輪郭の型を1つ引く。**池とバンカーで共通。**
 * 既定は楕円を少し歪ませるだけ（丸に寄る）なので、低い確率で崩れた形を混ぜる。
 */
function pickOutline(rng: () => number, roundAspect: Range): OutlineChoice {
  const shape = pickWeighted(rng, S.weights);
  // 型に関わらず同じ回数だけ乱数を引く。型を足しても他の配置がずれない
  const roundValue = pick(rng, roundAspect);
  const elongated = pick(rng, S.elongatedAspect);
  const flip = rng() < 0.5;
  if (shape === 'elongated') {
    // 細長い側と平たい側の両方を出す
    return { aspect: flip ? elongated : 1 / elongated, outline: undefined };
  }
  if (shape === 'lobed') {
    return { aspect: roundValue, outline: { ...S.lobed } };
  }
  return { aspect: roundValue, outline: undefined };
}

/**
 * 高さのハザード（マウンド・リッジ・窪地）を置く。
 *
 * **勾配が摩擦を上回る場所ではボールが止まらない**（スティンプ10ftで約7.8%）ので、
 * 1つあたりの最大勾配が `maxGradient` を超えないよう高さを削る。
 * ハザードどうしも縁を離して置くので、勾配が足し合わさることもない。
 */
function placeHeightFeatures(
  rng: () => number,
  count: number,
  draft: CourseDefinition,
  existing: readonly HeightFeature[] = [],
): HeightFeature[] {
  // バンカーのすり鉢（`existing`）は**間隔の判定に入れない。**
  // すり鉢は縁で勾配がちょうど0になるので、外の地形と勾配が足し合わさらない。
  // 判定に入れると 7m 級の除外円ができて、尾根やマウンドがほとんど置けなくなる
  const placedHere: HeightFeature[] = [];
  const features: HeightFeature[] = [...existing];
  const halfWidth = draft.bounds.width / 2;
  const halfLength = draft.bounds.length / 2;

  for (let i = 0; i < count; i++) {
    const kind = pickWeighted(rng, H.kindWeights);
    const isRidge = kind === 'ridge';
    const radiusU = isRidge ? pick(rng, H.ridgeLength) : pick(rng, H.moundRadius);
    const radiusV = isRidge
      ? pick(rng, H.ridgeWidth)
      : radiusU * pick(rng, H.moundAspect);
    const magnitude = pick(rng, isRidge ? H.ridgeHeight : H.moundHeight);
    // 勾配の上限は短いほうの半径が決める
    const limit = (H.maxGradient * Math.min(radiusU, radiusV)) / BUMP_PEAK_SLOPE;
    const height = (kind === 'hollow' ? -1 : 1) * Math.min(magnitude, limit);
    const maxRadius = Math.max(radiusU, radiusV);

    // 乱数は試行の前に引き切らず、試行ごとに引く（v1の池と同じ作り）
    let placed: HeightFeature | null = null;
    for (let attempt = 0; attempt < H.maxAttempts && !placed; attempt++) {
      const at = sampleRoute(draft.route, pick(rng, H.routeRange));
      const side = rng() < 0.5 ? -1 : 1;
      // 尾根はルートを横切らせたいので線の上へ寄せる。マウンド・窪地は脇でよい
      const offset = pick(rng, isRidge ? H.ridgeOffset : H.moundOffset) * side;
      const center = {
        x: at.x + at.insideX * offset,
        z: at.z + at.insideZ * offset,
      };
      const angle = isRidge
        ? // 尾根はルートを横切らせる。直交から ±ridgeSkew だけ振る
          Math.atan2(at.dirX, at.dirZ) +
          Math.PI / 2 +
          ((pick(rng, [-1, 1]) * H.ridgeSkew * Math.PI) / 180)
        : rng() * Math.PI * 2;

      // 枠の判定は**短いほうの半径**で見る。長い尾根を長軸で弾くと、
      // ルートが枠の端へ寄るホールで尾根がほとんど置けなくなる（外へ出た分はOBなので見えない）
      const edgeMargin = Math.min(radiusU, radiusV) * 0.5;
      if (Math.abs(center.x) > halfWidth - edgeMargin) continue;
      if (Math.abs(center.z) > halfLength - edgeMargin) continue;
      if (Math.hypot(center.x - draft.tee.x, center.z - draft.tee.z) < H.teeCupClearance) continue;
      if (Math.hypot(center.x - draft.cup.x, center.z - draft.cup.z) < H.teeCupClearance) continue;
      // 池やOBの中の起伏は見えないし転がらない。芝の上だけに置く。
      // 砂の上も避ける（バンカーは自前のすり鉢を持っているので二重に窪ませない）
      const surface = surfaceAt(draft, center.x, center.z);
      if (surface === 'water' || surface === 'ob' || surface === 'bunker') continue;
      const tooClose = placedHere.some(
        (f) =>
          Math.hypot(f.center.x - center.x, f.center.z - center.z) <
          Math.max(f.radiusU, f.radiusV) + maxRadius + H.minSpacing,
      );
      if (tooClose) continue;
      placed = { kind, center, height, radiusU, radiusV, angle };
    }
    if (placed) {
      placedHere.push(placed);
      features.push(placed);
    }
  }
  return features;
}

/**
 * バンカー（砂）を置く。**水と違って越えられるので、ルートの線の上に置ける。**
 * 「強く越えるか、避けて回すか」を、曲がり角を大きくせずに作る。
 *
 * **要は、必ず逃げ道を残すこと。** 横ずれの下限を、
 * 「反対側に `minClearWidth` の通常芝が残る」位置から取るので、
 * 砂がルートの線に掛かっていても脇は必ず通れる。
 * 最初に作った深いラフの島は横ずれの下限が0で、294個中87%が中心線を塞いでいた。
 * 逃げ道が無ければ選択にならず、ただの障害物になる。
 */
function placeBunkers(rng: () => number, count: number, draft: CourseDefinition): SandBunker[] {
  const bunkers: SandBunker[] = [];
  const halfWidth = draft.greenWidth / 2;

  for (let i = 0; i < count; i++) {
    const radiusMajor = pick(rng, B.radius);
    const { aspect, outline } = pickOutline(rng, B.aspect);
    const radiusX = radiusMajor;
    const radiusZ = radiusMajor * aspect;
    // 歪みを含めた実効半径。ひょうたん型は素の半径より外へ膨らむので、その分も見る
    const maxRadius = hazardReach(radiusX, radiusZ, outline, N.bunkerAmplitude);

    // 横ずれの下限は2つの条件のうち厳しいほう。
    //   1. 反対側に `minClearWidth` の通れる芝を残す（負なら中心線を跨いでも逃げ道が残る）
    //   2. 中心線を越えて芝側へ食い込む量を `maxCenterOverlap` までにする
    const minOffset = Math.max(
      maxRadius + B.minClearWidth - halfWidth,
      maxRadius - B.maxCenterOverlap,
    );
    const maxOffset = halfWidth * B.maxOffset;
    // 芝が狭すぎて逃げ道を作れないなら、このバンカーは諦める
    if (minOffset > maxOffset) continue;

    let placed: SandBunker | null = null;
    for (let attempt = 0; attempt < B.maxAttempts && !placed; attempt++) {
      const at = sampleRoute(draft.route, pick(rng, B.routeRange));
      const side = rng() < B.insideBias ? 1 : -1;
      const offset = pick(rng, [minOffset, maxOffset]) * side;
      const center = {
        x: at.x + at.insideX * offset,
        z: at.z + at.insideZ * offset,
      };
      const clearance = B.teeCupClearance + maxRadius;
      if (Math.hypot(center.x - draft.tee.x, center.z - draft.tee.z) < clearance) continue;
      if (Math.hypot(center.x - draft.cup.x, center.z - draft.cup.z) < clearance) continue;
      // 砂は芝の上だけに置く。OBの中の砂は見えないし、池と接すると区別が付かない
      if (surfaceAt(draft, center.x, center.z) === 'ob') continue;
      const nearWater = draft.hazards.some(
        (h) =>
          Math.hypot(h.center.x - center.x, h.center.z - center.z) <
          hazardReach(h.radiusX, h.radiusZ, h.outline, N.waterAmplitude) +
            maxRadius +
            draft.waterFringe +
            B.waterClearance,
      );
      if (nearWater) continue;
      const tooClose = bunkers.some(
        (b) =>
          Math.hypot(b.center.x - center.x, b.center.z - center.z) <
          hazardReach(b.radiusX, b.radiusZ, b.outline, N.bunkerAmplitude) +
            maxRadius +
            B.minSpacing,
      );
      if (tooClose) continue;
      placed = { center, radiusX, radiusZ, outline };
    }
    if (placed) bunkers.push(placed);
  }
  return bunkers;
}

/**
 * バンカーをゆるいすり鉢状に窪ませる高さのハザードを作る。
 *
 * 形は他の高さのハザードと同じ `(1 - r^2)^2` なので、**縁で高さも傾きもちょうど0**になる。
 * 急になるのは砂の内側だけで、外の芝には斜面が出ない。だから
 * 芝の「止まれる勾配の上限」（7.8%）ではなく、**砂の上限（62.7%）だけを考えればよく**、
 * `hollowGradient` を芝の上限より大きく取っても「砂で止まらない」は起きない。
 */
function bunkerHollows(bunkers: readonly SandBunker[]): HeightFeature[] {
  return bunkers.map((b) => {
    // **窪みは砂の内側に収める。** 輪郭の歪みは半径を角度ごとに (1 ± amplitude) 倍するので、
    // どの向きでも砂がある最小の半径は (1 - amplitude) 倍。そこまでに収めておけば、
    // 窪みの斜面が芝へはみ出さない。
    // はみ出すと、バンカー脇の芝が「止まれない斜面」になって手前に刻めなくなる
    // （実測で芝の止まれない面が 2.1% → 4.2% に倍増した）
    const inside = 1 - (b.outline?.amplitude ?? N.bunkerAmplitude);
    const radiusU = b.radiusX * inside;
    const radiusV = b.radiusZ * inside;
    const depth = (B.hollowGradient * Math.min(radiusU, radiusV)) / BUMP_PEAK_SLOPE;
    return { kind: 'hollow', center: b.center, height: -depth, radiusU, radiusV, angle: 0 };
  });
}

// --- 組み立て -------------------------------------------------------------

/**
 * 揺らぎが最大まで振れたときの、芝＋ラフ＋セカンドカットの片側の幅 [m]。
 * ここより外は必ずOBなので、コース枠をこの幅を基準に広げるとOBの量を狙って作れる。
 */
function maxPlayableHalfWidth(greenWidth: number, rough: number, deep: number): number {
  return (
    (greenWidth / 2) * (1 + N.greenAmplitude) +
    rough * (1 + N.roughAmplitude) +
    deep * (1 + N.deepRoughAmplitude)
  );
}

function parFor(length: number): number {
  const [a, b, c] = V.parThresholds;
  if (length <= a) return 3;
  if (length <= b) return 4;
  if (length <= c) return 5;
  return 6;
}

interface DraftV2 {
  course: CourseDefinition;
  difficulty: DifficultyV2;
  plan: CurvePlan;
}

/** 1回分の生成。検証はしない */
function draftCourseV2(seed: number, options: GenerateOptionsV2): DraftV2 {
  const rng = makeRng(seed);
  const difficulty = options.difficulty ?? pickWeighted(rng, V.difficultyWeights);
  const shape = options.shape ?? pickWeighted(rng, V.shapeWeights);
  const d = V.difficulty[difficulty];

  const greenWidth = pick(rng, d.greenWidth);
  const roughFringe = pick(rng, d.roughFringe);
  const deepRoughFringe = pick(rng, d.deepRoughFringe);
  const waterFringe = pick(rng, V.waterFringe);
  const { route, plan } = buildRouteV2(rng, shape, d.routeLength, greenWidth);

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
    maxPlayableHalfWidth(greenWidth, roughFringe, deepRoughFringe) * pick(rng, V.boundsExpand);
  const round = (v: number) => Math.ceil(v / V.boundsStep) * V.boundsStep;
  const bounds = {
    width: round(maxX - minX + expand * 2),
    length: round(maxZ - minZ + expand * 2),
  };

  const terrain = options.terrain ?? pickWeighted(rng, T.weights);
  const hazardCount = pickInt(rng, d.hazardCount);
  const heightFeatureCount = pickInt(rng, d.heightFeatureCount);
  const bunkerCount = pickInt(rng, d.bunkerCount);

  const base: CourseDefinition = {
    id: options.id ?? `gen2-${(seed >>> 0).toString(36)}`,
    name: options.name ?? `${LABEL[difficulty]}・${SHAPE_LABEL[shape]}`,
    par: parFor(polylineLength(route)),
    seed: seed >>> 0,
    terrain,
    bounds,
    tee: route[0],
    cup: route[route.length - 1],
    route,
    greenWidth,
    roughFringe,
    deepRoughFringe,
    waterFringe,
    hazards: [],
  };

  // 池 → バンカー → 高さのハザード の順に置く。後ろの2つは `surfaceAt` で置ける場所を
  // 確かめるので、前の段階の結果が入ったコース定義を渡す必要がある。
  //
  // **高さのハザードを最後にするのは、バンカーのすり鉢と重ねないため。**
  // すり鉢も高さのハザードなので、先に入れておけば間隔の判定がそのまま効く
  const withWater: CourseDefinition = { ...base, hazards: placeHazards(rng, hazardCount, base) };
  const bunkers = placeBunkers(rng, bunkerCount, withWater);
  const withBunkers: CourseDefinition = { ...withWater, bunkers };
  const course: CourseDefinition = {
    ...withBunkers,
    heightFeatures: placeHeightFeatures(
      rng,
      heightFeatureCount,
      withBunkers,
      bunkerHollows(bunkers),
    ),
  };
  return { course, difficulty, plan };
}

export interface GeneratedCourseV2 {
  course: CourseDefinition;
  /** 何回目の試行で通ったか（1 始まり） */
  attempts: number;
  /** 検証を通せず、池なしの安全形へ落としたか */
  fallback: boolean;
  difficulty: DifficultyV2;
  /** 曲がり方の狙い */
  plan: CurvePlan;
  /** 出来上がったルートの実測 */
  metrics: RouteMetrics;
}

/**
 * シードから1ホール生成する（v2）。検証器を通ったものだけを返す。
 *
 * 通らなかった場合は枝番だけを進めて作り直すので、**同じシードなら必ず同じホール**になる。
 * `maxAttempts` 回で決まらなければ、池を外した形をもう一度だけ試し、
 * それも駄目ならその形をそのまま返す（呼び出し側が必ず1ホール得られるようにする）。
 */
export function generateCourseV2Detailed(
  seed: number,
  options: GenerateOptionsV2 = {},
): GeneratedCourseV2 {
  const cellSize = V.validationCellSize;
  const [obMin, obMax] = V.obRatio;

  for (let attempt = 0; attempt < V.maxAttempts; attempt++) {
    // 枝番はシードから決まる固定の飛び幅。実行ごとに変わる値は使わない
    const draft = draftCourseV2((seed + attempt * 0x9e3779b1) >>> 0, options);
    const result = validateCourse(draft.course, { cellSize });
    if (!result.ok) continue;
    if (result.areaRatio.ob < obMin || result.areaRatio.ob > obMax) continue;
    // ティー側から辿り着けない芝の島を作らない。連結（ティー→カップ）だけでは残ってしまう。
    // 砂は罰打なしで打てるので、ここでも打てる地面として数える
    const playable =
      result.areaRatio.green +
      result.areaRatio.rough +
      result.areaRatio.deepRough +
      result.areaRatio.bunker;
    const unreachable =
      (playable - result.reachableRatio) * draft.course.bounds.width * draft.course.bounds.length;
    if (unreachable > V.maxUnreachableArea) continue;
    return {
      course: draft.course,
      attempts: attempt + 1,
      fallback: false,
      difficulty: draft.difficulty,
      plan: draft.plan,
      metrics: routeMetrics(draft.course.route),
    };
  }

  // ここまで来たら形の当たりが悪い。池を外せばルートは必ず繋がる
  const draft = draftCourseV2(seed >>> 0, options);
  const safe: CourseDefinition = { ...draft.course, hazards: [] };
  return {
    course: safe,
    attempts: V.maxAttempts + 1,
    fallback: true,
    difficulty: draft.difficulty,
    plan: draft.plan,
    metrics: routeMetrics(safe.route),
  };
}

/** `generateCourseV2Detailed` のコース定義だけを返す薄い入口 */
export function generateCourseV2(seed: number, options: GenerateOptionsV2 = {}): CourseDefinition {
  return generateCourseV2Detailed(seed, options).course;
}
