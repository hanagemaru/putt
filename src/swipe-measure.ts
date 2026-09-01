// スワイプ速度計測のコア。描画にも DOM にも依存しない純粋なロジック。
// 単位: 座標 px、時刻 ms、速度 px/s。
import { CONFIG } from './config';

const C = CONFIG.swipeTest;

export type Sample = {
  /** CSS ピクセル座標 */
  x: number;
  y: number;
  /** event.timeStamp [ms] */
  t: number;
};

/** 最小二乗フィットで得た速度と、その素性 */
export type Velocity = {
  vx: number;
  vy: number;
  /** フィットに使ったサンプル数 */
  samples: number;
  /** フィットに実際に使った時間窓 [ms] */
  windowMs: number;
};

export type Measurement = {
  /** インパクト時刻 [ms] */
  t: number;
  /** 最小二乗フィットで得た速度 [px/s] */
  vx: number;
  vy: number;
  /** 速度の大きさ [px/s] */
  speed: number;
  /** 真左（インパクト方向）からのズレ角 [rad]。画面下向きが正 */
  angle: number;
  /** バックスイング幅（指を置いた点から右への最大変位）[px] */
  backswingPx: number;
  /** 芯からのズレ [px]。＝ ボールのY − パター中心のY（§4.5） */
  offsetPx: number;
  /** ミスヒット減衰の係数。芯なら 1 */
  gain: number;
  /** 減衰込みのボール初速 [m/s]（§4.6） */
  speedMs: number;
  /** 打ち出し方向 [rad]。真左が 0、画面下向きが正。角度を感度で鈍らせたもの（§4.6） */
  launchAngle: number;
  /** フィットに使ったサンプル数 */
  fitSamples: number;
  /** フィットに実際に使った時間窓 [ms] */
  fitWindowMs: number;
  /** 窓内サンプルから求めた実効サンプリングレート [Hz] */
  sampleRateHz: number;
};

/** 失敗理由。null なら成功 */
export type Failure = 'no-backswing' | 'too-few-samples' | 'whiff';

type Phase = 'idle' | 'backswing' | 'downswing';

/**
 * 芯からのズレによる初速の減衰（§4.5）。フェース端を超えたら空振りで null。
 * 勢いだけを落とし、方向は変えない。
 */
export function mishitGain(offsetPx: number): number | null {
  const d = Math.abs(offsetPx);
  const edge = C.putterLength / 2;
  if (d > edge) return null;
  if (d <= C.sweetSpotPx) return 1;
  const k = (d - C.sweetSpotPx) / (edge - C.sweetSpotPx);
  return 1 + k * (C.mishitMinGain - 1);
}

/**
 * 右へのバックスイング → 反転して左へ → ボールの X 座標を横切った瞬間をインパクト、
 * とみなしてインパクト直前の速度を最小二乗フィットで求める。
 *
 * バックスイング幅は「指を置いた点から右へ実際に動かした量」で測る。ボール中心からの
 * 距離ではない。後者だとボールより右に指を置いただけで幅が計上され、右に引かずに
 * 左へ払うだけで打ててしまう。
 */
export class SwipeMeasure {
  /** リングバッファ */
  private buf: Sample[] = [];
  private head = 0;
  private count = 0;

  private phase: Phase = 'idle';
  private ballX = 0;
  /** 指を置いた X。バックスイング幅の原点 */
  private startX = 0;
  /** 指を置いた Y。パターヘッドの上下と芯のズレの原点（§4.4） */
  private startY = 0;
  private maxX = 0;
  /** 未アームのままボールの X を左へ横切ったか。指を離したときの通知に使う */
  private crossedUnarmed = false;
  /** 直前サンプル。インパクトの交差判定に使う */
  private prev: Sample | null = null;
  /** 直近のインパクトでの芯からのズレ [px]。空振りの表示に使う */
  private offsetPx = 0;

