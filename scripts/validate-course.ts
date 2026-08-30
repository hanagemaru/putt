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
import type { CourseDefinition, SurfaceType } from '../src/course/course-types.ts';

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

if (failed) {
  console.error('\n検証に失敗しました。');
  process.exit(1);
}
console.log('\nすべての検証を通過しました。');
