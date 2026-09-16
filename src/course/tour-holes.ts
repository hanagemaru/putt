// 通常ツアーの固定9ホールセット（spec §6）。
//
// **正本はセット名・シード列・仕立て（`setup`）**。ホールの中身はシードから生成器が決める。
// 4セットとも PAR3×2・PAR4×5・PAR5×2（合計PAR36）で、各セットのPAR4に5種類の地形を
// 1本ずつ入れ、単体でも地形を一巡できるようにした。
//
// 並べる順にも条件がある: **隣り合うホールで形（gentleCurve / sweepingDogleg / serpentine）と
// 地形を繰り返さない**（地形は2つ飛ばしでも重ねない）。最終ホールはそのラウンドの最長にし、
// 直線寄り（総回頭角30°未満）とカーブが3本続かないようにしてある。
//
// ## コースを分ける軸
//
// **ハザードの種類でコースを分けない。** 「池だらけのコース」を作ると9ホールが同じ判断の
// 繰り返しになり、コースの中の変化が死ぬ。分けるのは**土地の性格（長さ・芝幅・うねり・
// グリーンの速さ）**で、池・砂・起伏はどのコースでもホールごとに混ぜる。
//
// 実在のコース分類のうち、このゲームでプレイの差になるのは土地の性格だけだった。
// 林間（樹木）のような見た目の分類は、木が装飾で物理に効かないので差にならない。
//
// ## シードの選び方（`CONFIG.course.tourSetups` の値とセットで決める）
//
// v2の生成器でシード1〜3000を走査し、コースごとに条件を変えて9本ずつ選んだ。
// **36ホールすべてシードが重複しない。**
//
//   河川敷 池ゼロ・砂は薄く・総回頭角40°以下・起伏0.18以下・PAR4は13〜19m
//   丘陵   PAR4は18〜25m。池のあるホール5本以上・砂のあるホール5本以上（中庸をねらう）
//   リンクス 池ゼロ・砂の面積比1.2%以上。砂が中心線に掛かるホール4本以上
//   山岳   芝幅4.1m以下・池あり・起伏0.18以上・PAR4は21m以上
//
// **PAR3だけはどのコースでも易しい。** 生成器のPAR3は必ず `easy` で、10〜13m・芝幅4.6m以上
// にしかならない（走査3000本で例外なし）。テーマはPAR4とPAR5が担う。

import { CONFIG } from '../config';
import type { Language } from '../i18n';

/** 表示名は言語別に持つ。**ID とシードは言語に依らない正本** */
export type LocalizedText = Readonly<Record<Language, string>>;

/**
 * コースの仕立て。**ホールではなくコース（9ホール全体）の性格**なので、
 * `CourseDefinition` ではなくここに持つ。値の正本は `CONFIG.course.tourSetups`
 */
export interface CourseSetup {
  /** うねりの振幅に掛ける倍率。1 が今までどおり */
  undulationGain: number;
  /** グリーンの速さ [ft]。摩擦 MU を決める */
  stimpFeet: number;
}

export interface TourDefinition {
  /** URL の ?tour= に使う、変更しない短いID */
  id: string;
  /** プレイヤーへ見せるコース名 */
  name: LocalizedText;
  /** 選出指標の方向。試遊後に名前と一緒に見直してよい */
  description: LocalizedText;
  /** ホール1から順に並べた生成シード */
  seeds: readonly number[];
  /** どの生成器で作るか。**省略時は 'v1'**（過去のセットを作り直さないため） */
  generator?: 'v1' | 'v2';
  /** コースの仕立て。**省略時は config の既定**（うねり等倍・スティンプ10ft） */
  setup?: CourseSetup;
}

const SETUP = CONFIG.course.tourSetups;

/**
 * 通常ツアーの4コース。**やさしい順に並べる**（一覧はこの順で出る）。
 *
 * 速さは「1打で進む距離」と「距離のぶれ」の両方を動かすので、
 * **ルート全長と必ずセットで見る**こと。実測の平均は次のとおり。
 *
 *   河川敷 152m / 芝幅5.17m / 池0個・砂8個 / 起伏0.03 / 総回頭角27°
 *   丘陵   190m / 芝幅4.40m / 池8個・砂10個 / 起伏0.15 / 総回頭角39°
 *   リンクス 193m / 芝幅4.43m / 池0個・砂14個 / 起伏0.17 / 総回頭角32°
 *   山岳   210m / 芝幅3.68m / 池13個・砂4個 / 起伏0.24 / 総回頭角54°
 *
 * **週替わりチャレンジv1の候補384シードとも重複させない**（`npm run validate:challenge`）。
 * 最初の選定では 168（河川敷H8）と 359（丘陵H4）が候補と当たったので、
 * 同じ条件・同じ地形・同じ形の 668 と 2947 へ差し替えてある
 */
export const TOUR_SETS = [
  {
    id: 'riverside',
    name: { ja: '河川敷', en: 'Riverside' },
    description: {
      ja: '平坦で広い。池は無く、グリーンは遅い（8ft）',
      en: 'Flat and wide, no water. Slow greens (8 ft).',
    },
    generator: 'v2',
    setup: SETUP.riverside,
    seeds: [1038, 2967, 2358, 1502, 2461, 2090, 2980, 668, 2207],
  },
  {
    id: 'parkland',
    name: { ja: '丘陵', en: 'Parkland' },
    description: {
      ja: '基準のコース。池も砂も起伏も出る（10ft）',
      en: 'The standard. Water, sand and slopes (10 ft).',
    },
    generator: 'v2',
    setup: SETUP.parkland,
    seeds: [377, 898, 1852, 2947, 218, 1315, 1912, 2798, 638],
  },
  {
    id: 'links',
    name: { ja: 'リンクス', en: 'Links' },
    description: {
      ja: '砂だらけで池は無い。うねりが強く速い（11ft）',
      en: 'Sand everywhere, no water. Quick greens (11 ft).',
    },
    generator: 'v2',
    setup: SETUP.links,
    seeds: [1254, 1204, 2853, 2615, 1487, 1356, 570, 1460, 2561],
  },
  {
    id: 'mountain',
    name: { ja: '山岳', en: 'Mountain' },
    description: {
      ja: '狭く長い。池が近く、いちばん速い（12ft）',
      en: 'Long, narrow, water close by. Fastest greens (12 ft).',
    },
    generator: 'v2',
    setup: SETUP.mountain,
    seeds: [2589, 973, 1316, 1078, 2365, 2890, 759, 2238, 2542],
  },
] as const satisfies readonly TourDefinition[];

export const DEFAULT_TOUR = TOUR_SETS[0];

/** 不明なIDや指定なしは、最初の「河川敷」へ戻す */
export function tourById(id: string | null): TourDefinition {
  return TOUR_SETS.find((tour) => tour.id === id) ?? DEFAULT_TOUR;
}

/** 仕立ての既定値。`setup` を持たないセット（v1のコース）はこれで動く */
export const DEFAULT_SETUP: CourseSetup = {
  undulationGain: 1,
  stimpFeet: CONFIG.physics.stimpFeet,
};

/** そのツアーの仕立て。省略しているセットは既定値を返す */
export function setupOf(tour: TourDefinition): CourseSetup {
  return tour.setup ?? DEFAULT_SETUP;
}
