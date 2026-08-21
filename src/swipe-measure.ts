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
  /** フィットに使ったサンプル数 */
  fitSamples: number;
  /** フィットに実際に使った時間窓 [ms] */
  fitWindowMs: number;
  /** 窓内サンプルから求めた実効サンプリングレート [Hz] */
  sampleRateHz: number;
};

/** 失敗理由。null なら成功 */
export type Failure = 'no-backswing' | 'too-few-samples';

type Phase = 'idle' | 'backswing' | 'downswing';

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
  private maxX = 0;
  /** 未アームのままボールの X を左へ横切ったか。指を離したときの通知に使う */
  private crossedUnarmed = false;
  /** 直前サンプル。インパクトの交差判定に使う */
  private prev: Sample | null = null;

  /** ボールの X 座標（インパクトライン）を設定して計測を開始する */
  begin(ballX: number, first: Sample): void {
    this.buf = [];
    this.head = 0;
    this.count = 0;
    this.phase = 'backswing';
    this.ballX = ballX;
    this.startX = first.x;
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

    // 交差点を線形補間してインパクト時刻を求める
    const dx = prev.x - s.x;
    const frac = dx > 0 ? (prev.x - this.ballX) / dx : 0;
    const tImpact = prev.t + frac * (s.t - prev.t);

    return this.fit(tImpact, backswingPx);
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

  /** 描画用。ダウンスイングが解禁されているか */
  armed(): boolean {
    return this.phase === 'downswing';
  }

  /** 描画用。ゲート線の X 座標（指を置いた点 + 必要な引き幅） */
  gateX(): number {
    return this.startX + C.minBackswingPx;
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

  /**
   * インパクト直前 fitWindowMs のサンプルに最小二乗直線をあてて速度を出す。
   * 2点差分はノイズが多すぎるので使わない。
   * 窓内のサンプルが足りない端末（60Hz など）では、必要数に届くまで窓を広げる。
   */
  private fit(tImpact: number, backswingPx: number): Measurement | Failure {
    const all = this.samples().filter((s) => s.t <= tImpact);
    if (all.length < 2) return 'too-few-samples';

    let window = all.filter((s) => tImpact - s.t <= C.fitWindowMs);
    if (window.length < C.fitMinSamples) {
      // 窓を広げる＝直近から必要数だけ取る
      window = all.slice(-Math.max(C.fitMinSamples, 2));
    }
    if (window.length < 2) return 'too-few-samples';

    const n = window.length;
    const span = window[n - 1].t - window[0].t;
    if (span <= 0) return 'too-few-samples';

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
    if (stt <= 0) return 'too-few-samples';

    const vx = stx / stt;
    const vy = sty / stt;

    return {
      t: tImpact,
      vx,
      vy,
      speed: Math.hypot(vx, vy),
      // インパクトは左向き。真左を 0 とし、画面下向きを正としたズレ角
      angle: Math.atan2(vy, -vx),
      backswingPx,
      fitSamples: n,
      fitWindowMs: span,
      sampleRateHz: ((n - 1) / span) * 1000,
    };
  }
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
