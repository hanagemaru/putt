// 通常ツアーの固定9ホールセット（spec §6）。
//
// **正本はセット名・シード列・仕立て（`setup`）**。ホールの中身はシードから生成器が決める。
// 4セットとも PAR3×2・PAR4×5・PAR5×2（合計PAR36）で、各セットのPAR4に5種類の地形を
// 1本ずつ入れ、単体でも地形を一巡できるようにした。
//
// 並べる順にも条件がある: **隣り合うホールで形（gentleCurve / sweepingDogleg / serpentine）と
// 地形を繰り返さない**（地形は2つ飛ばしでも重ねない）。最終ホールはそのラウンドの最長にする。
//
// ## 名前は風景ではなく難易度で呼ぶ
//
// 最初は 河川敷 / 丘陵 / リンクス / 山岳 という地形名を付けたが、実機で
// **「雰囲気の違いが感じ取れない」**となった。原因ははっきりしていて、
// 空の色・芝の色・木はすべてグローバル設定で、**4コースとも同じ絵**だから。
// 地形名は風景を約束するのに、風景は出せない。
//
// 名前のほうを中身へ合わせて、BEGINNER / STANDARD / ADVANCED / EXPERT にした。
// 難易度は名前が約束しても破れない（実際に長さも芝幅もハザードも違う）。
// **日本語表示でも同じ英字**にしてある（意味が取れるので訳さない）。
//
// ## コースを分ける軸
//
// **ハザードの種類でコースを分けない。** 「池だらけのコース」を作ると9ホールが同じ判断の
// 繰り返しになり、コースの中の変化が死ぬ。分けるのは長さ・芝幅・うねり・曲がりの鋭さで、
// 池・砂・起伏はどのコースでもホールごとに混ぜる。
//
// ## シードの選び方（`CONFIG.course.tourSetups` の値とセットで決める）
//
// v2の生成器で走査し、コースごとに条件を変えて9本ずつ選んだ。
// **36ホールすべてシードが重複せず**、週替わりチャレンジv1の候補384シードとも重複しない
// （`npm run validate:challenge`）。
//
//   BEGINNER 池ゼロ・砂は薄く・総回頭角40°以下・起伏0.18以下・PAR4は13〜19m
//   STANDARD 池ゼロ・砂の面積比1.2%以上。砂が中心線に掛かるホール4本以上
//   ADVANCED PAR4は18〜25m。池のあるホール5本以上・砂のあるホール5本以上（中庸をねらう）
//   EXPERT   芝幅4.1m以下・池あり・起伏0.18以上・PAR4は21m以上。
//            **さらに曲率半径の下限を半分にして走査し直し**、遠回り率1.30以上の
//            「回り込む角」を1本、総回頭角90°以上を2本入れた（下記）
//
// **PAR3だけはどのコースでも易しい。** 生成器のPAR3は必ず `easy` で、10〜13m・芝幅4.6m以上
// にしかならない（走査3000本で例外なし）。難易度はPAR4とPAR5が担う。

import { CONFIG } from '../config';
import type { Language } from '../i18n';

/** 表示名は言語別に持つ。**ID とシードは言語に依らない正本** */
export type LocalizedText = Readonly<Record<Language, string>>;

/**
 * コースの仕立て。**ホールではなくコース（9ホール全体）の性格**なので、
 * `CourseDefinition` ではなくここに持つ。値の正本は `CONFIG.course.tourSetups`
 */
export interface CourseSetup {
  /** うねりの振幅に掛ける倍率。1 が既定 */
  undulationGain: number;
  /** グリーンの速さ [ft]。**通常芝の**摩擦 MU を決める（ラフ・砂は固定） */
  stimpFeet: number;
  /** 最小曲率半径の下限に掛ける倍率。1 が既定、小さいほど「角」に近づく */
  turnRadiusScale: number;
}

export interface TourDefinition {
  /** URL の ?tour= に使う、変更しない短いID */
  id: string;
  /** プレイヤーへ見せるコース名 */
  name: LocalizedText;
  /** そのコースで何が待っているか。1行に収める（コース選択の枠が4つ並ぶため） */
  description: LocalizedText;
  /** ホール1から順に並べた生成シード */
  seeds: readonly number[];
  /** どの生成器で作るか。**省略時は 'v1'**（過去のセットを作り直さないため） */
  generator?: 'v1' | 'v2';
  /** コースの仕立て。**省略時は config の既定** */
  setup?: CourseSetup;
}

