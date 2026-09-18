// 通常ツアーの固定9ホールセット（spec §6）。
//
// **正本はセット名・シード列・ホールごとの仕掛け（`holes`）。** ホールの中身はシードから
// 生成器が決める。4セットとも PAR3×2・PAR4×5・PAR5×2（合計PAR36）。
//
// ## 作り方は2通りある
//
// - **BEGINNER**: コース単位の仕立て（`tourSetups.beginner`）でシードを選ぶだけの古い作り方。
//   実機で「このままでいい」と出て確定しているので、**触らない**
// - **STANDARD / ADVANCED / EXPERT**: `tourSetups.composed`（仕掛けゼロ）を土台に、
//   **ホールごとに `CONFIG.course.holeFeatures` の部品を足す**新しい作り方。
//   実験コース（LAB）で試した作り方がそのまま固定コースの作り方になった
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
// ## 難易度はコース単位のつまみでは作らない
//
// 3コースとも速さ10ft・うねり1.0・曲率半径の下限も同じ。違うのは
// **どの仕掛けをいくつ足すかと、芝幅・長さをどこから選ぶか**だけ。
//
// 実機のスコアで分かっていること。
//
// - **池はほとんど難易度に効かない。** 生成器は池をルートから必ず離して置くので、
//   実測でルート中心線から芝半幅の1.94倍（＝フェアウェイ1本分外）にある。
//   効かせたいときは岸（ラフ）を無くしてフェアウェイが直接水に接させる（`bareWaterChance`）
// - **うねりは効きすぎる。** 倍率を1.1へ上げただけで、カップの周りが止まれない面だらけになる。
//   **1.0より上げない**
// - 効いているのは**芝幅・長さ・形・砂**
//
// ## PAR3だけはどのコースでも易しい
//
// 生成器のPAR3は必ず `easy` で、10〜13m・芝幅4.6m以上にしかならない（走査3000本で例外なし）。
// 細くしたいときは `narrow` を足す（EXPERT H6 は 芝3.00m）。難易度はPAR4とPAR5が担う。

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
  /**
   * そのホールだけ別の生成器で作る（省略＝コースの生成器）。
   *
   * **BEGINNER だけが使う。** 本番の風の丘（v1）といまのビギナー（v2）を混ぜてあり、
   * v1 は「狭くて真っ直ぐでハザード無し」、v2 は「広くて曲がってバンカーあり」と
   * 性格がはっきり違うので、混ぜると9ホールの振れ幅が広がる
   */
  generator?: 'v1' | 'v2';
  /** そのホールで試している仕掛け。マップ一覧とコメントのための短い名前 */
  label?: string;
}

