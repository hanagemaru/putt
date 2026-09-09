// パターヘッドの形状（spec §4.4）。**見た目だけの選択で、性能差は一切付けない。**
//
// フェース面の位置・フェース長（swipeTest.putterLength）・芯の範囲（sweetSpotPx）は
// 全形状で共通で、変えるのはフェースより後ろの輪郭と胴の色だけ。
// マレットは上から見た面積が増えるぶん「当てやすそう」に見えるので、
// 芯の印はどの形状でも同じ大きさ・同じ描き方にして錯覚を打ち消す。
//
// 描画は STROKE のオーバーレイ（stroke-view.ts）とメニューの見本（entry.ts）で共有する。
// 別々に描くと、選んだ形と実際に構える形が食い違う。
import { CONFIG } from './config';

const C = CONFIG.swipeTest;
const S = CONFIG.game.stroke;
const P = S.putterShape;

export type PutterShapeId = keyof typeof S.putterShapes;

/** config の形状データ。`rails` を持つのはファング型だけ */
interface ShapeGeometry {
  bodyDepth: number;
  rear: ReadonlyArray<{ depth: number; inset: number }>;
  rails: { depth: number; width: number } | null;
  sightDepth: number | null;
  body: string;
  bodyRest: string;
}

/**
 * 選択画面に出す順番と表示名。数値ではないので config には置かない。
 * 見本を見れば違いは分かるので、名前以外の説明は付けない
 */
export const PUTTER_SHAPES: ReadonlyArray<{ id: PutterShapeId; name: string }> = [
  { id: 'pin', name: 'ピン型' },
  { id: 'blade', name: 'L字' },
  { id: 'mallet', name: 'マレット' },
  { id: 'fang', name: 'ネオマレット' },
];

export function shapeGeometry(id: PutterShapeId): ShapeGeometry {
  return S.putterShapes[id] as ShapeGeometry;
}

/** 知らない値・保存されていない場合は既定の形状にする */
export function normalizeShapeId(value: string | null): PutterShapeId {
  if (value !== null && value in S.putterShapes) return value as PutterShapeId;
  return S.putterShapeDefault as PutterShapeId;
}

/** 選んだ形状を読む。localStorage が使えない端末でも既定で遊べる */
export function loadPutterShape(): PutterShapeId {
  try {
    return normalizeShapeId(window.localStorage.getItem(S.putterShapeStorageKey));
  } catch {
    return S.putterShapeDefault as PutterShapeId;
  }
}

/** 選んだ形状を保存する。保存できなくても選択は成立させる */
export function savePutterShape(id: PutterShapeId): void {
  try {
    window.localStorage.setItem(S.putterShapeStorageKey, id);
  } catch {
    // 保存できないだけなので無視する
  }
}

export interface PutterColors {
  /** フェース板と照準線の色。打てるかどうかの状態をここに出す */
  face: string;
  /** 芯のインサートの色 */
  spot: string;
  /** 待機中は胴の色を落とす */
  rest: boolean;
}

/**
 * パターヘッドを描く。呼ぶ側で translate / rotate を済ませておく。
 * ローカル座標は +X がボール側（フェース面）、-Y が手元（ヒール）側で、
 * フェース面は必ず +putterWidth/2 ＝ 当たり判定と同じ位置に来る。
 */
export function drawPutterHead(
  ctx: CanvasRenderingContext2D,
  id: PutterShapeId,
  colors: PutterColors,
): void {
  const shape = shapeGeometry(id);
  const front = C.putterWidth / 2;
  const half = C.putterLength / 2;
  const body = colors.rest ? shape.bodyRest : shape.body;

  ctx.fillStyle = body;

  // 胴。フェースのすぐ後ろ
  const bodyBack = front - shape.bodyDepth;
  ctx.fillRect(bodyBack, -half, shape.bodyDepth, C.putterLength);

  // 後ろの段。奥へ行くほど短くして、丸めずに階段で輪郭を作る
  let back = bodyBack;
  for (const step of shape.rear) {
    back -= step.depth;
    ctx.fillRect(back, -half + step.inset, step.depth, C.putterLength - step.inset * 2);
  }

  // 二股の羽根。間は空けたままにして、上から見た輪郭をコの字にする
  if (shape.rails) {
    const railBack = bodyBack - shape.rails.depth;
    ctx.fillRect(railBack, -half, shape.rails.depth, shape.rails.width);
    ctx.fillRect(railBack, half - shape.rails.width, shape.rails.depth, shape.rails.width);
    back = Math.min(back, railBack);
  }

  // ヒール側のホーゼルと、手元へ伸びるシャフト
  ctx.fillRect(-P.hoselSize / 2, -half - P.hoselSize, P.hoselSize, P.hoselSize);
  ctx.fillRect(
    -P.shaftWidth / 2,
    -half - P.hoselSize - P.shaftLength,
    P.shaftWidth,
    P.shaftLength,
  );

  // フェース板。状態の色はここに出す
  ctx.fillStyle = colors.face;
  ctx.fillRect(front - P.faceThickness, -half, P.faceThickness, C.putterLength);

  // 芯の範囲。フェース板の上にインサートとして置く。
  // 状態の色はトウ・ヒール側のフェースに残るので、打てるかどうかは変わらず読める
  ctx.fillStyle = colors.spot;
  ctx.fillRect(front - P.faceThickness, -C.sweetSpotPx, P.faceThickness, C.sweetSpotPx * 2);

  // 照準線。フェースと直角に引く。既定はヘッドの一番奥まで
  const sightDepth = shape.sightDepth ?? front - back;
  ctx.fillStyle = colors.face;
  ctx.fillRect(front - sightDepth, -P.sightLineWidth / 2, sightDepth, P.sightLineWidth);
}
