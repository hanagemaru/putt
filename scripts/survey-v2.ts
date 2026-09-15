// コース生成器v2の走査（`docs/course-generator-v2.md` §5「機械で見る」）。
//
// シードを端から生成して、合格条件を機械で数える。
//   - fallback 本数
//   - ティー側から到達できない芝の島（v1はシード1〜1000で15本・1.5%）
//   - OB面積比が受け入れ範囲（18〜45%）に収まっているか
//   - 最小曲率半径が下限以上か
//   - **総回頭角の分布**（v1は難易度が折れ角を決めていたので 90° 前後へ寄っていた）
//   - 遠回り率の分布
//
// v1にも同じ物差しを当てられるようにしてあるので、`--gen=v1` と `--gen=v2` を
// 並べれば、直したかった症状が本当に直ったかを同じ数字で見比べられる。
//
// 実行:
//   npm run survey:v2
//   npm run survey:v2 -- --gen=v1 --from=1 --to=1000
//
// 決定論の約束: 入力したシード範囲だけで結果が決まる。Math.random や時刻は使わない。

import { CONFIG } from '../src/config.ts';
import { generateCourseDetailed } from '../src/course/course-generate.ts';
import { generateCourseV2Detailed, routeMetrics } from '../src/course/course-generate-v2.ts';
import { validateCourse } from '../src/course/course-validate.ts';
import type { CourseDefinition, TerrainType } from '../src/course/course-types.ts';

const V = CONFIG.course.generatorV2;

/**
 * 島を数える格子間隔 [m]。`check-stuck.ts` の TOPO_CELL と同じ値にする。
 * これより粗いと、斜めに走る細い芝が「島」に見えてしまう
 */
const TOPO_CELL = 0.15;

/** 島として数える最小面積 [m2]。`check-stuck.ts` の ISLAND_MIN_AREA と同じ */
const ISLAND_MIN_AREA = 0.25;

interface Args {
  from: number;
  to: number;
  gen: 'v1' | 'v2';
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { from: 1, to: 1000, gen: 'v2' };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=', 2);
    const value = inline ?? argv[++i];
    if (flag === '--from') args.from = Number(value);
    else if (flag === '--to') args.to = Number(value);
    else if (flag === '--gen') {
      if (value !== 'v1' && value !== 'v2') throw new Error(`--gen は v1 か v2: ${value}`);
      args.gen = value;
    } else throw new Error(`不明な引数です: ${argv[i]}`);
  }
  if (args.from > args.to) throw new Error(`--from は --to 以下に: ${args.from} > ${args.to}`);
  return args;
}

const ARGS = parseArgs(process.argv.slice(2));

interface Row {
  seed: number;
  fallback: boolean;
  attempts: number;
  difficulty: string;
  shape: string;
  terrain: TerrainType;
  par: number;
  routeLength: number;
  routePoints: number;
  detourRatio: number;
  totalTurnDeg: number;
  minTurnRadius: number;
  /** 最小曲率半径の下限 [m]。v2だけが持つ。v1は 0（下限なし） */
  minTurnRadiusBound: number;
  obRatio: number;
  greenWidth: number;
  heightFeatures: number;
  bunkers: number;
  /** バンカーの面積比 */
  bunkerRatio: number;
  /** ティー側から辿れない芝の面積 [m2] */
  unreachableArea: number;
}

