// 通常ツアーの固定9ホールセット（spec §6）。
//
// **正本はセット名とシードの配列**。ホールの中身はシードから `generateCourse` が決める。
// 3セットとも PAR3×2・PAR4×5・PAR5×2（合計PAR36）で、PAR4はすべて「むずかしい」。
// 各セットのPAR4に5種類の地形を1本ずつ入れ、単体でも地形を一巡できるようにした。

import type { Language } from '../i18n';

/** 表示名は言語別に持つ。**ID とシードは言語に依らない正本** */
export type LocalizedText = Readonly<Record<Language, string>>;

export interface TourDefinition {
  /** URL の ?tour= に使う、変更しない短いID */
  id: string;
  /** プレイヤーへ見せるテーマ名 */
  name: LocalizedText;
  /** 選出指標の方向。試遊後に名前と一緒に見直してよい */
  description: LocalizedText;
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
    name: { ja: '風の丘', en: 'Windy Hills' },
    description: {
      ja: '池と大きな曲がりが少ない、比較的素直なコース',
      en: 'Few ponds and gentle bends. The most straightforward course.',
    },
    seeds: [553, 848, 44, 468, 798, 354, 977, 232, 185],
  },
  {
    id: 'forest',
    name: { ja: '曲がりの森', en: 'Bending Woods' },
    description: {
      ja: 'ドッグレッグとS字、遠回り率の大きいホールを集めたコース',
      en: 'Dogleg and S-shaped holes that make you take the long way round.',
    },
    seeds: [307, 299, 343, 101, 407, 549, 245, 649, 583],
  },
  {
    id: 'waterside',
    name: { ja: '水鏡の庭', en: 'Mirror Water Garden' },
    description: {
      ja: '池の数と水面積比が大きいホールを集めたコース',
      en: 'Holes with the most water, and the largest share of it.',
    },
    seeds: [394, 121, 410, 235, 731, 954, 411, 421, 933],
  },
] as const satisfies readonly TourDefinition[];

export const DEFAULT_TOUR = TOUR_SETS[0];

/** 不明なIDや指定なしは、最初の「風の丘」へ戻す */
export function tourById(id: string | null): TourDefinition {
  return TOUR_SETS.find((tour) => tour.id === id) ?? DEFAULT_TOUR;
}
