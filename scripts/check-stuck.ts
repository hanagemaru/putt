// 「打ち切り（par + 5打）」を廃止してよいかを判断するための調査（ゲーム本体は変更しない）。
//
// 打ち切りはスコアを丸める機能ではなく、**ホールを終われなくなった人の出口**なので、
// 外す前に「終われなくなる状態が本当に無いか」を機械的に確かめる。
//
// 確かめること:
//   1. 到達可能領域の位相
//      止まれるマス（芝・ラフ・セカンドカット）の連結成分を数え、
//      ティーとカップが同じ成分に入っているか、池やOBで隔離された島があるかを見る。
//      さらに、実際に打った結果が別の成分で止まることがあるか（＝細い池やOBを
//      1ステップで跨いでしまうか）も、走らせたショット全部から数える。
//   2. 力の余裕
//      セカンドカットの上り勾配が最大の地点から、最強の一打を真上りに打って
//      ボールが何m動くか。「打っても前へ進まない」状況が成立しうるか。
//   3. 逃げ場のない位置（本命）
//      止まれるマスそれぞれから 36方向 × 数段階の初速で実際に Roller を回し、
//      **どう打っても池かOBにしか行けないマス**があるかを数える。
//      1つでも池・OB以外で止まる打ち方があれば、そのマスは「詰まない」とする。
//
// 終われることの示し方:
//   このスクリプトは「全部の打ち方を全部の位置で総当たり」はしない（現実的な時間で終わらない）。
//   代わりに、次の3つを確かめて繋ぐ。
//     (a) どの止まれるマスからも、池・OB以外で止まれる打ち方が1つはある（＝詰まない）
//     (b) どの止まれるマスからも、カップまでの距離を PROGRESS_MIN 以上縮めて止まれる
//         打ち方が1つはある。例外のマスは、横へ逃げて (b) の効くマスへ移れる
//     (c) カップから ENDGAME_RADIUS 以内の止まれるマスからは、実際にカップインできる
//   (b) は1打ごとに距離が PROGRESS_MIN ずつ縮むので、有限の打数で (c) の範囲へ入る。
//   そこで (c) が効いてホールが終わる。どれも「1つでも見つかれば良い」向きの確認なので、
//   方向や初速を細かく試さなかったぶんは**安全側**に外れる（見落とすなら「打てない」側）。
//
// 決定論の約束: Math.random も時刻も使わない。同じ引数なら必ず同じ結果になる。
// 実行: npm run check:stuck  （引数は --seeds=1-200 --cell=0.5 など。下の ARGS 参照）

import { CONFIG } from '../src/config.ts';
import { approachDirection, generateCourse } from '../src/course/course-generate.ts';
import { surfaceAt } from '../src/course/course-map.ts';
import { Green, defaultGreenParams } from '../src/green.ts';
import { Roller, criticalGradient, frictionFromStimp } from '../src/physics.ts';
import type { CourseDefinition, SurfaceType } from '../src/course/course-types.ts';

const P = CONFIG.physics;

// --- 調査の前提値 ---------------------------------------------------------

/**
 * 想定した最弱の一打 [m/s]。結論はこの値に強く依存するので、**必ず報告に書く**。
 * 入力側に下限は無い（swipe-measure.ts は速度に speedK を掛けるだけ）ので、
 * ここは「人がこれ以上ゆっくりは振れないだろう」という仮定でしかない。
 * 0.15 m/s は speedK 0.00266・反発1.00倍で スワイプ約 56 px/s に当たる。
 */
const SPEED_MIN = 0.15;

/**
 * 想定した最強の一打 [m/s]。speedK 0.00266 × 反発の上限 1.5倍 = 0.00399 [m/s per px/s] に、
 * スワイプ 1000 px/s を掛けた値。**実機のスワイプ速度の上限は分かっていない**ので、
 * この 1000 px/s は仮定。--vmax= で上書きして感度を見られるようにしてある。
 */
const SPEED_MAX = 4.0;

/** 試す初速 [m/s]。弱い順。弱い方から試して、1つ通ったらそのマスは打ち切る */
function speedLadder(vmin: number, vmax: number): number[] {
  const steps = 7;
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    // 転がる距離は初速の2乗に比例するので、距離が等間隔になるよう2乗で刻む
    const t = i / (steps - 1);
    out.push(Math.sqrt(vmin * vmin + (vmax * vmax - vmin * vmin) * t));
  }
  return out;
}

/** 試す方向の数（36方向 = 10度刻み） */
const DIRECTIONS = 36;

/** 1ショットの上限時間 [s]。これを超えたら「止まらなかった」として数える */
const MAX_SHOT_SECONDS = 60;

/** 前進とみなす、カップまでの距離の縮み [m] */
const PROGRESS_MIN = 0.3;

