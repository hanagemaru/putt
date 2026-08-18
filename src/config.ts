// チューニング可能な数値は全てここに置く。他のファイルにマジックナンバーを書かない。
// 単位はメートル・秒。角度は内部ではラジアン。

export const CONFIG = {
  green: {
    /** グリーンの一辺 [m] */
    size: 20,
    /** 表示メッシュの分割数 */
    segments: 128,
    color: 0x4a8b3a,
  },

  camera: {
    fov: 70,
    near: 0.05,
    far: 200,
    /** 視点の高さ [m] */
    eyeHeight: 1.6,
    /** 原点からの距離 [m] */
    distance: 6,
  },

  light: {
    directionalIntensity: 1.0,
    ambientIntensity: 0.5,
    /** 光源の方向（正規化前）。低い角度から当てて陰影で形を出す */
    directionalDirection: { x: 1, y: 0.6, z: 0.5 },
  },

  renderer: {
    background: 0x87b7e0,
    /** 端末の devicePixelRatio の上限。上げすぎると重い */
    maxPixelRatio: 2,
  },

  /** /swipe-test/ のスワイプ速度計測ページ専用。ゲーム本体では使わない */
  swipeTest: {
    /** ボールを模した円の半径 [px] */
    ballRadius: 28,
    /** インパクト判定に必要な最小バックスイング幅 [px]。これ未満なら無効 */
    minBackswingPx: 40,
    /** 最小二乗フィットに使う、インパクト直前の時間窓 [ms] */
    fitWindowMs: 40,
    /** フィットに必要な最小サンプル数。窓内がこれ未満なら窓を広げる */
    fitMinSamples: 3,
    /** サンプルのリングバッファ長 */
    bufferSize: 512,
    /** 履歴として保持・集計する計測回数 */
    historySize: 10,
    /** 軌跡として描画する直近の時間 [ms] */
    trailMs: 600,
  },
} as const;
