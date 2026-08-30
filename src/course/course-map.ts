import type { CourseDefinition, CoursePoint, SurfaceType } from './course-types';

function pointSegmentDistance(point: CoursePoint, a: CoursePoint, b: CoursePoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = Math.min(
    Math.max(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq, 0),
    1,
  );
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

function distanceToRoute(course: CourseDefinition, x: number, z: number): number {
  const point = { x, z };
  let distance = Infinity;
  for (let i = 1; i < course.route.length; i++) {
    distance = Math.min(distance, pointSegmentDistance(point, course.route[i - 1], course.route[i]));
  }
  return distance;
}

/**
 * 池の楕円を外へ margin だけ広げた内側か。
 * margin = 0 なら池そのもの、正の値なら岸を含む範囲になる。
 */
function isInsideWater(
  course: CourseDefinition,
  x: number,
  z: number,
  margin = 0,
): boolean {
  return course.hazards.some((hazard) => {
    const dx = (x - hazard.center.x) / (hazard.radiusX + margin);
    const dz = (z - hazard.center.z) / (hazard.radiusZ + margin);
    return dx * dx + dz * dz <= 1;
  });
}

/** 高レベルのコース定義を、任意座標の地面種別へ変換する。 */
export function surfaceAt(course: CourseDefinition, x: number, z: number): SurfaceType {
  const halfWidth = course.bounds.width / 2;
  const halfLength = course.bounds.length / 2;
  if (x < -halfWidth || x > halfWidth || z < -halfLength || z > halfLength) return 'ob';
  if (isInsideWater(course, x, z)) return 'water';
  // 岸は芝の途中でもラフにする。池際から直接打つ状況を作らない
  if (isInsideWater(course, x, z, course.waterFringe)) return 'rough';

  const distance = distanceToRoute(course, x, z);
  const greenEdge = course.greenWidth / 2;
  const roughEdge = greenEdge + course.roughFringe;
  const deepRoughEdge = roughEdge + course.deepRoughFringe;
  if (distance <= greenEdge) return 'green';
  if (distance <= roughEdge) return 'rough';
  if (distance <= deepRoughEdge) return 'deepRough';
  return 'ob';
}