/**
 * 前進できなかったマスから「迂回して前進できるマスへ移れるか」を確かめる多段探索の上限。
 * 1マスから 36方向 × 初速 を打ち、止まった先からまた打つ、を繰り返す
 */
const CHAIN_MAX_CELLS = 40;
const CHAIN_MAX_DEPTH = 3;

/**
 * 位相（連結成分）を見るための格子間隔 [m]。打つマスの格子（--cell）より細かくする。
 * 粗い格子で4近傍を見ると、斜めに走る細い芝が「島」に見えてしまうため
 */
const TOPO_CELL = 0.15;

/** 島として数える最小面積 [m^2]。これ未満は格子の刻みの都合で出る点なので数えない */
const ISLAND_MIN_AREA = 0.25;

/**
 * 終盤の確認をする範囲 [m]。カップからこの距離までの止まれるマス全部から、
 * 「実際に入れられるか」を確かめる。ホールは入れないと終わらないので、
 * 前進の繰り返しだけでは「終われる」ことの確認にならない。
 *
 * カップの口は半径 5.4cm しかないので、10度刻みの36方向では 1m 先で 17cm ずれる。
 * ここだけは方向をずっと細かく刻む（下の ENDGAME_ANGLE_*）
 */
const ENDGAME_RADIUS = 1.0;

/** 終盤の確認で使う、ちょうど届く初速に対する倍率 */
const ENDGAME_SPEED_FACTORS = [1, 0.85, 1.15, 0.7, 1.3, 1.6] as const;

/** 終盤の確認の方向の刻み [度] と、カップの向きから左右へ振る上限 [度] */
const ENDGAME_ANGLE_STEP_DEG = 0.5;
const ENDGAME_ANGLE_MAX_DEG = 30;

/** 力の余裕を見るために、勾配が急な順に選ぶセカンドカットの地点の数 */
const UPHILL_SAMPLES = 5;

/** ゲーム本体の現行設定（main.ts の UNDULATION_MODES[3]「地形:強調」）に合わせる */
const UNDULATION_AMPLITUDE = CONFIG.green.compareEnhancedAmplitude;

// --- 引数 -----------------------------------------------------------------

interface Args {
  seedFrom: number;
  seedTo: number;
  cell: number;
  vmin: number;
  vmax: number;
  verbose: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    seedFrom: 1,
    seedTo: 200,
    cell: 0.5,
    vmin: SPEED_MIN,
    vmax: SPEED_MAX,
    verbose: false,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'seeds' && value) {
      const [a, b] = value.split('-');
      args.seedFrom = Number(a);
      args.seedTo = b === undefined ? Number(a) : Number(b);
    } else if (key === 'cell' && value) args.cell = Number(value);
    else if (key === 'vmin' && value) args.vmin = Number(value);
    else if (key === 'vmax' && value) args.vmax = Number(value);
    else if (key === 'verbose') args.verbose = true;
  }
  return args;
}

const ARGS = parseArgs(process.argv.slice(2));
const SPEEDS = speedLadder(ARGS.vmin, ARGS.vmax);

// --- 下ごしらえ -----------------------------------------------------------

/** main.ts の greenParamsFor と同じ組み立て。物理に効くのは高さだけなので見た目倍率は要らない */
function buildGreen(course: CourseDefinition): Green {
  return new Green(
    {
      ...defaultGreenParams(),
      seed: course.seed,
      width: course.bounds.width,
      length: course.bounds.length,
      undulationAmplitude: UNDULATION_AMPLITUDE,
      terrain: {
        type: course.terrain,
        cup: course.cup,
        approach: approachDirection(course),
      },
    },
    (x, z) => surfaceAt(course, x, z),
  );
}

function isPlayable(surface: SurfaceType): boolean {
  return surface === 'green' || surface === 'rough' || surface === 'deepRough';
}

/** 地面種別ごとの摩擦 [m/s^2]。physics.ts の frictionMultiplier と同じ */
function frictionOn(surface: SurfaceType): number {
  const base = frictionFromStimp(P.stimpFeet);
  if (surface === 'rough') return base * P.roughFrictionMultiplier;
  if (surface === 'deepRough') return base * P.deepRoughFrictionMultiplier;
  return base;
}

interface ShotResult {
  status: string;
  x: number;
  z: number;
  /** 上限時間まで止まらなかった */
  timedOut: boolean;
}

const grad = { x: 0, z: 0 };

/** 終盤の確認で使う、カップの向きからのずらし角 [rad]。真っ直ぐから外へ広げる順 */
const endgameAngles: number[] = (() => {
  const out = [0];
  const step = (ENDGAME_ANGLE_STEP_DEG * Math.PI) / 180;
  const count = Math.round(ENDGAME_ANGLE_MAX_DEG / ENDGAME_ANGLE_STEP_DEG);
  for (let k = 1; k <= count; k++) out.push(k * step, -k * step);
  return out;
})();