  /** ボールの X 座標（インパクトライン）を設定して計測を開始する */
  begin(ballX: number, first: Sample): void {
    this.buf = [];
    this.head = 0;
    this.count = 0;
    this.phase = 'backswing';
    this.ballX = ballX;
    this.startX = first.x;
    this.startY = first.y;
    this.maxX = first.x;
    this.crossedUnarmed = false;
    this.prev = null;
    this.push(first);
    this.prev = first;
  }

  /** pointerdown 以降を追う。インパクトを検出したフレームでのみ結果を返す */
  add(s: Sample): Measurement | Failure | null {
    if (this.phase === 'idle') return null;
    this.push(s);

    const prev = this.prev;
    this.prev = s;
    if (!prev) return null;

    if (s.x > this.maxX) this.maxX = s.x;

    const backswingPx = this.maxX - this.startX;

    // 十分に右へ引けたらダウンスイングを解禁する（アーム）
    if (this.phase === 'backswing' && backswingPx >= C.minBackswingPx) {
      this.phase = 'downswing';
    }

    // ボールの X 座標を右から左へ横切った瞬間がインパクト
    const crossed = prev.x >= this.ballX && s.x < this.ballX;
    if (!crossed) return null;

    // 未アームなら打たない。ストロークは終わらせず、引き直してから振れば成立する
    if (this.phase !== 'downswing') {
      this.crossedUnarmed = true;
      return null;
    }

    this.phase = 'idle';

    // 交差点を線形補間してインパクト時刻を求める。指の Y も同じ比で補間する
    const dx = prev.x - s.x;
    const frac = dx > 0 ? (prev.x - this.ballX) / dx : 0;
    const tImpact = prev.t + frac * (s.t - prev.t);
    const yImpact = prev.y + frac * (s.y - prev.y);

    // パター中心の Y は ボールのY +（指のY変位）なので、ズレはその符号反転（§4.5）
    this.offsetPx = -(yImpact - this.startY);
    const gain = mishitGain(this.offsetPx);
    if (gain === null) return 'whiff';

    return this.impact(tImpact, backswingPx, gain);
  }

  /**
   * 指を離したときに呼ぶ。バックスイングせずに振ろうとしていた場合だけ理由を返す。
   * ただのタップや、引きかけて止めただけの場合は null。
   */
  end(): Failure | null {
    const failed = this.phase !== 'idle' && this.crossedUnarmed;
    this.cancel();
    return failed ? 'no-backswing' : null;
  }

  cancel(): void {
    this.phase = 'idle';
    this.crossedUnarmed = false;
    this.prev = null;
  }

  /**
   * 計測を止めたうえでサンプルも捨てる。描画側は samples() を毎フレーム描くので、
   * 残しておくと次に画面へ入ったときに前の一打の軌跡がそのまま出る。
   * 直前のスイングを見せたい /swipe-test/ は cancel() のままにする
   */
  reset(): void {
    this.cancel();
    this.buf = [];
    this.head = 0;
    this.count = 0;
  }

  /** 描画用。ダウンスイングが解禁されているか */
  armed(): boolean {
    return this.phase === 'downswing';
  }

  /** 描画用。ゲート線の X 座標（指を置いた点 + 必要な引き幅） */
  gateX(): number {
    return this.startX + C.minBackswingPx;
  }

  /** 描画用。パターヘッドの中心 Y（ボールのY + 指のY変位）（§4.4） */
  putterY(ballY: number, current: Sample): number {
    return ballY + (current.y - this.startY);
  }

  /** 直近のインパクトでの芯からのズレ [px]。空振りの表示に使う */
  lastOffsetPx(): number {
    return this.offsetPx;
  }

  /**
   * 描画用。最新サンプルまでのスイング速度。フェースの向き（軌跡の垂線）に使う。
   * サンプルが足りない・止まっているときは null。
   */
  liveVelocity(): Velocity | null {
    const all = this.samples();
    if (all.length < 2) return null;
    return this.fitVelocity(all, all[all.length - 1].t);
  }

