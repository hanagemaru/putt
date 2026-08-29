// STROKE の 2D オーバーレイ（spec §4）。真下を見下ろす 3D の上に重ねて、
// パターヘッド・つま先・ゲート線・スイング軌跡を px 空間で描く。
// ボールとカップは 3D のまま（実寸）。ここで px の円を描くと転がる画面と大きさが食い違う。
//
// 計測そのものは /swipe-test/ で検証済みの SwipeMeasure をそのまま使う。
// px → m の換算を新しく作らないので、ゲーム本体でも検証ページと同じ手応えになる。
// ゲーム本体では pointerdown の絶対座標ではなく、待機中パターを原点にした指の移動量を
// SwipeMeasure へ渡す。平行移動だけなので速度・角度・バックスイング幅の計測値は変わらない。
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
  /** 目標角。計測角をゲーム本体用の感度で鈍らせた値 */
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
   * ボールの見かけの半径 [px]。3D のボールを投影した実寸で、main.ts から入れてもらう。
   * ここで px の定数を持つと、転がる画面のボールと大きさが食い違う
   */
  private ballRadiusPx = 0;
  /**
   * インパクトライン（§4.2）。フェースがボールの右端に触れる位置。
   * ボール中心で判定すると、当たる前にパターがボールへめり込んで見える。
   */
  private impactX = 0;

  /** pointerdown の絶対座標。以後はここからの変位だけをパターへ反映する */
  private touchStartX = 0;
  private touchStartY = 0;
  /** pointerdown 時点のパター位置。通常はボール直後の待機位置 */
  private putterStartX = 0;
  private putterStartY = 0;

  private live: Sample | null = null;

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

  /**
   * ボールの見かけの半径 [px]。3D のボールを投影した値を渡す。
   * インパクトラインの位置がこれで決まるので、リサイズのたびに入れ直す
   */
  setBallRadiusPx(radiusPx: number): void {
    this.ballRadiusPx = radiusPx;
    this.impactX = this.ballX + radiusPx + C.putterWidth / 2;
    if (!this.active || this.pointerId === null) this.restPutter();
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
    this.impactX = this.ballX + this.ballRadiusPx + C.putterWidth / 2;
    if (!this.active || this.pointerId === null) this.restPutter();
  }

  /** STROKE に入る。オーバーレイを出してスワイプを待つ */
  enter(): void {
    this.active = true;
    this.pointerId = null;
    this.live = null;
    this.measure.cancel();
    this.restPutter();
    this.canvas.style.display = 'block';
  }

  /** STROKE を抜ける */
  exit(): void {
    this.active = false;
    this.pointerId = null;
    this.live = null;
    this.measure.cancel();
    this.canvas.style.display = 'none';
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
    // /swipe-test/ の待機位置36pxは、ボール半径28px＋パター半幅5px＋隙間3px。
    // ゲーム本体は3Dボールの見かけ半径が端末/FOVで変わるため、中心から36pxではなく
    // 同じ「ボール表面からの隙間」を使い、フェースをボールのすぐ後ろへ置く。
    const restGapPx = Math.max(C.putterRestOffsetPx - C.ballRadius - C.putterWidth / 2, 0);
    this.putter.x = this.impactX + restGapPx;
    this.putter.y = this.ballY;
    this.putter.angle = Math.PI;
    this.putter.targetAngle = Math.PI;
    this.putter.mode = 'rest';
    this.putter.struck = false;
  }

  /**
   * 生の指座標を、pointerdown 時点の待機パターを原点にした仮想パター座標へ移す。
   * X/Yとも pointerdown だけでは変化せず、その後の指の移動量だけが反映される。
   */
  private toSample(e: PointerEvent): Sample {
    return {
      x: this.putterStartX + (e.clientX - this.touchStartX),
      y: this.putterStartY + (e.clientY - this.touchStartY),
      t: e.timeStamp,
    };
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

    // pointerdown ではパターを動かさない。ここからの ΔX / ΔY だけを以後の座標に使う。
    this.touchStartX = e.clientX;
    this.touchStartY = e.clientY;
    this.putterStartX = this.putter.x;
    this.putterStartY = this.putter.y;
    const first = this.toSample(e);

    this.measure.begin(this.impactX, first);
    this.live = first;
    this.putter.mode = 'follow';
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

      // 待機位置を原点に指の移動量へ追従する。インパクト後も空振りのあとも同じ（§4.4）。
      if (this.putter.mode === 'follow') {
        const v = this.measure.liveVelocity();
        if (v && Math.hypot(v.vx, v.vy) >= C.faceMinSpeedPx) {
          const measured = faceAngleFrom(v.vx, v.vy, this.putter.targetAngle);
          const offset = wrapPi(measured - Math.PI);
          this.putter.targetAngle = Math.PI + offset * S.faceAngleSensitivity;
        }
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
   * 仮想パター X を描画位置へ直す（§4.4）。
   * インパクト後は、フェースがボールの右端より左へ行かないよう頭打ちにする。
   */
  private followX(putterX: number): number {
    if (!this.putter.struck) return putterX;
    return Math.max(putterX, this.impactX);
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
    // ボールは 3D のメッシュをそのまま見せる。ここで px の円を描くと、
    // 転がる画面のボールと大きさが食い違う（§4.1）
    this.drawPutter(armed);
  }

  /**
   * パター軌跡（直近 trailMs）。指の絶対位置ではなく、指の移動量と同期したパター座標を描く。
   * サンプル点も打つので、密度＝サンプリングレートが目で見える。
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