function shoot(roller: Roller, x: number, z: number, speed: number, direction: number): ShotResult {
  roller.launch(x, z, speed, direction);
  const maxSteps = Math.round(MAX_SHOT_SECONDS / P.timeStep);
  let steps = 0;
  while (roller.status === 'rolling' && steps < maxSteps) {
    roller.advance(P.timeStep);
    steps++;
  }
  return {
    status: roller.status,
    x: roller.x,
    z: roller.z,
    timedOut: roller.status === 'rolling',
  };
}

// --- 格子 -----------------------------------------------------------------

interface Grid {
  nx: number;
  nz: number;
  step: number;
  x0: number;
  z0: number;
  /** 芝・ラフ・セカンドカットなら 1 */
  playable: Uint8Array;
  /** さらに「勾配が摩擦以下＝そこで止まれる」なら 1 */
  stoppable: Uint8Array;
  /** 連結成分の番号（-1 は芝でないマス） */
  component: Int32Array;
  componentSizes: number[];
  cellX(i: number): number;
  cellZ(j: number): number;
  indexAt(x: number, z: number): number;
}

function buildGrid(course: CourseDefinition, green: Green, step: number): Grid {
  const halfWidth = course.bounds.width / 2;
  const halfLength = course.bounds.length / 2;
  const nx = Math.max(2, Math.floor(course.bounds.width / step) + 1);
  const nz = Math.max(2, Math.floor(course.bounds.length / step) + 1);
  const x0 = -halfWidth + (course.bounds.width - (nx - 1) * step) / 2;
  const z0 = -halfLength + (course.bounds.length - (nz - 1) * step) / 2;

  const playable = new Uint8Array(nx * nz);
  const stoppable = new Uint8Array(nx * nz);
  const component = new Int32Array(nx * nz).fill(-1);

  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const surface = surfaceAt(course, x, z);
      if (!isPlayable(surface)) continue;
      playable[j * nx + i] = 1;
      green.sampleGradient(x, z, grad);
      const slopeAccel = P.slopeFactor * P.gravity * Math.hypot(grad.x, grad.z);
      // physics.ts の停止条件と同じ: 勾配による加速度が摩擦以下なら止まれる
      if (slopeAccel <= frictionOn(surface)) stoppable[j * nx + i] = 1;
    }
  }

  // 4近傍の連結成分（芝どうし）
  const componentSizes: number[] = [];
  const queue = new Int32Array(nx * nz);
  for (let start = 0; start < nx * nz; start++) {
    if (!playable[start] || component[start] >= 0) continue;
    const id = componentSizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    component[start] = id;
    let size = 0;
    while (head < tail) {
      const index = queue[head++];
      size++;
      const i = index % nx;
      const j = (index - i) / nx;
      if (i > 0) push(index - 1);
      if (i < nx - 1) push(index + 1);
      if (j > 0) push(index - nx);
      if (j < nz - 1) push(index + nx);
      function push(next: number): void {
        if (component[next] >= 0 || !playable[next]) return;
        component[next] = id;
        queue[tail++] = next;
      }
    }
    componentSizes.push(size);
  }

  const indexAt = (x: number, z: number): number => {
    const i = Math.min(nx - 1, Math.max(0, Math.round((x - x0) / step)));
    const j = Math.min(nz - 1, Math.max(0, Math.round((z - z0) / step)));
    return j * nx + i;
  };

  return {
    nx,
    nz,
    step,
    x0,
    z0,
    playable,
    stoppable,
    component,
    componentSizes,
    cellX: (i) => x0 + i * step,
    cellZ: (j) => z0 + j * step,
    indexAt,
  };
}

// --- 1シードぶんの調査 ----------------------------------------------------

interface StuckCell {
  x: number;
  z: number;
  surface: SurfaceType;
}

interface SeedReport {
  seed: number;
  par: number;
  terrain: string;
  bounds: string;
  /** 芝の連結成分の数と、ティー成分にカップが入っているか */
  components: number;
  teeCupSameComponent: boolean;
  /** ティー成分の外にある芝の島（面積が閾値以上のもの）の数と、その合計面積 [m^2] */
  islands: number;
  islandArea: number;
  /** 調べた「止まれるマス」の数 */
  stoppableCells: number;
  /** どう打っても池・OBにしかならなかったマス */
  stuck: StuckCell[];
  /** 池・OB以外で止まれはするが、カップへ近づけなかったマス */
  noProgress: StuckCell[];
  /** そのうち、多段で打ってもカップへ辿り着けないと分かったマス */
  noReach: StuckCell[];
  /** 多段探索が上限に当たって、行けるとも行けないとも言えなかったマス */
  undecided: StuckCell[];
  /** カップから ENDGAME_RADIUS 以内で調べたマスの数と、そこから入れられなかったマス */
  endgameCells: number;
  noHoleOut: StuckCell[];
  /** 別の連結成分で止まったショットの数（＝細い池やOBを跨いだ回数） */
  crossedComponent: number;
  /** 上限時間まで止まらなかったショットの数 */
  timedOut: number;
  /** 脱出に要った最小の初速の分布 */
  escapeSpeedHistogram: number[];
  /** 前進できなかったマスの、カップまでの距離 [m] */
  noProgressDistances: number[];
  /** セカンドカットの上り勾配が最大の地点での、力の余裕 */
  worstUphill: {
    gradient: number;
    surface: SurfaceType;
    x: number;
    z: number;
    /** 真上りへ最強の一打を打ったときの移動距離 [m] */
    uphillMove: number;
    uphillStatus: string;
    /** 36方向 × 初速のうち、池・OB以外で止まれた中での最大移動距離 [m] */
    bestMove: number;
  } | null;
  /** 調べた急斜面のうち、いちばん動かせなかった地点 */
  minBestMove: { distance: number; x: number; z: number; gradient: number };
  shots: number;
}

