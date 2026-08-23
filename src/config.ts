// チューニング可能な数値は全てここに置く。他のファイルにマジックナンバーを書かない。
// 単位はメートル・秒。角度は内部ではラジアン。

/** 単位の定義であってチューニング値ではない */
export const FEET_TO_METERS = 0.3048;

export const CONFIG = {
  green: {
    /** グリーンの一辺 [m] */
    size: 20,
    /** 表示メッシュの分割数 */
    segments: 128,
    color: 0x4a8b3a,
    /** 物理・描画の唯一の情報源であるハイトマップの解像度（正方 res×res） */
    heightmapResolution: 256,
    /** 手続き生成のシード。同じ値なら同じ地形になる */
    seed: 20250823,
    /** 全体傾斜 [%]。シードごとにこの範囲から選ぶ（実際のグリーン相当で 1〜3%） */
    tiltMinPercent: 1,
    tiltMaxPercent: 3,
    /** うねりの振幅 [m]。合成したガウシアンをこの振幅（±）へ正規化する */
    undulationAmplitude: 0.15,
    /** 合成するガウシアンの数 */
    gaussianCount: 7,
    /**
     * ガウシアンの広がり [m] の範囲。小さいほど局所的に急な斜面ができる。
     * 振幅は正規化されるので、ここが「どれだけ急な面ができるか」を決める。
     * 勾配が MU*7/(5g)（スティンプ 10ft で約 7.8%）を超える面がないと
     * 「下りで止まらない」が起きないので、下限は狭めに取ってある
     */
    gaussianSigmaMin: 0.7,
    gaussianSigmaMax: 3.5,
    /** ガウシアンの中心を置く範囲。グリーンの一辺に対する割合 */
    gaussianSpread: 0.9,
    /**
     * 頂点カラーの濃淡の強さ（§1 のアンジュレーション表現の主軸）。
     * 0 で単色、1 で最も低い点が真っ黒になる
     */
    shadeStrength: 0.55,
  },

  hole: {
    /** カップの直径 [m]（規定 108mm） */
    diameter: 0.108,
    /** カップの深さ [m] */
    depth: 0.1,
    /** カップの位置 [m]。XZ 平面 */
    position: { x: 0.6, z: -5.5 },
    /** 旗竿の高さ [m]。必ず鉛直に立てる（傾き表現の基準） */
    flagstickHeight: 1.5,
    flagstickRadius: 0.008,
    flagWidth: 0.32,
    flagHeight: 0.22,
    flagColor: 0xd94f3d,
    cupColor: 0x121a12,
  },

  ball: {
    /** ゴルフボールの半径 [m]（直径 42.7mm） */
    radius: 0.0213,
    color: 0xf6f8f4,
  },

  /** グリーンの外に敷く地面。グリーンが宙に浮いて見えないようにするだけ */
  surround: {
    size: 60,
    color: 0x2f5d2a,
    /** グリーンの最低点からどれだけ下げるか [m] */
    drop: 0.35,
  },

  /** 背景の木。傾きの基準になるので必ず鉛直に立てる */
  trees: {
    count: 14,
    /** グリーン中心からの距離 [m] の範囲 */
    radiusMin: 13,
    radiusMax: 18,
    heightMin: 3.5,
    heightMax: 6.5,
    trunkColor: 0x5b4632,
    leafColor: 0x2f6b32,
  },

  physics: {
    /** 固定タイムステップ [s]。決定論的に保つ（後でリプレイに使う） */
    timeStep: 1 / 240,
    /** 重力加速度 [m/s^2] */
    gravity: 9.81,
    /** 勾配による加速度の係数。転がる球なので 5/7 */
    slopeFactor: 5 / 7,
    /** スティンプ値 [ft]。摩擦 MU はここから逆算する */
    stimpFeet: 10,
    /**
     * スティンプメーターの解放速度 [m/s]。
     * 「この初速で stimpFeet だけ転がる」から MU = v^2 / (2 * 距離) を出す
     */
    stimpReleaseSpeed: 1.83,
    /** これを下回ったら停止判定に入る [m/s] */
    stopSpeed: 0.02,
    /** カップ中心からこの距離に入ったら判定 [m]（54mm） */
    cupCaptureRadius: 0.054,
    /** この速度未満ならカップイン。以上ならリップアウト [m/s] */
    cupCaptureSpeed: 1.4,
    /** リップアウト時に残る速度の割合 */
    lipOutDamping: 0.7,
    /** 1フレームで進めるシミュレーション時間の上限 [s]。タブ復帰時の暴走を防ぐ */
    maxStepPerFrame: 0.1,
    /** 軌跡を記録する間隔（物理ステップ数）。8 なら 30Hz */
    pathSampleSteps: 8,
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

  /** /green-test/ のグリーン・物理の確認ページ専用。ゲーム本体では使わない */
  greenTest: {
    /**
     * 俯瞰カメラ。20m 四方のグリーンは縦画面の横幅に透視投影では収まらないので、
     * グリーンにフィットさせた正射影で見る。確認用の固定カメラで、ゲーム本体には持ち込まない
     */
    /** 見下ろし角 [度]。90 で真上 */
    cameraPitchDeg: 62,
    /** カメラを置く距離 [m]。正射影なので見た目の大きさには効かない。near/far に収まればよい */
    cameraDistance: 40,
    /** 画面の横幅に収める範囲 [m]。グリーンの一辺より少し広く取って外周も見せる */
    viewWidth: 23,
    /** ボールの初期位置 [m] */
    ballStart: { x: -1.5, z: 5.5 },
    /** 初速の初期値 [m/s] */
    initialSpeed: 3.2,
    /** 方向の初期値 [度]。0 が -Z（画面奥）、+ が右回り */
    initialDirectionDeg: 0,
    /** 見やすさのためにボールを実寸より大きく描く倍率。20m を画面幅に収めるとかなり小さい */
    ballScale: 15,
    /** 軌跡の色 */
    trailColor: 0xffe66d,
    /** 軌跡をグリーン面から浮かせる高さ [m]。Z ファイティング防止 */
    trailLift: 0.02,
    /** 軌跡の頂点バッファ長。これを超えたぶんは描かない */
    trailMaxPoints: 4096,
    /** lil-gui のスライダーの範囲 */
    gui: {
      stimpMin: 6,
      stimpMax: 14,
      stimpStep: 0.5,
      seedMin: 0,
      seedMax: 99999,
      seedStep: 1,
      amplitudeMin: 0,
      amplitudeMax: 0.5,
      amplitudeStep: 0.01,
      shadeMin: 0,
      shadeMax: 1,
      shadeStep: 0.01,
      lightMin: 0,
      lightMax: 2,
      lightStep: 0.05,
    },
  },

  /** /swipe-test/ のスワイプ速度計測ページ専用。ゲーム本体では使わない */
  swipeTest: {
    /** ボールを模した円の半径 [px] */
    ballRadius: 28,
    /** インパクト判定に必要な最小バックスイング幅 [px]。指を置いた点から右へこれだけ引くまで打てない */
    minBackswingPx: 40,
    /** パターヘッドのフェース長 [px]（§4.4）。この半分を超えて外すと空振り */
    putterLength: 64,
    /** パターヘッドの厚み [px]。描画のみで判定には使わない */
    putterWidth: 10,
    /** 指を置く前にパターを置いておく位置。ボールの右への距離 [px]（§4.4） */
    putterRestOffsetPx: 36,
    /** 描画するフェース角の上限 [度]。狙い方向（真左）からこれを超えて傾けない。反転もさせない */
    faceMaxAngleDeg: 35,
    /** これ未満のスイング速度では向きを更新しない [px/s]。静止時のジッタ防止 */
    faceMinSpeedPx: 60,
    /** 芯とみなす範囲 [px]。ここまでは減衰なし（§4.5） */
    sweetSpotPx: 12,
    /** フェース端での減衰係数。芯からフェース端までこの値へ線形に落ちる */
    mishitMinGain: 0.55,
    /** スワイプ速度の X 成分 [px/s] → ボール初速 [m/s] の換算係数（§4.6） */
    speedK: 0.00133,
    /** 打ち出し方向の鈍らせ係数。0 なら常に真左（§4.6） */
    directionSensitivity: 0.4,
    // 以下は検証ページのボール演出（§4.7）。見た目だけの演出で、ゲーム本体の物理とは別物
    /**
     * 演出の画面スケール [px/m]。ボールに寄った近接視点なので、実際のパット程度の初速でも
     * ボールはすぐ画面外へ抜ける。0.3 m/s（ごく弱いタッチ）で画面外へ出る値に合わせてある。
     * 減速と一緒に動かすこと。両方を半分にすると転がる距離は変わらず、見え方だけ緩やかになる
     */
    ballPxPerMeter: 1400,
    /**
     * 転がりの減速 [m/s^2]。演出用に実際のグリーンより抵抗を小さくしている
     * （スティンプ換算で約 20ft 相当。spec §2 の MU＝10ft 相当 0.55 の半分）
     */
    ballDecelMs2: 0.275,
    /** 停止・画面外に出てから中央へ戻すまで [ms] */
    ballResetMs: 900,
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
