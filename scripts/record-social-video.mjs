import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = process.env.PUTT_URL ?? 'http://127.0.0.1:4173/putt';
const plan = JSON.parse(await fs.readFile(process.env.PUTT_PLAN ?? 'social-plan.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  // Keep the game in its real 390x640 mobile layout, but render at a 2x device scale.
  // Playwright's built-in video recorder only records CSS pixels and pads a larger video,
  // so high-resolution capture is done with a CDP screencast below instead.
  viewport: { width: 390, height: 640 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const captureCdp = await context.newCDPSession(page);
const frameDir = 'social-video-frames';
const capturedFrames = [];
const frameWrites = [];
let frameIndex = 0;

await fs.mkdir(frameDir, { recursive: true });

captureCdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const file = `frame-${String(frameIndex++).padStart(6, '0')}.jpg`;
  const timestamp = metadata?.timestamp ?? Date.now() / 1000;
  capturedFrames.push({ file, timestamp });
  frameWrites.push(fs.writeFile(`${frameDir}/${file}`, Buffer.from(data, 'base64')));
  void captureCdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
try {
await page.goto(`${base}/?mode=practice&tour=beginner&seed=${plan.seed}&social=1&lang=ja`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__puttSocial);

// Capture the composited browser page itself rather than Playwright's 25fps-ish video path.
// With deviceScaleFactor=2 this keeps the 390x640 logical layout while producing 780x1280 frames.
await captureCdp.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 92,
  maxWidth: 780,
  maxHeight: 1280,
  everyNthFrame: 1,
});
await page.waitForTimeout(500);

// Establish the whole hole first so the slope/hazard context is readable in a short clip.
await page.evaluate(() => window.__puttSocial.map());
await page.waitForTimeout(1500);
await page.evaluate(() => window.__puttSocial.map());
await page.waitForTimeout(900);

// Let the solver choose the final line, but approach it like a person reading the green.
// The small overshoot/correction is deterministic: clips remain reproducible while the cursor
// no longer snaps mechanically to the mathematically solved angle.
const position = await page.evaluate(() => window.__puttSocial.position());
const initialAim = Math.atan2(
  position.cup.x - position.ball.x,
  -(position.cup.z - position.ball.z),
);
let currentAim = initialAim;
async function easeAim(target, durationMs) {
  const from = currentAim;
  const steps = Math.max(6, Math.round(durationMs / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t * t * (3 - 2 * t);
    const direction = from + (target - from) * eased;
    const aimed = await page.evaluate((value) => window.__puttSocial.aim(value), direction);
    if (!aimed) throw new Error('Social driver refused aim');
    await page.waitForTimeout(durationMs / steps);
  }
  currentAim = target;
}
await easeAim(plan.direction - 0.055, 360);
await easeAim(plan.direction + 0.022, 280);
await easeAim(plan.direction - 0.010, 220);
await easeAim(plan.direction, 360);

await page.mouse.click(195, 320);
await page.waitForFunction(() => {
  const el = document.getElementById('stroke');
  return window.__puttSocial.state() === 'STROKE' && el && getComputedStyle(el).display === 'block';
}, null, { timeout: 3000 });
await page.waitForTimeout(450);

// Use a separate CDP session for input. Keeping it away from screencast frame/ack traffic
// makes the timestamp-sensitive impact samples deterministic on GitHub Actions.
const inputCdp = await context.newCDPSession(page);

// Use CDP timestamps so SwipeMeasure sees the solver's exact launch speed while the wall-clock
// pauses keep the backswing/downswing visible in the recorded clip.
const x0 = 195;
const y = 320;
let ts = Date.now() / 1000;
await inputCdp.send('Input.dispatchMouseEvent', {
  type: 'mouseMoved', x: x0, y, button: 'none', buttons: 0, timestamp: ts,
});
await inputCdp.send('Input.dispatchMouseEvent', {
  type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1, timestamp: ts,
});

// Use a much larger, readable stroke (about 2.5x the previous travel) with a tiny vertical
// wobble. The final 40 ms remains solver-accurate, so the production swipe fitter still launches
// the planned speed/direction instead of bypassing real input handling.
async function moveStroke(from, to, durationMs, wobble = 0) {
  const steps = Math.max(2, Math.round(durationMs / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t * t * (3 - 2 * t);
    const x = from[0] + (to[0] - from[0]) * eased;
    const baseY = from[1] + (to[1] - from[1]) * eased;
    const yy = baseY + Math.sin(t * Math.PI * 2) * wobble;
    ts += durationMs / steps / 1000;
    await inputCdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y: yy, button: 'left', buttons: 1, timestamp: ts,
    });
    await page.waitForTimeout(durationMs / steps);
  }
}

await moveStroke([195, 320], [345, 319], 440, 2.0);

// Accelerate back through the ball with a small deterministic hand wobble. The final impact
// window below remains solver-accurate, so this visual smoothing does not change the shot.
await moveStroke([345, 319], [249, 320], 185, 1.7);

// Solver-accurate impact window. Four pixels per sample gives enough samples inside the 40 ms fit.
const speedK = 0.00266;
const pxPerSample = 4;
const dt = pxPerSample / (plan.speed / speedK);
for (let x = 245; x >= 155; x -= pxPerSample) {
  ts += dt;
  await inputCdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, button: 'left', buttons: 1, timestamp: ts,
  });
  await page.waitForTimeout(Math.max(1, dt * 1000));
  if ((await page.evaluate(() => window.__puttSocial.state())) !== 'STROKE') break;
}
ts += dt;
await inputCdp.send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x: 151, y, button: 'left', buttons: 0, clickCount: 1, timestamp: ts,
});