function investigate(seed: number, args: Args): SeedReport {
  const course = generateCourse(seed);
  const green = buildGreen(course);
  const grid = buildGrid(course, green, args.cell);
  // 位相は細かい格子で見る。粗い格子だと斜めの細い芝が島に見える
  const topo = buildGrid(course, green, TOPO_CELL);
  const roller = new Roller(green, course.cup);

  const teeComponent = topo.component[topo.indexAt(course.tee.x, course.tee.z)];
  const cupComponent = topo.component[topo.indexAt(course.cup.x, course.cup.z)];

  const islandMinCells = ISLAND_MIN_AREA / (TOPO_CELL * TOPO_CELL);
  let islands = 0;
  let islandArea = 0;
  for (let id = 0; id < topo.componentSizes.length; id++) {
    if (id === teeComponent) continue;
    if (topo.componentSizes[id] < islandMinCells) continue;
    islands++;
    islandArea += topo.componentSizes[id] * TOPO_CELL * TOPO_CELL;
  }

  let shots = 0;
  const phaseShots = { escape: 0, progress: 0, chase: 0, endgame: 0, uphill: 0 };
  let phase: 'escape' | 'progress' | 'chase' | 'endgame' | 'uphill' = 'escape';
  let crossedComponent = 0;
  let timedOut = 0;
  const stuck: StuckCell[] = [];
  const noProgress: StuckCell[] = [];
  const noReach: StuckCell[] = [];
  const undecided: StuckCell[] = [];
  let stoppableCells = 0;
  /** 脱出に要った最小の初速の分布（SPEEDS の番号ごと） */
  const escapeSpeedHistogram = new Array<number>(SPEEDS.length).fill(0);
  /** 前進できなかったマスの、カップまでの距離の分布 */
  const noProgressNearCup: number[] = [];
  let minBestMove = { distance: Infinity, x: 0, z: 0, gradient: 0 };

  const cupDistance = (x: number, z: number): number =>
    Math.hypot(x - course.cup.x, z - course.cup.z);

  /** 1発打って記録する。成分跨ぎと止まらなかった回数はここで数える */
  function fire(x: number, z: number, speed: number, direction: number): ShotResult {
    const result = shoot(roller, x, z, speed, direction);
    shots++;
    phaseShots[phase]++;
    if (result.timedOut) timedOut++;
    if (result.status === 'stopped') {
      const from = topo.component[topo.indexAt(x, z)];
      const landed = topo.component[topo.indexAt(result.x, result.z)];
      if (landed >= 0 && from >= 0 && landed !== from) crossedComponent++;
    }
    return result;
  }

  const angleOf = (d: number): number => (d / DIRECTIONS) * Math.PI * 2;

  /**
   * カップへ向かう順に方向を並べ替える。前進できる打ち方は普通カップ寄りにあるので、
   * ここから試すと1〜2発で決着がつく（総当たりの結果は順序に依らない）
   */
  function directionsTowardCup(x: number, z: number): number[] {
    const bearing = Math.atan2(course.cup.x - x, -(course.cup.z - z));
    const order = [];
    for (let d = 0; d < DIRECTIONS; d++) {
      let diff = Math.abs(angleOf(d) - bearing) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      order.push({ d, diff });
    }
    order.sort((a, b) => a.diff - b.diff || a.d - b.d);
    return order.map((o) => o.d);
  }

  /** カップまで届くのに要る初速 [m/s] に近い順へ初速を並べ替える */
  function speedsTowardCup(x: number, z: number): number[] {
    const needed = Math.sqrt(2 * frictionOn('green') * cupDistance(x, z));
    return [...SPEEDS].sort((a, b) => Math.abs(a - needed) - Math.abs(b - needed));
  }

  /**
   * 池・OB以外で止まれる打ち方のうち、いちばん弱い初速の番号を返す。無ければ -1。
   * 弱い方から試すので、返る番号がそのまま「脱出に要る最小の強さ」になる
   */
  function weakestEscape(x: number, z: number): number {
    for (let k = 0; k < SPEEDS.length; k++) {
      for (let d = 0; d < DIRECTIONS; d++) {
        const status = fire(x, z, SPEEDS[k], angleOf(d)).status;
        if (status === 'stopped' || status === 'holed') return k;
      }
    }
    return -1;
  }

  /** カップへ PROGRESS_MIN 以上近づいて止まれる打ち方が1つでもあるか */
  function canProgress(x: number, z: number): boolean {
    const here = cupDistance(x, z);
    const directions = directionsTowardCup(x, z);
    for (const speed of speedsTowardCup(x, z)) {
      for (const d of directions) {
        const result = fire(x, z, speed, angleOf(d));
        if (result.status === 'holed') return true;
        if (result.status === 'stopped' && here - cupDistance(result.x, result.z) >= PROGRESS_MIN) {
          return true;
        }
      }
    }
    return false;
  }

  /** 1マスから全部の打ち方を試し、止まった先を集める（多段探索で使う） */
  function landings(x: number, z: number): { holed: boolean; cells: { x: number; z: number }[] } {
    const cells: { x: number; z: number }[] = [];
    for (const speed of SPEEDS) {
      for (let d = 0; d < DIRECTIONS; d++) {
        const result = fire(x, z, speed, angleOf(d));
        if (result.status === 'holed') return { holed: true, cells };
        if (result.status === 'stopped') cells.push({ x: result.x, z: result.z });
      }
    }
    return { holed: false, cells };
  }

  /** canProgress の結果をマスごとに覚えておく。迂回の判定で何度も引くため */
  const progressCache = new Map<number, boolean>();
  function progressAt(x: number, z: number): boolean {
    const index = grid.indexAt(x, z);
    const cached = progressCache.get(index);
    if (cached !== undefined) return cached;
    const value = canProgress(x, z);
    progressCache.set(index, value);
    return value;
  }

  /**
   * 前進できなかったマスから、横や後ろへ逃げて「前進できるマス」へ移れるかを確かめる。
   * 移れるなら、そこから先は前進の繰り返しでカップへ近づける（冒頭の「終われることの示し方」）。
   *   'reach'     : そのまま入るか、前進できるマスへ移れた
   *   'unreachable': 打てる先を全部尽くしても、前進できるマスへ移れない
   *   'undecided' : 探索の上限に当たって決められなかった
   */
  function chase(x: number, z: number): 'reach' | 'unreachable' | 'undecided' {
    const seen = new Set<number>([grid.indexAt(x, z)]);
    let frontier = [{ x, z }];
    let expanded = 0;
    for (let depth = 0; depth < CHAIN_MAX_DEPTH; depth++) {
      const next: { x: number; z: number }[] = [];
      for (const cell of frontier) {
        if (expanded >= CHAIN_MAX_CELLS) return 'undecided';
        expanded++;
        const result = landings(cell.x, cell.z);
        if (result.holed) return 'reach';
        for (const landing of result.cells) {
          const index = grid.indexAt(landing.x, landing.z);
          if (seen.has(index)) continue;
          seen.add(index);
          if (progressAt(landing.x, landing.z)) return 'reach';
          next.push(landing);
        }
      }
      if (next.length === 0) return 'unreachable';
      frontier = next;
    }
    return 'undecided';
  }

  for (let j = 0; j < grid.nz; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const index = j * grid.nx + i;
      if (!grid.stoppable[index]) continue;
      stoppableCells++;
      const x = grid.cellX(i);
      const z = grid.cellZ(j);
      phase = 'escape';
      const escapeIndex = weakestEscape(x, z);
      if (escapeIndex < 0) {
        stuck.push({ x, z, surface: surfaceAt(course, x, z) });
        continue;
      }
      escapeSpeedHistogram[escapeIndex]++;
      phase = 'progress';
      if (!progressAt(x, z)) {
        phase = 'chase';
        const cell = { x, z, surface: surfaceAt(course, x, z) };
        noProgress.push(cell);
        noProgressNearCup.push(cupDistance(x, z));
        const verdict = chase(x, z);
        if (verdict === 'unreachable') noReach.push(cell);
        else if (verdict === 'undecided') undecided.push(cell);
      }
    }
  }

  // 終盤の確認。カップの近くの止まれるマスから、実際にカップインできるかを見る
  phase = 'endgame';
  const noHoleOut: StuckCell[] = [];
  let endgameCells = 0;
  for (let j = 0; j < grid.nz; j++) {
    for (let i = 0; i < grid.nx; i++) {
      if (!grid.stoppable[j * grid.nx + i]) continue;
      const x = grid.cellX(i);
      const z = grid.cellZ(j);
      const distance = cupDistance(x, z);
      if (distance > ENDGAME_RADIUS || distance <= P.cupCaptureRadius) continue;
      endgameCells++;
      // ちょうど届く初速を基準に、その前後を試す。摩擦は足元の地面のもので見る
      const base = Math.sqrt(2 * frictionOn(surfaceAt(course, x, z)) * distance);
      let holed = false;
      const bearing = Math.atan2(course.cup.x - x, -(course.cup.z - z));
      for (const factor of ENDGAME_SPEED_FACTORS) {
        const speed = Math.min(Math.max(base * factor, args.vmin), args.vmax);
        // カップの向きから左右へ、細かい刻みで振っていく
        for (const angle of endgameAngles) {
          if (fire(x, z, speed, bearing + angle).status === 'holed') {
            holed = true;
            break;
          }
        }
        if (holed) break;
      }
      if (!holed) noHoleOut.push({ x, z, surface: surfaceAt(course, x, z) });
    }
  }

  // 力の余裕（調べること 2）。
  // セカンドカットの上り勾配が急な順に UPHILL_SAMPLES 箇所を選び、
  //   - 真上りへ最強の一打を打ったときに何m動くか
  //   - 36方向 × 初速を全部試したとき、池・OB以外で止まれる中での最大移動距離
  // を見る。後者が小さいほど「打っても前へ進まない」に近い
  phase = 'uphill';
  const candidates: { x: number; z: number; gradient: number }[] = [];
  for (let j = 0; j < grid.nz; j++) {
    for (let i = 0; i < grid.nx; i++) {
      if (!grid.playable[j * grid.nx + i]) continue;
      const x = grid.cellX(i);
      const z = grid.cellZ(j);
      if (surfaceAt(course, x, z) !== 'deepRough') continue;
      green.sampleGradient(x, z, grad);
      candidates.push({ x, z, gradient: Math.hypot(grad.x, grad.z) });
    }
  }
  candidates.sort((a, b) => b.gradient - a.gradient);

  let worst: SeedReport['worstUphill'] = null;
  for (const candidate of candidates.slice(0, UPHILL_SAMPLES)) {
    green.sampleGradient(candidate.x, candidate.z, grad);
    // 真上り（勾配ベクトルの向き）へ打つ。direction は 0 が -Z、+ で +X
    const direction = Math.atan2(grad.x, -grad.z);
    const uphill = fire(candidate.x, candidate.z, args.vmax, direction);
    const uphillMove = Math.hypot(uphill.x - candidate.x, uphill.z - candidate.z);

    let bestMove = 0;
    for (const speed of SPEEDS) {
      for (let d = 0; d < DIRECTIONS; d++) {
        const result = fire(candidate.x, candidate.z, speed, angleOf(d));
        if (result.status !== 'stopped' && result.status !== 'holed') continue;
        bestMove = Math.max(bestMove, Math.hypot(result.x - candidate.x, result.z - candidate.z));
      }
    }

    if (worst === null || candidate.gradient > worst.gradient) {
      worst = {
        gradient: candidate.gradient,
        surface: 'deepRough',
        x: candidate.x,
        z: candidate.z,
        uphillMove,
        uphillStatus: uphill.status,
        bestMove,
      };
    }
    if (bestMove < minBestMove.distance) {
      minBestMove = { distance: bestMove, x: candidate.x, z: candidate.z, gradient: candidate.gradient };
    }
  }

  if (ARGS.verbose) {
    console.log(
      `  ショット内訳: 脱出 ${phaseShots.escape} / 前進 ${phaseShots.progress} / 迂回 ${phaseShots.chase} / 終盤 ${phaseShots.endgame} / 急斜面 ${phaseShots.uphill}`,
    );
  }
  return {
    seed,
    par: course.par,
    terrain: course.terrain,
    bounds: `${course.bounds.width}×${course.bounds.length}m`,
    components: topo.componentSizes.length,
    teeCupSameComponent: teeComponent >= 0 && teeComponent === cupComponent,
    islands,
    islandArea,
    stoppableCells,
    stuck,
    noProgress,
    noReach,
    undecided,
    endgameCells,
    noHoleOut,
    crossedComponent,
    timedOut,
    escapeSpeedHistogram,
    noProgressDistances: noProgressNearCup,
    worstUphill: worst,
    minBestMove,
    shots,
  };
}