/** v1の生成コースは名前に「難易度・形」が入っている。v2は値をそのまま返す */
function rowFor(seed: number): Row {
  let course: CourseDefinition;
  let fallback: boolean;
  let attempts: number;
  let difficulty: string;
  let shape: string;
  let bound: number;

  if (ARGS.gen === 'v2') {
    const generated = generateCourseV2Detailed(seed);
    course = generated.course;
    fallback = generated.fallback;
    attempts = generated.attempts;
    difficulty = generated.difficulty;
    shape = generated.plan.shape;
    bound = generated.plan.minTurnRadius;
  } else {
    const generated = generateCourseDetailed(seed);
    course = generated.course;
    fallback = generated.fallback;
    attempts = generated.attempts;
    const [d, s] = generated.course.name.split('・');
    difficulty = d;
    shape = s;
    bound = 0;
  }

  const metrics = routeMetrics(course.route);
  const result = validateCourse(course, { cellSize: TOPO_CELL });
  // OB面積比は**生成器が自分で判定に使った格子**で測る。
  // 格子が違うと縁の1マス分だけ比が動き、受け入れ範囲の境目で判定がずれる
  const obCellSize = ARGS.gen === 'v2' ? V.validationCellSize : CONFIG.course.generator.validationCellSize;
  const obRatio =
    obCellSize === TOPO_CELL
      ? result.areaRatio.ob
      : validateCourse(course, { cellSize: obCellSize }).areaRatio.ob;
  const playable =
    result.areaRatio.green +
    result.areaRatio.rough +
    result.areaRatio.deepRough +
    result.areaRatio.bunker;
  const area = course.bounds.width * course.bounds.length;

  return {
    seed,
    fallback,
    attempts,
    difficulty,
    shape,
    terrain: course.terrain,
    par: course.par,
    routeLength: metrics.length,
    routePoints: course.route.length,
    detourRatio: metrics.detourRatio,
    totalTurnDeg: metrics.totalTurnDeg,
    minTurnRadius: metrics.minTurnRadius,
    minTurnRadiusBound: bound,
    obRatio,
    greenWidth: course.greenWidth,
    heightFeatures: course.heightFeatures?.length ?? 0,
    bunkers: course.bunkers?.length ?? 0,
    bunkerRatio: result.areaRatio.bunker,
    unreachableArea: Math.max(0, playable - result.reachableRatio) * area,
  };
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[index];
}

function describe(label: string, values: readonly number[], unit: string): string {
  const head = label ? `${label}: ` : '';
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const infinite = values.length - finite.length;
  if (finite.length === 0) return `${head}該当なし`;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const tail = infinite > 0 ? `（∞ ${infinite}本）` : '';
  return (
    `${head}最小 ${finite[0].toFixed(2)}${unit} / ` +
    `25% ${quantile(finite, 0.25).toFixed(2)} / 中央 ${quantile(finite, 0.5).toFixed(2)} / ` +
    `75% ${quantile(finite, 0.75).toFixed(2)} / 最大 ${finite[finite.length - 1].toFixed(2)}${unit} / ` +
    `平均 ${mean.toFixed(2)}${unit}${tail}`
  );
}

/** ヒストグラム。「90°前後に固まっていないか」は分布の形でしか分からない */
function histogram(values: readonly number[], edges: readonly number[], unit: string): string[] {
  const counts = new Array(edges.length + 1).fill(0);
  for (const v of values) {
    let bucket = edges.length;
    for (let i = 0; i < edges.length; i++) {
      if (v < edges[i]) {
        bucket = i;
        break;
      }
    }
    counts[bucket]++;
  }
  const total = values.length || 1;
  const lines: string[] = [];
  for (let i = 0; i < counts.length; i++) {
    const lo = i === 0 ? '' : `${edges[i - 1]}`;
    const hi = i === edges.length ? '' : `${edges[i]}`;
    const label = i === 0 ? `  〜${hi}${unit}` : i === edges.length ? `${lo}${unit}〜  ` : `${lo}〜${hi}${unit}`;
    const ratio = counts[i] / total;
    const bar = '#'.repeat(Math.round(ratio * 60));
    lines.push(`    ${label.padStart(14)} ${String(counts[i]).padStart(5)} ${(ratio * 100).toFixed(1).padStart(5)}% ${bar}`);
  }
  return lines;
}

function tally<T extends string | number>(values: readonly T[]): string {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([k, n]) => `${k} ${n}`)
    .join(' / ');
}

// --- 走査 -----------------------------------------------------------------

const started = Date.now();
const rows: Row[] = [];
for (let seed = ARGS.from; seed <= ARGS.to; seed++) {
  rows.push(rowFor(seed));
  if ((seed - ARGS.from) % 100 === 99) {
    console.error(`-- 進捗: ${seed - ARGS.from + 1} / ${ARGS.to - ARGS.from + 1}`);
  }
}
const elapsed = (Date.now() - started) / 1000;

// 決定論の確認。同じシードを2回作って一致するか
const twice =
  JSON.stringify(rowFor(ARGS.from)) === JSON.stringify(rowFor(ARGS.from)) ? 'OK' : 'NG';

