// /swipe-test/ — スワイプの速度計測とパターの所作を検証する単独ページ。
// ゲームのロジック（物理・カメラ・状態機械）は一切持たない。
// ボールの転がりは §4.7 の「打てたことが分かる」ための演出であって、§2 の物理とは別物。
import { CONFIG } from './config';
import { SwipeMeasure, mean, stddev, type Measurement, type Sample } from './swipe-measure';

const C = CONFIG.swipeTest;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const elSpeed = document.getElementById('speed')!;
const elBallSpeed = document.getElementById('ballspeed')!;
const elAngle = document.getElementById('angle')!;
const elOffset = document.getElementById('offset')!;
const elGain = document.getElementById('gain')!;
const elBackswing = document.getElementById('backswing')!;
const elDetail = document.getElementById('detail')!;
const elStatus = document.getElementById('status')!;
const elHistory = document.getElementById('history')!;
const elStats = document.getElementById('stats')!;

const measure = new SwipeMeasure();
const history: Measurement[] = [];

let pointerId: number | null = null;
/** ボールの定位置。画面中央に固定で、転がっているボールの位置とは別 */
let ballX = 0;
let ballY = 0;
/**
 * インパクトライン（§4.2）。フェースがボールの右端に触れる位置。
 * ボール中心で判定すると、当たる前にパターがボールへめり込んで見える。
 */
let impactX = 0;
let live: Sample | null = null;
let lastImpactAt = -Infinity;

/** 転がるボール（演出）。停止・画面外から ballResetMs 後に中央へ戻す */
const ball = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  rolling: false,
  /** 停止した時刻 [ms]。まだ停止していなければ -Infinity */
  stoppedAt: -Infinity,
};

/**
 * パターヘッド（§4.4）。指を置く前から待機位置にいる。
 * rest = アドレス、follow = 指に追従、through = インパクト後の惰性。
 */
const putter = {
  x: 0,
  y: 0,
  /** 軌跡の向き [rad]。真左（狙い方向）が π。ローカル X が軌跡方向、ローカル Y がフェース */
  angle: Math.PI,
  vx: 0,
  vy: 0,
  mode: 'rest' as 'rest' | 'follow' | 'through',
};

/** パターをアドレス位置（ボールの右）へ戻す */
function restPutter(): void {
  putter.x = ballX + C.putterRestOffsetPx;
  putter.y = ballY;
  putter.angle = Math.PI;
  putter.vx = 0;
  putter.vy = 0;
  putter.mode = 'rest';
}

/** ボールとパターをまとめて構え直しの状態へ戻す */
function resetStroke(): void {
  ball.x = ballX;
  ball.y = ballY;
  ball.vx = 0;
  ball.vy = 0;
  ball.rolling = false;
  ball.stoppedAt = -Infinity;
  restPutter();
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ballX = window.innerWidth / 2;
  ballY = window.innerHeight / 2;
  impactX = ballX + C.ballRadius + C.putterWidth / 2;
  resetStroke();
}
window.addEventListener('resize', resize);
resize();

function toSample(e: PointerEvent): Sample {
  return { x: e.clientX, y: e.clientY, t: e.timeStamp };
}

/** 取りこぼしを防ぐため coalesced 込みで全サンプルを取り出す */
function samplesOf(e: PointerEvent): Sample[] {
  const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  if (coalesced.length === 0) return [toSample(e)];
  return coalesced.map(toSample);
}

canvas.addEventListener('pointerdown', (e) => {
  if (pointerId !== null) return;
  pointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  resetStroke();
  measure.begin(impactX, toSample(e));
  live = toSample(e);
  putter.mode = 'follow';
  putter.x = e.clientX;
  putter.y = ballY;
  setStatus('右へ引いてください', 'wait');
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointerId) return;
  for (const s of samplesOf(e)) {
    live = s;
    const wasArmed = measure.armed();
    const r = measure.add(s);
    if (!wasArmed && measure.armed()) setStatus('振り抜いてください', 'wait');
    // インパクトするまでは指に追従する。空振りのあともそのまま振り抜かせる
    if (putter.mode === 'follow') {
      const v = measure.liveVelocity();
      if (v) putter.angle = faceAngleFrom(v.vx, v.vy, putter.angle);
      putter.x = s.x;
      putter.y = measure.putterY(ballY, s);
    }
    if (r === null) continue;
    if (r === 'no-backswing') {
      setStatus('バックスイングなし — 無効', 'ng');
    } else if (r === 'too-few-samples') {
      setStatus('サンプル不足 — 無効', 'ng');
    } else if (r === 'whiff') {
      // フェース端を超えた。指を離して構え直す
      lastImpactAt = -Infinity;
      elOffset.textContent = fmt(measure.lastOffsetPx(), 0);
      elGain.textContent = '—';
      setStatus(`空振り — 芯から ${Math.round(Math.abs(measure.lastOffsetPx()))}px 外れました`, 'ng');
    } else {
      record(r);
    }
  }
});

