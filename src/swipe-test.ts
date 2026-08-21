// /swipe-test/ — スワイプの速度計測だけを検証する単独ページ。
// ゲームのロジック（物理・カメラ・状態機械）は一切持たない。
import { CONFIG } from './config';
import { SwipeMeasure, mean, stddev, type Measurement, type Sample } from './swipe-measure';

const C = CONFIG.swipeTest;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const elSpeed = document.getElementById('speed')!;
const elAngle = document.getElementById('angle')!;
const elBackswing = document.getElementById('backswing')!;
const elDetail = document.getElementById('detail')!;
const elStatus = document.getElementById('status')!;
const elHistory = document.getElementById('history')!;
const elStats = document.getElementById('stats')!;

const measure = new SwipeMeasure();
const history: Measurement[] = [];

let pointerId: number | null = null;
let ballX = 0;
let ballY = 0;
let live: Sample | null = null;
let lastImpactAt = -Infinity;

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ballX = window.innerWidth / 2;
  ballY = window.innerHeight / 2;
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
  measure.begin(ballX, toSample(e));
  live = toSample(e);
  setStatus('右へ引いてください', 'wait');
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointerId) return;
  for (const s of samplesOf(e)) {
    live = s;
    const wasArmed = measure.armed();
    const r = measure.add(s);
    if (!wasArmed && measure.armed()) setStatus('振り抜いてください', 'wait');
    if (r === null) continue;
    if (r === 'no-backswing') {
      setStatus('バックスイングなし — 無効', 'ng');
    } else if (r === 'too-few-samples') {
      setStatus('サンプル不足 — 無効', 'ng');
    } else {
      record(r);
    }
  }
});

function end(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  live = null;
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

  elSpeed.textContent = Math.round(m.speed).toString();
  elAngle.textContent = fmt((m.angle * 180) / Math.PI, 1);
  elBackswing.textContent = Math.round(m.backswingPx).toString();
  elDetail.textContent =
    `vx ${Math.round(m.vx)} / vy ${Math.round(m.vy)} px/s ・ ` +
    `フィット ${m.fitSamples} 点 / ${fmt(m.fitWindowMs, 1)}ms ・ ` +
    `実効 ${Math.round(m.sampleRateHz)}Hz`;
  setStatus('計測', 'ok');
  renderHistory();
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
        `<span class="b">${Math.round(m.backswingPx)}px</span></li>`
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
    `角度 σ ${stddev(angles).toFixed(1)}°`;
}

function draw(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  const armed = measure.armed();

  // インパクトライン（ボールの X 座標）。打てる状態でだけ実線で明るくする
  ctx.setLineDash(armed ? [] : [4, 6]);
  ctx.strokeStyle = armed ? 'rgba(140,255,180,0.75)' : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ballX, 0);
  ctx.lineTo(ballX, h);
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

  // ボールを模した円。インパクト直後だけ光らせる
  const since = performance.now() - lastImpactAt;
  const flash = Math.max(0, 1 - since / 250);
  ctx.beginPath();
  ctx.arc(ballX, ballY, C.ballRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#f2f4f0';
  ctx.fill();
  if (flash > 0) {
    ctx.beginPath();
    ctx.arc(ballX, ballY, C.ballRadius + 10 + flash * 20, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,220,120,${flash})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // パターヘッド。指の X に立てる。アームされるまでは打てないことを色で示す
  if (live) {
    ctx.fillStyle = armed ? 'rgba(140,255,180,0.95)' : 'rgba(255,180,120,0.6)';
    ctx.fillRect(
      live.x - C.putterWidth / 2,
      ballY - C.putterHeight / 2,
      C.putterWidth,
      C.putterHeight,
    );
  }

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
