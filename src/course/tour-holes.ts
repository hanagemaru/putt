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
// **「雰囲気の違いが感じ取れない」**となった。空の色・芝の色・木はすべてグローバル設定で、
// **4コースとも同じ絵**だから。地形名は風景を約束するのに、風景は出せない。
//
// 名前のほうを中身へ合わせて、BEGINNER / STANDARD / ADVANCED / EXPERT にした。
// **日本語表示でも同じ英字**にしてある（意味が取れるので訳さない）。
//
// ## 難易度は「芝幅 × 長さ × 形 ＋ 砂」で作る
//
// 実機のスコアで分かったこと。
//
// - **池はほとんど難易度に効かない。** 生成器は池をルートから必ず離して置くので、
//   実測でルート中心線から芝半幅の1.94倍（＝フェアウェイ1本分外）にある。普通に打つ限り入らない。
//   池8個のコースより、池ゼロで砂の多いコースのほうがスコアが悪かった
// - **うねりは効きすぎる。** 倍率を1.1へ上げただけで、カップの周りが止まれない面だらけになる
// - 効いているのは**芝幅・長さ・砂**
//
// なので難易度は芝幅・長さ・形と砂で作り、**うねりは BEGINNER 0.8・他は 1.0 で固定**、
// 池は「景色」と「回り込む理由」として置く。
// ただし池を少しは効かせるため、**岸（ラフ）を無くしてフェアウェイが直接水に接するホール**を
// 混ぜられるようにした（`bareWaterChance`）。
//
// ## シードの選び方（`CONFIG.course.tourSetups` の値とセットで決める）
//
// v2の生成器で走査し、コースごとに条件を変えて9本ずつ選んだ。
// **36ホールすべてシードが重複せず**、週替わりチャレンジv1の候補384シードとも重複しない
// （`npm run validate:challenge`）。
//
//   BEGINNER 池ゼロ・砂は薄く・総回頭角40°以下・起伏0.18以下・PAR4は13〜19m
//   STANDARD PAR4は17〜23mで芝幅4.0m以上。砂のあるホール7本以上
//   ADVANCED PAR4は20m以上で芝幅4.4m以下。砂7本以上＋遠回り率1.15以上を1本
//   EXPERT   PAR4は23m以上で芝幅3.9m以下、PAR5は29m以上。
//            遠回り率1.25以上の「回り込む角」と、**遠回りするS字**をそれぞれ1本以上
//
// **どのコースも「カップ周り2mの止まれない面が2%以下」を条件に入れている。**
// 実機で1ホール15打になったホールは、カップ周り2mの64.5%が勾配7.8%超
// （＝摩擦より重力が勝つ面）で、寄せても止まらなかった。
// `check:stuck` は止まれるマスからしか打たないのでこれを拾えない（同スクリプトに検査を足した）。
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
  /** S字を大きく振る（制御点を増やして遠回りさせる） */
  wideSCurve: boolean;
  /** 池の岸（ラフ）を無くす割合。フェアウェイが直接水に接する */
  bareWaterChance: number;
  /** バンカーの大きさ・形・置き場所・個数の幅を広げる */
  variedBunkers: boolean;
  /** カップの周りに置くガードバンカーの数（0＝置かない） */
  guardBunkers: number;
  /** 砲台グリーン（カップ周りを持ち上げ、法面をラフにする） */
  plateau: boolean;
  /** 芝幅の倍率。小さいほど道が細い */
  widthScale: number;
  /** ラフ・セカンドカットの幅の倍率。小さいほどOBが手前まで来る */
  fringeScale: number;
  /** くびれの深さ（0＝一定幅） */
  waist: number;
  /** 幅のうねりの大きさ（0＝一定幅）。ホール全体で広い・狭いを繰り返す */
  widthVariation: number;
  /**
   * ティー側に必ず残す直線区間（ルート全長に対する割合）。
   * **0.4 なら、ティーショットをホール長の4割ぶん真っ直ぐ転がせる**
   */
  teeStraightRun: number;
}

/**
 * ホール1本の指定。**シードが正本**で、`setup` はそのホールだけの上書き。
 *
 * LAB のように**ホールごとに違う仕掛けを試すコース**で使う。
 * 上書きしなければコースの仕立て（`TourDefinition.setup`）のまま
 */
export interface TourHole {
  seed: number;
  /** そのホールだけ仕立てを上書きする（省略＝コースの仕立てのまま） */
  setup?: Partial<CourseSetup>;
  /** そのホールで試している仕掛け。マップ一覧とコメントのための短い名前 */
  label?: string;
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
  /**
   * ホールごとの仕立ての上書き。**`seeds` と同じ並び・同じ長さ**。
   * 省略すると全ホールがコースの仕立てで作られる（既存の4コースはこちら）
   */
  holes?: readonly TourHole[];
  /** どの生成器で作るか。**省略時は 'v1'**（過去のセットを作り直さないため） */
  generator?: 'v1' | 'v2';
  /** コースの仕立て。**省略時は config の既定** */
  setup?: CourseSetup;
}

const SETUP = CONFIG.course.tourSetups;
const F = CONFIG.course.labFeatures;