function end(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  live = null;
  // 惰性で流れている最中は触らない。それ以外はアドレスへ戻す
  if (putter.mode !== 'through') restPutter();
  if (measure.end() === 'no-backswing') {
    setStatus('右へ引いていません — 無効', 'ng');
  }
}
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);

function setStatus(text: string, kind: 'wait' | 'ng' | 'ok'): void {
  elStatus.textContent = text;
  elStatus.className = kind;
}

function record(m: Measurement): void {
  lastImpactAt = performance.now();
  history.unshift(m);
  if (history.length > C.historySize) history.length = C.historySize;

  launchStroke(m);

  elSpeed.textContent = Math.round(m.speed).toString();
  elBallSpeed.textContent = m.speedMs.toFixed(2);
  elAngle.textContent = fmt((m.angle * 180) / Math.PI, 1);
  elOffset.textContent = fmt(m.offsetPx, 0);
  elGain.textContent = m.gain.toFixed(2);
  elBackswing.textContent = Math.round(m.backswingPx).toString();
  elDetail.textContent =
    `vx ${Math.round(m.vx)} / vy ${Math.round(m.vy)} px/s ・ ` +
    `フィット ${m.fitSamples} 点 / ${fmt(m.fitWindowMs, 1)}ms ・ ` +
    `実効 ${Math.round(m.sampleRateHz)}Hz`;
  setStatus(m.gain < 1 ? '計測 — 芯を外しました' : '計測 — 芯', 'ok');
  renderHistory();
}

/**
 * 計測速度（減衰込み）に応じてボールを転がし、パターを惰性へ移す。
 * 見た目のフィードバック（§4.7）。
 */
function launchStroke(m: Measurement): void {
  // 減衰込みのボール初速 [m/s] を画面のピクセルに直す。スワイプの px/s ではなく物理速度が基準
  const v = m.speedMs * C.ballPxPerMeter;
  ball.x = ballX;
  ball.y = ballY;
  ball.vx = -v * Math.cos(m.launchAngle);
  ball.vy = v * Math.sin(m.launchAngle);
  ball.rolling = v > 0;
  ball.stoppedAt = ball.rolling ? -Infinity : performance.now();

  // パターは指から切り離し、フェースの向きへ流す。ボールと同じ減速で初速だけ遅いので
  // 追い越しは起こらない（§4.4）
  const pv = v * C.putterFollowRatio;
  putter.x = impactX;
  putter.y = ballY - m.offsetPx;
  putter.vx = pv * Math.cos(putter.angle);
  putter.vy = pv * Math.sin(putter.angle);
  putter.mode = 'through';
}

/** 転がりの減速 [px/s^2]。スティンプ相当の摩擦を画面スケールに直したもの */
const decelPx = C.ballDecelMs2 * C.ballPxPerMeter;

/** 一定減速で流す。位置を進めて速度を落とし、止まったら true */
type Moving = { x: number; y: number; vx: number; vy: number };

function coast(o: Moving, dt: number, decel: number): boolean {
  const speed = Math.hypot(o.vx, o.vy);
  o.x += o.vx * dt;
  o.y += o.vy * dt;
  const next = speed - decel * dt;
  if (next <= 0) {
    o.vx = 0;
    o.vy = 0;
    return true;
  }
  const k = next / speed;
  o.vx *= k;
  o.vy *= k;
  return false;
}

/** 転がるボール。止まるか画面外へ抜けたら、しばらくして構え直しの状態に戻る */
function stepBall(dt: number, now: number): void {
  if (ball.rolling) {
    const r = C.ballRadius;
    const off = ball.x < -r || ball.y < -r || ball.y > window.innerHeight + r;
    if (coast(ball, dt, decelPx) || off) {
      ball.rolling = false;
      ball.stoppedAt = now;
    }
    return;
  }
  // 停止してしばらくしたら戻す。構えている間は戻さない
  if (pointerId === null && now - ball.stoppedAt > C.ballResetMs) resetStroke();
}

/** インパクト後のフォロースルー */
function stepPutter(dt: number): void {
  if (putter.mode === 'through') coast(putter, dt, decelPx);
}

/** [-π, π) に畳む */
function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * スイング速度からフェースの向きを決める（§4.4）。
 * 真左（狙い方向）を基準に、右向きの動きは鏡映して反転を防ぎ、傾きは faceMaxAngleDeg で頭打ちにする。
 * 止まっている間は直前の向きを保つ。
 */
