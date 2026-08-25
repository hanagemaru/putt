// STROKE の 2D オーバーレイ（spec §4）。真下を見下ろす 3D の上に重ねて、
// ボール・パターヘッド・つま先・ゲート線だけを px 空間で描く。
//
// 計測そのものは /swipe-test/ で検証済みの SwipeMeasure をそのまま使う。
// px → m の換算を新しく作らないので、ゲーム本体でも検証ページと同じ手応えになる。
// （計測の定数は CONFIG.swipeTest。ページ専用の演出値ではなく所作の定数なので、ここでも使う。
//   ボールの転がりの演出 ballPxPerMeter / ballDecelMs2 だけは §4.7 の検証ページ限定で、持ち込まない）
import { CONFIG } from './config';
import {
  SwipeMeasure,
  faceAngleFrom,
  wrapPi,
  type Measurement,
  type Sample,
} from './swipe-measure';

const C = CONFIG.swipeTest;
const S = CONFIG.game.stroke;

export interface StrokeCallbacks {
  /** インパクトした。ここでゲームは FOLLOW へ移る */
  onImpact(m: Measurement): void;
  /** 空振り・バックスイングなしなどの通知 */
  onNotice(text: string): void;
}

/**
 * パターヘッド（§4.4）。指を置く前から待機位置にいる。
 * angle は軌跡の向き [rad]。真左（狙い方向）が π。ローカル X が軌跡方向、ローカル Y がフェース。
 */
interface Putter {
  x: number;
  y: number;
  /** 実際に描く角度。目標角へ時定数で寄せる */
  angle: number;
  /** 目標角。最小二乗フィットの結果をそのまま入れる */
  targetAngle: number;
  mode: 'rest' | 'follow';
  /** この一振りでインパクト済みか */
  struck: boolean;
}

/** 端末によっては捕捉できないことがある。捕捉できなくてもストロークは成立させる */
function capture(target: Element, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // 捕捉できないだけなので無視する
  }
}

