// 通常ツアーの固定9ホールセット（spec §6）。
//
// **正本はセット名とシードの配列**。ホールの中身はシードから `generateCourse` が決める。
// 3セットとも PAR3×2・PAR4×5・PAR5×2（合計PAR36）で、PAR4はすべて「むずかしい」。
// 各セットのPAR4に5種類の地形を1本ずつ入れ、単体でも地形を一巡できるようにした。

export interface TourDefinition {
  /** URL の ?tour= に使う、変更しない短いID */
  id: string;
  /** プレイヤーへ見せるテーマ名 */
  name: string;
  /** 選出指標の方向。試遊後に名前と一緒に見直してよい */
  description: string;
  /** ホール1から順に並べた生成シード */
  seeds: readonly number[];
}

/**
 * 試遊用の3コース。短いPAR3で入り、9番を長いPAR5にする。
 * 面白さは機械判定できないため、ここで確定とはせず実機で違和感を確認する。
 */
export const TOUR_SETS = [
  {
    id: 'breeze',
    name: '風の丘',
    description: '池と大きな曲がりが少ない、比較的素直なコース',
    seeds: [553, 848, 44, 468, 798, 354, 977, 232, 185],
  },
  {
    id: 'forest',
    name: '曲がりの森',
    description: 'ドッグレッグとS字、遠回り率の大きいホールを集めたコース',
    seeds: [307, 299, 343, 101, 407, 549, 245, 649, 583],
  },
  {
    id: 'waterside',
    name: '水鏡の庭',
    description: '池の数と水面積比が大きいホールを集めたコース',
    seeds: [394, 121, 410, 235, 731, 954, 411, 421, 933],
  },
] as const satisfies readonly TourDefinition[];

export const DEFAULT_TOUR = TOUR_SETS[0];

/** 不明なIDや指定なしは、最初の「風の丘」へ戻す */
export function tourById(id: string | null): TourDefinition {
  return TOUR_SETS.find((tour) => tour.id === id) ?? DEFAULT_TOUR;
}