// --- 実行 -----------------------------------------------------------------

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

console.log('=== 打ち切り廃止の可否を判断するための調査 ===');
console.log(`シード: ${ARGS.seedFrom}〜${ARGS.seedTo}（生成器 generateCourse(seed)）`);
console.log(`位相を見る格子: ${TOPO_CELL}m / 打つマスの格子: ${ARGS.cell}m / 方向: ${DIRECTIONS} / 初速: ${SPEEDS.map((v) => v.toFixed(2)).join(', ')} m/s`);
console.log(`想定した最弱の一打: ${ARGS.vmin} m/s ・ 最強の一打: ${ARGS.vmax} m/s`);
console.log(
  `参考: 初速 = スワイプ[px/s] × speedK ${CONFIG.swipeTest.speedK} × 反発（${CONFIG.game.putterTuning.minScale}〜${CONFIG.game.putterTuning.maxScale}倍）× 芯の減衰（${CONFIG.swipeTest.mishitMinGain}〜1.0）`,
);
console.log(
  `摩擦: 通常芝 ${frictionOn('green').toFixed(3)} / ラフ ${frictionOn('rough').toFixed(3)} / セカンドカット ${frictionOn('deepRough').toFixed(3)} m/s^2`,
);
console.log(
  `止まれる勾配の上限: 通常芝 ${percent(criticalGradient(P.stimpFeet))} / ラフ ${percent(criticalGradient(P.stimpFeet) * P.roughFrictionMultiplier)} / セカンドカット ${percent(criticalGradient(P.stimpFeet) * P.deepRoughFrictionMultiplier)}`,
);
console.log('');