/**
 * **LAB の15ホール。** 仕掛けを1つずつ試すホールと、組み合わせを試すホールを分ける。
 *
 * 実機で「1ホールに全部入れるのではなく、**ホールごとに違う要素・違う組み合わせ**に」
 * と出たので、`tourSetups.laboratory`（仕掛けゼロ）へホール単位で `labFeatures` を足す。
 * H1 は**仕掛けなしの基準**で、他のホールとの違いをここと比べて感じ取る。
 *
 * 並べる順は「単体 → 組み合わせ」。組み合わせを後ろに置くと、
 * 先に単体で覚えた手応えが組み合わせで効くようになる。
 *
 * **ここは仕上がったコースではなく、選ぶための見本帳。**
 * 実機で良かったホールを固定コースへ移す前提で、仕掛けを増やしながら足していく。
 *
 * **全ホール共通で、ティー側にホール長の35%の直線がある**（`teeStraightRun`）。
 * 実機で「S字がティーの近くで曲がるとティーショットを全然しっかり打てない」と出たため。
 * 曲がれる量は曲がる区間の長さで頭打ちになるので、
 * **同じ回頭角を出すには曲率半径を詰めるしかない**（`corner` と `sCurve` が半径も下げる理由）。
 */
const LAB_HOLES: readonly TourHole[] = [
  //              PAR / 全長 / 形          / その仕掛けの実測
  /* H1  */ { seed: 940, label: '仕掛けなし' },
  //              3 / 13.0m / serpentine     / 芝4.76m。ここが基準
  /* H2  */ { seed: 201, label: '砲台', setup: F.plateau },
  //              4 / 26.4m / sweepingDogleg / 砲台17cm・花道5.0m
  /* H3  */ { seed: 907, label: 'くびれ', setup: F.waist },
  //              3 / 10.7m / gentleCurve    / いちばん細いところが7割
  /* H4  */ { seed: 484, label: 'カップ周りの砂', setup: F.guard },
  //              4 / 23.8m / sweepingDogleg / カップ周りに砂3個。**3個とも奥**
  /* H5  */ { seed: 539, label: '細い道', setup: F.narrow },
  //              4 / 22.3m / gentleCurve    / 芝1.96m・中心線からOBまで2.29m
  /* H6  */ { seed: 973, label: '角', setup: F.corner },
  //              4 / 27.1m / sweepingDogleg / 回頭117°・遠回り1.35
  /* H7  */ { seed: 286, label: '岸なし池', setup: F.bareWater },
  //              4 / 24.0m / gentleCurve    / 池2個ともフェアウェイが直接水に接する
  /* H8  */ { seed: 895, label: 'S字', setup: F.sCurve },
  //              5 / 28.7m / serpentine     / 回頭165°・遠回り1.15
  /* H9  */ { seed: 243, label: '砂だらけ', setup: F.variedSand },
  //              4 / 15.6m / sweepingDogleg / 砂3個。短いのに砂で刻ませる
  /* H10 */ { seed: 266, label: '砲台＋カップ周りの砂', setup: { ...F.plateau, ...F.guard } },
  //              4 / 23.3m / serpentine     / 砲台17cm ＋ カップ周りの砂3個（奥2個）
  /* H11 */ { seed: 250, label: '細い道＋くびれ', setup: { ...F.narrow, ...F.waist } },
  //              5 / 30.3m / sweepingDogleg / 芝2.06m・OB2.43m・さらに7割へ絞る
  /* H12 */ { seed: 255, label: '幅のうねり', setup: F.wavyWidth },
  //              4 / 23.6m / serpentine     / 幅が 0.65〜1.35倍 で振れ続ける
  /* H13 */ { seed: 364, label: '幅のうねり＋カップ周りの砂', setup: { ...F.wavyWidth, ...F.guard } },
  //              4 / 17.6m / gentleCurve    / 幅0.65〜1.35 ＋ カップ周りの砂3個（奥2個）
  /* H14 */ { seed: 742, label: '幅のうねり＋角', setup: { ...F.wavyWidth, ...F.corner } },
  //              4 / 26.2m / sweepingDogleg / 幅0.84〜1.35 ＋ 回頭113°・遠回り1.31
  /* H15 */ { seed: 1113, label: 'S字＋角＋岸なし池', setup: { ...F.sCurve, ...F.corner, ...F.bareWater } },
  //              5 / 30.5m / serpentine     / 回頭135°・池2個とも岸なし。**このコース最長**
];

