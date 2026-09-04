import type { CourseDefinition } from './course-types';

/**
 * コース基盤を実機検証するための手作りパー4。
 * ティーからカップへの直線は池とOBを横切り、左奥の曲がり角へ刻む安全ルートを持つ。
 * 芝を外してもすぐOBにならないよう、ラフとセカンドカットで合計3.6mの余地を取る。
 */
export const PROTOTYPE_COURSE: CourseDefinition = {
  id: 'prototype-dogleg-01',
  name: '試験ホール・池越えドッグレッグ',
  par: 4,
  seed: 20260830,
  terrain: 'receiving',
  bounds: { width: 16, length: 24 },
  tee: { x: -4, z: 8 },
  cup: { x: 4, z: -3 },
  route: [
    { x: -4, z: 8 },
    { x: -4, z: -3 },
    { x: 4, z: -3 },
  ],
  greenWidth: 4,
  roughFringe: 1.2,
  deepRoughFringe: 2.4,
  waterFringe: 1,
  hazards: [
    {
      type: 'water',
      center: { x: 0, z: 2.5 },
      radiusX: 2.2,
      radiusZ: 3,
    },
  ],
};