let totalStoppable = 0;
let totalStuck = 0;
let totalNoProgress = 0;
let totalNoReach = 0;
let totalUndecided = 0;
let totalEndgame = 0;
let totalNoHoleOut = 0;
let totalCrossed = 0;
let totalTimedOut = 0;
let totalShots = 0;
let seedsWithIslands = 0;
let totalIslandArea = 0;
let seedsTeeCupSplit = 0;
let maxUphill = { gradient: -1, seed: 0, uphillMove: 0, status: '', bestMove: 0, x: 0, z: 0 };
let globalMinBestMove = { distance: Infinity, x: 0, z: 0, gradient: 0, seed: 0 };
const escapeSpeedTotal = new Array<number>(SPEEDS.length).fill(0);
let noProgressWithinReach = 0;
const uphillDisplacements: number[] = [];
const problems: string[] = [];

// 決定論の確認。同じシードを2回調べて、結果が1文字も違わないことを見る
{
  const a = JSON.stringify(investigate(ARGS.seedFrom, ARGS));
  const b = JSON.stringify(investigate(ARGS.seedFrom, ARGS));
  console.log(`決定論（シード ${ARGS.seedFrom} を2回）: ${a === b ? 'OK' : 'NG'}`);
  if (a !== b) process.exitCode = 1;
}

