// コース定義の検証器（spec §1）。
// 境界に揺らぎを入れると「見た目は自然だが遊べない形」も作れてしまうので、
// ティーからカップまで芝が繋がっているか、サーフェスの面積比が崩れていないかを機械的に確かめる。
//
// `surfaceAt` を格子状に呼ぶだけなので、ブラウザからも Node からも同じ結果になる。

import { CONFIG } from '../config';
import { surfaceAt } from './course-map';
import type { CourseDefinition, SurfaceType } from './course-types';

/** 芝として扱う（罰打なしで打てる）サーフェス */
const PLAYABLE: readonly SurfaceType[] = ['green', 'rough', 'deepRough'];

export interface CourseValidationOptions {
  /** 格子間隔 [m]。既定は `CONFIG.course.validationCellSize` */
  cellSize?: number;
}

export interface CourseValidationResult {
  ok: boolean;
  cellSize: number;
  /** サーフェス別の面積比。合計は 1 */
  areaRatio: Record<SurfaceType, number>;
  /** ティーからカップまで、芝（green / rough / deepRough）だけを辿って行けるか */
  connected: boolean;
  /** ティー・カップの周囲が通常芝に保たれているか */
  teeIsGreen: boolean;
  cupIsGreen: boolean;
  /** 芝だけを辿ったときのティー側連結成分の面積比 */
  reachableRatio: number;
  /** 人が読むための問題点。ok が false のとき必ず1つ以上入る */
  issues: string[];
}

function surfaceCode(surface: SurfaceType): number {
  return PLAYABLE.indexOf(surface) >= 0 ? 1 : 0;
}

/**
 * 格子を切ってサーフェスを数え、ティーからカップまでの連結を4近傍の幅優先探索で確かめる。
 */
export function validateCourse(
  course: CourseDefinition,
  options: CourseValidationOptions = {},
): CourseValidationResult {
  const cellSize = options.cellSize ?? CONFIG.course.validationCellSize;
  const halfWidth = course.bounds.width / 2;
  const halfLength = course.bounds.length / 2;
  const nx = Math.max(2, Math.round(course.bounds.width / cellSize) + 1);
  const nz = Math.max(2, Math.round(course.bounds.length / cellSize) + 1);
  const stepX = course.bounds.width / (nx - 1);
  const stepZ = course.bounds.length / (nz - 1);

  const playable = new Uint8Array(nx * nz);
  const counts: Record<SurfaceType, number> = {
    green: 0,
    rough: 0,
    deepRough: 0,
    water: 0,
    ob: 0,
  };
  for (let j = 0; j < nz; j++) {
    const z = -halfLength + j * stepZ;
    for (let i = 0; i < nx; i++) {
      const x = -halfWidth + i * stepX;
      const surface = surfaceAt(course, x, z);
      counts[surface]++;
      playable[j * nx + i] = surfaceCode(surface);
    }
  }

  const total = nx * nz;
  const areaRatio = {
    green: counts.green / total,
    rough: counts.rough / total,
    deepRough: counts.deepRough / total,
    water: counts.water / total,
    ob: counts.ob / total,
  };

  const toIndex = (p: { x: number; z: number }): number => {
    const i = Math.min(nx - 1, Math.max(0, Math.round((p.x + halfWidth) / stepX)));
    const j = Math.min(nz - 1, Math.max(0, Math.round((p.z + halfLength) / stepZ)));
    return j * nx + i;
  };
  const teeIndex = toIndex(course.tee);
  const cupIndex = toIndex(course.cup);

  // ティーのセルから芝だけを辿る幅優先探索
  const seen = new Uint8Array(nx * nz);
  let reachable = 0;
  let connected = false;
  if (playable[teeIndex]) {
    const queue = new Int32Array(nx * nz);
    let head = 0;
    let tail = 0;
    queue[tail++] = teeIndex;
    seen[teeIndex] = 1;
    const neighbors: number[] = [];
    while (head < tail) {
      const index = queue[head++];
      reachable++;
      if (index === cupIndex) connected = true;
      const i = index % nx;
      const j = (index - i) / nx;
      neighbors.length = 0;
      if (i > 0) neighbors.push(index - 1);
      if (i < nx - 1) neighbors.push(index + 1);
      if (j > 0) neighbors.push(index - nx);
      if (j < nz - 1) neighbors.push(index + nx);
      for (const next of neighbors) {
        if (seen[next] || !playable[next]) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  const teeIsGreen = surfaceAt(course, course.tee.x, course.tee.z) === 'green';
  const cupIsGreen = surfaceAt(course, course.cup.x, course.cup.z) === 'green';

  const issues: string[] = [];
  if (!teeIsGreen) issues.push('ティーが通常芝ではない');
  if (!cupIsGreen) issues.push('カップが通常芝ではない');
  if (!connected) issues.push('ティーからカップまで芝が繋がっていない');

  return {
    ok: issues.length === 0,
    cellSize,
    areaRatio,
    connected,
    teeIsGreen,
    cupIsGreen,
    reachableRatio: reachable / total,
    issues,
  };
}

/**
 * サーフェスを格子状に走査した内容のダイジェスト（FNV-1a）。
 * 同じシードで2回生成した結果が完全に一致するかを、一度に比べるために使う。
 */
export function courseSurfaceDigest(
  course: CourseDefinition,
  options: CourseValidationOptions = {},
): string {
  const cellSize = options.cellSize ?? CONFIG.course.validationCellSize;
  const halfWidth = course.bounds.width / 2;
  const halfLength = course.bounds.length / 2;
  const nx = Math.max(2, Math.round(course.bounds.width / cellSize) + 1);
  const nz = Math.max(2, Math.round(course.bounds.length / cellSize) + 1);
  const stepX = course.bounds.width / (nx - 1);
  const stepZ = course.bounds.length / (nz - 1);
  const order: readonly SurfaceType[] = ['green', 'rough', 'deepRough', 'water', 'ob'];

  let hash = 0x811c9dc5;
  for (let j = 0; j < nz; j++) {
    const z = -halfLength + j * stepZ;
    for (let i = 0; i < nx; i++) {
      const x = -halfWidth + i * stepX;
      hash = Math.imul(hash ^ order.indexOf(surfaceAt(course, x, z)), 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}