/**
 * 通常ツアーの4コース。**やさしい順に並べる**（一覧はこの順で出る）。
 *
 * 実測の平均。**速さは4コースとも10ft、うねりは BEGINNER 0.8・他 1.0。**
 *
 *              全長 / 芝幅 / 池 / 砂（面積比） / 岸なしの池 / 総回頭角 / 遠回り率の最大
 *   BEGINNER 152m / 5.17m / 0個 /  8個 (1.1%) / 0本 / 27° / 1.03
 *   STANDARD 185m / 4.26m / 6個 / 18個 (3.5%) / 4本 / 44° / 1.06
 *   ADVANCED 207m / 4.06m / 4個 / 20個 (4.3%) / 2本 / 50° / 1.27
 *   EXPERT   213m / 3.85m / 8個 / 23個 (3.3%) / 6本 / 84° / 1.39
 *   LAB      211m / 2.56m / 6個 / 28個        / 4本 / 92° / 1.61
 *
 * **LAB は実験用。** 砲台グリーン・カップ周りのガードバンカー・細い道・くびれを全部入れた。
 * 中心線からOBまでが平均2.61m しかない（既存4コースは5.0〜6.5m）ので、
 * **OBが初めて罰打ハザードとして働く**。
 *
 * **BEGINNER は実機で「このままでいい」と出たので据え置く。**
 * 新しいつまみは全部オフなので、生成器を触っても出力は1ビットも変わらない
 * （既定オプションのシード1〜400のダイジェストで確認済み）。
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
      ja: 'バンカーが増える。池は少なく、まだ広い',
      en: 'More sand. Little water, still wide.',
    },
    generator: 'v2',
    setup: SETUP.standard,
    seeds: [548, 303, 1356, 1118, 622, 1733, 1571, 1730, 1844],
  },
  {
    id: 'advanced',
    name: { ja: 'ADVANCED', en: 'ADVANCED' },
    description: {
      ja: '長くて狭い。バンカーだらけで、回り込む角もある',
      en: 'Long and narrow, sand everywhere, one real dogleg.',
    },
    generator: 'v2',
    setup: SETUP.advanced,
    // H9 (543) PAR5 107.6°・遠回り1.27 が、このコース唯一の「回り込む角」
    seeds: [1312, 1959, 325, 1339, 1713, 536, 1879, 869, 543],
  },
  {
    id: 'expert',
    name: { ja: 'EXPERT', en: 'EXPERT' },
    description: {
      ja: '最長・最狭。角とS字が続き、池が芝に直接接する',
      en: 'Longest and tightest. Doglegs, S-curves, water on the edge.',
    },
    generator: 'v2',
    setup: SETUP.expert,
    //   H2 (1931) 総回頭角 202.7° の**S字で遠回り率1.26**。v1のS字（最大202°）と同じ振り幅で、
    //             v2では `wideSCurve` を入れるまで作れなかった形
    //   H5 (1019) 125.1°・遠回り1.39 ＝ 回り込むしかない角
    //   H1 (1087) 100.5°、H3 (1612) 102.4° も遠回り率1.25以上
    //   H4 (920) 55.6° / H6 (1742) 41.7° / H8 (1545) 27.5° は緩く、角ばかりにしない
    seeds: [1087, 1931, 1612, 920, 1019, 1742, 1146, 1545, 694],
  },
  {
    id: 'laboratory',
    name: { ja: 'LAB', en: 'LAB' },
    // **ここだけ12ホール。** 枠に出る一行なので、ホール数もここで伝える
    description: {
      ja: '実験の15ホール。仕掛けを1つずつ、後半は組み合わせで',
      en: '15 holes. One new idea per hole, combined in the back half.',
    },
    generator: 'v2',
    setup: SETUP.laboratory,
    // **正本は `LAB_HOLES`。** シード列はそこから写すのではなく、そこから作る
    seeds: LAB_HOLES.map((hole) => hole.seed),
    holes: LAB_HOLES,
  },
] satisfies readonly TourDefinition[];

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
  wideSCurve: false,
  bareWaterChance: 0,
  variedBunkers: false,
  guardBunkers: 0,
  plateau: false,
  widthScale: 1,
  fringeScale: 1,
  waist: 0,
  widthVariation: 0,
  teeStraightRun: 0,
};

/** 仕立てから、生成器へ渡すオプションを作る */
export function generateOptionsFor(setup: CourseSetup) {
  return {
    turnRadiusScale: setup.turnRadiusScale,
    wideSCurve: setup.wideSCurve,
    bareWaterChance: setup.bareWaterChance,
    variedBunkers: setup.variedBunkers,
    guardBunkers: setup.guardBunkers,
    plateau: setup.plateau,
    widthScale: setup.widthScale,
    fringeScale: setup.fringeScale,
    waist: setup.waist,
    widthVariation: setup.widthVariation,
    teeStraightRun: setup.teeStraightRun,
  };
}

/** そのツアーの仕立て。省略しているセットは既定値を返す */
export function setupOf(tour: TourDefinition): CourseSetup {
  return tour.setup ?? DEFAULT_SETUP;
}

/**
 * そのツアーの**ホール1本**の仕立て。
 * `holes[index].setup` があればコースの仕立てへ重ねる（無ければコースのまま）
 */
export function setupOfHole(tour: TourDefinition, index: number): CourseSetup {
  const base = setupOf(tour);
  const override = tour.holes?.[index]?.setup;
  return override ? { ...base, ...override } : base;
}

/** シードからそのホールの仕立てを引く。**シードはツアー内で重複しない** */
export function setupOfSeed(tour: TourDefinition, seed: number): CourseSetup {
  const index = tour.seeds.indexOf(seed);
  return index < 0 ? setupOf(tour) : setupOfHole(tour, index);
}
