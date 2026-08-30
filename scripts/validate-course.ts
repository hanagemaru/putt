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

if (failed) {
  console.error('\n検証に失敗しました。');
  process.exit(1);
}
console.log('\nすべての検証を通過しました。');