  /** 描画用。古い順のサンプル列 */
  samples(): Sample[] {
    const out: Sample[] = [];
    for (let i = 0; i < this.count; i++) {
      out.push(this.buf[(this.head - this.count + i + this.buf.length) % this.buf.length]);
    }
    return out;
  }

  private push(s: Sample): void {
    if (this.buf.length < C.bufferSize) {
      this.buf.push(s);
    } else {
      this.buf[this.head] = s;
    }
    this.head = (this.head + 1) % C.bufferSize;
    if (this.count < C.bufferSize) this.count++;
  }

  /** インパクト時の速度をフィットして計測結果を組み立てる */
  private impact(tImpact: number, backswingPx: number, gain: number): Measurement | Failure {
    const all = this.samples().filter((s) => s.t <= tImpact);
    const v = this.fitVelocity(all, tImpact);
    if (v === null) return 'too-few-samples';

    // インパクトは左向き。真左を 0 とし、画面下向きを正としたズレ角
    const angle = Math.atan2(v.vy, -v.vx);

    return {
      t: tImpact,
      vx: v.vx,
      vy: v.vy,
      speed: Math.hypot(v.vx, v.vy),
      angle,
      backswingPx,
      offsetPx: this.offsetPx,
      gain,
      speedMs: Math.abs(v.vx) * C.speedK * gain,
      launchAngle: angle * C.directionSensitivity,
      fitSamples: v.samples,
      fitWindowMs: v.windowMs,
      sampleRateHz: ((v.samples - 1) / v.windowMs) * 1000,
    };
  }

  /**
   * tEnd 直前 fitWindowMs のサンプルに最小二乗直線をあてて速度を出す。
   * 2点差分はノイズが多すぎるので使わない。
   * 窓内のサンプルが足りない端末（60Hz など）では、必要数に届くまで窓を広げる。
   */
  private fitVelocity(all: Sample[], tEnd: number): Velocity | null {
    if (all.length < 2) return null;

    let window = all.filter((s) => tEnd - s.t <= C.fitWindowMs);
    if (window.length < C.fitMinSamples) {
      // 窓を広げる＝直近から必要数だけ取る
      window = all.slice(-Math.max(C.fitMinSamples, 2));
    }
    if (window.length < 2) return null;

    const n = window.length;
    const span = window[n - 1].t - window[0].t;
    if (span <= 0) return null;

    // 時刻を秒に直し、平均を引いて数値的に安定させる
    let mt = 0;
    for (const s of window) mt += s.t;
    mt /= n;

    let stt = 0;
    let stx = 0;
    let sty = 0;
    let mx = 0;
    let my = 0;
    for (const s of window) {
      mx += s.x;
      my += s.y;
    }
    mx /= n;
    my /= n;
    for (const s of window) {
      const dt = (s.t - mt) / 1000;
      stt += dt * dt;
      stx += dt * (s.x - mx);
      sty += dt * (s.y - my);
    }
    if (stt <= 0) return null;

    return { vx: stx / stt, vy: sty / stt, samples: n, windowMs: span };
  }
}

/** [-π, π) に畳む */
export function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * スイング速度からフェースの向きを決める（§4.4）。
 * 真左（狙い方向）を基準に、右向きの動きは鏡映して反転を防ぎ、傾きは faceMaxAngleDeg で頭打ちにする。
 * 止まっている間は直前の向きを保つ。
 */
export function faceAngleFrom(vx: number, vy: number, current: number): number {
  if (Math.hypot(vx, vy) < C.faceMinSpeedPx) return current;
  let d = wrapPi(Math.atan2(vy, vx) - Math.PI);
  if (Math.abs(d) > Math.PI / 2) d = wrapPi(d + Math.PI);
  const max = (C.faceMaxAngleDeg * Math.PI) / 180;
  return Math.PI + Math.max(-max, Math.min(max, d));
}

/** 標本標準偏差（n-1）。1個以下なら 0 */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