for (let seed = ARGS.seedFrom; seed <= ARGS.seedTo; seed++) {
  const report = investigate(seed, ARGS);
  if ((seed - ARGS.seedFrom) % 25 === 24) {
    console.log(`-- 進捗: ${seed - ARGS.seedFrom + 1} / ${ARGS.seedTo - ARGS.seedFrom + 1} シード`);
  }
  totalStoppable += report.stoppableCells;
  totalStuck += report.stuck.length;
  totalNoProgress += report.noProgress.length;
  totalNoReach += report.noReach.length;
  totalUndecided += report.undecided.length;
  totalEndgame += report.endgameCells;
  totalNoHoleOut += report.noHoleOut.length;
  totalCrossed += report.crossedComponent;
  totalIslandArea += report.islandArea;
  totalTimedOut += report.timedOut;
  totalShots += report.shots;
  for (let k = 0; k < SPEEDS.length; k++) escapeSpeedTotal[k] += report.escapeSpeedHistogram[k];
  for (const d of report.noProgressDistances) if (d <= PROGRESS_MIN) noProgressWithinReach++;
  if (report.worstUphill) uphillDisplacements.push(report.worstUphill.bestMove);
  if (report.islands > 0) seedsWithIslands++;
  if (!report.teeCupSameComponent) seedsTeeCupSplit++;
  if (report.worstUphill && report.worstUphill.gradient > maxUphill.gradient) {
    maxUphill = {
      gradient: report.worstUphill.gradient,
      seed,
      uphillMove: report.worstUphill.uphillMove,
      status: report.worstUphill.uphillStatus,
      bestMove: report.worstUphill.bestMove,
      x: report.worstUphill.x,
      z: report.worstUphill.z,
    };
  }
  if (report.minBestMove.distance < globalMinBestMove.distance) {
    globalMinBestMove = { ...report.minBestMove, seed };
  }

  const flags: string[] = [];
  if (!report.teeCupSameComponent) flags.push('ティーとカップが芝で繋がっていない');
  if (report.stuck.length > 0) {
    flags.push(`詰み ${report.stuck.length}マス`);
    for (const cell of report.stuck.slice(0, 5)) {
      problems.push(
        `シード ${seed}: 詰み (${cell.x.toFixed(2)}, ${cell.z.toFixed(2)}) ${cell.surface}`,
      );
    }
  }
  if (report.noReach.length > 0) {
    flags.push(`カップへ行けない ${report.noReach.length}マス`);
    for (const cell of report.noReach.slice(0, 5)) {
      problems.push(
        `シード ${seed}: カップへ行けない (${cell.x.toFixed(2)}, ${cell.z.toFixed(2)}) ${cell.surface}`,
      );
    }
  }
  if (report.undecided.length > 0) {
    flags.push(`未確定 ${report.undecided.length}マス`);
    for (const cell of report.undecided.slice(0, 5)) {
      problems.push(
        `シード ${seed}: 未確定 (${cell.x.toFixed(2)}, ${cell.z.toFixed(2)}) ${cell.surface}`,
      );
    }
  }
  if (report.noHoleOut.length > 0) {
    flags.push(`入れられない ${report.noHoleOut.length}マス`);
    for (const cell of report.noHoleOut.slice(0, 5)) {
      problems.push(
        `シード ${seed}: カップ近くで入れられない (${cell.x.toFixed(2)}, ${cell.z.toFixed(2)}) ${cell.surface}`,
      );
    }
  }
  if (report.crossedComponent > 0) flags.push(`成分跨ぎ ${report.crossedComponent}回`);
  if (report.timedOut > 0) flags.push(`止まらず ${report.timedOut}回`);

  if (ARGS.verbose || flags.length > 0) {
    console.log(
      `シード ${seed}: par${report.par} ${report.terrain} ${report.bounds} ` +
        `止まれるマス ${report.stoppableCells} / 芝の成分 ${report.components}（島 ${report.islands}・${report.islandArea.toFixed(2)}m2）` +
        (flags.length > 0 ? ` ! ${flags.join(' / ')}` : ''),
    );
  }
}

