/**
 * 地面種別。芝は通常芝 → ラフ → セカンドカットの順に重くなり、
 * その外側だけをOBにする。
 *
 * `bunker`（砂）は芝の中に置く。**罰打はなく、そこから打つ。**
 * 摩擦がセカンドカットよりさらに高いので、止まりはするが次の一打が短くなる。
 * 水と違って越えられるので、**ルートの線の上に置ける唯一の罰則的ハザード**。
 */
export type SurfaceType = 'green' | 'rough' | 'deepRough' | 'bunker' | 'water' | 'ob';

/**
 * 地形の性格。ハイトマップの作り方を決める（spec §1）。
 * 完全に無性格なランダムだけだと「どう転がるか読む」対象にならないので、
 * 読める形を数種類そろえて、そこへうねりを足す。
 *
 * - `random`      : 従来どおり。緩い全体傾斜＋ガウシアンのうねり
 * - `singleSlope` : 片流れ。一方向へ素直に流れる
 * - `receiving`   : 受けグリーン。カップへ向かって上り、カップの奥で平らになる
 * - `saddle`      : ポテトチップ。対角が高く、残る対角が低い鞍点
 * - `twoTier`     : 2段グリーン。カップ手前に段差が1本入る
 */
export type TerrainType = 'random' | 'singleSlope' | 'receiving' | 'saddle' | 'twoTier';

export interface CoursePoint {
  x: number;
  z: number;
}

export interface CourseBounds {
  /** X方向の幅 [m] */
  width: number;
  /** Z方向の長さ [m] */
  length: number;
}

/**
 * 輪郭の歪ませ方。楕円の半径1を、角度ごとに調和成分で膨らませる量を決める。
 *
 * **省略すると config の既定値を使う。** v1のコースは指定しないので形は変わらない。
 * 波数を 2〜3 に絞って `amplitude` を大きくすると、膨らみが2つできて
 * ひょうたん・まゆのような輪郭になる。既定（波数2〜5・小さめの振幅）は丸に近い。
 */
export interface HazardOutline {
  /** 半径を歪める割合。0.45 なら半径が ±45% */
  amplitude: number;
  /** 歪ませる調和成分の波数の範囲 */
  orderMin: number;
  orderMax: number;
}

export interface EllipseHazard {
  type: 'water';
  center: CoursePoint;
  radiusX: number;
  radiusZ: number;
  /** 輪郭の歪ませ方。**省略時は config の既定値**（v1のコースは省略する） */
  outline?: HazardOutline;
}

/**
 * 高さのハザード（生成器v2）。ハイトマップへ足す局所的な盛り上がり／尾根／窪み。
 * **新しいサーフェスも罰打も持たない。** ハイトマップが表示と物理の唯一の情報源なので、
 * ここを足すだけで見た目と転がりの両方が同時に変わる。
 *
 * 形は「長軸 `radiusU` ・短軸 `radiusV` の楕円の中だけで盛り上がる山」。
 * 縁で高さも傾きも 0 になるので、周りの地形と段差なく繋がる。
 * `kind` は見出しで、実際の形は `height` の符号（＋が山・−が窪み）と軸比が決める。
 */
export interface HeightFeature {
  kind: 'mound' | 'ridge' | 'hollow';
  center: CoursePoint;
  /** 頂点（窪地なら底）の高さ [m]。負なら窪み */
  height: number;
  /** 長軸方向の広がり [m]。ここより外は完全に 0 */
  radiusU: number;
  /** 短軸方向の広がり [m] */
  radiusV: number;
  /** 長軸の向き [rad]。+Z を 0 とし、+X へ回る向きを正とする */
  angle: number;
}

/**
 * バンカー（生成器v2）。楕円の砂地で、輪郭は池と同じ作りで歪ませる。
 *
 * **罰打なし。縁を立てない（平らな砂だけ）。** 壁を作ると出られなくなる（詰み）ので、
 * ハイトマップには一切手を入れず、サーフェスだけを砂に変える。
 * 高さの濃淡は掛ける（池・OBと違い、砂の上でも地形を読ませたいため）。
 */