const [obMin, obMax] = V.obRatio;
const fallbacks = rows.filter((r) => r.fallback);
const obOut = rows.filter((r) => r.obRatio < obMin || r.obRatio > obMax);
const tightTurns = rows.filter((r) => r.minTurnRadius < r.minTurnRadiusBound);
const islands = rows.filter((r) => r.unreachableArea >= ISLAND_MIN_AREA);

console.log('');
console.log(`生成器: ${ARGS.gen} / シード ${ARGS.from}〜${ARGS.to}（${rows.length}本）`);
console.log(`所要 ${elapsed.toFixed(1)}秒 / 決定論（同じシードを2回）: ${twice}`);
console.log(
  `島を数えた格子: ${TOPO_CELL}m / 島とみなす最小面積: ${ISLAND_MIN_AREA}m2 / ` +
    `OB面積比を測った格子: ${ARGS.gen === 'v2' ? V.validationCellSize : CONFIG.course.generator.validationCellSize}m`,
);
console.log('');
console.log('■ 合格条件');
console.log(`  fallback: ${fallbacks.length}本${fallbacks.length ? ` (${fallbacks.slice(0, 20).map((r) => r.seed).join(', ')})` : ''}`);
console.log(
  `  ティー側から到達できない芝の島: ${islands.length}本 ` +
    `(${((islands.length / rows.length) * 100).toFixed(1)}%)` +
    `${islands.length ? ` ${islands.slice(0, 20).map((r) => `${r.seed}:${r.unreachableArea.toFixed(2)}m2`).join(', ')}` : ''}`,
);
console.log(
  `  OB面積比が ${(obMin * 100).toFixed(0)}〜${(obMax * 100).toFixed(0)}% の外: ${obOut.length}本`,
);
console.log(
  ARGS.gen === 'v2'
    ? `  最小曲率半径が下限（芝幅×${V.curve.minTurnRadiusWidthFactor}、最低${V.curve.minTurnRadiusFloor}m）未満: ${tightTurns.length}本`
    : '  最小曲率半径の下限: v1には無いので判定しない',
);
console.log('');
console.log('■ 分布');
console.log(`  ${describe('総回頭角', rows.map((r) => r.totalTurnDeg), '°')}`);
console.log(histogram(rows.map((r) => r.totalTurnDeg), [15, 30, 45, 60, 75, 90, 105, 120, 150], '°').join('\n'));
console.log(`  ${describe('最小曲率半径', rows.map((r) => r.minTurnRadius), 'm')}`);
console.log(`  ${describe('遠回り率', rows.map((r) => r.detourRatio), '')}`);
console.log(histogram(rows.map((r) => r.detourRatio), [1.01, 1.03, 1.06, 1.1, 1.15, 1.25], '').join('\n'));
console.log(`  ${describe('ルート全長', rows.map((r) => r.routeLength), 'm')}`);
console.log(`  ${describe('OB面積比', rows.map((r) => r.obRatio * 100), '%')}`);
console.log(`  ${describe('ルートの点数', rows.map((r) => r.routePoints), '点')}`);
console.log('');
console.log('■ 内訳');
console.log(`  難易度: ${tally(rows.map((r) => r.difficulty))}`);
console.log(`  形: ${tally(rows.map((r) => r.shape))}`);
console.log(`  地形: ${tally(rows.map((r) => r.terrain))}`);
console.log(`  PAR: ${tally(rows.map((r) => r.par))}`);
console.log(`  PAR4のルート全長: ${describe('', rows.filter((r) => r.par === 4).map((r) => r.routeLength), 'm')}`);
console.log(
  `  むずかしいPAR4のルート全長: ${describe('', rows.filter((r) => r.par === 4 && r.difficulty === (ARGS.gen === 'v2' ? 'hard' : 'むずかしい')).map((r) => r.routeLength), 'm')}`,
);
console.log(`  高さのハザード: ${tally(rows.map((r) => r.heightFeatures))}`);
console.log(`  バンカー: ${tally(rows.map((r) => r.bunkers))}`);
console.log(`  ${describe('バンカー面積比', rows.map((r) => r.bunkerRatio * 100), '%')}`);
console.log(`  生成の試行回数: ${describe('', rows.map((r) => r.attempts), '回')}`);
