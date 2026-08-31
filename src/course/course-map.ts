import { CONFIG } from '../config';
import type { CourseDefinition, CoursePoint, EllipseHazard, SurfaceType } from './course-types';
import {
  evalAngularHarmonics,
  fbm2,
  makeAngularHarmonics,
  type AngularHarmonics,
  type FbmParams,
} from './course-noise';

const N = CONFIG.course.edgeNoise;

const BAND_FBM: FbmParams = {
  octaves: N.bandOctaves,
  lacunarity: N.bandLacunarity,
  gain: N.bandGain,
};

function pointSegmentDistance(point: CoursePoint, a: CoursePoint, b: CoursePoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = Math.min(
    Math.max(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq, 0),
    1,
  );
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

/** ルート（芝の中心線）までの最短距離 [m]。生成器が池を置くときにも使う */
export function distanceToRoute(course: CourseDefinition, x: number, z: number): number {
  const point = { x, z };
  let distance = Infinity;
  for (let i = 1; i < course.route.length; i++) {
    distance = Math.min(distance, pointSegmentDistance(point, course.route[i - 1], course.route[i]));
  }
  return distance;
}

/**
 * 池ごとの輪郭の歪み。シードとハザードの並び順だけで決まるので、
 * 同じコース定義なら毎回同じ形になる。
 */
interface HazardShape {
  /** 輪郭そのものの歪み（半径に対する割合） */
  outline: AngularHarmonics[];
  /** 岸の幅の歪み（waterFringe に対する割合） */
  shore: AngularHarmonics[];
}

// 池の歪みは1コースにつき数個しか作らないので、コース定義ごとに一度だけ作って持つ。
// 中身はシードから決まる純粋な派生値なので、キャッシュの有無で結果は変わらない
const hazardShapeCache = new WeakMap<CourseDefinition, HazardShape[]>();

function hazardShapes(course: CourseDefinition): HazardShape[] {
  const cached = hazardShapeCache.get(course);
  if (cached) return cached;
  const salt = N.streamSalt;
  const shapes = course.hazards.map((_, index) => ({
    outline: makeAngularHarmonics(
      (course.seed + salt.water + index) >>> 0,
      N.waterOrderMin,
      N.waterOrderMax,
    ),
    shore: makeAngularHarmonics(
      (course.seed + salt.shore + index) >>> 0,
      N.waterOrderMin,
      N.waterOrderMax,
    ),
  }));
  hazardShapeCache.set(course, shapes);
  return shapes;
}

/**
 * 池（margin = 0）または岸を含む範囲（margin > 0）の内側か。
 *
 * 真楕円をやめるため、正規化した楕円座標の半径 1 を角度ごとに `outline` で膨らませる。
 * 角度は**歪ませる前の楕円座標**から求めるので、岸を広げても角度の対応は変わらず、
 * 岸の領域は必ず池の領域を含む（水際が岸の外へ飛び出すことがない）。
 */
function isInsideHazard(
  hazard: EllipseHazard,
  shape: HazardShape,
  x: number,
  z: number,
  fringe: number,
): boolean {
  const baseX = (x - hazard.center.x) / hazard.radiusX;
  const baseZ = (z - hazard.center.z) / hazard.radiusZ;
  if (baseX === 0 && baseZ === 0) return true;
  const theta = Math.atan2(baseZ, baseX);
  const limit = 1 + N.waterAmplitude * evalAngularHarmonics(shape.outline, theta);
  if (fringe <= 0) {
    return Math.hypot(baseX, baseZ) <= limit;
  }
  // 岸の幅も角度ごとに変える。広い浅瀬と切り立った岸が交互に出る
  const width = fringe * (1 + N.shoreAmplitude * evalAngularHarmonics(shape.shore, theta));
  const dx = (x - hazard.center.x) / (hazard.radiusX + width);
  const dz = (z - hazard.center.z) / (hazard.radiusZ + width);
  return Math.hypot(dx, dz) <= limit;
}

function isInsideWater(course: CourseDefinition, x: number, z: number, fringe = 0): boolean {
  const shapes = hazardShapes(course);
  for (let i = 0; i < course.hazards.length; i++) {
    if (isInsideHazard(course.hazards[i], shapes[i], x, z, fringe)) return true;
  }
  return false;
}

/**
 * 帯の幅の揺らぎ。位置ごとの倍率を返す（1 が定義どおりの幅）。
 *
 * ルートに沿った位置だけでなく左右でも変わるようにするため、素直に座標のノイズを引く。
 * 折れ線からの距離だけで決めると帯が左右対称の「太らせた折れ線」のままになる。
 * ノイズは [-1, 1] に収まり amplitude は 1 未満なので、倍率は必ず正になる。
 */
function bandScale(seed: number, salt: number, amplitude: number, x: number, z: number): number {
  const n = fbm2((seed + salt) >>> 0, x / N.bandWavelength, z / N.bandWavelength, BAND_FBM);
  return 1 + amplitude * n;
}

/** ティー・カップの周囲は必ず通常芝に保つ */
function isProtected(course: CourseDefinition, x: number, z: number): boolean {
  return (
    Math.hypot(x - course.tee.x, z - course.tee.z) <= N.safeRadius ||
    Math.hypot(x - course.cup.x, z - course.cup.z) <= N.safeRadius
  );
}

/**
 * 高レベルのコース定義を、任意座標の地面種別へ変換する。
 * 座標だけで決まる純関数で、呼ぶ順序や回数によって結果は変わらない（物理が毎ステップ呼ぶ）。
 */
export function surfaceAt(course: CourseDefinition, x: number, z: number): SurfaceType {
  const halfWidth = course.bounds.width / 2;
  const halfLength = course.bounds.length / 2;
  if (x < -halfWidth || x > halfWidth || z < -halfLength || z > halfLength) return 'ob';
  if (isProtected(course, x, z)) return 'green';
  if (isInsideWater(course, x, z)) return 'water';
  // 岸は芝の途中でもラフにする。池際から直接打つ状況を作らない
  if (isInsideWater(course, x, z, course.waterFringe)) return 'rough';

  const salt = N.streamSalt;
  const distance = distanceToRoute(course, x, z);
  // 揺らぎの幅は [-1, 1] に収まるので、どう転んでも結果が変わらない距離ではノイズを引かない。
  // 早期に返しても同じ答えになる（枝刈りであって、場所ごとの結果は変わらない）
  if (distance <= (course.greenWidth / 2) * (1 - N.greenAmplitude)) return 'green';
  const maxPlayable =
    (course.greenWidth / 2) * (1 + N.greenAmplitude) +
    course.roughFringe * (1 + N.roughAmplitude) +
    course.deepRoughFringe * (1 + N.deepRoughAmplitude);
  if (distance > maxPlayable) return 'ob';

  const greenEdge =
    (course.greenWidth / 2) * bandScale(course.seed, salt.green, N.greenAmplitude, x, z);
  const roughEdge =
    greenEdge + course.roughFringe * bandScale(course.seed, salt.rough, N.roughAmplitude, x, z);
  const deepRoughEdge =
    roughEdge +
    course.deepRoughFringe * bandScale(course.seed, salt.deepRough, N.deepRoughAmplitude, x, z);
  if (distance <= greenEdge) return 'green';
  if (distance <= roughEdge) return 'rough';
  if (distance <= deepRoughEdge) return 'deepRough';
  return 'ob';
}
