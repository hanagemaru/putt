// コース定義の検証を Node から回すための入口。`npm run validate:course` で実行する。
//
// 確かめること:
//   1. 同じシードで2回生成したサーフェスが完全に一致する（決定論）
//   2. ティーからカップまで芝が繋がっている
//   3. サーフェスの面積比
//
// 決定論の確認は、コース定義を作り直した別オブジェクトで同じダイジェストを取って比べる
// （`surfaceAt` が内部に持つ池の形のキャッシュも作り直させる）。

import { PROTOTYPE_COURSE } from '../src/course/prototype-course.ts';
import { courseSurfaceDigest, validateCourse } from '../src/course/course-validate.ts';
import { generateCourseDetailed } from '../src/course/course-generate.ts';
import type { CourseDefinition, SurfaceType, TerrainType } from '../src/course/course-types.ts';

const SURFACES: readonly SurfaceType[] = ['green', 'rough', 'deepRough', 'water', 'ob'];
const LABEL: Record<SurfaceType, string> = {
  green: '通常芝',
  rough: 'ラフ',
  deepRough: 'セカンドカット',
  water: '池',
  ob: 'OB',
};

/** 同じ内容の別オブジェクトを作る。キャッシュを共有させないための複製 */
function cloneCourse(course: CourseDefinition): CourseDefinition {
  return JSON.parse(JSON.stringify(course)) as CourseDefinition;
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

const courses: readonly CourseDefinition[] = [PROTOTYPE_COURSE];
let failed = false;

for (const course of courses) {
  console.log(`\n=== ${course.name}（${course.id} / シード ${course.seed}）===`);

  const digestA = courseSurfaceDigest(course);
  const digestB = courseSurfaceDigest(cloneCourse(course));
  const deterministic = digestA === digestB;
  console.log(`決定論: ${deterministic ? 'OK' : 'NG'}（${digestA} / ${digestB}）`);
  if (!deterministic) failed = true;

  const result = validateCourse(course);
  console.log(`格子間隔: ${result.cellSize}m`);
  console.log(`ティーが通常芝: ${result.teeIsGreen ? 'OK' : 'NG'}`);
  console.log(`カップが通常芝: ${result.cupIsGreen ? 'OK' : 'NG'}`);
  console.log(`ティー→カップの芝の連結: ${result.connected ? 'OK' : 'NG'}`);
  console.log(`ティー側の芝の連結成分: ${percent(result.reachableRatio)}`);
  console.log('面積比:');
  for (const surface of SURFACES) {
    console.log(`  ${LABEL[surface]}: ${percent(result.areaRatio[surface])}`);
  }
  if (!result.ok) {
    failed = true;
    for (const issue of result.issues) console.log(`  ! ${issue}`);
  }
}

// シードを切り替えると外形ごと変わるので、どのシードでも遊べる形になることを確かめる。
// 帯の幅の揺らぎは100%未満なのでルート上の芝は構造的に途切れないが、
// 池や枠との組み合わせまで含めて実際に走査しておく
const SWEEP_COUNT = 200;
const SWEEP_CELL_SIZE = 0.15;

for (const base of courses) {
  console.log(`\n=== ${base.name}: シード掃引（${SWEEP_COUNT}通り・格子${SWEEP_CELL_SIZE}m）===`);
  const ratios: number[] = [];
  const bad: string[] = [];
  for (let i = 0; i < SWEEP_COUNT; i++) {
    // 掃引そのものも再現可能にする。実行ごとに変わる乱数は使わない
    const seed = (base.seed + i * 7919) >>> 0;
    const result = validateCourse({ ...base, seed }, { cellSize: SWEEP_CELL_SIZE });
    ratios.push(result.areaRatio.ob);
    if (!result.ok) bad.push(`シード ${seed}: ${result.issues.join(' / ')}`);
  }
  ratios.sort((a, b) => a - b);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  console.log(`OB面積比: 最小 ${percent(ratios[0])} / 平均 ${percent(mean)} / 最大 ${percent(ratios[ratios.length - 1])}`);
  if (bad.length === 0) {
    console.log('すべてのシードで、ティー/カップが通常芝・ティーからカップまで芝が連結: OK');
  } else {
    failed = true;
    for (const line of bad) console.log(`  ! ${line}`);
  }
}

// 生成器の掃引。シードから作ったホールが、そのまま遊べる形になっているかを確かめる。
// 生成器は内部で検証器を通すので、ここは「通ったと言い張っていないか」の答え合わせでもある
const GEN_COUNT = 200;
const GEN_CELL_SIZE = 0.15;
const GEN_BASE_SEED = 20260901;

console.log(`\n=== コース生成器: シード掃引（${GEN_COUNT}通り・格子${GEN_CELL_SIZE}m）===`);
{
  const terrainCount: Partial<Record<TerrainType, number>> = {};
  const parCount: Record<number, number> = {};
  const obRatios: number[] = [];
  let attempts = 0;
  let fallbacks = 0;
  const bad: string[] = [];

  for (let i = 0; i < GEN_COUNT; i++) {
    const seed = (GEN_BASE_SEED + i * 7919) >>> 0;
    const generated = generateCourseDetailed(seed);
    const course = generated.course;
    attempts += generated.attempts;
    if (generated.fallback) fallbacks++;
    terrainCount[course.terrain] = (terrainCount[course.terrain] ?? 0) + 1;
    parCount[course.par] = (parCount[course.par] ?? 0) + 1;

    // 同じシードから作り直したものと、サーフェスが完全に一致するか
    const digest = courseSurfaceDigest(course, { cellSize: GEN_CELL_SIZE });
    const again = courseSurfaceDigest(generateCourseDetailed(seed).course, { cellSize: GEN_CELL_SIZE });
    if (digest !== again) bad.push(`シード ${seed}: 同じシードで違う形になった（${digest} / ${again}）`);

    const result = validateCourse(course, { cellSize: GEN_CELL_SIZE });
    obRatios.push(result.areaRatio.ob);
    if (!result.ok) bad.push(`シード ${seed}: ${result.issues.join(' / ')}`);
  }

  obRatios.sort((a, b) => a - b);
  const mean = obRatios.reduce((a, b) => a + b, 0) / obRatios.length;
  console.log(`平均試行回数: ${(attempts / GEN_COUNT).toFixed(2)} 回 / 池なしへ落ちた回数: ${fallbacks}`);
  console.log(`OB面積比: 最小 ${percent(obRatios[0])} / 平均 ${percent(mean)} / 最大 ${percent(obRatios[obRatios.length - 1])}`);
  console.log(`par の内訳: ${Object.keys(parCount).sort().map((k) => `par${k} ${parCount[Number(k)]}`).join(' / ')}`);
  console.log(`地形の内訳: ${Object.entries(terrainCount).map(([k, v]) => `${k} ${v}`).join(' / ')}`);
  if (bad.length === 0) {
    console.log('すべてのシードで、決定論・ティー/カップが通常芝・ティーからカップまで芝が連結: OK');
  } else {
    failed = true;
    for (const line of bad.slice(0, 10)) console.log(`  ! ${line}`);
    if (bad.length > 10) console.log(`  ! ほか ${bad.length - 10} 件`);
  }
}

if (failed) {
  console.error('\n検証に失敗しました。');
  process.exit(1);
}
console.log('\nすべての検証を通過しました。');
