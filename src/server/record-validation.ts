// 登録された記録の検証（段1。`docs/ranking.md` §4-4）。
//
// **ここでやるのは「形」と「常識」だけ。** 打数が整数か、ホール数と合計が合っているか、
// ありえない初速が混じっていないか。**嘘のスコアそのものは通る**（それを弾くのは
// 段2のリプレイ検証で、Workerの外のバッチが後から判定する）。
//
// ここを通ったかどうかで順位が変わるので、**理由は必ず1つ返す**（弾いた側も調べられる）。
// 判定はサーバだけで完結させる。クライアントの言い分は一切信じない。

import { CONFIG } from '../config';
import {
  isBoardId,
  normalizeDisplayName,
  type SubmitRecordRequest,
  type SubmittedHole,
} from '../ranking-shared';

const R = CONFIG.game.ranking;
const S = R.server;
const P = CONFIG.game.putterTuning;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function fail(reason: string): ValidationResult {
  return { ok: false, reason };
}

function isCount(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** 1ホールぶんの形。**番号はホール1から順に詰まっていること** */
function validHole(value: unknown, index: number): value is SubmittedHole {
  if (!value || typeof value !== 'object') return false;
  const hole = value as Partial<SubmittedHole>;
  return (
    hole.number === index + 1 &&
    isCount(hole.seed, 0, Number.MAX_SAFE_INTEGER) &&
    // par 2 以下・7 以上のホールは生成器が作らない
    isCount(hole.par, 3, 6) &&
    isCount(hole.strokes, 1, S.maxHoleStrokes) &&
    typeof hole.holedOut === 'boolean'
  );
}

/**
 * 1打の打ち出し。**再生に要るのは初速と方向の2つだけ**（`docs/ranking.md` §4-1）。
 * 方向は狙いからの相対ではなく絶対角なので、1周ぶんを超える値は来ない
 */
function validShot(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [speed, direction] = value as [unknown, unknown];
  return (
    typeof speed === 'number' &&
    Number.isFinite(speed) &&
    speed >= 0 &&
    speed <= S.maxShotSpeed &&
    typeof direction === 'number' &&
    Number.isFinite(direction) &&
    Math.abs(direction) <= Math.PI * 2
  );
}

/**
 * 登録の中身を確かめる。**通ったものだけが板に載る。**
 *
 * 打ち出しの列（`shots`）は**空でもよい**。段5を入れる前のクライアントや、
 * 途中保存から再開したラウンドでは全ホールぶんが揃わない。
 * 揃っていないものは「検証できない」だけで、記録としては正しい
 */
export function validateSubmission(value: unknown): ValidationResult {
  if (!value || typeof value !== 'object') return fail('body is not an object');
  const body = value as Partial<SubmitRecordRequest>;

  if (
    typeof body.submissionId !== 'string' ||
    body.submissionId.length < 8 ||
    body.submissionId.length > 100
  ) {
    return fail('bad submissionId');
  }
  if (!isBoardId(body.boardId)) return fail('bad boardId');
  if (!normalizeDisplayName(body.displayName)) return fail('bad displayName');

  // **規則の版が違う記録は同じ板に混ぜない。** 物理や罰打が変われば比べられなくなる
  if (body.rulesVersion !== R.rulesVersion) return fail('rulesVersion mismatch');
  // 版の文字列は記録として残すだけ。古い版のまま開いている端末を弾かない
  if (typeof body.appVersion !== 'string' || body.appVersion.length > 40) {
    return fail('bad appVersion');
  }
  if (body.generator !== 'v1' && body.generator !== 'v2') return fail('bad generator');

  // 感度の個人調整。ゲーム側が 0.5〜1.5 に丸めているので、外れていれば触られている
  if (
    typeof body.putterPowerScale !== 'number' ||
    !Number.isFinite(body.putterPowerScale) ||
    body.putterPowerScale < P.minScale ||
    body.putterPowerScale > P.maxScale
  ) {
    return fail('bad putterPowerScale');
  }

  const holes = body.holes;
  if (!Array.isArray(holes) || holes.length < 1 || holes.length > S.maxHoles) {
    return fail('bad holes');
  }
  for (let i = 0; i < holes.length; i++) {
    if (!validHole(holes[i], i)) return fail(`bad hole ${i + 1}`);
  }

  if (!isCount(body.totalStrokes, holes.length, S.maxTotalStrokes)) return fail('bad totalStrokes');
  if (!isCount(body.totalPar, holes.length * 3, S.maxTotalStrokes)) return fail('bad totalPar');

  // **合計は自分で数え直す。** 送られてきた合計をそのまま信じない
  let strokes = 0;
  let par = 0;
  let gaveUp = false;
  for (const hole of holes as SubmittedHole[]) {
    strokes += hole.strokes;
    par += hole.par;
    if (!hole.holedOut) gaveUp = true;
  }
  if (strokes !== body.totalStrokes) return fail('totalStrokes does not match holes');
  if (par !== body.totalPar) return fail('totalPar does not match holes');
  if (body.gaveUp !== gaveUp) return fail('gaveUp does not match holes');

  const shots = body.shots;
  if (!Array.isArray(shots)) return fail('bad shots');
  if (shots.length > 0) {
    if (shots.length !== holes.length) return fail('shots length does not match holes');
    for (let i = 0; i < shots.length; i++) {
      const hole = shots[i];
      if (!Array.isArray(hole)) return fail(`bad shots ${i + 1}`);
      // 罰打のぶん打数のほうが多くなることはあっても、**打った数が打数を超えることはない**
      if (hole.length > (holes[i] as SubmittedHole).strokes) return fail(`too many shots ${i + 1}`);
      for (const shot of hole) {
        if (!validShot(shot)) return fail(`bad shot in hole ${i + 1}`);
      }
    }
  }

  return { ok: true };
}
