// ホールの規則（`docs/spec.md` §3・§6）。**画面から切り離した、状態を持たない判定だけ。**
//
// ここを作った理由は1つ。**ゲーム本体と、後で入れるリプレイ検証が同じ規則を見るため**
// （`docs/ranking.md` §4-6）。検証側へ規則を書き写すと、片方だけ直したときに
// 「本人の画面では42打・サーバでは43打」のような食い違いが起き、
// しかもそれが**他人の順位を動かす**。
//
// three.js も DOM も知らない。入るのは転がりの結果（`RollStatus`）と打数だけ。

import { CONFIG } from './config';
import type { Roller, RollStatus } from './physics';
import type { CoursePoint } from './course/course-types';

const R = CONFIG.game.round;
const P = CONFIG.physics;
const V = CONFIG.game.ranking.verify;

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

// --- リプレイ（`docs/ranking.md` §4-1） ------------------------------------

/** 1打の打ち出し `[初速 m/s, 方向 rad]`。`src/round.ts` の `ShotRecord` と同じ形 */
export type ReplayShot = readonly [speed: number, direction: number];

export interface HoleReplay {
  /** 罰打を含めた打数 */
  strokes: number;
  holedOut: boolean;
  /**
   * 打ち切れなかったか。**判定できない**という意味で、嘘だという意味ではない。
   * 止まらない打ち出しが混じっていたときだけ立つ
   */
  aborted: boolean;
}

/**
 * ホール1本を打ち出しの列から再生する（`docs/ranking.md` §4）。
 *
 * **ゲーム本体と同じ規則を、同じ関数で通す。** 打つ位置は前の打の結果なので、
 * 送られてくるのは1打につき初速と方向の2つだけでよい。
 *
 * 罰打（池・OB）は1打足して**打つ前の位置へ戻す**。カップインしたらそこで終わり。
 * 転がりは固定タイムステップなので、**同じ入力なら必ず同じ結果**になる。
 */
export function replayHole(
  roller: Roller,
  tee: CoursePoint,
  shots: readonly ReplayShot[],
): HoleReplay {
  let x = tee.x;
  let z = tee.z;
  let strokes = 0;

  for (const [speed, direction] of shots) {
    const fromX = x;
    const fromZ = z;
    roller.launch(x, z, speed, direction);

    let steps = 0;
    while (roller.advance(P.timeStep) === 'rolling') {
      if (++steps > V.maxStepsPerShot) return { strokes, holedOut: false, aborted: true };
    }

    strokes += 1 + penaltyStrokes(roller.status);
    if (isHoledOut(roller.status)) return { strokes, holedOut: true, aborted: false };

    // 池・OBは打つ前の位置から。それ以外は止まったところから
    x = returnsToShotStart(roller.status) ? fromX : roller.x;
    z = returnsToShotStart(roller.status) ? fromZ : roller.z;
  }

  // 打ち出しを全部使ってもカップに入らなかった。ギブアップならこれで正しい
  return { strokes, holedOut: false, aborted: false };
}