const SETUP = CONFIG.course.tourSetups;

/**
 * 通常ツアーの4コース。**やさしい順に並べる**（一覧はこの順で出る）。
 *
 * 実測の平均は次のとおり。**速さは4コースとも10ftで揃えてある**ので、
 * 難易度の差は長さ・芝幅・罰打のハザード・うねり・曲がりの鋭さで付けている。
 *
 *                全長 / 芝幅 / 池 / 砂 / 起伏 / 総回頭角 / 遠回り率の最大
 *   BEGINNER  152m / 5.17m /  0 /  8 / 0.03 / 27° / 1.03
 *   STANDARD  193m / 4.43m /  0 / 14 / 0.17 / 32° / 1.02
 *   ADVANCED  190m / 4.40m /  8 / 10 / 0.15 / 39° / 1.04
 *   EXPERT    216m / 3.60m / 13 /  3 / 0.25 / 60° / **1.42**
 *
 * **STANDARD を ADVANCED より前に置いてある。** 長さも芝幅もほぼ同じだが、
 * STANDARD は池がゼロで砂しか無い（＝罰打を受けない）。
 * ADVANCED は9ホールに池が8個あり、入れば1罰打。**罰打の有無のほうが打数に効く**
 */
export const TOUR_SETS = [
  {
    id: 'beginner',
    name: { ja: 'BEGINNER', en: 'BEGINNER' },
    description: {
      ja: '短くて広い。池が無く、起伏もほとんど無い',
      en: 'Short and wide. No water, almost no slope.',
    },
    generator: 'v2',
    setup: SETUP.beginner,
    seeds: [1038, 2967, 2358, 1502, 2461, 2090, 2980, 668, 2207],
  },
  {
    id: 'standard',
    name: { ja: 'STANDARD', en: 'STANDARD' },
    description: {
      ja: 'バンカーは多いが池は無い。罰打は受けにくい',
      en: 'Plenty of sand, but no water to punish you.',
    },
    generator: 'v2',
    setup: SETUP.standard,
    seeds: [1254, 1204, 2853, 2615, 1487, 1356, 570, 1460, 2561],
  },
  {
    id: 'advanced',
    name: { ja: 'ADVANCED', en: 'ADVANCED' },
    description: {
      ja: '池・バンカー・起伏が一通り出る',
      en: 'Water, sand and slopes, in turn.',
    },
    generator: 'v2',
    setup: SETUP.advanced,
    seeds: [377, 898, 1852, 2947, 218, 1315, 1912, 2798, 638],
  },
  {
    id: 'expert',
    name: { ja: 'EXPERT', en: 'EXPERT' },
    description: {
      ja: '狭くて長い。池が近く、回り込む角がある',
      en: 'Long and narrow. Water close by, and real doglegs.',
    },
    generator: 'v2',
    setup: SETUP.expert,
    // 曲率半径の下限を半分にして選び直した並び。
    //   H4 (1956) PAR5 124.9°・最小半径3.8m・遠回り1.42 ＝ 回り込むしかない角
    //   H9 (1318) PAR5 112.4°、H6 (973) PAR4 89.3°・最小半径4.1m
    //   H1 (1798) 10.6° / H5 (1371) 26.9° / H7 (1316) 28.2° は直線寄りで、角を挟む
    seeds: [1798, 1808, 1423, 1956, 1371, 973, 1316, 714, 1318],
  },
] as const satisfies readonly TourDefinition[];

export const DEFAULT_TOUR = TOUR_SETS[0];

/** 不明なIDや指定なしは、最初の BEGINNER へ戻す */
export function tourById(id: string | null): TourDefinition {
  return TOUR_SETS.find((tour) => tour.id === id) ?? DEFAULT_TOUR;
}

/** 仕立ての既定値。`setup` を持たないセット（v1のコース）はこれで動く */
export const DEFAULT_SETUP: CourseSetup = {
  undulationGain: 1,
  stimpFeet: CONFIG.physics.stimpFeet,
  turnRadiusScale: 1,
};

/** そのツアーの仕立て。省略しているセットは既定値を返す */
export function setupOf(tour: TourDefinition): CourseSetup {
  return tour.setup ?? DEFAULT_SETUP;
}