const seeds = ARGS.seedTo - ARGS.seedFrom + 1;
console.log('');
console.log('=== まとめ ===');
console.log(`調べたシード: ${seeds} / 打ったショット: ${totalShots}`);
console.log(`調べた「止まれるマス」: ${totalStoppable}`);
console.log(`ティーとカップが芝で繋がっていないシード: ${seedsTeeCupSplit}`);
console.log(
  `ティー成分の外に芝の島（${ISLAND_MIN_AREA}m2以上）があるシード: ${seedsWithIslands} / 島の合計面積 ${totalIslandArea.toFixed(2)}m2`,
);
console.log(`別の連結成分で止まったショット（池・OBを跨いだ）: ${totalCrossed}`);
console.log(`上限 ${MAX_SHOT_SECONDS}s まで止まらなかったショット: ${totalTimedOut}`);
console.log(`詰み（どう打っても池かOB）のマス: ${totalStuck}`);
console.log(`前進できなかったマス: ${totalNoProgress}（うちカップへ行けない ${totalNoReach} / 未確定 ${totalUndecided}）`);
console.log(
  `カップから ${ENDGAME_RADIUS}m 以内で調べたマス: ${totalEndgame} / そこから入れられなかったマス: ${totalNoHoleOut}`,
);
console.log(
  `脱出に要った最小の初速の分布: ${SPEEDS.map((v, k) => `${v.toFixed(2)}m/s ${escapeSpeedTotal[k]}`).join(' / ')}`,
);
console.log(
  `前進できなかったマスのうち、カップまで ${PROGRESS_MIN}m 以内（＝入れるしかない位置）: ${noProgressWithinReach}`,
);
{
  const sorted = [...uphillDisplacements].sort((a, b) => a - b);
  console.log(
    `各シードのセカンドカット最大上り地点で、いちばん遠くへ動かせた距離: ` +
      `最小 ${(sorted[0] ?? 0).toFixed(2)}m / 中央 ${(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(2)}m / 最大 ${(sorted[sorted.length - 1] ?? 0).toFixed(2)}m`,
  );
}
console.log(
  `セカンドカットの最大上り勾配: ${percent(maxUphill.gradient)}（シード ${maxUphill.seed} / ` +
    `(${maxUphill.x.toFixed(2)}, ${maxUphill.z.toFixed(2)})）。そこで真上りへ最強の一打 ${ARGS.vmax} m/s: ` +
    `${maxUphill.uphillMove.toFixed(2)}m 動いて ${maxUphill.status} / 全方向の中でいちばん遠くへ動かせた距離 ${maxUphill.bestMove.toFixed(2)}m`,
);
console.log(
  `調べた急斜面の中でいちばん動かせなかった地点: ${globalMinBestMove.distance.toFixed(2)}m` +
    `（シード ${globalMinBestMove.seed} / (${globalMinBestMove.x.toFixed(2)}, ${globalMinBestMove.z.toFixed(2)}) / 勾配 ${percent(globalMinBestMove.gradient)}）`,
);
if (problems.length > 0) {
  console.log('');
  console.log('=== 具体例 ===');
  for (const line of problems.slice(0, 60)) console.log(`  ! ${line}`);
  if (problems.length > 60) console.log(`  ! ほか ${problems.length - 60} 件`);
}
