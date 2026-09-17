// ホールの規則（`docs/spec.md` §3・§6）。**画面から切り離した、状態を持たない判定だけ。**
//
// ここを作った理由は1つ。**ゲーム本体と、後で入れるリプレイ検証が同じ規則を見るため**
// （`docs/ranking.md` §4-6）。検証側へ規則を書き写すと、片方だけ直したときに
// 「本人の画面では42打・サーバでは43打」のような食い違いが起き、
// しかもそれが**他人の順位を動かす**。
//
// three.js も DOM も知らない。入るのは転がりの結果（`RollStatus`）と打数だけ。

import { CONFIG } from './config';
import type { RollStatus } from './physics';

const R = CONFIG.game.round;

/**
 * その一打に付く罰打（`docs/spec.md` §3）。
 * 池とOBが1打で、それ以外は0。**打数を増やすのはここだけ**
 */
export function penaltyStrokes(status: RollStatus): number {
  return status === 'water' || status === 'outOfBounds' ? 1 : 0;
}

/**
 * 次の一打を**打つ前の位置から**打ち直すか。
 * 池とOBがこれに当たる（罰打1つと引き換えに、入る前の場所へ戻す）
 */
export function returnsToShotStart(status: RollStatus): boolean {
  return penaltyStrokes(status) > 0;
}

/** ホールアウトしたか。**自然に終わる出口はカップインだけ**（もう一方はギブアップ） */
export function isHoledOut(status: RollStatus): boolean {
  return status === 'holed';
}

/**
 * ギブアップを出してよい打数か（`docs/spec.md` §3）。
 * ダブルパー（par × `giveUpParMultiple`）に達するまでは出さない。
 * **普通に遊んでいる人の目に触れさせない**ための線
 */
export function giveUpAvailable(strokes: number, par: number): boolean {
  return strokes >= par * R.giveUpParMultiple;
}