export interface SandBunker {
  center: CoursePoint;
  radiusX: number;
  radiusZ: number;
  /** 輪郭の歪ませ方。省略時は config の既定値 */
  outline?: HazardOutline;
  /**
   * 砂の中心がいちばん低くなる深さ [m]（正の値）。
   *
   * **窪みの縁は砂の輪郭そのもの。** 楕円を内接させるのではなく、
   * 「輪郭までの正規化距離」で窪ませるので、歪んだ形でも砂の面全体が皿になる。
   * 縁でちょうど 0 に戻るので、外の芝には斜面が出ない
   */
  depth: number;
}

/**
 * 砲台グリーン（生成器v2の実験）。**カップの周りを一段持ち上げる。**
 *
 * 上面（`innerRadius` の中）は平らなまま通常芝にして、読みは今までどおりにする。
 * `innerRadius` から `outerRadius` までの法面だけを**ラフにする**のが要点で、
 * 通常芝は勾配7.8%を超えると止まらないのに対し、ラフは27.4%まで止まれる。
 * だから法面をラフにすると、**高低差30〜50cmの本物の砲台**が作れる
 * （実際のゴルフの砲台グリーンも法面はラフ）。
 *
 * 効果は「弱いと法面で失速して戻る・強いと越えて奥の法面を転げ落ちる」＝距離の精度。
 * このゲームにいちばん足りていなかった「オーバーの罰」がこれで出る。
 */
export interface GreenPlateau {
  center: CoursePoint;
  /** 上面（平ら・通常芝）の半径 [m] */
  innerRadius: number;
  /** 法面（ラフ・急）の幅 [m]。横と奥はこの幅で落ちる */
  shoulder: number;
  /** 花道（通常芝・緩い坂）の長さ [m]。`shoulder` より長い */
  laneRun: number;
  /** 花道の向き [rad]。**カップから見て花道のある側**（+Z を 0） */
  laneBearing: number;
  /** 花道の角度の半幅 [rad]。この中は通常芝のまま */
  laneHalfAngle: number;
  /** 法面へ戻し終える角度 [rad]。半幅との差が緩衝帯（ラフ） */
  laneFadeAngle: number;
  /** 持ち上げる高さ [m] */
  rise: number;
}

/**
 * 生成器・検証器・ゲーム本体が共有するコース定義。
 * route はプレイ可能な芝の中心線で、各線分の周囲を greenWidth の芝にする。
 * その外へ roughFringe（ラフ）、deepRoughFringe（セカンドカット）の順に帯を足し、
 * さらに外側とコース枠の外だけをOBにする。
 */
export interface CourseDefinition {
  id: string;
  name: string;
  par: number;
  seed: number;
  bounds: CourseBounds;
  tee: CoursePoint;
  cup: CoursePoint;
  route: readonly CoursePoint[];
  greenWidth: number;
  /** 芝の縁から外へ伸ばすラフの幅 [m] */
  roughFringe: number;
  /** ラフの外へさらに伸ばすセカンドカットの幅 [m]。ここまではOBにしない */
  deepRoughFringe: number;
  /** 池の縁の外側をラフにする幅 [m]。芝の中の池でも岸はラフになる */
  waterFringe: number;
  hazards: readonly EllipseHazard[];
  /** 地形の性格。高さの作り方だけを決め、サーフェス分類には影響しない */
  terrain: TerrainType;
  /**
   * 高さのハザード。**生成器v2だけが入れる任意項目。**
   * 省略（v1のコース）なら地形はこれまでと1mmも変わらない
   */
  heightFeatures?: readonly HeightFeature[];
  /**
   * バンカー。**生成器v2だけが入れる任意項目。**
   * 省略（v1のコース）なら `surfaceAt` はこれまでと同じ答えを返す
   */
  bunkers?: readonly SandBunker[];
  /**
   * ルートに沿った芝幅の倍率。**等間隔に並べた点の値**で、間は線形に繋ぐ。
   * 先頭がティー側、末尾がカップ側。
   *
   * 1.0 だけの配列（または省略）なら今までと同じ一定幅。
   * 途中を小さくすれば「くびれ」、カップ手前だけ小さくすれば「花道」になる。
   * **ラフとセカンドカットの幅には掛けない**（掛けるとOBまでの距離も一緒に縮んで、
   * くびれが「狭い」ではなく「OBが迫る」になってしまう）
   */
  widthProfile?: readonly number[];
  /** 砲台グリーン。**生成器v2だけが入れる任意項目** */
  plateau?: GreenPlateau;
}