function faceAngleFrom(vx: number, vy: number, current: number): number {
  if (Math.hypot(vx, vy) < C.faceMinSpeedPx) return current;
  let d = wrapPi(Math.atan2(vy, vx) - Math.PI);
  if (Math.abs(d) > Math.PI / 2) d = wrapPi(d + Math.PI);
  const max = (C.faceMaxAngleDeg * Math.PI) / 180;
  return Math.PI + Math.max(-max, Math.min(max, d));
}

function fmt(v: number, digits: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(digits);
}

function renderHistory(): void {
  elHistory.innerHTML = history
    .map((m, i) => {
      const n = history.length - i;
      return (
        `<li><span class="n">${n}</span>` +
        `<span class="v">${Math.round(m.speed)}<i>px/s</i></span>` +
        `<span class="a">${fmt((m.angle * 180) / Math.PI, 1)}°</span>` +
        `<span class="o">${fmt(m.offsetPx, 0)}px</span>` +
        `<span class="g">×${m.gain.toFixed(2)}</span></li>`
      );
    })
    .join('');

  const speeds = history.map((m) => m.speed);
  const angles = history.map((m) => (m.angle * 180) / Math.PI);
  if (speeds.length < 2) {
    elStats.textContent = `${speeds.length} 回`;
    return;
  }
  const sd = stddev(speeds);
  const mn = mean(speeds);
  elStats.textContent =
    `${speeds.length} 回 ・ 速度 平均 ${Math.round(mn)} / σ ${Math.round(sd)} px/s ` +
    `(${(mn > 0 ? (sd / mn) * 100 : 0).toFixed(1)}%) ・ ` +
    `角度 σ ${stddev(angles).toFixed(1)}° ・ ` +
    `ズレ σ ${stddev(history.map((m) => m.offsetPx)).toFixed(0)}px`;
}

/**
 * フェースをスイング軌跡と直角に描く（§4.4）。芯の範囲は色を変える。
 * 軌跡の向きに回転させると、ローカル X が軌跡方向・ローカル Y がフェース方向になる。
 */
function drawPutter(armed: boolean): void {
  const face =
    putter.mode === 'rest'
      ? 'rgba(150,175,160,0.55)'
      : armed
        ? 'rgba(140,255,180,0.95)'
        : 'rgba(255,180,120,0.6)';
  const spot =
    putter.mode === 'rest'
      ? 'rgba(18,26,22,0.7)'
      : armed
        ? 'rgba(20,40,28,0.85)'
        : 'rgba(40,26,14,0.7)';
  ctx.save();
  ctx.translate(putter.x, putter.y);
  ctx.rotate(putter.angle);
  ctx.fillStyle = face;
  ctx.fillRect(-C.putterWidth / 2, -C.putterLength / 2, C.putterWidth, C.putterLength);
  ctx.fillStyle = spot;
  ctx.fillRect(-C.putterWidth / 2, -C.sweetSpotPx, C.putterWidth, C.sweetSpotPx * 2);
  ctx.restore();
}

let lastFrame = -1;

function draw(now: number): void {
  const dt = lastFrame < 0 ? 0 : Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  stepBall(dt, now);
  stepPutter(dt);

  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  const armed = measure.armed();

  // インパクトライン（ボールの X 座標）。打てる状態でだけ実線で明るくする
  ctx.setLineDash(armed ? [] : [4, 6]);
  ctx.strokeStyle = armed ? 'rgba(140,255,180,0.75)' : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(impactX, 0);
  ctx.lineTo(impactX, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // バックスイングのゲート線。ここまで右へ引かないとダウンスイングが解禁されない
  if (live) {
    const gx = measure.gateX();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = armed ? 'rgba(140,255,180,0.5)' : 'rgba(255,180,120,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 軌跡
  const all = measure.samples();
  if (all.length > 1) {
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

    // サンプル点。密度＝サンプリングレートが目で見える
    ctx.fillStyle = 'rgba(120,200,255,0.9)';
    for (const s of all) {
      if (tEnd - s.t > C.trailMs) continue;
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
  }

  // ボール。インパクト直後だけ光らせる
  const since = now - lastImpactAt;
  const flash = Math.max(0, 1 - since / 250);
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, C.ballRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#f2f4f0';
  ctx.fill();
  if (flash > 0) {
    ctx.beginPath();
    ctx.arc(ballX, ballY, C.ballRadius + 10 + flash * 20, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,220,120,${flash})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // パターヘッド。指を置く前から待機位置に見えている（§4.4）
  drawPutter(armed);

  // 指の現在位置
  if (live) {
    ctx.beginPath();
    ctx.arc(live.x, live.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
  }

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

renderHistory();
setStatus('画面に指を置いて、右へ引いてから左へ振り抜く', 'wait');
