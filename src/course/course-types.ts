export type SurfaceType = 'green' | 'rough' | 'water' | 'ob';

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
  roughFringe: number;
  hazards: readonly EllipseHazard[];
}
