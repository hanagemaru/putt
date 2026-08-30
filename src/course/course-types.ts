/**
 * 地面種別。芝は通常芝 → ラフ → セカンドカットの順に重くなり、
 * その外側だけをOBにする。
 */
export type SurfaceType = 'green' | 'rough' | 'deepRough' | 'water' | 'ob';

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
}
