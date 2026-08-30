import type { CourseDefinition } from './course-types';

/**
 * コース基盤を実機検証するための手作りパー3。
 * ティーからカップへの直線は池とOBを横切り、左奥の曲がり角へ刻む安全ルートを持つ。
 */
export const PROTOTYPE_COURSE: CourseDefinition = {
  id: 'prototype-dogleg-01',
  name: '試験ホール・池越えドッグレッグ',
  par: 3,
  seed: 20260830,
  bounds: { width: 16, length: 24 },
  tee: { x: -4, z: 8 },
  cup: { x: 4, z: -3 },
  route: [
    { x: -4, z: 8 },
    { x: -4, z: -3 },
    { x: 4, z: -3 },
  ],
  greenWidth: 4,
  roughFringe: 0.8,
  hazards: [
    {
      type: 'water',
      center: { x: 0, z: 2.5 },
      radiusX: 2.2,
      radiusZ: 3,
    },
  ],
};
