// コースごとの雰囲気（`docs/PLAYTEST_BACKLOG.md` §12）。**見た目だけを持つ。**
// 物理・生成器・シード・自己ベスト・ランキングには一切関わらない。
//
// 数値は `CONFIG.themes` に置き、ここは「型」と「省略時に既定へ落とす」ことだけを受け持つ。
// 既定は `renderer.background` / `light` / `green.surfaceColors` / `surround` / `trees` を
// そのまま読む（既定値を二重に持たないため）。
import { CONFIG } from './config';
import type { SurfaceType } from './course/course-types';

/** 樹種。形の作り方が違うのはこの3つだけ（比は `TreeTheme.kinds`） */
export type TreeKind = 'broadleaf' | 'conifer' | 'shrub';

/** 木のうち、コースごとに変える分だけ。形の比と揺らぎの幅は `CONFIG.trees` に置いたまま */
export interface TreeTheme {
  count: number;
  heightMin: number;
  heightMax: number;
  trunkColor: number;
  leafColor: number;
  /** 樹種の混ざり方（重み）。0 の樹種は出ない */
  kinds: Readonly<Record<TreeKind, number>>;
}

export interface CourseTheme {
  /** 空（`scene.background`） */
  sky: number;
  /**
   * 光。**向きは変えない**（斜面の陰影が強まると「明るい＝高い」の読みと競合する）。
   * 色を付けるのは環境光だけ。全頂点へ同じ倍率で掛かるので明暗の比は変わらない
   */
  light: {
    directionalIntensity: number;
    ambientIntensity: number;
    ambientColor: number;
  };
  /** サーフェス別の基準色。芝3種は明るさを保ち、色相と彩度だけ振る */
  surfaces: Readonly<Record<SurfaceType, number>>;
  /** グリーンの外に敷く地面 */
  surround: number;
  trees: TreeTheme;
}

/** テーマのID。ツアーのIDと同じにしてある（`?theme=expert` で見比べられる） */
export type ThemeId = keyof typeof CONFIG.themes;

/**
 * 省略時のテーマ。**練習モード・週替わりチャレンジ・検証ページはこれ。**
 * 中身は既存の設定そのままなので、テーマを指定しない画面の見た目は
 * 木の形を除いて従来と同じになる
 */
export const DEFAULT_THEME: CourseTheme = {
  sky: CONFIG.renderer.background,
  light: {
    directionalIntensity: CONFIG.light.directionalIntensity,
    ambientIntensity: CONFIG.light.ambientIntensity,
    ambientColor: 0xffffff,
  },
  surfaces: CONFIG.green.surfaceColors,
  surround: CONFIG.surround.color,
  trees: {
    count: CONFIG.trees.count,
    heightMin: CONFIG.trees.heightMin,
    heightMax: CONFIG.trees.heightMax,
    trunkColor: CONFIG.trees.trunkColor,
    leafColor: CONFIG.trees.leafColor,
    kinds: CONFIG.trees.kinds,
  },
};

/** `CONFIG` から読んだテーマを書き換えられるようにする（調整パネル用） */
type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K];
};

/** 調整パネルで書き換えるテーマ。`CourseTheme` として読む側はそのまま使える */
export type TunableTheme = Mutable<CourseTheme>;

/**
 * テーマを書き換え可能な形へ複製する。
 * **`CONFIG` を直接書き換えない**ため（パネルで触っても元の定義は残る）
 */
export function cloneTheme(theme: CourseTheme): TunableTheme {
  return {
    sky: theme.sky,
    light: { ...theme.light },
    surfaces: { ...theme.surfaces },
    surround: theme.surround,
    trees: { ...theme.trees, kinds: { ...theme.trees.kinds } },
  };
}

function isThemeId(id: string): id is ThemeId {
  return Object.prototype.hasOwnProperty.call(CONFIG.themes, id);
}

/** 不明なID・未指定は既定へ落とす。URLから来る値をそのまま渡してよい */
export function themeById(id: string | null | undefined): CourseTheme {
  if (id === null || id === undefined) return DEFAULT_THEME;
  return isThemeId(id) ? CONFIG.themes[id] : DEFAULT_THEME;
}

/** 調整パネルの「テーマ読み込み」に出す一覧。既定を先頭に置く */
export const THEME_CHOICES: readonly string[] = ['default', ...Object.keys(CONFIG.themes)];