export interface TourDefinition {
  /** URL の ?tour= に使う、変更しない短いID */
  id: string;
  /** プレイヤーへ見せるコース名 */
  name: LocalizedText;
  /**
   * そのコースで何が待っているか。1行に収める。
   * **ゲームには出さない**（実機で「コース選択の説明はなしでいい」と出た）。
   * いまはマップ一覧（`npm run maps`）の見出しでだけ使う
   */
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
const F = CONFIG.course.holeFeatures;

/**
 * **STANDARD / ADVANCED / EXPERT のホール。** 3コースとも同じ作り方で組む。
 *
 * 土台は `tourSetups.composed`（仕掛けゼロ・ティー側の直線35%だけ）で、
 * **ホールごとに `CONFIG.course.holeFeatures` の部品を足す。**
 * 前半は仕掛けを1つずつ、後半で組み合わせる。
 *
 * ## 難易度はコース単位のつまみでは作らない
 *
 * 3コースとも速さ10ft・うねり1.0・曲率半径の下限も同じ。違うのは
 * **どの仕掛けをいくつ足すかと、芝幅・長さをどこから選ぶか**だけ。
 *
 *              芝幅の平均 / 全長 / 仕掛けの数
 *   STANDARD   4.36m / 192m / 1ホールにつき 0〜2個。池と砂は控えめ
 *   ADVANCED   3.65m / 210m / 角・岸なし池が入り、組み合わせが半分
 *   EXPERT     3.05m / 230m / 細い道が土台。ほぼ全ホールが組み合わせ
 *
 * ⚠️ **EXPERT は一度 201m で出して失敗している。** 実機で
 * 「体感は順番どおりだが、スコアは ADVANCED より4打良かった」となった。
 * 狭さだけでは打数が増えない（狭ければ短く刻んで安全に運べてしまう）。
 * **打数に効くのは長さ**なので、狭さを保ったまま各PARの帯の長い側へ寄せて 230m にした。
 *
 * ## どのコースにも池も砂も無いホールを2本入れる
 *
 * 実機で「ハザードなしでコース幅をかなり細くするとかくびれを作るとか曲げるとかだけで
 * 難易度上げるパターンもあったらいい」と出たもの。★を付けたホールがそれ。
 *
 * ## 並べる順の決まり
 *
 * **PARの並びは4コースとも同じ型にしてある。**
 *
 *   H1  H2  H3  H4  H5  H6  H7  H8  H9
 *    4   3   5   4   4   3   5   4   4   （合計PAR36）
 *
 * - **最初と最後は必ずPAR4。** 短いPAR3で始まる／終わるとラウンドの締まりがない
 * - **PAR5はH3とH7に分ける。** 以前は両方とも後半（H8・H9）に固まっていて、
 *   前半がずっと軽く、最後だけ重いラウンドになっていた
 * - PAR3はH2とH6。長いホールの直前に軽いホールが来る
 *
 * **隣り合うホールで形（gentleCurve / sweepingDogleg / serpentine）を繰り返さない。**
 * 地形も繰り返さないほうが良いが、**形を優先する**。ADVANCED は9ホール中5ホールが
 * ポテチで、PAR3の位置が固定されているため地形の重複を2か所避けられない。
 *
 * 「最終ホールはそのラウンドの最長」という以前の決まりは**やめた**。
 * 最長はPAR5（H3かH7）に来るので、最初と最後をPAR4にする決まりと両立しない。
 *
 * ## シードの選び方
 *
 * v2の生成器で1500シードを走査し、仕掛けごとに条件を変えて選んだ。
 * **27ホールすべてシードが重複せず**、BEGINNER・週替わりチャレンジv1の候補384シード・
 * 本番のv1 3コースとも重複しない（`npm run validate:challenge`）。
 *
 * どのホールも次を満たす。
 *
 *   - ティーショットをホール長の1/3以上まっすぐ転がせる
 *   - カップ周り2mの止まれない面が1.5%以下（**うねり振幅0.20で測る**。
 *     `defaultGreenParams` の0.15で測ると本番の判定と食い違う）
 *   - 砲台のあるホールは花道が坂の上まで通常芝で繋がっている
 */

/**
 * **BEGINNER。本番の風の丘（v1）と、いままでのビギナー（v2）を混ぜた9ホール。**
 *
 * 2つのセットは性格がはっきり違う。
 *
 *              全長 / 芝幅 / 曲がり / ハザード
 *   風の丘(v1)  178m / 3.87m / 17° / **池も砂もゼロ**。6本が「むずかしい・ストレート」で似ている
 *   ビギナー(v2) 152m / 5.17m / 27° / 砂8個。短くて広く、少し曲がる
 *
 * **似たものを並べないことだけを条件に9本選んだ。** v1 からは狭くて真っ直ぐな性格を、
 * v2 からは広くて曲がってバンカーのある性格を取る。
 * v1 の「むずかしい・ストレート」は5本もあって互いにそっくりなので、2本だけ使う。
 *
 * PAR5 は v2 を優先した。**v1 と v2 で par の境目が違う**ためで
 * （v1 は 22m 以上が PAR5、v2 は 27.5m 以上）、v1 の PAR5 は 24.7m と短く、
 * 同じ PAR5 でも寄せやすさが揃わない。長い側の1本だけ v1 から取っている。
 *
 * 並べる順は**隣り合うホールで形も地形も繰り返さない**。最終ホールが最長。
 * 合計 PAR36 / 163m（風の丘178m といままでのビギナー152m の間）。
 */
const BEGINNER_HOLES: readonly TourHole[] = [
  //            PAR / 全長 / 芝幅 / 形            / 地形
  /* H1 */ { seed: 232, generator: 'v1', label: '風の丘' },
  //            4 / 22.0m / 3.87m / むずかしい・ストレート / ランダム。長くて狭い。ハザードなし
  /* H2 */ { seed: 1038, generator: 'v2' },
  //            3 / 10.9m / 5.60m / sweepingDogleg / 2段。このコースで最も広い
  /* H3 */ { seed: 2207, generator: 'v2' },
  //            5 / 28.3m / 4.26m / gentleCurve    / ランダム。**このコース最長**
  /* H4 */ { seed: 848, generator: 'v1', label: '風の丘' },
  //            4 / 20.4m / 3.13m / むずかしい・ストレート / ポテチ。**このコースで最も狭い**
  /* H5 */ { seed: 2358, generator: 'v2' },
  //            4 / 14.7m / 5.39m / sweepingDogleg / 受け。砂1個
  /* H6 */ { seed: 553, generator: 'v1', label: '風の丘' },
  //            3 /  9.2m / 4.71m / やさしい・S字     / ポテチ。曲がり52°はこのコース最大
  /* H7 */ { seed: 185, generator: 'v1', label: '風の丘' },
  //            5 / 26.2m / 3.70m / むずかしい・ストレート / 2段。真っ直ぐ長い
  /* H8 */ { seed: 2967, generator: 'v2' },
  //            4 / 13.4m / 5.54m / gentleCurve    / ポテチ。いちばん短いPAR4
  /* H9 */ { seed: 1502, generator: 'v2' },
  //            4 / 17.5m / 5.50m / serpentine     / ランダム。砂なしで広い
];

/** STANDARD。広くて、仕掛けは1つずつ来る */
const STANDARD_HOLES: readonly TourHole[] = [
  //              PAR / 全長 / 芝幅 / 形            / 実測
  /* H1 */ { seed: 484, label: 'カップ周りの砂', setup: F.guard },
  //              4 / 23.8m / 3.93m / sweepingDogleg / カップ周りに砂3個（奥3個）
  /* H2 */ { seed: 940, label: '仕掛けなし' },
  //              3 / 13.0m / 4.76m / serpentine     / ★池も砂も無い。ここが基準
  /* H3 */ { seed: 1040, label: '幅のうねり', setup: F.wavyWidth },
  //              5 / 33.1m / 3.23m / gentleCurve    / ★池も砂も無い。**このコース最長**
  /* H4 */ { seed: 243, label: '砂だらけ', setup: F.variedSand },
  //              4 / 15.6m / 3.94m / sweepingDogleg / 砂3個。短いのに刻ませる
  /* H5 */ { seed: 255, label: '幅のうねり', setup: F.wavyWidth },
  //              4 / 23.6m / 4.13m / serpentine     / 幅が 0.65〜1.35倍 で振れ続ける
  /* H6 */ { seed: 907, label: 'くびれ', setup: F.waist },
  //              3 / 10.7m / 5.36m / gentleCurve    / いちばん細いところが7割
  /* H7 */ { seed: 756, label: '砲台', setup: F.plateau },
  //              5 / 27.8m / 4.78m / sweepingDogleg / 砲台17cm。長いぶん段が効く
  /* H8 */ { seed: 364, label: '幅のうねり＋カップ周りの砂', setup: { ...F.wavyWidth, ...F.guard } },
  //              4 / 17.6m / 4.55m / gentleCurve    / 幅0.65〜1.35 ＋ 砂3個（奥2個）
  /* H9 */ { seed: 201, label: '砲台', setup: F.plateau },
  //              4 / 26.4m / 4.54m / sweepingDogleg / 砲台17cm・花道5.0m
];

/** ADVANCED。狭くなり、角と岸なしの池が入る */
const ADVANCED_HOLES: readonly TourHole[] = [
  /* H1 */ { seed: 266, label: '砲台＋カップ周りの砂', setup: { ...F.plateau, ...F.guard } },
  //              4 / 23.3m / 3.00m / serpentine     / 砲台17cm ＋ 砂3個（奥2個）
  /* H2 */ { seed: 197, label: 'カップ周りの砂', setup: F.guard },
  //              3 / 11.5m / 5.44m / sweepingDogleg / 短いのにカップ周りに砂3個（奥2個）
  /* H3 */ { seed: 895, label: 'S字', setup: F.sCurve },
  //              5 / 28.7m / 3.18m / serpentine     / 回頭165°・遠回り1.15
  /* H4 */ { seed: 973, label: '角', setup: F.corner },
  //              4 / 27.1m / 3.08m / sweepingDogleg / 回頭117°・遠回り1.35
  /* H5 */ { seed: 286, label: '岸なし池', setup: F.bareWater },
  //              4 / 24.0m / 3.40m / gentleCurve    / 池2個ともフェアウェイが直接水に接する
  /* H6 */ { seed: 1433, label: 'くびれ', setup: F.waist },
  //              3 / 12.8m / 5.09m / sweepingDogleg / ★池も砂も無い。関門を1つ通すだけ
  /* H7 */ { seed: 797, label: '岸なし池＋砂だらけ', setup: { ...F.bareWater, ...F.variedSand } },
  //              5 / 29.3m / 3.26m / serpentine     / 池2個とも岸なし ＋ 砂3個。**このコース最長**
  /* H8 */ { seed: 742, label: '幅のうねり＋角', setup: { ...F.wavyWidth, ...F.corner } },
  //              4 / 26.2m / 3.65m / sweepingDogleg / 幅0.84〜1.35 ＋ 回頭113°・遠回り1.31
  /* H9 */ { seed: 516, label: '細い道＋幅のうねり', setup: { ...F.narrow, ...F.wavyWidth } },
  //              4 / 27.4m / 2.75m / gentleCurve    / ★池も砂も無い。OBまで3.25m
];

/**
 * EXPERT。細い道が土台で、ほぼ全ホールが組み合わせ。
 *
 * **実機で「体感は順番どおりだが、スコアは ADVANCED より4打良かった」と出たので伸ばした。**
 * 201m → 230m（ADVANCED 210m より20m長い）。狭さは変えていない（芝幅3.05m）ので、
 * **長くて狭い**になった。各PARの帯の長い側から選び直している
 * （PAR3は12.3m以上／PAR4は25.5m以上／PAR5は34.9m以上。帯の上限は13・27.5・35.5m）。
 */
const EXPERT_HOLES: readonly TourHole[] = [
  /* H1 */ { seed: 387, label: '砲台＋カップ周りの砂＋細い道', setup: { ...F.plateau, ...F.guard, ...F.narrow } },
  //              4 / 27.4m / 2.92m / gentleCurve    / 砲台17cm ＋ 砂3個 ＋ OBまで3.30m
  /* H2 */ { seed: 1114, label: '細い道', setup: F.narrow },
  //              3 / 12.9m / 3.12m / serpentine     / ★池も砂も無い。PAR3の上限いっぱい
  /* H3 */ { seed: 1645, label: '細い道＋くびれ', setup: { ...F.narrow, ...F.waist } },
  //              5 / 35.2m / 2.46m / gentleCurve    / OBまで2.64m からさらに7割。**このコース最長**
  /* H4 */ { seed: 1788, label: 'S字＋細い道', setup: { ...F.sCurve, ...F.narrow } },
  //              4 / 27.2m / 2.78m / serpentine     / 回頭123°・OBまで3.00m
  /* H5 */ { seed: 994, label: '岸なし池＋角', setup: { ...F.bareWater, ...F.corner } },
  //              4 / 27.4m / 3.74m / sweepingDogleg / 池2個とも岸なし ＋ 回頭87°・遠回り1.17
  /* H6 */ { seed: 1637, label: '砲台＋カップ周りの砂', setup: { ...F.plateau, ...F.guard } },
  //              3 / 12.3m / 5.20m / gentleCurve    / 砲台12cm ＋ 砂3個（奥2個）。ここだけ広い
  /* H7 */ { seed: 1737, label: 'S字＋角＋岸なし池', setup: { ...F.sCurve, ...F.corner, ...F.bareWater } },
  //              5 / 34.9m / 3.28m / serpentine     / **回頭176°・遠回り1.26。このコース最大の曲がり**
  /* H8 */ { seed: 1371, label: '細い道', setup: F.narrow },
  //              4 / 26.8m / 1.97m / gentleCurve    / ★池も砂も無い。**芝1.97m・OBまで2.39m**
  /* H9 */ { seed: 1963, label: '細い道＋角', setup: { ...F.narrow, ...F.corner } },
  //              4 / 25.5m / 1.99m / serpentine     / 回頭100° ＋ 芝1.99m。1打目41%はこのコース最短
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
      ja: '池が無い。広くて曲がる道と、狭くて真っ直ぐな道が混ざる',
      en: 'No water. Wide bending holes mixed with narrow straight ones.',
    },
    // 生成器は**ホールごと**に指定する（v1 の風の丘と v2 のビギナーを混ぜているため）
    generator: 'v2',
    setup: SETUP.beginner,
    seeds: BEGINNER_HOLES.map((hole) => hole.seed),
    holes: BEGINNER_HOLES,
  },
  {
    id: 'standard',
    name: { ja: 'STANDARD', en: 'STANDARD' },
    description: {
      ja: '広い。仕掛けは1ホールに1つずつ来る',
      en: 'Wide. One idea at a time.',
    },
    generator: 'v2',
    setup: SETUP.composed,
    seeds: STANDARD_HOLES.map((hole) => hole.seed),
    holes: STANDARD_HOLES,
  },
  {
    id: 'advanced',
    name: { ja: 'ADVANCED', en: 'ADVANCED' },
    description: {
      ja: '狭くなる。角と、岸のない池が出てくる',
      en: 'Tighter. Doglegs, and water on the edge.',
    },
    generator: 'v2',
    setup: SETUP.composed,
    seeds: ADVANCED_HOLES.map((hole) => hole.seed),
    holes: ADVANCED_HOLES,
  },
  {
    id: 'expert',
    name: { ja: 'EXPERT', en: 'EXPERT' },
    description: {
      ja: '最も狭い。ほぼ全ホールが組み合わせで来る',
      en: 'Narrowest. Almost every hole combines two ideas.',
    },
    generator: 'v2',
    setup: SETUP.composed,
    seeds: EXPERT_HOLES.map((hole) => hole.seed),
    holes: EXPERT_HOLES,
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

/**
 * そのツアーの**ホール1本**を作る生成器。
 * ホールが指定していればそれ、無ければコースの指定、それも無ければ v1
 */
export function generatorOfHole(tour: TourDefinition, index: number): 'v1' | 'v2' {
  return tour.holes?.[index]?.generator ?? tour.generator ?? 'v1';
}

/** シードからその生成器を引く。**シードはツアー内で重複しない** */
export function generatorOfSeed(tour: TourDefinition, seed: number): 'v1' | 'v2' {
  const index = tour.seeds.indexOf(seed);
  return index < 0 ? (tour.generator ?? 'v1') : generatorOfHole(tour, index);
}
