/**
 * 地面種別。芝は通常芝 → ラフ → セカンドカットの順に重くなり、
 * その外側だけをOBにする。
 */
export type SurfaceType = 'green' | 'rough' | 'deepRough' | 'water' | 'ob';

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

export interface EllipseHazard {
  type: 'water';
  center: CoursePoint;
  radiusX: number;
  radiusZ: number;
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
 * 深いラフの島（生成器v2）。帯ではなく塊としてルートの中や脇に置く。
 * `surfaceAt` は島の内側で `deepRough` を返すだけなので、
 * **罰打も新しいサーフェスも要らず、芝の連結も切れない**（セカンドカットは打てる）。
 */
export interface RoughIsland {
  center: CoursePoint;
  radiusX: number;
  radiusZ: number;
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
   * 深いラフの島。**生成器v2だけが入れる任意項目。**
   * 省略（v1のコース）なら `surfaceAt` はこれまでと同じ答えを返す
   */
  roughIslands?: readonly RoughIsland[];
}
