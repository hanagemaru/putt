import { CONFIG } from '../config';
import type {
  CourseDefinition,
  CoursePoint,
  EllipseHazard,
  GreenPlateau,
  HazardOutline,
  SandBunker,
  SurfaceType,
} from './course-types';
import {
  evalAngularHarmonics,
  fbm2,
  makeAngularHarmonics,
  type AngularHarmonics,
  type FbmParams,
} from './course-noise';

const N = CONFIG.course.edgeNoise;
const B = CONFIG.course.generatorV2.bunker;

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

/**
 * 輪郭の歪みまで含めた、ハザードの実効的な最大半径 [m]。
 * 生成器が「どれだけ場所を空けるか」を決めるのに使う。
 * 歪みを大きくした形（ひょうたん型など）は素の半径より外へ膨らむ。
 */
export function hazardReach(
  radiusX: number,
  radiusZ: number,
  outline: HazardOutline | undefined,
  fallbackAmplitude: number,
): number {
  return Math.max(radiusX, radiusZ) * (1 + (outline?.amplitude ?? fallbackAmplitude));
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
 * ルートに沿った累積長。幅プロファイルを引くのに要る。
 * コース定義から決まる純粋な派生値なので、キャッシュの有無で結果は変わらない
 */
const routeArcCache = new WeakMap<CourseDefinition, { cum: number[]; total: number }>();

function routeArcs(course: CourseDefinition): { cum: number[]; total: number } {
  const cached = routeArcCache.get(course);
  if (cached) return cached;
  const cum = [0];
  for (let i = 1; i < course.route.length; i++) {
    cum.push(
      cum[i - 1] +
        Math.hypot(
          course.route[i].x - course.route[i - 1].x,
          course.route[i].z - course.route[i - 1].z,
        ),
    );
  }
  const arcs = { cum, total: cum[cum.length - 1] };
  routeArcCache.set(course, arcs);
  return arcs;
}

/**
 * ルートまでの最短距離と、その最寄り点のルート上の位置（0＝ティー側 / 1＝カップ側）。
 * 幅がルートに沿って変わる（`widthProfile`）ので、距離だけでは帯を決められない
 */
function nearestOnRoute(course: CourseDefinition, x: number, z: number): { distance: number; t: number } {
  const { cum, total } = routeArcs(course);
  let best = Infinity;
  let bestT = 0;
  for (let i = 1; i < course.route.length; i++) {
    const a = course.route[i - 1];
    const b = course.route[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const u =
      lengthSq === 0 ? 0 : Math.min(Math.max(((x - a.x) * dx + (z - a.z) * dz) / lengthSq, 0), 1);
    const distance = Math.hypot(x - (a.x + dx * u), z - (a.z + dz * u));
    if (distance < best) {
      best = distance;
      bestT = total > 0 ? (cum[i - 1] + Math.sqrt(lengthSq) * u) / total : 0;
    }
  }
  return { distance: best, t: bestT };
}

/**
 * ルート位置 t での芝幅の倍率。`widthProfile` は等間隔の点なので線形に繋ぐ。
 * 省略なら 1（今までと同じ一定幅）
 */
export function widthScaleAt(course: CourseDefinition, t: number): number {
  const profile = course.widthProfile;
  if (!profile || profile.length === 0) return 1;
  if (profile.length === 1) return profile[0];
  const clamped = Math.min(Math.max(t, 0), 1) * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(clamped));
  const u = clamped - i;
  return profile[i] + (profile[i + 1] - profile[i]) * u;
}

/**
 * 砲台の坂の長さ [m]。**向きで変わる。**
 *
 *   花道の中（`laneHalfAngle` まで）… `laneRun`。長くて緩い坂
 *   花道の外（`laneFadeAngle` から）… `shoulder`。短くて急な坂（法面）
 *
 * 間は smoothstep で繋ぐので、高さは向きに対しても滑らかに変わる。
 * **花道の中は坂の長さが一定**なので、そこには円周方向の傾きがまったく出ない
 * （＝花道を横に流されない）
 */
function plateauRampAt(plateau: GreenPlateau, x: number, z: number): number {
  const bearing = Math.atan2(x - plateau.center.x, z - plateau.center.z);
  let delta = bearing - plateau.laneBearing;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const a = Math.abs(delta);
  if (a <= plateau.laneHalfAngle) return plateau.laneRun;
  if (a >= plateau.laneFadeAngle) return plateau.shoulder;
  const u = (a - plateau.laneHalfAngle) / (plateau.laneFadeAngle - plateau.laneHalfAngle);
  const w = 1 - u * u * (3 - 2 * u);
  return plateau.shoulder + (plateau.laneRun - plateau.shoulder) * w;
}

/**
 * 砲台グリーンの高さ [m]。上面は平ら、坂だけ滑らかに下る。
 * `green.ts` がハイトマップへ足すために呼ぶ
 */
export function plateauHeightAt(course: CourseDefinition, x: number, z: number): number {
  const plateau = course.plateau;
  if (!plateau) return 0;
  const d = Math.hypot(x - plateau.center.x, z - plateau.center.z);
  if (d <= plateau.innerRadius) return plateau.rise;
  const ramp = plateauRampAt(plateau, x, z);
  if (d >= plateau.innerRadius + ramp) return 0;
  // smoothstep。縁で傾きが 0 になるので、外の地形と段差なく繋がる
  const u = (d - plateau.innerRadius) / ramp;
  return plateau.rise * (1 - u * u * (3 - 2 * u));
}

/**
 * その座標が砲台の法面（＝ラフにする帯）の中か。
 * **花道の中は通常芝のまま返す。** パターゴルフなので、
 * フェアウェイからカップまで通常芝で繋がっていないと寄せられない
 */
function isPlateauShoulder(course: CourseDefinition, x: number, z: number): boolean {
  const plateau = course.plateau;
  if (!plateau) return false;
  const d = Math.hypot(x - plateau.center.x, z - plateau.center.z);
  if (d <= plateau.innerRadius) return false;
  const ramp = plateauRampAt(plateau, x, z);
  if (d >= plateau.innerRadius + ramp) return false;
  // 坂の長さが花道と同じ ＝ 花道の中。勾配は `laneGrade` に収まっているので通常芝で残す
  return ramp < plateau.laneRun;
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
  const shapes = course.hazards.map((hazard, index) => ({
    outline: makeAngularHarmonics(
      (course.seed + salt.water + index) >>> 0,
      hazard.outline?.orderMin ?? N.waterOrderMin,
      hazard.outline?.orderMax ?? N.waterOrderMax,
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
  const amplitude = hazard.outline?.amplitude ?? N.waterAmplitude;
  const limit = 1 + amplitude * evalAngularHarmonics(shape.outline, theta);
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
 * バンカー（生成器v2）の輪郭の歪み。池と同じ作りで、
 * コース定義とシードだけから決まるのでキャッシュの有無で結果は変わらない。
 */
const bunkerShapeCache = new WeakMap<CourseDefinition, AngularHarmonics[][]>();

function bunkerShapes(course: CourseDefinition): AngularHarmonics[][] {
  const cached = bunkerShapeCache.get(course);
  if (cached) return cached;
  const shapes = (course.bunkers ?? []).map((bunker, index) =>
    makeAngularHarmonics(
      (course.seed + N.streamSalt.bunker + index) >>> 0,
      bunker.outline?.orderMin ?? N.bunkerOrderMin,
      bunker.outline?.orderMax ?? N.bunkerOrderMax,
    ),
  );
  bunkerShapeCache.set(course, shapes);
  return shapes;
}

function isInsideSand(
  bunker: SandBunker,
  outline: AngularHarmonics[],
  x: number,
  z: number,
  margin = 0,
): boolean {
  const baseX = (x - bunker.center.x) / bunker.radiusX;
  const baseZ = (z - bunker.center.z) / bunker.radiusZ;
  if (baseX === 0 && baseZ === 0) return true;
  const theta = Math.atan2(baseZ, baseX);
  const amplitude = bunker.outline?.amplitude ?? N.bunkerAmplitude;
  const limit = 1 + amplitude * evalAngularHarmonics(outline, theta);
  if (margin <= 0) return Math.hypot(baseX, baseZ) <= limit;
  // 縁を外へ広げる。池の岸（`isInsideHazard` の fringe）と同じやり方
  const dx = (x - bunker.center.x) / (bunker.radiusX + margin);
  const dz = (z - bunker.center.z) / (bunker.radiusZ + margin);
  return Math.hypot(dx, dz) <= limit;
}

/**
 * バンカーの輪郭までの正規化距離。0 が中心、1 がちょうど砂の縁、1 より大きければ砂の外。
 * **角度ごとの歪みで割っている**ので、輪郭がどれだけ崩れていても縁がちょうど 1 になる。
 */
function sandNormalizedRadius(
  bunker: SandBunker,
  outline: AngularHarmonics[],
  x: number,
  z: number,
): number {
  const baseX = (x - bunker.center.x) / bunker.radiusX;
  const baseZ = (z - bunker.center.z) / bunker.radiusZ;
  const r = Math.hypot(baseX, baseZ);
  if (r === 0) return 0;
  const theta = Math.atan2(baseZ, baseX);
  const amplitude = bunker.outline?.amplitude ?? N.bunkerAmplitude;
  const limit = 1 + amplitude * evalAngularHarmonics(outline, theta);
  return limit > 0 ? r / limit : Infinity;
}

/**
 * バンカーの内側か。**v1のコースはバンカーを持たないので、そのまま false を返す。**
 */
function isInsideBunker(course: CourseDefinition, x: number, z: number, margin = 0): boolean {
  const bunkers = course.bunkers;
  if (!bunkers || bunkers.length === 0) return false;
  const shapes = bunkerShapes(course);
  for (let i = 0; i < bunkers.length; i++) {
    if (isInsideSand(bunkers[i], shapes[i], x, z, margin)) return true;
  }
  return false;
}

/**
 * バンカーのすり鉢による高さの変化 [m]（0 または負）。
 *
 * **窪みの縁は砂の輪郭そのもの。** 形は `1 - q^n`（q は輪郭までの正規化距離）なので
 *   - q = 1（＝砂の縁）でちょうど 0。外の芝には一切影響しない
 *   - 傾きは q に比例して**縁でいちばん急**になる（＝縁を起点に落ちる皿）
 *   - q = 0（中心）で傾きが 0。底は平ら
 * `(1 - r^2)^2` のような「中心も縁も平らで途中が急」な形とは逆で、
 * 砂の面全体が縁から落ち込む1枚の皿になる。
 *
 * 急になるのは砂の中だけなので、止まれる勾配の上限は芝（7.8%）ではなく砂（62.7%）を見ればよい。
 */
export function bunkerBasinAt(course: CourseDefinition, x: number, z: number): number {
  const bunkers = course.bunkers;
  if (!bunkers || bunkers.length === 0) return 0;
  const shapes = bunkerShapes(course);
  let drop = 0;
  for (let i = 0; i < bunkers.length; i++) {
    const bunker = bunkers[i];
    // 枠の外は角度も歪みも引かずに捨てる（ハイトマップの全点から呼ばれる）
    const reach = hazardReach(bunker.radiusX, bunker.radiusZ, bunker.outline, N.bunkerAmplitude);
    if (Math.abs(x - bunker.center.x) > reach || Math.abs(z - bunker.center.z) > reach) continue;
    const q = sandNormalizedRadius(bunker, shapes[i], x, z);
    if (q >= 1) continue;
    drop -= bunker.depth * (1 - Math.pow(q, N.bunkerBasinProfile));
  }
  return drop;
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
 * ルートからの距離で決まる帯（芝 → ラフ → セカンドカット → OB）の種別。
 * 池と保護域の判定はここには入れず、呼ぶ側で先に済ませる。
 */
function bandSurfaceAt(course: CourseDefinition, x: number, z: number): SurfaceType {
  const salt = N.streamSalt;
  // 幅がルートに沿って変わるコース（`widthProfile`）では、最寄り点の位置も要る。
  // プロファイルが無ければ倍率は 1 で、今までとまったく同じ計算になる
  const { distance, t } = nearestOnRoute(course, x, z);
  const halfGreen = (course.greenWidth / 2) * widthScaleAt(course, t);
  // 揺らぎの幅は [-1, 1] に収まるので、どう転んでも結果が変わらない距離ではノイズを引かない。
  // 早期に返しても同じ答えになる（枝刈りであって、場所ごとの結果は変わらない）
  if (distance <= halfGreen * (1 - N.greenAmplitude)) return 'green';
  const maxPlayable =
    halfGreen * (1 + N.greenAmplitude) +
    course.roughFringe * (1 + N.roughAmplitude) +
    course.deepRoughFringe * (1 + N.deepRoughAmplitude);
  if (distance > maxPlayable) return 'ob';

  const greenEdge = halfGreen * bandScale(course.seed, salt.green, N.greenAmplitude, x, z);
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

  const band = bandSurfaceAt(course, x, z);
  // バンカー（生成器v2）。**帯に関わらず砂として塗る。**
  //
  // 以前は芝の上だけを砂にしていたので、半径がOBへ届いた砂はそこで切り落とされ、
  // 見た目には「砂がOBへめり込む」状態になっていた（実機で EXPERT H1 の指摘）。
  // 置くのをやめると砂の少ないホールが増えるので、**境界のほうを砂の形へ合わせる**。
  // OB側へはみ出した分は、すぐ下で打てる地面に変える。
  //
  // **砲台の法面より先に見る。** 逆にすると、法面の輪がガードバンカーを横切って
  // ラフに塗り替えてしまう（実機で「砂がラフで不自然に横切られている」と出た）。
  // 砂は砂で、坂の上にあっても砂であることは変わらない
  if (isInsideBunker(course, x, z)) return 'bunker';
  // **OB境界を砂の形に沿って膨らませる。** 砂の縁の外 `obClearance` ぶんは必ず打てる地面。
  // 実際のゴルフでバンカーが直接OBへ繋がることはない
  if (band === 'ob' && isInsideBunker(course, x, z, B.obClearance)) return 'deepRough';
  // 砲台グリーンの法面は**ラフにする**。通常芝は勾配7.8%で止まらなくなるが、
  // ラフは27.4%まで止まれるので、ここをラフにして初めて「高い段」が成立する。
  // 芝の外（セカンドカット・OB）は塗り替えない
  if ((band === 'green' || band === 'rough') && isPlateauShoulder(course, x, z)) return 'rough';
  return band;
}

/**
 * **ティーから真っ直ぐ転がせる距離 [m]。** シード選定と一覧のための物差しで、ゲームは呼ばない。
 *
 * ティーショットは真っ直ぐしか打てないので、ティーの近くで曲がるホールは
 * 「少し転がしてすぐ止める」しかできない。実機で
 * 「S字がティーの近くで曲がるとティーショットを全然しっかり打てない」と出た。
 *
 * ルート初期方向を中心に狙いを扇状に振り、**通常芝を外れずに進める最長の距離**を返す。
 * 砂・ラフは「外れた」とみなす（狙って入れる場所ではない）
 */
export function teeStraightDistance(course: CourseDefinition): number {
  const R = CONFIG.course.teeRun;
  const base = Math.atan2(course.route[1].x - course.route[0].x, course.route[1].z - course.route[0].z);
  const fan = (R.fanDeg * Math.PI) / 180;
  const fanStep = (R.fanStepDeg * Math.PI) / 180;
  let best = 0;
  for (let a = -fan; a <= fan + 1e-9; a += fanStep) {
    const dx = Math.sin(base + a);
    const dz = Math.cos(base + a);
    let d = R.step;
    while (d <= R.maxDistance) {
      if (surfaceAt(course, course.tee.x + dx * d, course.tee.z + dz * d) !== 'green') break;
      d += R.step;
    }
    best = Math.max(best, d - R.step);
  }
  // ホール長を超えて測っても意味がないので、呼ぶ側が割合にするときは全長で切る
  return best;
}

/**
 * **砲台の花道が、坂の上まで通常芝で繋がっているか。**
 *
 * パターゴルフなので、フェアウェイからカップまで通常芝で繋がっていないと寄せられない。
 * 砲台はカップ中心の円で、花道は放射状に真っ直ぐ伸びるので、
 * **フェアウェイが曲がっているホールでは花道の先がラフへ外れることがある**
 * （実測で120本中23本）。生成器で直すよりシード選定で弾くほうが単純なので、
 * `check:stuck` とシード選定の条件にしてある。
 *
 * 測るのは花道の**中心線**（坂が持ち上げている範囲だけ）。
 * 扇の端まで芝であることは求めない。狭いフェアウェイでは原理的に入らないし、
 * 寄せるのに要るのは「1本通っていること」だから
 */
export function plateauLaneIsTurf(course: CourseDefinition): boolean {
  const plateau = course.plateau;
  if (!plateau) return true;
  const step = CONFIG.course.teeRun.step;
  const dx = Math.sin(plateau.laneBearing);
  const dz = Math.cos(plateau.laneBearing);
  const outer = plateau.innerRadius + plateau.laneRun;
  for (let d = plateau.innerRadius; d <= outer + 1e-9; d += step) {
    if (surfaceAt(course, plateau.center.x + dx * d, plateau.center.z + dz * d) !== 'green') {
      return false;
    }
  }
  return true;
}