await page.waitForFunction(() => window.__puttSocial.lastShot() !== null, null, { timeout: 3000 });
const actual = await page.evaluate(() => window.__puttSocial.lastShot());
if (Math.abs(actual.speed - plan.speed) > 0.04) {
  throw new Error(`Swipe speed mismatch: planned ${plan.speed.toFixed(3)}, actual ${actual.speed.toFixed(3)}`);
}
if (Math.abs(actual.direction - plan.direction) > 0.01) {
  throw new Error(`Swipe direction mismatch: planned ${plan.direction.toFixed(4)}, actual ${actual.direction.toFixed(4)}`);
}

await page.waitForFunction(() => ['RESULT', 'PRACTICE_END'].includes(window.__puttSocial.state()), null, { timeout: 15000 });
await page.waitForTimeout(3200);

const finalState = await page.evaluate(() => window.__puttSocial.state());
if (finalState !== 'PRACTICE_END') throw new Error(`Expected cup-in, got ${finalState}`);
// Hold the score card long enough to read in the final social clip.
await page.waitForTimeout(1800);

await captureCdp.send('Page.stopScreencast');
await page.waitForTimeout(120);
await Promise.all(frameWrites);
if (capturedFrames.length < 30) {
  throw new Error(`Too few screencast frames: ${capturedFrames.length}`);
}

const concat = ['ffconcat version 1.0'];
for (let i = 0; i < capturedFrames.length; i++) {
  const frame = capturedFrames[i];
  const next = capturedFrames[i + 1];
  let duration = next ? next.timestamp - frame.timestamp : 1 / 60;
  if (!Number.isFinite(duration) || duration <= 0) duration = 1 / 60;
  duration = Math.min(0.25, Math.max(1 / 240, duration));
  concat.push(`file '${frame.file}'`);
  concat.push(`duration ${duration.toFixed(6)}`);
}
// concat demuxer needs the last frame repeated for its duration to be honored.
concat.push(`file '${capturedFrames.at(-1).file}'`);
await fs.writeFile(`${frameDir}/frames.ffconcat`, `${concat.join('\n')}\n`);

const elapsed = capturedFrames.at(-1).timestamp - capturedFrames[0].timestamp;
await fs.writeFile(
  `${frameDir}/stats.json`,
  JSON.stringify({
    frames: capturedFrames.length,
    elapsedSeconds: elapsed,
    averageCaptureFps: elapsed > 0 ? (capturedFrames.length - 1) / elapsed : null,
  }, null, 2),
);
await fs.copyFile(`${frameDir}/${capturedFrames[0].file}`, 'social-first-frame.jpg');
await context.close();
} finally {
  await browser.close();
}