export class StrokeView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly measure = new SwipeMeasure();

  private active = false;
  private pointerId: number | null = null;

  /** ボールの定位置（画面中央） */
  private ballX = 0;
  private ballY = 0;
  /**
   * インパクトライン（§4.2）。フェースがボールの右端に触れる位置。
   * ボール中心で判定すると、当たる前にパターがボールへめり込んで見える。
   */
  private impactX = 0;

  private live: Sample | null = null;

  /**
   * 打ったあとのボールの画面位置 [px]。物理のワールド座標をカメラで投影したものを
   * main.ts から入れてもらう。null の間はボールは定位置（画面中央）にいる。
   * 打った直後は視点を動かさないので、ボールが画面から出ていくところまでここで見せる（§3 FOLLOW）
   */
  private released: { x: number; y: number } | null = null;

  private readonly putter: Putter = {
    x: 0,
    y: 0,
    angle: Math.PI,
    targetAngle: Math.PI,
    mode: 'rest',
    struck: false,
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: StrokeCallbacks,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    this.resize();
  }

  /** 画面サイズが変わったら呼ぶ */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ballX = w / 2;
    this.ballY = h / 2;
    this.impactX = this.ballX + C.ballRadius + C.putterWidth / 2;
    if (!this.active || this.pointerId === null) this.restPutter();
  }

  /** STROKE に入る。オーバーレイを出してスワイプを待つ */
  enter(): void {
    this.active = true;
    this.pointerId = null;
    this.live = null;
    this.released = null;
    this.measure.cancel();
    this.restPutter();
    this.canvas.style.display = 'block';
  }

  /** STROKE を抜ける */
  exit(): void {
    this.active = false;
    this.pointerId = null;
    this.live = null;
    this.released = null;
    this.measure.cancel();
    this.canvas.style.display = 'none';
  }

  /**
   * 打ったあとのボールの画面位置を入れる [px]。ここから先はボールは物理で動いている。
   * 画面の外に出たら描かない
   */
  setBallScreen(x: number, y: number): void {
    this.released = { x, y };
  }

  /**
   * 毎フレーム。フェース角を目標角へ時定数で寄せてから描く。
   * angle += (target - angle) * (1 - exp(-dt / tau)) はフレームレートに依存しない形。
   */
  update(dt: number): void {
    if (!this.active) return;
    const k = 1 - Math.exp(-dt / S.faceSmoothingTau);
    this.putter.angle += wrapPi(this.putter.targetAngle - this.putter.angle) * k;
    this.draw();
  }

  private restPutter(): void {
    this.putter.x = this.ballX + C.putterRestOffsetPx;
    this.putter.y = this.ballY;
    this.putter.angle = Math.PI;
    this.putter.targetAngle = Math.PI;
    this.putter.mode = 'rest';
    this.putter.struck = false;
  }

  private toSample(e: PointerEvent): Sample {
    return { x: e.clientX, y: e.clientY, t: e.timeStamp };
  }

  /** 取りこぼしを防ぐため coalesced 込みで全サンプルを取り出す（§4.3） */
  private samplesOf(e: PointerEvent): Sample[] {
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (coalesced.length === 0) return [this.toSample(e)];
    return coalesced.map((c) => this.toSample(c));
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.active || this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    capture(this.canvas, e.pointerId);
    this.measure.begin(this.impactX, this.toSample(e));
    this.live = this.toSample(e);
    this.putter.mode = 'follow';
    this.putter.x = e.clientX;
    this.putter.y = this.ballY;
    this.putter.struck = false;
    this.callbacks.onNotice('右へ引いてください');
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.pointerId) return;
    for (const s of this.samplesOf(e)) {
      this.live = s;
      const wasArmed = this.measure.armed();
      const r = this.measure.add(s);
      if (!wasArmed && this.measure.armed()) this.callbacks.onNotice('振り抜いてください');

      // 指に追従する。インパクト後も空振りのあとも追従したまま振り抜かせる（§4.4）
      if (this.putter.mode === 'follow') {
        const v = this.measure.liveVelocity();
        if (v) this.putter.targetAngle = faceAngleFrom(v.vx, v.vy, this.putter.targetAngle);
        this.putter.x = this.followX(s.x);
        this.putter.y = this.measure.putterY(this.ballY, s);
      }

      if (r === null) continue;
      if (r === 'no-backswing') {
        this.callbacks.onNotice('バックスイングなし — 無効');
      } else if (r === 'too-few-samples') {
        this.callbacks.onNotice('サンプル不足 — 無効');
      } else if (r === 'whiff') {
        this.callbacks.onNotice(
          `空振り — 芯から ${Math.round(Math.abs(this.measure.lastOffsetPx()))}px 外れました`,
        );
      } else {
        this.putter.struck = true;
        this.putter.x = this.impactX;
        this.putter.y = this.ballY - r.offsetPx;
        this.callbacks.onImpact(r);
        return;
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.live = null;
    this.restPutter();
    if (this.measure.end() === 'no-backswing') {
      this.callbacks.onNotice('右へ引いていません — 無効');
    }
  };

  /**
   * 指の X をパターの X に直す（§4.4）。
   * インパクト後は、フェースがボールの右端より左へ行かないよう頭打ちにする。
   */
  private followX(fingerX: number): number {
    if (!this.putter.struck) return fingerX;
    return Math.max(fingerX, this.impactX);
  }

  // --- 描画 ---------------------------------------------------------------

  private draw(): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    const armed = this.measure.armed();

    // インパクトライン。打てる状態でだけ実線で明るくする
    ctx.setLineDash(armed ? [] : [4, 6]);
    ctx.strokeStyle = armed ? 'rgba(140,255,180,0.75)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.impactX, 0);
    ctx.lineTo(this.impactX, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // バックスイングのゲート線。ここまで右へ引かないとダウンスイングが解禁されない（§4.2）
    if (this.live) {
      const gx = this.measure.gateX();
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = armed ? 'rgba(140,255,180,0.5)' : 'rgba(255,180,120,0.85)';
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    this.drawTrail();
    this.drawToes(w, h);

    // ボール。真下視点では実寸だと小さすぎるので px で描く。
    // 打ったあとは物理の位置（投影済み）へ移る
    const bx = this.released ? this.released.x : this.ballX;
    const by = this.released ? this.released.y : this.ballY;
    const r = C.ballRadius;
    if (bx > -r && bx < w + r && by > -r && by < h + r) {
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = '#f4f6f2';
      ctx.fill();
    }

    this.drawPutter(armed);
  }

  /**
   * 指の軌跡（直近 trailMs）。/swipe-test/ と同じ描き方。
   * サンプル点も打つので、密度＝サンプリングレートが目で見える
   */
  private drawTrail(): void {
    const all = this.measure.samples();
    if (all.length < 2) return;
    const ctx = this.ctx;
    const tEnd = all[all.length - 1].t;

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(120,200,255,0.7)';
    ctx.beginPath();
    let started = false;
    for (const s of all) {
      if (tEnd - s.t > C.trailMs) continue;
      if (started) ctx.lineTo(s.x, s.y);
      else {
        ctx.moveTo(s.x, s.y);
        started = true;
      }
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(120,200,255,0.9)';
    for (const s of all) {
      if (tEnd - s.t > C.trailMs) continue;
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
  }

  /** つま先。STROKE で見えるのはボール・パターヘッド・つま先だけ（§3） */
  private drawToes(w: number, h: number): void {
    const ctx = this.ctx;
    const y = h - S.toeBottomPx - S.toeHeightPx;
    ctx.fillStyle = 'rgba(28,34,30,0.85)';
    for (const sign of [-1, 1]) {
      const cx = w / 2 + sign * (S.toeGapPx / 2 + S.toeWidthPx / 2);
      ctx.beginPath();
      ctx.ellipse(cx, y, S.toeWidthPx / 2, S.toeHeightPx / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** フェースをスイング軌跡と直角に描く（§4.4）。芯の範囲は色を変える */
  private drawPutter(armed: boolean): void {
    const ctx = this.ctx;
    const rest = this.putter.mode === 'rest';
    const face = rest
      ? 'rgba(150,175,160,0.55)'
      : armed
        ? 'rgba(140,255,180,0.95)'
        : 'rgba(255,180,120,0.6)';
    const spot = rest
      ? 'rgba(18,26,22,0.7)'
      : armed
        ? 'rgba(20,40,28,0.85)'
        : 'rgba(40,26,14,0.7)';
    ctx.save();
    ctx.translate(this.putter.x, this.putter.y);
    ctx.rotate(this.putter.angle);
    ctx.fillStyle = face;
    ctx.fillRect(-C.putterWidth / 2, -C.putterLength / 2, C.putterWidth, C.putterLength);
    ctx.fillStyle = spot;
    ctx.fillRect(-C.putterWidth / 2, -C.sweetSpotPx, C.putterWidth, C.sweetSpotPx * 2);
    ctx.restore();
  }
}
