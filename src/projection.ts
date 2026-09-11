// 3D の大きさを画面の px へ直す小さな計算。
// three を読み込まないメニュー（entry.ts）からも使うので、独立した場所に置く。
// ここを2箇所に写すと、ゲーム本体と見本でボールの大きさが食い違う。

// 試聴ブランチでは、entry.ts が必ず読むこの小さい共通モジュールから音フックを一度だけ初期化する。
import './audio-bootstrap';

/**
 * 半径 radius [m] の球が distance [m] 先にあるときの画面上の半径 [px]。
 * ストローク画面のインパクトラインを実寸に合わせるために使う（§4.2）。
 * 3D で描いているボールと同じ大きさになるので、px の定数を別に持たない
 */
export function projectedRadiusPx(
  radius: number,
  distance: number,
  fovDeg: number,
  viewportHeightPx: number,
): number {
  const half = Math.tan(((fovDeg * Math.PI) / 180) / 2) * distance;
  return (radius / half) * (viewportHeightPx / 2);
}
