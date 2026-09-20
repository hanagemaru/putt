// 固定ツアーの1ホールを組み立てる（コース → グリーン → 転がり）。
//
// **ゲーム本体・詰み検証・リプレイ検証の3つが、同じここを通る。**
// 組み立てが1mmでも食い違うと、同じシードから別のホールが出てくる。
// そうなると「本人の画面では42打・サーバでは43打」が起き、しかもそれが**他人の順位を動かす**
// （`docs/ranking.md` §4-6）。写しを増やさないための入口。
//
// three.js は触らない。**Node からそのまま読める**こと（`scripts/` が読む）。

import { CONFIG } from '../config';
import { Green, defaultGreenParams } from '../green';
import { Roller } from '../physics';
import { approachDirection, generateCourse } from './course-generate';
import { generateCourseV2 } from './course-generate-v2';
import { bunkerBasinAt, plateauHeightAt, surfaceAt } from './course-map';
import type { CourseDefinition } from './course-types';
import {
  generateOptionsFor,
  generatorOfSeed,
  setupOfSeed,
  type CourseSetup,
  type TourDefinition,
} from './tour-holes';

/**
 * **本番で実際に使っているうねりの振幅** [m]。
 *
 * `main.ts` の地形モードは既定が `UNDULATION_MODES[3]`（地形:強調/形1.5×）で、
 * 物理に効く振幅はその `compareEnhancedAmplitude` のほう。
 * **`defaultGreenParams()` の 0.15 ではない。** ここを取り違えると、
 * 転がりが本番と変わってしまう（固定コースの選定もこの値で測っている）
 */
export const LIVE_UNDULATION_AMPLITUDE = CONFIG.green.compareEnhancedAmplitude;

/** そのホールの仕立て。コースの仕立てを、ホールごとの上書きで塗り替えたもの */
export function tourHoleSetup(tour: TourDefinition, seed: number): CourseSetup {
  return setupOfSeed(tour, seed >>> 0);
}

/**
 * そのホールのコース。**生成器はツアーが持つが、ホール単位で上書きできる**
 * （BEGINNER は v1 と v2 を混ぜている）
 */
export function tourHoleCourse(tour: TourDefinition, seed: number): CourseDefinition {
  const value = seed >>> 0;
  const setup = tourHoleSetup(tour, value);
  return generatorOfSeed(tour, value) === 'v2'
    ? generateCourseV2(value, generateOptionsFor(setup))
    : generateCourse(value);
}

/**
 * グリーンの作り方。**高さ（＝転がり）に効くものが全部ここに入る。**
 * 見た目だけの倍率（`visualHeightScale`）は入れない。呼ぶ側が別に持つ
 */
export function holeGreenParams(
  course: CourseDefinition,
  setup: CourseSetup,
  amplitude: number = LIVE_UNDULATION_AMPLITUDE,
) {
  return {
    ...defaultGreenParams(),
    seed: course.seed,
    width: course.bounds.width,
    length: course.bounds.length,
    // コースの仕立ての倍率を掛ける。**絶対値ではなく倍率にしてある**ので、
    // アンジュレーション比較モードは今までどおり効く
    undulationAmplitude: amplitude * setup.undulationGain,
    terrain: {
      type: course.terrain,
      cup: course.cup,
      approach: approachDirection(course),
    },
    // 高さのハザード（生成器v2）。v1のコースは持たないので undefined のまま渡る
    heightFeatures: course.heightFeatures,
    // バンカーのすり鉢。縁を砂の輪郭に合わせるので、コース定義を知っている側から渡す
    bunkerBasin: (x: number, z: number) => bunkerBasinAt(course, x, z),
    plateau: (x: number, z: number) => plateauHeightAt(course, x, z),
  };
}

export function buildHoleGreen(
  course: CourseDefinition,
  setup: CourseSetup,
  amplitude: number = LIVE_UNDULATION_AMPLITUDE,
): Green {
  return new Green(holeGreenParams(course, setup, amplitude), (x, z) =>
    surfaceAt(course, x, z),
  );
}

/** **グリーンの速さはコースの仕立てが決める**ので、転がりを作るたびにここを通す */
export function buildHoleRoller(
  green: Green,
  course: CourseDefinition,
  setup: CourseSetup,
): Roller {
  const roller = new Roller(green, course.cup);
  roller.stimpFeet = setup.stimpFeet;
  return roller;
}
